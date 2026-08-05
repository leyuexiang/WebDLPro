import type { TransitionId } from '@/config/scene-topology/identifiers'
import type { TopologyDeviceDoubleClickIntent } from '@/modules/visual/topology/topology-node-interaction'
import {
  isHostEventMessage,
  type HostEventMessage,
  type HostEventType,
  type HostProtocolError,
  type HostVisualizationContext,
  type SceneObjectSelectedPayload,
  type StateSnapshotPayload,
} from '@/host-bridge/host-protocol'
import type { HostBridgeSecurityContext } from '@/host-bridge/host-bridge'
import type { HostCommandLifecycleResult } from '@/host-bridge/host-command-lifecycle'

/**
 * 事件发送器依赖的最小桥接端口。
 * 该接口故意不暴露窗口对象、路由器或入站命令，确保拓扑、事务等业务层只能提交已组装的上行事件，
 * 而不能绕过 HostBridge（外层桥）直接向任意来源发送跨窗口消息。
 */
export interface HostEventTransport {
  getContext(): HostBridgeSecurityContext
  send(event: HostEventMessage): boolean
}

/**
 * 可注入的时间与序列号来源。
 * 生产环境保持单调递增的本地序列；测试可固定时间，避免事件测试依赖真实时钟或随机值。
 */
export interface HostEventSenderClock {
  now(): number
}

/**
 * 外层协议的受控事件发送器。
 * 它是 task-013 的唯一普通业务事件出口：负责补齐实例、会话、消息标识、时间戳和关联标识，
 * 并在交给 HostBridge 前再次调用协议校验器。调用方只能提供已定义的载荷，不能拼接路径、Unity 层级、
 * 原始外部消息或任意异常对象。
 */
export class HostEventSender {
  private messageSequence = 0

  public constructor(
    private readonly transport: HostEventTransport,
    private readonly clock: HostEventSenderClock = Date,
  ) {}

  /**
   * 回传命令生命周期结果。
   * `replyTo` 必定取自已验证父命令的 messageId，保证 `command.result`（命令结果）不会脱离原命令；
   * 生命周期层已把异常收敛为 HostProtocolError（外层协议受控错误），此处不读取或转发 Error.message。
   */
  public sendCommandResult(result: HostCommandLifecycleResult): boolean {
    return this.send('command.result', result.payload, result.replyTo)
  }

  /**
   * 在场景、拓扑及可选动作全部提交后发送稳定视图变更。
   * 非 ready（就绪）上下文代表事务尚未提交，必须保持静默，避免父页面观察到半成品切换状态。
   */
  public sendViewChanged(context: HostVisualizationContext, transitionId?: TransitionId): boolean {
    if (context.status !== 'ready') return false

    return this.send('view.changed', {
      sceneId: context.sceneId,
      topologyId: context.topologyId,
      actionId: context.actionId,
      contextRevision: context.contextRevision,
      ...(transitionId ? { transitionId } : {}),
    })
  }

  /**
   * 发送二维拓扑节点产生的设备双击意图。
   * 意图只能由正式清单的 `emit-device` 节点生成，因此 deviceId（设备标识）在此方法签名中强制存在；
   * 关联标识复用本事件 messageId，使父页面可以将本次用户操作与随后业务处理日志安全关联。
   */
  public sendTopologyNodeDoubleClick(intent: TopologyDeviceDoubleClickIntent, contextRevision: number): boolean {
    const correlationId = this.createMessageId('topology.node.dblclick')
    return this.send('topology.node.dblclick', {
      ...intent,
      contextRevision,
      correlationId,
    }, undefined, correlationId)
  }

  /**
   * 发送来自 task-037 映射层的三维对象选择结果。
   * 当前组合根尚不调用此方法：只有三维反向选择已完成稳定映射、去重和回环保护后才能启用，
   * 因此本发送器提供协议能力，但不会把未完成的 Unity 原始选择提前暴露给父页面。
   */
  public sendSceneObjectSelected(payload: SceneObjectSelectedPayload): boolean {
    return this.send('scene.object.selected', payload)
  }

  /**
   * 回答 `state.get`（状态查询）时发送有限运行快照。
   * 调用方必须传入原命令 messageId 作为 replyTo，状态快照不会包含设备全量状态、场景对象或原始消息。
   */
  public sendStateSnapshot(replyTo: string, payload: StateSnapshotPayload): boolean {
    return this.send('state.snapshot', payload, replyTo)
  }

  /**
   * 发送已经由领域层构造的受控错误。
   * 该签名仅接收 HostProtocolError（外层协议受控错误），从类型和出站校验两层避免把运行时异常文本直接上报。
   */
  public sendSystemError(error: HostProtocolError): boolean {
    return this.send('system.error', { error })
  }

  /**
   * 组装通用信封并执行发送前最后一层校验。
   * 自定义 messageId 仅用于双击事件的 correlationId 对齐；其余事件各自申请一个递增标识，
   * 从而在单会话内保持稳定、有限且不会依赖不可信输入的可追踪性。
   */
  private send<TType extends Exclude<HostEventType, 'system.ready' | 'system.ack'>>(
    type: TType,
    payload: Extract<HostEventMessage, { type: TType }>['payload'],
    replyTo?: string,
    messageId: string = this.createMessageId(type),
  ): boolean {
    const context = this.transport.getContext()
    const event = {
      channel: 'power-scene-topology-shell',
      version: 1,
      instanceId: context.instanceId,
      sessionId: context.sessionId,
      messageId,
      ...(replyTo ? { replyTo } : {}),
      type,
      timestamp: this.clock.now(),
      payload,
    } as Extract<HostEventMessage, { type: TType }>

    return isHostEventMessage(event) && this.transport.send(event)
  }

  /**
   * 协议标识只能包含小写安全字符；事件类型中的点号转换为连字符，序列号只在发送器实例内递增。
   * 这避免将节点标题、设备名称或父页面输入拼入 messageId，也避免额外的随机缓存和内存状态。
   */
  private createMessageId(type: HostEventType): string {
    this.messageSequence += 1
    return `shell-${type.replaceAll('.', '-')}-${this.messageSequence}`
  }
}

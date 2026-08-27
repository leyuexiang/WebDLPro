import type { TransitionId } from '@/config/scene-topology/identifiers'
import type { TopologyNodeDoubleClickIntent } from '@/modules/visual/topology/topology-node-interaction'
import {
  isBusinessHostVisualizationContext,
  isHostEventMessage,
  type CommandResultPayload,
  type HostEventMessage,
  type HostEventType,
  type HostProtocolError,
  type HostProtocolErrorCode,
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
 * 外层协议错误码对应的固定安全说明。
 * 出站层不复用上游传入的 message（说明文本），避免异常链、Unity 层级路径、访问凭据或完整不可信载荷
 * 被错误拼入父页面可见事件；错误码、阶段和稳定领域标识仍足以完成定位与关联。
 */
const SAFE_HOST_PROTOCOL_ERROR_MESSAGES = Object.freeze({
  'protocol.origin.rejected': '父页面来源未通过协议校验。',
  'protocol.source.rejected': '消息窗口未通过协议校验。',
  'protocol.envelope.invalid': '消息信封未通过协议校验。',
  'protocol.payload.invalid': '消息载荷未通过协议校验。',
  'protocol.capability.undeclared': '当前发布版本未声明所请求的能力。',
  'protocol.message.duplicate': '当前会话已存在相同消息标识。',
  'protocol.capacity.exceeded': '请求数量或消息大小超过协议上限。',
  'manifest.version.mismatch': '发布清单版本与当前运行版本不匹配。',
  'scene.unknown': '场景标识未在当前发布清单中登记。',
  'topology.unknown': '拓扑标识未在当前发布清单中登记。',
  'topology.scene.mismatch': '拓扑与目标场景不匹配。',
  'action.unknown': '动作标识未在当前发布清单中登记。',
  'action.context.mismatch': '动作与当前稳定上下文不匹配。',
  'context.revision.conflict': '父页面使用的上下文版本已经失效。',
  'scene.switch.failed': '目标场景切换未能完成。',
  'action.execute.failed': '受控业务动作未能完成。',
  'topology.prepare.failed': '目标拓扑准备未能完成。',
  'topology.activate.failed': '目标拓扑激活未能完成。',
  'command.timeout': '外层命令等待执行结果超时。',
  'command.superseded': '外层命令已被更新的事务取代。',
  'runtime.startup.timeout': '页面未能在启动期限内完成运行时准备。',
  'runtime.disposed': '可视化子应用已经释放。',
}) satisfies Readonly<Record<HostProtocolErrorCode, string>>

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
   * 此处重新按字段投影结果，并将失败说明替换为错误码对应的固定安全文本，防止上游对象的附加字段或异常文本外泄。
   */
  public sendCommandResult(result: HostCommandLifecycleResult): boolean {
    const payload = result.payload
    if (!payload.success && !payload.error) return false

    const safePayload: CommandResultPayload = {
      success: payload.success,
      status: payload.status,
      ...(payload.transitionId !== undefined ? { transitionId: payload.transitionId } : {}),
      ...(payload.contextRevision !== undefined ? { contextRevision: payload.contextRevision } : {}),
      error: payload.error ? toSafeHostProtocolError(payload.error) : null,
    }
    return this.send('command.result', safePayload, result.replyTo)
  }

  /**
   * 在场景、拓扑及可选动作全部提交后发送稳定视图变更。
   * 非 ready（就绪）上下文代表事务尚未提交，必须保持静默，避免父页面观察到半成品切换状态。
   * 父命令触发时由组合根提供 replyTo；只有未来明确的内部自发视图变化才允许省略关联标识。
   */
  public sendViewChanged(context: HostVisualizationContext, transitionId?: TransitionId, replyTo?: string): boolean {
    if (context.status !== 'ready') return false

    const payload = isBusinessHostVisualizationContext(context)
      ? {
          sceneId: context.sceneId,
          topologyId: context.topologyId,
          actionId: context.actionId,
          contextRevision: context.contextRevision,
          ...(transitionId !== undefined ? { transitionId } : {}),
        }
      : {
          sceneId: context.sceneId,
          actionId: context.actionId,
          contextRevision: context.contextRevision,
          ...(transitionId !== undefined ? { transitionId } : {}),
        }
    return this.send('view.changed', payload, replyTo)
  }

  /**
   * 发送二维拓扑节点产生的节点双击意图。
   * 意图只能由正式清单的 `emit-node` 节点生成；发送器逐字段投影，旧设备编号或三维内部标识不会外泄。
   */
  public sendTopologyNodeDoubleClick(intent: TopologyNodeDoubleClickIntent): boolean {
    return this.send('topology.node.dblclick', {
      // 逐项选择协议字段，不展开来源对象；即使调用方在运行时被错误强制转换，也不会携带层级路径或凭据等附加数据。
      sceneId: intent.sceneId,
      topologyId: intent.topologyId,
      nodeId: intent.nodeId,
    })
  }

  /**
   * 发送来自 task-037 映射层的三维对象选择结果。
   * 当前组合根只在三维反向选择完成稳定映射、去重、回环保护和上下文复核后调用；
   * 发送器再次执行逐字段投影，不把 Unity 原始消息标识、对象名称、层级路径或其他附加属性传给父页面。
   */
  public sendSceneObjectSelected(payload: SceneObjectSelectedPayload): boolean {
    return this.send('scene.object.selected', {
      sceneId: payload.sceneId,
      sceneNodeId: payload.sceneNodeId,
      nodeId: payload.nodeId,
    })
  }

  /**
   * 回答 `state.get`（状态查询）时发送有限运行快照。
   * 调用方必须传入原命令 messageId 作为 replyTo，状态快照不会包含设备全量状态、场景对象或原始消息。
   */
  public sendStateSnapshot(replyTo: string, payload: StateSnapshotPayload): boolean {
    const context = isBusinessHostVisualizationContext(payload.context)
      ? {
          sceneId: payload.context.sceneId,
          topologyId: payload.context.topologyId,
          actionId: payload.context.actionId,
          contextRevision: payload.context.contextRevision,
          status: payload.context.status,
        }
      : {
          sceneId: payload.context.sceneId,
          actionId: payload.context.actionId,
          contextRevision: payload.context.contextRevision,
          status: payload.context.status,
        }
    return this.send('state.snapshot', {
      manifestVersion: payload.manifestVersion,
      context,
      unityStatus: payload.unityStatus,
      topologyStatus: payload.topologyStatus,
    }, replyTo)
  }

  /**
   * 发送已经由领域层归类的受控错误。
   * 有原命令时必须传入其 messageId 作为 replyTo（回复关联标识）；无归属的运行时错误才允许省略。
   * 错误说明和字段在本层重新生成，因此不会把调用方的原始异常文本或附加属性直接上报。
   */
  public sendSystemError(error: HostProtocolError, replyTo?: string): boolean {
    return this.send('system.error', { error: toSafeHostProtocolError(error) }, replyTo)
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
      // 显式提供的空值或非法标识必须进入校验器并被拒绝，不能因真假值判断静默退化成无关联事件。
      ...(replyTo !== undefined ? { replyTo } : {}),
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

/**
 * 将领域错误转换为协议允许的最小安全结构。
 * 函数只执行常数时间属性读取和错误码表查询，不使用正则扫描大文本；所有可选标识仍由统一出站校验器复核。
 */
function toSafeHostProtocolError(error: HostProtocolError): HostProtocolError {
  return {
    code: error.code,
    message: SAFE_HOST_PROTOCOL_ERROR_MESSAGES[error.code],
    stage: error.stage,
    recoverable: error.recoverable,
    ...(error.sceneId !== undefined ? { sceneId: error.sceneId } : {}),
    ...(error.topologyId !== undefined ? { topologyId: error.topologyId } : {}),
    ...(error.actionId !== undefined ? { actionId: error.actionId } : {}),
    ...(error.transitionId !== undefined ? { transitionId: error.transitionId } : {}),
  }
}

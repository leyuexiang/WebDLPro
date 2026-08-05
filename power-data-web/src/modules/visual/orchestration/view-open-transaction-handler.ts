import { toTransitionId, type TransitionId } from '@/config/scene-topology/identifiers'
import type { UnityActionDefinition } from '@/config/scene-topology/types'
import type { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import type { HostCommandExecutionResult } from '@/host-bridge/host-command-lifecycle'
import type { HostDispatchableDomainCommand } from '@/host-bridge/host-command-dispatcher'
import type { HostProtocolError, HostProtocolErrorCode, ViewOpenPayload } from '@/host-bridge/host-protocol'
import type { VisualizationCoordinatorFacade } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import type { VisualizationDiagnostic, VisualizationStableContext } from '@/modules/visual/orchestration/visualization.store'
import type { TopologyRuntime } from '@/modules/visual/topology/topology-runtime'

/**
 * Unity 场景端口只表达事务需要的受控结果，不暴露 iframe、Window、消息信封或 Unity 对象。
 * 真正的内层连接器在组合根实现该端口；本处理器只按结果推进或回滚领域事务。
 */
export interface ViewOpenUnityPort {
  switchScene(sceneId: ViewOpenPayload['sceneId'], sceneMappingVersion: string, transitionId: TransitionId): Promise<ViewOpenUnityPortResult>
  executeAction(action: UnityActionDefinition, actionId: NonNullable<ViewOpenPayload['actionId']>, transitionId: TransitionId): Promise<ViewOpenUnityPortResult>
}

/** Unity 端口只向编排层反馈是否完成及受控失败码，避免泄露引擎异常、层级或资源信息。 */
export interface ViewOpenUnityPortResult {
  success: boolean
  errorCode?: 'scene.switch.failed' | 'action.execute.failed'
}

/** 可注入的切换事务标识工厂；测试使用固定值，生产默认使用有前缀的安全随机标识。 */
export type ViewOpenTransitionIdFactory = () => TransitionId

/**
 * `view.open`（原子打开视图）事务处理器。
 *
 * 顺序严格固定为：清单校验、拓扑预解析、开始事务、可选场景切换、可选动作、拓扑激活、稳定提交。
 * 因此拓扑准备失败时绝不请求 Unity 切换；任一异步阶段失败都恢复上一份稳定上下文，外部调用方
 * 永远不会观察到“新场景 + 旧拓扑”或“新拓扑 + 旧场景”的可操作组合。
 */
export class ViewOpenTransactionHandler {
  public constructor(
    private readonly registry: TopologyRegistry,
    private readonly topologyRuntime: TopologyRuntime,
    private readonly unity: ViewOpenUnityPort,
    private readonly coordinator: VisualizationCoordinatorFacade,
    private readonly createTransitionId: ViewOpenTransitionIdFactory = createDefaultTransitionId,
  ) {}

  /**
   * 仅消费外层分派器已完成协议校验的 `view.open` 意图。
   * 其他命令在类型和运行时双重拒绝，防止后续流程或设备状态任务越过各自处理器进入本事务。
   */
  public async submit(command: HostDispatchableDomainCommand): Promise<HostCommandExecutionResult> {
    if (command.type !== 'view.open') {
      return this.failure('action.execute.failed', 'executing-action', '当前事务处理器只接收原子打开视图命令。')
    }

    return this.open(command.payload, command.correlationId)
  }

  private async open(payload: ViewOpenPayload, correlationId: string): Promise<HostCommandExecutionResult> {
    const actionValidationFailure = this.validateManifestReferences(payload)
    if (actionValidationFailure) return actionValidationFailure

    const transitionId = this.createTransitionId()
    // prepare 不操作 Canvas；必须先完成，避免错误拓扑在 Unity 已经切换后才暴露失败。
    const preparedTopology = this.topologyRuntime.prepare(payload.sceneId, payload.topologyId, transitionId)
    if (!preparedTopology) {
      return this.failure('topology.prepare.failed', 'preparing-topology', '目标拓扑未能完成预解析，未执行场景切换。', transitionId, payload)
    }

    const beginResult = this.coordinator.submit({
      type: 'transition.begin',
      transitionId,
      sceneId: payload.sceneId,
      topologyId: payload.topologyId,
      actionId: payload.actionId ?? null,
      ...(payload.expectedContextRevision !== undefined ? { expectedContextRevision: payload.expectedContextRevision } : {}),
    })
    if (beginResult.status === 'ignored') return this.superseded(transitionId)
    if (beginResult.status === 'rejected') return this.failure(beginResult.error.code as HostProtocolErrorCode, 'validation', beginResult.error.message, transitionId, payload)

    const previousContext = this.coordinator.getSnapshot().stableContext
    const requiresSceneSwitch = previousContext?.sceneId !== payload.sceneId
    let targetSceneActivated = false
    if (requiresSceneSwitch) {
      // 场景登记与 Unity 场景映射版本同属清单；切换消息必须携带这一版本以拒绝旧资源回执。
      const targetScene = this.registry.getScene(payload.sceneId)
      if (!targetScene) {
        return this.failCurrentTransition('scene.switch.failed', 'switching-scene', '目标场景登记在事务开始后不可用。', correlationId, transitionId, payload)
      }
      const switchResult = await this.unity.switchScene(payload.sceneId, targetScene.sceneMappingVersion, transitionId)
      if (!this.isCurrentTransition(transitionId)) return this.superseded(transitionId)
      if (!switchResult.success) {
        return this.failCurrentTransition('scene.switch.failed', 'switching-scene', 'Unity 未能完成目标业务场景切换。', correlationId, transitionId, payload)
      }
      // 仅收到目标场景最终成功回执后才视为物理运行时已改变；此前失败无需执行回退命令。
      targetSceneActivated = true
    }

    const unityReadyResult = this.coordinator.submit({ type: 'unity.status.reported', transitionId, status: 'ready' })
    if (unityReadyResult.status === 'ignored') return this.superseded(transitionId)
    if (unityReadyResult.status === 'rejected') {
      return this.recoverPhysicalRuntimeOrFail('scene.switch.failed', 'switching-scene', 'Unity 场景状态未能进入就绪阶段。', correlationId, transitionId, payload, previousContext, targetSceneActivated)
    }

    const action = payload.actionId ? this.registry.getAction(payload.actionId) : undefined
    if (action && action.unityAction.type !== 'none') {
      const actionResult = await this.unity.executeAction(action.unityAction, action.actionId, transitionId)
      if (!this.isCurrentTransition(transitionId)) return this.superseded(transitionId)
      if (!actionResult.success) {
        if (!requiresSceneSwitch && action.failurePolicy === 'keep-current-context') {
          /*
           * 同场景动作由清单显式声明“保持当前上下文”时，不激活目标拓扑且不重建 Unity。
           * 该策略是任务-034的默认失败语义；跨场景动作仍必须走物理回退，不能把已切换场景伪装成旧状态。
           */
          return this.failCurrentTransition('action.execute.failed', 'executing-action', '同场景动作未完成，已保持上一稳定视图。', correlationId, transitionId, payload)
        }
        if (!requiresSceneSwitch && action.failurePolicy === 'commit-view-with-warning') {
          // 只有原子清单明确许可时，动作失败才可继续激活映射拓扑；诊断保留稳定码供外层有限状态查询关联。
          this.coordinator.submit({ type: 'diagnostic.record', diagnostic: this.createDiagnostic('action.execute.failed', correlationId) })
        } else {
          return this.recoverPhysicalRuntimeOrFail('action.execute.failed', 'executing-action', '目标场景动作未完成，未激活目标拓扑。', correlationId, transitionId, payload, previousContext, targetSceneActivated)
        }
      }
    }

    // activate 是唯一会写入活动 Canvas 的位置；失败时不提交上下文且协调器恢复上一个稳定状态。
    if (!this.topologyRuntime.activate(preparedTopology, transitionId)) {
      return this.recoverPhysicalRuntimeOrFail('topology.activate.failed', 'activating-topology', '目标拓扑未能激活，正在恢复上一稳定视图。', correlationId, transitionId, payload, previousContext, targetSceneActivated)
    }

    const topologyReadyResult = this.coordinator.submit({ type: 'topology.status.reported', transitionId, status: 'ready' })
    if (topologyReadyResult.status === 'ignored') return this.superseded(transitionId)
    if (topologyReadyResult.status === 'rejected') {
      return this.recoverPhysicalRuntimeOrFail('topology.activate.failed', 'activating-topology', '拓扑状态未能进入就绪阶段。', correlationId, transitionId, payload, previousContext, targetSceneActivated)
    }

    const commitResult = this.coordinator.submit({
      type: 'transition.commit',
      transitionId,
      sceneId: payload.sceneId,
      topologyId: payload.topologyId,
      actionId: payload.actionId ?? null,
    })
    if (commitResult.status === 'ignored') return this.superseded(transitionId)
    if (commitResult.status === 'rejected') {
      return this.recoverPhysicalRuntimeOrFail('topology.activate.failed', 'activating-topology', '场景与拓扑尚未同时满足稳定提交条件。', correlationId, transitionId, payload, previousContext, targetSceneActivated)
    }

    return {
      success: true,
      status: 'completed',
      transitionId,
      contextRevision: commitResult.contextRevision,
    }
  }

  /** 在发起任何异步操作前验证场景、拓扑与可选动作的原子清单关系。 */
  private validateManifestReferences(payload: ViewOpenPayload): HostCommandExecutionResult | undefined {
    if (!this.registry.getScene(payload.sceneId)) {
      return this.failure('scene.unknown', 'validation', '目标场景未在当前原子清单中登记。', undefined, payload)
    }
    if (!this.registry.getTopology(payload.topologyId)) {
      return this.failure('topology.unknown', 'validation', '目标拓扑未在当前原子清单中登记。', undefined, payload)
    }
    if (!this.registry.getTopologyForScene(payload.sceneId, payload.topologyId)) {
      return this.failure('topology.scene.mismatch', 'validation', '目标拓扑不属于指定场景。', undefined, payload)
    }
    if (!payload.actionId) return undefined

    const action = this.registry.getAction(payload.actionId)
    if (!action) {
      return this.failure('action.unknown', 'validation', '目标动作未在当前原子清单中登记。', undefined, payload)
    }
    if (action.targetSceneId !== payload.sceneId || action.targetTopologyId !== payload.topologyId) {
      return this.failure('action.context.mismatch', 'validation', '动作目标与请求的场景和拓扑不一致。', undefined, payload)
    }
    return undefined
  }

  /** 当前事务失败时统一写入受控诊断；协调器负责恢复上一份稳定上下文。 */
  private failCurrentTransition(
    code: Extract<HostProtocolErrorCode, 'scene.switch.failed' | 'action.execute.failed' | 'topology.activate.failed'>,
    stage: HostProtocolError['stage'],
    message: string,
    correlationId: string,
    transitionId: TransitionId,
    payload: ViewOpenPayload,
  ): HostCommandExecutionResult {
    this.coordinator.submit({ type: 'transition.fail', transitionId, diagnostic: this.createDiagnostic(code, correlationId) })
    return this.failure(code, stage, message, transitionId, payload)
  }

  /**
   * 目标场景已经生效后，失败不能只恢复状态仓库：必须同时把 Unity 与单画布恢复到上一稳定上下文。
   * 旧事务在任何 await（等待）点被新事务取代时立即停止恢复，避免旧回退命令反向覆盖最新目标。
   */
  private async recoverPhysicalRuntimeOrFail(
    code: Extract<HostProtocolErrorCode, 'scene.switch.failed' | 'action.execute.failed' | 'topology.activate.failed'>,
    stage: HostProtocolError['stage'],
    message: string,
    correlationId: string,
    transitionId: TransitionId,
    payload: ViewOpenPayload,
    previousContext: VisualizationStableContext | null,
    targetSceneActivated: boolean,
  ): Promise<HostCommandExecutionResult> {
    if (!targetSceneActivated) {
      // 同场景动作可能已产生部分业务副作用，缺少显式可逆映射时不假定“当前画面未改变”。
      return this.failRecoveryToError(code, stage, message, correlationId, transitionId, payload)
    }
    if (!previousContext || previousContext.actionId !== null) {
      // 前一稳定上下文带动作时，无法根据动作名称猜测是否可重放，直接进入明确错误态。
      return this.failRecoveryToError(code, stage, message, correlationId, transitionId, payload)
    }

    const previousScene = this.registry.getScene(previousContext.sceneId)
    const previousTopology = this.topologyRuntime.prepare(previousContext.sceneId, previousContext.topologyId, transitionId)
    if (!previousScene || !previousTopology) {
      return this.failRecoveryToError(code, stage, message, correlationId, transitionId, payload)
    }

    const recoveryResult = await this.unity.switchScene(previousContext.sceneId, previousScene.sceneMappingVersion, transitionId)
    if (!this.isCurrentTransition(transitionId)) return this.superseded(transitionId)
    if (!recoveryResult.success || !this.topologyRuntime.activate(previousTopology, transitionId)) {
      return this.failRecoveryToError(code, stage, message, correlationId, transitionId, payload)
    }

    // 物理三维与单画布均回到上一个稳定上下文后，才允许仓库恢复 ready（就绪）状态。
    return this.failCurrentTransition(code, stage, message, correlationId, transitionId, payload)
  }

  /** 回退无法被清单和最终回执证明时，清空稳定上下文并让壳层展示可恢复的明确错误视图。 */
  private failRecoveryToError(
    code: Extract<HostProtocolErrorCode, 'scene.switch.failed' | 'action.execute.failed' | 'topology.activate.failed'>,
    stage: HostProtocolError['stage'],
    message: string,
    correlationId: string,
    transitionId: TransitionId,
    payload: ViewOpenPayload,
  ): HostCommandExecutionResult {
    this.coordinator.submit({
      type: 'transition.recovery.fail',
      transitionId,
      diagnostic: this.createDiagnostic('transition.recovery.failed', correlationId),
    })
    return {
      success: false,
      status: 'failed',
      transitionId,
      error: {
        code,
        stage,
        message,
        recoverable: false,
        sceneId: payload.sceneId,
        topologyId: payload.topologyId,
        ...(payload.actionId ? { actionId: payload.actionId } : {}),
      },
    }
  }

  /** 一旦新事务取代当前事务，旧异步回调只能返回 superseded（已取代），不能再写任何状态。 */
  private isCurrentTransition(transitionId: TransitionId): boolean {
    return this.coordinator.getSnapshot().activeTransitionId === transitionId
  }

  private superseded(transitionId: TransitionId): HostCommandExecutionResult {
    return {
      success: false,
      status: 'superseded',
      transitionId,
      error: {
        code: 'command.superseded',
        stage: 'switching-scene',
        message: '当前视图切换已被更新的事务取代。',
        recoverable: true,
        transitionId,
      },
    }
  }

  /** 将内部失败收敛成协议允许的稳定诊断；关联标识只来自外层已校验命令。 */
  private createDiagnostic(code: string, correlationId: string): VisualizationDiagnostic {
    return { code, correlationId, occurredAt: new Date().toISOString() }
  }

  /** 构造协议受控失败结果，不返回 Unity、Canvas 或异常对象中的任意文本。 */
  private failure(
    code: HostProtocolErrorCode,
    stage: HostProtocolError['stage'],
    message: string,
    transitionId: TransitionId | undefined = undefined,
    payload: ViewOpenPayload | undefined = undefined,
  ): HostCommandExecutionResult {
    return {
      success: false,
      status: 'failed',
      ...(transitionId ? { transitionId } : {}),
      error: {
        code,
        stage,
        message,
        recoverable: code !== 'runtime.disposed',
        ...(payload ? { sceneId: payload.sceneId, topologyId: payload.topologyId, ...(payload.actionId ? { actionId: payload.actionId } : {}) } : {}),
      },
    }
  }
}

let transitionSequence = 0

/** 默认标识以固定前缀开头，满足稳定标识格式且不会使用外层消息标识或资源路径。 */
function createDefaultTransitionId(): TransitionId {
  transitionSequence += 1
  return toTransitionId(`view-open-${Date.now().toString(36)}-${transitionSequence.toString(36)}`)
}

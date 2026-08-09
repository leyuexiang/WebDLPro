import { toTransitionId, type SceneActivationId, type TransitionId } from '@/config/scene-topology/identifiers'
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
  /**
   * `forceReload` 为 true 时，即使目标与当前场景相同也必须重建物理 Unity 场景。
   * 该开关仅供超时补偿清除可能已经产生的动作副作用，普通视图切换保持 false 以复用当前实例。
   */
  switchScene(
    sceneId: ViewOpenPayload['sceneId'],
    sceneMappingVersion: string,
    transitionId: TransitionId,
    forceReload?: boolean,
  ): Promise<ViewOpenUnityPortResult>
  executeAction(action: UnityActionDefinition, actionId: NonNullable<ViewOpenPayload['actionId']>, transitionId: TransitionId): Promise<ViewOpenUnityPortResult>
}

/** Unity 端口只向编排层反馈是否完成及受控失败码，避免泄露引擎异常、层级或资源信息。 */
export interface ViewOpenUnityPortResult {
  success: boolean
  errorCode?: 'scene.switch.failed' | 'action.execute.failed'
  /** 仅 switchScene 成功时返回 Unity 实际提交的物理场景实例标识。 */
  sceneActivationId?: SceneActivationId
}

/** 可注入的切换事务标识工厂；测试使用固定值，生产默认使用有前缀的安全随机标识。 */
export type ViewOpenTransitionIdFactory = () => TransitionId

/**
 * 外层生命周期允许同时等待的命令上限为 64 条；原子初始化最多额外占用一条记录。
 * 这里使用相同的固定上限，避免测试或异常调用绕过外层桥后使“关联标识 → 事务”映射无界增长。
 */
const MAXIMUM_ACTIVE_VIEW_OPEN_TRANSACTIONS = 65

/**
 * 只保存实施补偿恢复所需的受控字段，不保存外层完整载荷、Unity 对象、Canvas（画布）或 Promise。
 * `previousContext` 是超时后唯一允许恢复的基线；有动作的旧上下文不能猜测为可重放，必须转入明确错误态。
 */
interface ActiveViewOpenTransaction {
  readonly correlationId: string
  readonly transitionId: TransitionId
  readonly payload: ViewOpenPayload
  readonly previousContext: VisualizationStableContext | null
  recoveryStarted: boolean
}

/** 物理回退与超时补偿都只使用协议已经允许的有限失败码。 */
type RecoverableViewOpenErrorCode = Extract<
  HostProtocolErrorCode,
  'scene.switch.failed' | 'action.execute.failed' | 'topology.activate.failed' | 'command.timeout'
>

/**
 * `view.open`（原子打开视图）事务处理器。
 *
 * 顺序严格固定为：清单校验、拓扑预解析、开始事务、可选场景切换、可选动作、拓扑激活、稳定提交。
 * 因此拓扑准备失败时绝不请求 Unity 切换；任一异步阶段失败都恢复上一份稳定上下文，外部调用方
 * 永远不会观察到“新场景 + 旧拓扑”或“新拓扑 + 旧场景”的可操作组合。
 */
export class ViewOpenTransactionHandler {
  private readonly activeTransactionsByCorrelationId = new Map<string, ActiveViewOpenTransaction>()

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

  /**
   * 外层十秒超时时撤销原事务的提交权，并立即开始补偿恢复事务。
   * 不能只让外层回包超时：那样迟到的 Unity 成功仍会激活目标拓扑。补偿事务使用新标识，
   * 使 Unity 的事务门同步废弃正在加载的旧目标；若新用户请求随后到达，又会继续取代该补偿事务。
   */
  public cancelTimedOutCommand(correlationId: string): void {
    const activeTransaction = this.activeTransactionsByCorrelationId.get(correlationId)
    if (!activeTransaction || activeTransaction.recoveryStarted) return

    activeTransaction.recoveryStarted = true
    void this.beginTimedOutRecovery(activeTransaction).catch(() => {
      // 端口契约应将异常收敛为受控结果；即使未来实现违约，也只将当前事务转入明确错误态。
      this.failTimedOutRecovery(activeTransaction)
    })
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
    if (this.activeTransactionsByCorrelationId.size >= MAXIMUM_ACTIVE_VIEW_OPEN_TRANSACTIONS) {
      // 容量检查必须早于 transition.begin（开始事务）；否则一个本应拒绝的调用会意外取代有效事务。
      return this.failure('protocol.capacity.exceeded', 'validation', '原子视图事务已达到受控容量上限。', transitionId, payload)
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
    const activeTransaction: ActiveViewOpenTransaction = {
      correlationId,
      transitionId,
      payload,
      previousContext: previousContext ? { ...previousContext } : null,
      recoveryStarted: false,
    }
    this.activeTransactionsByCorrelationId.set(correlationId, activeTransaction)

    try {
    const requiresSceneSwitch = previousContext?.sceneId !== payload.sceneId
    // 同场景拓扑切换复用现有 Unity 物理实例；只有 Unity 真正完成切换或恢复后才替换该标识。
    let sceneActivationId = this.coordinator.getSnapshot().sceneActivationId ?? null
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
        // Unity 的跨场景协调器可能在目标加载失败后自动重建上一稳定场景。此时业务上下文不变，
        // 但物理实例已经变化，必须以 recovered 收尾并替换激活标识；缺失标识时仍按普通失败处理。
        return this.failCurrentTransition(
          'scene.switch.failed',
          'switching-scene',
          'Unity 未能完成目标业务场景切换。',
          correlationId,
          transitionId,
          payload,
          switchResult.sceneActivationId ? 'recovered' : 'failed',
          switchResult.sceneActivationId,
        )
      }
      // 仅收到目标场景最终成功回执后才视为物理运行时已改变；此前失败无需执行回退命令。
      targetSceneActivated = true
      if (!switchResult.sceneActivationId) {
        // Unity 已切入目标却未给出实例标识时，不能让后续对象选择与任意同名旧场景混合；
        // 进入统一物理恢复流程，绝不以当前事务标识或节点名称代替真实激活标识。
        return this.recoverPhysicalRuntimeOrFail('scene.switch.failed', 'switching-scene', 'Unity 未返回可验证的物理场景激活标识。', correlationId, transitionId, payload, previousContext, targetSceneActivated)
      }
      sceneActivationId = switchResult.sceneActivationId
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
        if (action.failurePolicy === 'commit-view-with-warning') {
          /*
           * 只有清单显式标为“带警告提交”时，已结束但失败的非关键展示动作才可继续激活映射拓扑。
           * 该规则同样适用于跨场景：Unity 已确认进入目标场景，此时提交目标视图比伪装为旧场景更一致；
           * 关键动作仍使用 keep-current-context（保持当前上下文），跨场景失败会继续走物理回退。
           */
          // 诊断仅保留稳定错误码与请求关联，避免将 Unity 原始异常、对象或参数暴露给外层。
          this.coordinator.submit({ type: 'diagnostic.record', diagnostic: this.createDiagnostic('action.execute.failed', correlationId) })
        } else if (!requiresSceneSwitch) {
          // 同场景关键动作尚未造成场景物理变化，直接恢复上一稳定上下文即可，绝不升级为全局错误态。
          return this.failCurrentTransition('action.execute.failed', 'executing-action', '同场景动作未完成，已保持上一稳定视图。', correlationId, transitionId, payload)
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
      sceneActivationId,
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
    } finally {
      // 只有本次登记仍是当前值时才删除，避免测试替身或未来重试复用关联标识时误删后续事务。
      if (this.activeTransactionsByCorrelationId.get(correlationId) === activeTransaction) {
        this.activeTransactionsByCorrelationId.delete(correlationId)
      }
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
    code: RecoverableViewOpenErrorCode,
    stage: HostProtocolError['stage'],
    message: string,
    correlationId: string,
    transitionId: TransitionId,
    payload: ViewOpenPayload,
    outcome: 'failed' | 'recovered' = 'failed',
    restoredSceneActivationId: SceneActivationId | undefined = undefined,
  ): HostCommandExecutionResult {
    this.coordinator.submit({
      type: 'transition.fail',
      transitionId,
      diagnostic: this.createDiagnostic(code, correlationId),
      outcome,
      ...(restoredSceneActivationId ? { restoredSceneActivationId } : {}),
    })
    return this.failure(code, stage, message, transitionId, payload)
  }

  /**
   * 对超时事务启动补偿恢复。恢复始终另建事务并强制按场景切换处理：这会把旧 Unity 请求
   * 交给引擎侧事务门清理，而不是在网页端假定“目标尚未加载”。恢复成功只恢复原稳定上下文，
   * 不提交新版本；恢复被后续用户请求取代时，迟到结果会因 recoveryTransitionId 失效而被丢弃。
   */
  private async beginTimedOutRecovery(activeTransaction: ActiveViewOpenTransaction): Promise<void> {
    if (!this.isCurrentTransition(activeTransaction.transitionId)) return

    const previousContext = activeTransaction.previousContext
    if (!previousContext || previousContext.actionId !== null) {
      // 没有基线或基线携带动作时无法证明可重放，不能借标题、名称或当前 Unity 画面猜测恢复目标。
      this.failTimedOutRecovery(activeTransaction)
      return
    }

    const previousScene = this.registry.getScene(previousContext.sceneId)
    const recoveryTransitionId = this.createTransitionId()
    const previousTopology = this.topologyRuntime.prepare(
      previousContext.sceneId,
      previousContext.topologyId,
      recoveryTransitionId,
    )
    if (!previousScene || !previousTopology) {
      this.failTimedOutRecovery(activeTransaction)
      return
    }

    const beginRecovery = this.coordinator.submit({
      type: 'transition.begin',
      transitionId: recoveryTransitionId,
      sceneId: previousContext.sceneId,
      topologyId: previousContext.topologyId,
      actionId: null,
      // 逻辑稳定场景本就等于恢复目标，但物理 Unity 可能已经切到超时目标；必须强制发起补偿切换。
      forceSceneSwitch: true,
    })
    if (beginRecovery.status !== 'accepted') {
      this.failTimedOutRecovery(activeTransaction)
      return
    }

    const recoveryResult = await this.unity.switchScene(
      previousContext.sceneId,
      previousScene.sceneMappingVersion,
      recoveryTransitionId,
      // 超时命令可能已在同一场景产生部分副作用；只有物理重载才能建立可证明的干净恢复基线。
      true,
    )
    if (!this.isCurrentTransition(recoveryTransitionId)) return
    if (!recoveryResult.success || !recoveryResult.sceneActivationId || !this.topologyRuntime.activate(previousTopology, recoveryTransitionId)) {
      this.failTimedOutRecovery(activeTransaction, recoveryTransitionId)
      return
    }

    // 恢复不是新的业务打开：画布和 Unity 已回到旧稳定上下文后，以 fail 收尾保持原 contextRevision 不递增。
    this.coordinator.submit({
      type: 'transition.fail',
      transitionId: recoveryTransitionId,
      diagnostic: this.createDiagnostic('command.timeout', activeTransaction.correlationId),
      outcome: 'recovered',
      restoredSceneActivationId: recoveryResult.sceneActivationId,
    })
  }

  /** 不能安全证明补偿结果时清空稳定上下文，禁止保留可能已与物理 Unity 脱节的旧二维视图。 */
  private failTimedOutRecovery(activeTransaction: ActiveViewOpenTransaction, transitionId = activeTransaction.transitionId): void {
    if (!this.isCurrentTransition(transitionId)) return
    this.coordinator.submit({
      type: 'transition.recovery.fail',
      transitionId,
      diagnostic: this.createDiagnostic('command.timeout', activeTransaction.correlationId),
    })
  }

  /**
   * 目标场景已经生效后，失败不能只恢复状态仓库：必须同时把 Unity 与单画布恢复到上一稳定上下文。
   * 旧事务在任何 await（等待）点被新事务取代时立即停止恢复，避免旧回退命令反向覆盖最新目标。
   */
  private async recoverPhysicalRuntimeOrFail(
    code: RecoverableViewOpenErrorCode,
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
    if (!recoveryResult.success || !recoveryResult.sceneActivationId || !this.topologyRuntime.activate(previousTopology, transitionId)) {
      return this.failRecoveryToError(code, stage, message, correlationId, transitionId, payload)
    }

    // 物理三维与单画布均回到上一个稳定上下文后，才允许仓库恢复 ready（就绪）状态。
    return this.failCurrentTransition(
      code,
      stage,
      message,
      correlationId,
      transitionId,
      payload,
      'recovered',
      recoveryResult.sceneActivationId,
    )
  }

  /** 回退无法被清单和最终回执证明时，清空稳定上下文并让壳层展示可恢复的明确错误视图。 */
  private failRecoveryToError(
    code: RecoverableViewOpenErrorCode,
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

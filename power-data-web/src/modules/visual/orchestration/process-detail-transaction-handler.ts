import type { ActionDefinition, ProcessDetailDefinition } from '@/config/scene-topology/types'
import type { ProcessDetailId, SceneId, TransitionId } from '@/config/scene-topology/identifiers'
import { toTransitionId } from '@/config/scene-topology/identifiers'
import type { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import type { HostCommandExecutionResult } from '@/host-bridge/host-command-lifecycle'
import type { HostDispatchableDomainCommand } from '@/host-bridge/host-command-dispatcher'
import type { HostProtocolError } from '@/host-bridge/host-protocol'
import type { VisualizationCoordinatorFacade } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import {
  isBusinessVisualizationStableContext,
  isProcessDetailVisualizationStableContext,
} from '@/modules/visual/orchestration/visualization.store'
import type { PreparedTopology, TopologyRuntime } from '@/modules/visual/topology/topology-runtime'

/** 第三层 Unity 端口显式暴露准备、提交、取消、退出与播放控制，不包含旧组合进入或流程步骤命令。 */
export interface ProcessDetailUnityPort {
  prepareProcessDetail(detail: ProcessDetailDefinition, transitionId: TransitionId): Promise<{ success: boolean }>
  commitProcessDetail(sceneId: SceneId, processDetailId: ProcessDetailId, transitionId: TransitionId): Promise<{ success: boolean }>
  abortProcessDetail(sceneId: SceneId, processDetailId: ProcessDetailId, transitionId: TransitionId): Promise<{ success: boolean }>
  exitProcessDetail(sceneId: SceneId, processDetailId: ProcessDetailId, transitionId: TransitionId): Promise<{ success: boolean }>
  setProcessDetailPlayback(sceneId: SceneId, processDetailId: ProcessDetailId, playing: boolean): Promise<{ success: boolean }>
}

/** 可注入事务编号工厂让测试稳定复现，生产值始终满足统一稳定标识格式。 */
export type ProcessDetailTransitionIdFactory = () => TransitionId

/**
 * 外层命令超时后仍可能收到 Unity 的迟到回执。
 * 此对象只保留清理所需的稳定编号，绝不保存外层参数、模型对象、资源句柄或 Promise，
 * 并且生命周期严格绑定同一个 correlationId（关联标识）。
 */
interface ActiveProcessDetailTransaction {
  readonly correlationId: string
  readonly transitionId: TransitionId
  readonly kind: 'enter' | 'switch' | 'exit'
  readonly detail: ProcessDetailDefinition
  readonly previousDetail?: ProcessDetailDefinition
  readonly rollbackTopology?: PreparedTopology
  phase: 'preparing' | 'prepared' | 'committing' | 'exiting'
  cancelled: boolean
  cleanupStarted: boolean
}

/**
 * 独立关键环节原子事务。
 * 进入时先等待 Unity 完成隐藏加载和状态重放，再暂停唯一拓扑并等待全屏布局落盘，最后提交资源与相机；返回时反向执行。
 * 任一失败均保留或恢复上一个稳定组合，不调用 enterProcessStep、focusNode、setNodeVisibility 或 resetScene。
 */
export class ProcessDetailTransactionHandler {
  /** 受控映射最多与外层有限待确认命令同量级；每个异步入口结束后立即删除对应记录。 */
  private readonly activeTransactionsByCorrelationId = new Map<string, ActiveProcessDetailTransaction>()

  public constructor(
    private readonly registry: TopologyRegistry,
    private readonly topologyRuntime: TopologyRuntime,
    private readonly unity: ProcessDetailUnityPort,
    private readonly coordinator: VisualizationCoordinatorFacade,
    private readonly createTransitionId: ProcessDetailTransitionIdFactory = createDefaultTransitionId,
    /** 由 Vue 组合根注入下一次布局提交边界；领域层不直接依赖网页框架或文档对象模型。 */
    private readonly waitForProcessDetailLayoutCommit: () => Promise<void> = async () => undefined,
  ) {}

  /**
   * 流程路由与外层播放按钮只传已验证的领域命令；其他命令在此再次防御。
   * 播放控制不创建新事务、不改变拓扑或稳定视图，只作用于当前已提交的关键环节。
   */
  public async submit(command: HostDispatchableDomainCommand): Promise<HostCommandExecutionResult> {
    if (command.type === 'process-detail.playback') {
      return this.setCurrentPlayback(command.payload.playing, command.payload.expectedContextRevision)
    }
    if (command.type !== 'workflow.trigger') return this.failure('action.execute.failed', 'validation', '关键环节处理器只接收流程触发命令。')
    const action = this.registry.getAction(command.payload.actionId)
    if (!action) return this.failure('action.unknown', 'validation', '流程动作未在当前清单中登记。')

    const snapshot = this.coordinator.getSnapshot()
    const context = snapshot.stableContext
    if (!context || snapshot.runtimeStatus !== 'ready') {
      return this.failure('action.execute.failed', 'validation', '当前没有可执行关键环节事务的稳定视图。')
    }
    if (command.payload.expectedContextRevision !== undefined && command.payload.expectedContextRevision !== context.contextRevision) {
      return this.failure('context.revision.conflict', 'validation', '流程动作使用的上下文版本已经失效。')
    }
    if (Object.keys(command.payload.parameters ?? {}).length > 0) {
      return this.failure('action.execute.failed', 'validation', '关键环节动作当前不接收运行时参数。')
    }

    if (action.targetViewMode === 'process-detail') return this.enter(action, context.contextRevision, command.correlationId)
    if (isProcessDetailVisualizationStableContext(context)) return this.exit(action, context.contextRevision, command.correlationId)
    return this.failure('action.context.mismatch', 'validation', '当前动作不属于关键环节进入或返回事务。')
  }

  /**
   * 将网页播放或停止意图绑定到当前稳定关键环节，而非相信外层传入的场景或资源编号。
   * Unity 回执返回前若视图已切换，则按已取代处理，避免旧按钮回执覆盖新环节状态。
   */
  public async setCurrentPlayback(
    playing: boolean,
    expectedContextRevision?: number,
  ): Promise<HostCommandExecutionResult> {
    const snapshot = this.coordinator.getSnapshot()
    const context = snapshot.stableContext
    if (!context || snapshot.runtimeStatus !== 'ready' || !isProcessDetailVisualizationStableContext(context)) {
      return this.failure('action.context.mismatch', 'validation', '播放控制只能在已稳定提交的关键环节中执行。')
    }
    if (expectedContextRevision !== undefined && expectedContextRevision !== context.contextRevision) {
      return this.failure('context.revision.conflict', 'validation', '播放控制使用的上下文版本已经失效。')
    }

    const sceneId = context.sceneId
    const processDetailId = context.processDetailId
    const contextRevision = context.contextRevision
    const result = await this.unity.setProcessDetailPlayback(sceneId, processDetailId, playing)
    const currentContext = this.coordinator.getSnapshot().stableContext
    if (!currentContext || !isProcessDetailVisualizationStableContext(currentContext)
      || currentContext.sceneId !== sceneId
      || currentContext.processDetailId !== processDetailId
      || currentContext.contextRevision !== contextRevision) {
      return this.failure('command.superseded', 'executing-action', '播放命令完成前当前关键环节已切换。')
    }
    if (!result.success) return this.failure('action.execute.failed', 'executing-action', '关键环节播放控制未被三维运行时确认。')
    return { success: true, status: 'completed', contextRevision }
  }

  /**
   * 外层生命周期到期时立即撤销该事务的提交权。
   * 进入中的 Unity 迟到成功会在 await 返回后按同一 transitionId 发送定向退出；
   * 退出中的迟到成功则会定向重建原关键环节。两种收尾均不会改写随后新事务的稳定上下文。
   */
  public cancelTimedOutCommand(correlationId: string): void {
    const active = this.activeTransactionsByCorrelationId.get(correlationId)
    if (!active || active.cancelled) return

    active.cancelled = true
    if (!this.isCurrent(active.transitionId)) return
    if (active.kind === 'enter' && active.rollbackTopology) {
      // 外层截止时先恢复同一画布的业务拓扑，避免协调器恢复业务稳定态后短暂暴露仍暂停的空画布。
      this.topologyRuntime.activate(active.rollbackTopology, active.transitionId)
    }
    if (active.kind === 'switch' && active.previousDetail) {
      this.topologyRuntime.retargetProcessDetail(active.previousDetail.sceneId, active.previousDetail.stateNodeId)
    }
    if (active.kind !== 'exit') this.cleanupAbandonedProcessDetail(active)
    this.coordinator.submit({
      type: 'transition.fail',
      transitionId: active.transitionId,
      diagnostic: { code: 'command.timeout', correlationId, occurredAt: new Date().toISOString() },
    })
  }

  /** 重复触发当前已稳定环节直接幂等成功，不重复加载模型、粒子或监听器。 */
  private async enter(
    action: Extract<ActionDefinition, { targetViewMode: 'process-detail' }>,
    expectedContextRevision: number,
    correlationId: string,
  ): Promise<HostCommandExecutionResult> {
    const currentContext = this.coordinator.getSnapshot().stableContext
    const detail = this.registry.getProcessDetail(action.processDetailId)
    if (!currentContext || !detail || detail.sceneId !== currentContext.sceneId || currentContext.sceneId !== action.targetSceneId) {
      return this.failure('action.context.mismatch', 'validation', '关键环节目录或当前业务拓扑上下文不匹配。')
    }

    const switchesProcessDetail = isProcessDetailVisualizationStableContext(currentContext)
    if (switchesProcessDetail && currentContext.processDetailId === action.processDetailId) {
      return { success: true, status: 'completed', contextRevision: currentContext.contextRevision }
    }
    const previousDetail = switchesProcessDetail
      ? this.registry.getProcessDetail(currentContext.processDetailId)
      : undefined
    const activeTopology = this.topologyRuntime.getActiveTopology()
    if (switchesProcessDetail) {
      if (!previousDetail || previousDetail.sceneId !== detail.sceneId) {
        return this.failure('action.context.mismatch', 'validation', '同场景关键环节切换缺少原活动目录项。')
      }
    } else if (!isBusinessVisualizationStableContext(currentContext) || !activeTopology || activeTopology.topologyId !== currentContext.topologyId) {
      return this.failure('action.context.mismatch', 'validation', '关键环节只能从同场景第二层业务拓扑或已提交关键环节进入。')
    }

    const transitionId = this.createTransitionId()
    // 从第二层进入时预先保存同一拓扑的可回滚定义；准备阶段仍保持画布显示和可恢复能力。
    const rollbackTopology = switchesProcessDetail
      ? undefined
      : this.topologyRuntime.prepare(detail.sceneId, activeTopology!.topologyId, transitionId)
    if (!switchesProcessDetail && !rollbackTopology) {
      return this.failure('topology.prepare.failed', 'preparing-topology', '当前业务拓扑未能建立回滚快照。')
    }
    const begin = this.coordinator.submit({
      type: 'transition.begin',
      transitionId,
      sceneId: detail.sceneId,
      topologyId: null,
      processDetailId: detail.processDetailId,
      actionId: action.actionId,
      expectedContextRevision,
    })
    if (begin.status !== 'accepted') return this.failure('context.revision.conflict', 'validation', '关键环节事务未能取得当前上下文提交权。')

    const active = this.registerActiveTransaction(
      correlationId,
      transitionId,
      switchesProcessDetail ? 'switch' : 'enter',
      detail,
      previousDetail,
      rollbackTopology,
    )
    try {
      const prepared = await this.unity.prepareProcessDetail(detail, transitionId)
      if (active.cancelled || !this.isCurrent(transitionId)) {
        this.cleanupAbandonedProcessDetail(active)
        return this.superseded(transitionId)
      }
      if (!prepared.success) {
        this.abortPreparedProcessDetail(active)
        return this.fail(transitionId, correlationId, '关键环节候选资源未能完成隐藏加载和状态重放。')
      }
      active.phase = 'prepared'

      // 同场景第三层直切时画布已经暂停；从第二层进入才需要保存视口并切换状态投影目标。
      if (!switchesProcessDetail && !this.topologyRuntime.suspendForProcessDetail(detail.sceneId, detail.stateNodeId)) {
        await this.unity.abortProcessDetail(detail.sceneId, detail.processDetailId, transitionId)
        return this.fail(transitionId, correlationId, '唯一拓扑画布未能安全暂停。', 'activating-topology')
      }
      if (switchesProcessDetail && !this.topologyRuntime.retargetProcessDetail(detail.sceneId, detail.stateNodeId)) {
        await this.unity.abortProcessDetail(detail.sceneId, detail.processDetailId, transitionId)
        return this.fail(transitionId, correlationId, '关键环节状态投影目标未能安全切换。', 'activating-topology')
      }
      const topologyIdle = this.coordinator.submit({ type: 'topology.status.reported', transitionId, status: 'idle' })
      if (topologyIdle.status !== 'accepted') {
        this.cleanupAbandonedProcessDetail(active)
        return this.superseded(transitionId)
      }

      // 先让组合根提交“全屏三维 + 拓扑暂停”布局，再允许 Unity 显示候选和移动相机。
      await this.waitForProcessDetailLayoutCommit()
      if (active.cancelled || !this.isCurrent(transitionId)) {
        this.cleanupAbandonedProcessDetail(active)
        return this.superseded(transitionId)
      }

      active.phase = 'committing'
      const committedInUnity = await this.unity.commitProcessDetail(detail.sceneId, detail.processDetailId, transitionId)
      if (active.cancelled || !this.isCurrent(transitionId)) {
        this.cleanupAbandonedProcessDetail(active)
        return this.superseded(transitionId)
      }
      if (!committedInUnity.success) {
        await this.unity.abortProcessDetail(detail.sceneId, detail.processDetailId, transitionId)
        if (previousDetail) this.topologyRuntime.retargetProcessDetail(previousDetail.sceneId, previousDetail.stateNodeId)
        if (rollbackTopology && !this.topologyRuntime.activate(rollbackTopology, transitionId)) {
          return this.failToError(transitionId, correlationId, '关键环节提交失败且业务拓扑未能恢复。')
        }
        return this.fail(transitionId, correlationId, '关键环节候选未能原子提交。')
      }

      const commit = this.coordinator.submit({
        type: 'transition.commit',
        transitionId,
        sceneId: detail.sceneId,
        topologyId: null,
        processDetailId: detail.processDetailId,
        actionId: action.actionId,
        sceneActivationId: this.coordinator.getSnapshot().sceneActivationId ?? null,
      })
      if (commit.status !== 'accepted') {
        this.cleanupAbandonedProcessDetail(active)
        return this.superseded(transitionId)
      }
      return { success: true, status: 'completed', transitionId, contextRevision: commit.contextRevision }
    } finally {
      this.unregisterActiveTransaction(correlationId, active)
    }
  }

  /** 返回只接受同场景第二层动作；预备拓扑不绘制，直到 Unity 确认恢复业务相机并释放独立资源。 */
  private async exit(
    action: Extract<ActionDefinition, { targetViewMode: 'business' }>,
    expectedContextRevision: number,
    correlationId: string,
  ): Promise<HostCommandExecutionResult> {
    const currentContext = this.coordinator.getSnapshot().stableContext
    if (!currentContext || !isProcessDetailVisualizationStableContext(currentContext) || currentContext.sceneId !== action.targetSceneId) {
      return this.failure('action.context.mismatch', 'validation', '返回动作与当前关键环节场景不匹配。')
    }
    const detail = this.registry.getProcessDetail(currentContext.processDetailId)
    if (!detail) return this.failure('action.context.mismatch', 'validation', '当前关键环节未在目录中登记。')

    const transitionId = this.createTransitionId()
    const prepared = this.topologyRuntime.prepare(action.targetSceneId, action.targetTopologyId, transitionId)
    if (!prepared) return this.failure('topology.prepare.failed', 'preparing-topology', '返回目标拓扑未能预备。')
    const begin = this.coordinator.submit({
      type: 'transition.begin',
      transitionId,
      sceneId: action.targetSceneId,
      topologyId: action.targetTopologyId,
      actionId: action.actionId,
      expectedContextRevision,
    })
    if (begin.status !== 'accepted') return this.failure('context.revision.conflict', 'validation', '返回事务未能取得当前上下文提交权。')

    const active = this.registerActiveTransaction(correlationId, transitionId, 'exit', detail)
    try {
      const exited = await this.unity.exitProcessDetail(detail.sceneId, detail.processDetailId, transitionId)
      if (active.cancelled || !this.isCurrent(transitionId)) {
        // 退出回执在超时后才成功意味着旧第三层可能已释放；只有当前仍稳定停留在同一环节时才重建，
        // 防止迟到收尾覆盖用户已经进入的新场景或新关键环节。
        this.restoreProcessDetailAfterStaleExit(detail)
        return this.superseded(transitionId)
      }
      if (!exited.success) {
        // 命令失败不等同于 Unity 从未执行。先投递幂等重建覆盖迟到退出，再让协调器恢复原稳定关键环节。
        this.restoreProcessDetailAfterStaleExit(detail)
        return this.fail(transitionId, correlationId, '关键环节资源未能释放，已保留当前稳定视图。')
      }

      if (!this.topologyRuntime.activate(prepared, transitionId)) {
        // Unity 已退出第三层后必须重进同一目录项才能证明旧稳定组合恢复；失败时进入明确错误态。
        // 补偿进入必须使用全新事务标识；退出标识已经被 Unity 幂等登记，复用它会被判为重放，
        // 从而让“保留上一稳定第三层”的恢复语义只停留在前端状态而没有真实模型支撑。
        const recoveryTransitionId = this.createTransitionId()
        const restored = await this.restoreStableProcessDetail(detail, recoveryTransitionId)
        if (active.cancelled || !this.isCurrent(transitionId)) return this.superseded(transitionId)
        if (!restored.success) return this.failToError(transitionId, correlationId, '拓扑恢复失败且关键环节模型未能重新建立。')
        return this.fail(transitionId, correlationId, '原业务拓扑未能恢复。', 'activating-topology')
      }
      const topologyReady = this.coordinator.submit({ type: 'topology.status.reported', transitionId, status: 'ready' })
      if (topologyReady.status !== 'accepted') return this.superseded(transitionId)
      const commit = this.coordinator.submit({
        type: 'transition.commit',
        transitionId,
        sceneId: action.targetSceneId,
        topologyId: action.targetTopologyId,
        actionId: action.actionId,
        sceneActivationId: this.coordinator.getSnapshot().sceneActivationId ?? null,
      })
      if (commit.status !== 'accepted') return this.superseded(transitionId)
      return { success: true, status: 'completed', transitionId, contextRevision: commit.contextRevision }
    } finally {
      this.unregisterActiveTransaction(correlationId, active)
    }
  }

  /** 登记后只保存固定标识，允许外层 120 秒超时精确撤销该一次独立资源事务。 */
  private registerActiveTransaction(
    correlationId: string,
    transitionId: TransitionId,
    kind: ActiveProcessDetailTransaction['kind'],
    detail: ProcessDetailDefinition,
    previousDetail?: ProcessDetailDefinition,
    rollbackTopology?: PreparedTopology,
  ): ActiveProcessDetailTransaction {
    const active: ActiveProcessDetailTransaction = {
      correlationId,
      transitionId,
      kind,
      detail,
      ...(previousDetail ? { previousDetail } : {}),
      ...(rollbackTopology ? { rollbackTopology } : {}),
      phase: kind === 'exit' ? 'exiting' : 'preparing',
      cancelled: false,
      cleanupStarted: false,
    }
    this.activeTransactionsByCorrelationId.set(correlationId, active)
    return active
  }

  /** 只删除仍属于本次异步调用的记录，避免未来重试复用关联标识时误删新事务。 */
  private unregisterActiveTransaction(correlationId: string, active: ActiveProcessDetailTransaction): void {
    if (this.activeTransactionsByCorrelationId.get(correlationId) === active) {
      this.activeTransactionsByCorrelationId.delete(correlationId)
    }
  }

  /**
   * 最佳努力清理进入中的迟到资源。退出与原 transitionId 绑定，Unity 即使收到更晚的旧回执也只能处理该实例。
   * 不等待该 Promise，避免已经超时的外层命令继续占用生命周期待确认槽位；异常同样不能逃逸到调用链。
   */
  private cleanupAbandonedProcessDetail(active: ActiveProcessDetailTransaction): void {
    if (active.cleanupStarted || active.kind === 'exit') return
    active.cleanupStarted = true
    if (active.phase !== 'committing') {
      void this.unity.abortProcessDetail(active.detail.sceneId, active.detail.processDetailId, active.transitionId).catch(() => undefined)
      return
    }

    if (active.previousDetail) {
      void this.restoreStableProcessDetail(active.previousDetail, this.createTransitionId()).catch(() => undefined)
      return
    }
    void this.unity.exitProcessDetail(active.detail.sceneId, active.detail.processDetailId, active.transitionId).catch(() => undefined)
  }

  /** 已知尚处准备阶段时只取消候选，不触碰当前稳定第三层或第二层相机。 */
  private abortPreparedProcessDetail(active: ActiveProcessDetailTransaction): void {
    if (active.cleanupStarted) return
    active.cleanupStarted = true
    void this.unity.abortProcessDetail(active.detail.sceneId, active.detail.processDetailId, active.transitionId).catch(() => undefined)
  }

  /**
   * 退出或直切结果不确定时，用全新事务按同一两阶段协议重建原稳定环节。
   * 该补偿不提交前端上下文，只修复 Unity 物理视图与协调器已经恢复的稳定上下文。
   */
  private async restoreStableProcessDetail(detail: ProcessDetailDefinition, transitionId: TransitionId): Promise<{ success: boolean }> {
    const prepared = await this.unity.prepareProcessDetail(detail, transitionId)
    if (!prepared.success) return { success: false }
    return this.unity.commitProcessDetail(detail.sceneId, detail.processDetailId, transitionId)
  }

  /**
   * 退出不确定时只在当前稳定上下文仍是同一关键环节才定向重建。
   * 使用新的内部事务标识，避免 Unity 将“补偿进入”误判为刚刚超时的退出请求重放；该内部清理不提交前端状态，
   * 因为协调器早已恢复原第三层稳定上下文。
   */
  private restoreProcessDetailAfterStaleExit(detail: ProcessDetailDefinition): void {
    const context = this.coordinator.getSnapshot().stableContext
    if (!context || !isProcessDetailVisualizationStableContext(context) || context.sceneId !== detail.sceneId || context.processDetailId !== detail.processDetailId) return
    void this.restoreStableProcessDetail(detail, this.createTransitionId()).catch(() => undefined)
  }

  private isCurrent(transitionId: TransitionId): boolean {
    return this.coordinator.getSnapshot().activeTransitionId === transitionId
  }

  private fail(
    transitionId: TransitionId,
    correlationId: string,
    message: string,
    stage: HostProtocolError['stage'] = 'executing-action',
  ): HostCommandExecutionResult {
    this.coordinator.submit({
      type: 'transition.fail',
      transitionId,
      diagnostic: { code: 'action.execute.failed', correlationId, occurredAt: new Date().toISOString() },
    })
    return this.failure('action.execute.failed', stage, message, transitionId)
  }

  private failToError(transitionId: TransitionId, correlationId: string, message: string): HostCommandExecutionResult {
    this.coordinator.submit({
      type: 'transition.recovery.fail',
      transitionId,
      diagnostic: { code: 'transition.recovery.failed', correlationId, occurredAt: new Date().toISOString() },
    })
    return this.failure('action.execute.failed', 'executing-action', message, transitionId, false)
  }

  private superseded(transitionId: TransitionId): HostCommandExecutionResult {
    return {
      success: false,
      status: 'superseded',
      transitionId,
      error: { code: 'command.superseded', stage: 'executing-action', message: '关键环节事务已被更新请求取代。', recoverable: true },
    }
  }

  private failure(
    code: HostProtocolError['code'],
    stage: HostProtocolError['stage'],
    message: string,
    transitionId?: TransitionId,
    recoverable = true,
  ): HostCommandExecutionResult {
    return { success: false, status: 'failed', ...(transitionId ? { transitionId } : {}), error: { code, stage, message, recoverable } }
  }
}

let processDetailTransitionSequence = 0

/** 只使用固定前缀、时间与单调序号，不把动作参数或模型名称拼入事务标识。 */
function createDefaultTransitionId(): TransitionId {
  processDetailTransitionSequence += 1
  return toTransitionId(`transition.process-detail.${Date.now()}.${processDetailTransitionSequence}`)
}

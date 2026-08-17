import type {
  ActionId,
  NodeId,
  RouteId,
  SceneActivationId,
  SceneId,
  SceneNodeId,
  TopologyId,
  TransitionId,
} from '@/config/scene-topology/identifiers'
import type {
  VisualizationDiagnostic,
  VisualizationSceneLoadProgress,
  VisualizationSceneLoadStage,
  VisualizationRuntimeStatus,
  VisualizationSelectionSource,
  VisualizationStableContext,
  VisualizationSubsystemStatus,
  VisualizationTransitionOutcome,
  VisualizationTransitionSummary,
} from '@/modules/visual/orchestration/visualization.store'

/**
 * 协调器接受的可序列化领域命令。
 * 外层桥、拓扑组件和 Unity 事件适配器只能构造这些命令，不能取得 Pinia 写方法、窗口、画布或 Unity 对象。
 */
export type VisualizationDomainCommand =
  | {
      type: 'transition.begin'
      transitionId: TransitionId
      sceneId: SceneId
      topologyId: TopologyId
      actionId: ActionId | null
      expectedContextRevision?: number
      /** 补偿恢复时即使逻辑稳定场景相同，也必须要求 Unity 重新确认物理场景。 */
      forceSceneSwitch?: boolean
    }
  | { type: 'unity.status.reported'; transitionId: TransitionId | null; status: VisualizationSubsystemStatus }
  | {
      type: 'unity.load-progress.reported'
      transitionId: TransitionId
      sceneId: SceneId
      stageCode: VisualizationSceneLoadStage
      progress: number
    }
  | { type: 'topology.status.reported'; transitionId: TransitionId | null; status: VisualizationSubsystemStatus }
  | {
      type: 'transition.commit'
      transitionId: TransitionId
      sceneId: SceneId
      topologyId: TopologyId
      actionId: ActionId | null
      /** 真实 Unity 场景实例标识；同场景拓扑切换沿用上一个稳定上下文的值。 */
      sceneActivationId?: SceneActivationId | null
    }
  | {
      type: 'transition.fail'
      transitionId: TransitionId
      diagnostic: VisualizationDiagnostic
      /** 只有补偿恢复成功才可显式标记为 recovered（已恢复）；普通失败仍保持 failed。 */
      outcome?: Extract<VisualizationTransitionOutcome, 'failed' | 'recovered'>
      /** 仅 recovered 路径可传入，表示 Unity 已物理恢复到此前稳定场景的新实例。 */
      restoredSceneActivationId?: SceneActivationId
    }
  | { type: 'transition.recovery.fail'; transitionId: TransitionId; diagnostic: VisualizationDiagnostic }
  | {
      type: 'selection.replace'
      nodeIds: readonly NodeId[]
      routeIds: readonly RouteId[]
      source: VisualizationSelectionSource
      sceneNodeId?: SceneNodeId | null
    }
  | { type: 'diagnostic.record'; diagnostic: VisualizationDiagnostic }
  | { type: 'system.release' }

/** 协调器错误使用稳定代码和阶段，后续外层桥只能显式映射，不能回传原始异常对象。 */
export interface VisualizationCoordinatorError {
  code:
    | 'context.revision.conflict'
    | 'transition.stale'
    | 'transition.target.mismatch'
    | 'transition.subsystems.not-ready'
    | 'runtime.not-ready'
    | 'runtime.disposed'
  stage: 'validation' | 'transition' | 'selection' | 'disposing'
  message: string
  recoverable: boolean
}

/**
 * 所有领域命令都返回明确结果。ignored（已忽略）只用于幂等或迟到事件，
 * rejected（已拒绝）表示调用方需要向上层返回结构化失败。
 */
export type VisualizationCoordinatorResult =
  | {
      status: 'accepted'
      transitionId?: TransitionId
      supersededTransitionId?: TransitionId
      contextRevision?: number
    }
  | { status: 'ignored'; reason: 'idempotent' | 'stale-transition' }
  | { status: 'rejected'; error: VisualizationCoordinatorError }

/**
 * Pinia 状态仓库对协调器公开的最小写入端口。
 * 该接口刻意不包含 `$state`、`$patch` 或任意响应式容器，便于单元测试并限制直接状态写入范围。
 */
export interface VisualizationCoordinatorStatePort {
  readonly stableContext: VisualizationStableContext | null
  /** 与稳定上下文绑定的真实 Unity 场景实例；旧测试替身缺失时视为不可证明。 */
  readonly sceneActivationId?: SceneActivationId | null
  readonly activeTransitionId: TransitionId | null
  readonly targetSceneId: SceneId | null
  readonly targetTopologyId: TopologyId | null
  readonly targetActionId: ActionId | null
  readonly runtimeStatus: VisualizationRuntimeStatus
  readonly unityStatus: VisualizationSubsystemStatus
  readonly topologyStatus: VisualizationSubsystemStatus
  readonly sceneLoadProgress: VisualizationSceneLoadProgress | null
  readonly selectedNodeIds: readonly NodeId[]
  readonly selectedRouteIds: readonly RouteId[]
  readonly selectedSceneNodeId: SceneNodeId | null
  readonly selectionSource: VisualizationSelectionSource
  readonly latestDiagnostic: VisualizationDiagnostic | null
  readonly recentTransitionSummaries?: readonly VisualizationTransitionSummary[]
  beginTransition(
    transitionId: TransitionId,
    sceneId: SceneId,
    topologyId: TopologyId,
    actionId: ActionId | null,
    forceSceneSwitch?: boolean,
  ): void
  setUnityStatus(status: VisualizationSubsystemStatus): void
  setTopologyStatus(status: VisualizationSubsystemStatus): void
  setSceneLoadProgress(progress: VisualizationSceneLoadProgress | null): void
  commitStableContext(
    transitionId: TransitionId,
    sceneId: SceneId,
    topologyId: TopologyId,
    actionId: ActionId | null,
    sceneActivationId?: SceneActivationId | null,
  ): boolean
  failTransition(
    transitionId: TransitionId,
    diagnostic: VisualizationDiagnostic,
    outcome?: Extract<VisualizationTransitionOutcome, 'failed' | 'recovered'>,
    restoredSceneActivationId?: SceneActivationId,
  ): boolean
  failTransitionToError(transitionId: TransitionId, diagnostic: VisualizationDiagnostic): boolean
  setSelection(
    nodeIds: readonly NodeId[],
    routeIds: readonly RouteId[],
    source: VisualizationSelectionSource,
    sceneNodeId?: SceneNodeId | null,
  ): void
  recordDiagnostic(diagnostic: VisualizationDiagnostic): void
  release(): void
}

/** 只读快照全部由原始值和数组副本组成，不暴露响应式引用或可修改的仓库对象。 */
export interface VisualizationCoordinatorSnapshot {
  stableContext: VisualizationStableContext | null
  /** 当前稳定 Unity 物理实例标识；缺失时对象选择协调器会安全拒绝。 */
  sceneActivationId?: SceneActivationId | null
  activeTransitionId: TransitionId | null
  targetSceneId: SceneId | null
  targetTopologyId: TopologyId | null
  targetActionId: ActionId | null
  runtimeStatus: VisualizationRuntimeStatus
  unityStatus: VisualizationSubsystemStatus
  topologyStatus: VisualizationSubsystemStatus
  /**
   * 新版协调器快照始终提供该字段；可选标记保留旧测试替身和只读适配器的兼容性。
   * 消费方必须把 undefined 与 null 同等视为“当前没有可显示的加载反馈”。
   */
  sceneLoadProgress?: VisualizationSceneLoadProgress | null
  selectedNodeIds: readonly NodeId[]
  selectedRouteIds: readonly RouteId[]
  selectedSceneNodeId: SceneNodeId | null
  selectionSource: VisualizationSelectionSource
  latestDiagnostic: VisualizationDiagnostic | null
  /** 新版快照提供固定容量终态摘要；旧测试替身缺失时按空数组处理。 */
  recentTransitionSummaries?: readonly VisualizationTransitionSummary[]
}

/**
 * 场景—拓扑联动协调器是可视化状态的唯一写入口。
 * 它只验证领域事务并调用状态端口，不导入窗口消息、画布绘制器、内嵌框架或 Unity 对象接口。
 */
export class VisualizationCoordinator {
  public constructor(private readonly state: VisualizationCoordinatorStatePort) {}

  /** 提交单条领域命令；所有分支均在本类内完成写入，调用方不会取得状态端口。 */
  public submit(command: VisualizationDomainCommand): VisualizationCoordinatorResult {
    if (command.type === 'system.release') return this.release()
    if (this.state.runtimeStatus === 'released') return this.rejected('runtime.disposed', 'disposing', '可视化运行时已经释放。', false)

    switch (command.type) {
      case 'transition.begin':
        return this.beginTransition(command)
      case 'unity.status.reported':
        return this.reportSubsystemStatus('unity', command.transitionId, command.status)
      case 'unity.load-progress.reported':
        return this.reportUnityLoadProgress(command)
      case 'topology.status.reported':
        return this.reportSubsystemStatus('topology', command.transitionId, command.status)
      case 'transition.commit':
        return this.commitTransition(command)
      case 'transition.fail':
        return this.failTransition(command.transitionId, command.diagnostic, command.outcome, command.restoredSceneActivationId)
      case 'transition.recovery.fail':
        return this.failTransitionToError(command.transitionId, command.diagnostic)
      case 'selection.replace':
        return this.replaceSelection(command)
      case 'diagnostic.record':
        this.state.recordDiagnostic(command.diagnostic)
        return { status: 'accepted' }
    }
  }

  /**
   * 返回防御性快照。稳定上下文和诊断对象均复制，数组也复制，
   * 因此外层状态查询无法通过修改返回值绕过协调器。
   */
  public getSnapshot(): VisualizationCoordinatorSnapshot {
    return {
      stableContext: this.state.stableContext ? { ...this.state.stableContext } : null,
      sceneActivationId: this.state.sceneActivationId ?? null,
      activeTransitionId: this.state.activeTransitionId,
      targetSceneId: this.state.targetSceneId,
      targetTopologyId: this.state.targetTopologyId,
      targetActionId: this.state.targetActionId,
      runtimeStatus: this.state.runtimeStatus,
      unityStatus: this.state.unityStatus,
      topologyStatus: this.state.topologyStatus,
      sceneLoadProgress: this.state.sceneLoadProgress ? { ...this.state.sceneLoadProgress } : null,
      selectedNodeIds: [...this.state.selectedNodeIds],
      selectedRouteIds: [...this.state.selectedRouteIds],
      selectedSceneNodeId: this.state.selectedSceneNodeId,
      selectionSource: this.state.selectionSource,
      latestDiagnostic: this.state.latestDiagnostic ? { ...this.state.latestDiagnostic } : null,
      recentTransitionSummaries: this.state.recentTransitionSummaries
        ? this.state.recentTransitionSummaries.map((summary) => ({ ...summary }))
        : [],
    }
  }

  /**
   * 开始事务前检查调用方期望的上下文版本。新事务会立即取代旧事务的提交权，
   * 但旧稳定上下文继续可见，直至新事务完整提交。
   */
  private beginTransition(command: Extract<VisualizationDomainCommand, { type: 'transition.begin' }>): VisualizationCoordinatorResult {
    const currentRevision = this.state.stableContext?.contextRevision ?? 0
    if (command.expectedContextRevision !== undefined && command.expectedContextRevision !== currentRevision) {
      return this.rejected('context.revision.conflict', 'validation', '调用方期望的上下文版本与当前稳定版本不一致。', true)
    }

    if (
      this.state.activeTransitionId === command.transitionId &&
      this.state.targetSceneId === command.sceneId &&
      this.state.targetTopologyId === command.topologyId &&
      this.state.targetActionId === command.actionId
    ) {
      return { status: 'ignored', reason: 'idempotent' }
    }

    const supersededTransitionId = this.state.activeTransitionId ?? undefined
    const requiresSceneSwitch = command.forceSceneSwitch || this.state.stableContext?.sceneId !== command.sceneId
    this.state.beginTransition(
      command.transitionId,
      command.sceneId,
      command.topologyId,
      command.actionId,
      command.forceSceneSwitch,
    )

    // 首次进入或跨场景切换必须重新等待 Unity 就绪；同场景事务保留当前 Unity ready 状态。
    if (requiresSceneSwitch) this.state.setUnityStatus('preparing')

    return {
      status: 'accepted',
      transitionId: command.transitionId,
      ...(supersededTransitionId ? { supersededTransitionId } : {}),
    }
  }

  /** 子系统状态只有在对应事务仍活动时可写入；迟到进度和结果直接忽略。 */
  private reportSubsystemStatus(
    subsystem: 'unity' | 'topology',
    transitionId: TransitionId | null,
    status: VisualizationSubsystemStatus,
  ): VisualizationCoordinatorResult {
    if (transitionId !== this.state.activeTransitionId) return { status: 'ignored', reason: 'stale-transition' }

    if (subsystem === 'unity') this.state.setUnityStatus(status)
    else this.state.setTopologyStatus(status)

    return { status: 'accepted', ...(transitionId ? { transitionId } : {}) }
  }

  /**
   * 仅当前跨场景事务可以写入 Unity 加载反馈。
   * 连接器已经校验来源、原请求、场景、事务、阶段和数值范围；协调器仍再次核对活动目标与单调性，
   * 防止迟到回调、错误场景或进度回退改变遮罩内容。该反馈仅供本地诊断和脱敏界面显示，不会提前提交目标视图。
   */
  private reportUnityLoadProgress(
    command: Extract<VisualizationDomainCommand, { type: 'unity.load-progress.reported' }>,
  ): VisualizationCoordinatorResult {
    if (
      command.transitionId !== this.state.activeTransitionId
      || command.sceneId !== this.state.targetSceneId
      || this.state.runtimeStatus !== 'switching'
    ) {
      return { status: 'ignored', reason: 'stale-transition' }
    }
    if (!Number.isFinite(command.progress) || command.progress < 0 || command.progress > 1) {
      // 不把无效进度写入诊断；连接器应已拒绝它，此处只保留领域层防御边界。
      return { status: 'ignored', reason: 'idempotent' }
    }

    const previous = this.state.sceneLoadProgress
    if (previous && command.progress < previous.progress) {
      // 进度回退不能覆盖已显示的加载状态；下一事务会在 begin 时清空该单条快照。
      return { status: 'ignored', reason: 'idempotent' }
    }
    if (previous?.stageCode === command.stageCode && previous.progress === command.progress) {
      return { status: 'ignored', reason: 'idempotent' }
    }

    this.state.setSceneLoadProgress({ stageCode: command.stageCode, progress: command.progress })
    return { status: 'accepted', transitionId: command.transitionId }
  }

  /**
   * 提交时同时验证事务、场景、拓扑、动作和两个子系统状态。
   * 任一条件不满足都不会递增上下文版本，从而避免“新场景 + 旧拓扑”等混合状态。
   */
  private commitTransition(command: Extract<VisualizationDomainCommand, { type: 'transition.commit' }>): VisualizationCoordinatorResult {
    if (command.transitionId !== this.state.activeTransitionId) return { status: 'ignored', reason: 'stale-transition' }
    if (
      command.sceneId !== this.state.targetSceneId ||
      command.topologyId !== this.state.targetTopologyId ||
      command.actionId !== this.state.targetActionId
    ) {
      return this.rejected('transition.target.mismatch', 'transition', '提交目标与当前事务准备目标不一致。', true)
    }
    if (this.state.unityStatus !== 'ready' || this.state.topologyStatus !== 'ready') {
      return this.rejected('transition.subsystems.not-ready', 'transition', 'Unity 与拓扑尚未同时就绪，不能提交稳定上下文。', true)
    }

    const committed = this.state.commitStableContext(
      command.transitionId,
      command.sceneId,
      command.topologyId,
      command.actionId,
      command.sceneActivationId,
    )
    if (!committed) return { status: 'ignored', reason: 'stale-transition' }

    return {
      status: 'accepted',
      transitionId: command.transitionId,
      contextRevision: this.state.stableContext?.contextRevision ?? 0,
    }
  }

  /** 当前事务失败时恢复上一个稳定上下文；旧事务失败不会覆盖新事务或新诊断。 */
  private failTransition(
    transitionId: TransitionId,
    diagnostic: VisualizationDiagnostic,
    outcome: Extract<VisualizationTransitionOutcome, 'failed' | 'recovered'> = 'failed',
    restoredSceneActivationId: SceneActivationId | undefined = undefined,
  ): VisualizationCoordinatorResult {
    if (transitionId !== this.state.activeTransitionId) return { status: 'ignored', reason: 'stale-transition' }
    return this.state.failTransition(transitionId, diagnostic, outcome, restoredSceneActivationId)
      ? { status: 'accepted', transitionId, contextRevision: this.state.stableContext?.contextRevision ?? 0 }
      : { status: 'ignored', reason: 'stale-transition' }
  }

  /**
   * 回退失败代表状态仓库无法再证明稳定上下文与 Unity、拓扑画布一致。
   * 因此仅当前活动事务可将系统切至 error（错误）状态；迟到旧事务仍只能被忽略。
   */
  private failTransitionToError(transitionId: TransitionId, diagnostic: VisualizationDiagnostic): VisualizationCoordinatorResult {
    if (transitionId !== this.state.activeTransitionId) return { status: 'ignored', reason: 'stale-transition' }
    return this.state.failTransitionToError(transitionId, diagnostic)
      ? { status: 'accepted', transitionId }
      : { status: 'ignored', reason: 'stale-transition' }
  }

  /** 选择只在稳定可操作状态写入；切换遮罩期间的点击事件不会污染旧稳定上下文。 */
  private replaceSelection(command: Extract<VisualizationDomainCommand, { type: 'selection.replace' }>): VisualizationCoordinatorResult {
    if (this.state.runtimeStatus !== 'ready' || !this.state.stableContext) {
      return this.rejected('runtime.not-ready', 'selection', '当前视图尚未进入稳定可操作状态。', true)
    }

    this.state.setSelection(
      [...new Set(command.nodeIds)],
      [...new Set(command.routeIds)],
      command.source,
      command.sceneNodeId ?? null,
    )
    return { status: 'accepted', contextRevision: this.state.stableContext.contextRevision }
  }

  /** 释放命令幂等；首次释放清空状态，后续重复释放不触发第二次生命周期副作用。 */
  private release(): VisualizationCoordinatorResult {
    if (this.state.runtimeStatus === 'released') return { status: 'ignored', reason: 'idempotent' }
    this.state.release()
    return { status: 'accepted' }
  }

  /** 统一构造领域错误，避免各分支泄露任意异常文本。 */
  private rejected(
    code: VisualizationCoordinatorError['code'],
    stage: VisualizationCoordinatorError['stage'],
    message: string,
    recoverable: boolean,
  ): VisualizationCoordinatorResult {
    return { status: 'rejected', error: { code, stage, message, recoverable } }
  }
}

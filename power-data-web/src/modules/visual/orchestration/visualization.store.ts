import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ActionId, NodeId, RouteId, SceneActivationId, SceneId, SceneNodeId, TopologyId, TransitionId } from '@/config/scene-topology/identifiers'

/** 选择来源用于阻断二维单击、Unity 反向选择和外层事件之间的聚焦回环。 */
export type VisualizationSelectionSource = 'topology' | 'unity' | 'external' | 'system'

/** 当前子应用的有限运行阶段；窗口、Canvas、定时器和 Unity 对象均不属于状态仓库。 */
export type VisualizationRuntimeStatus = 'idle' | 'preparing' | 'switching' | 'ready' | 'error' | 'released'

/** 三维与拓扑分别记录就绪状态，协调器只在两者满足事务条件时提交稳定上下文。 */
export type VisualizationSubsystemStatus = 'idle' | 'preparing' | 'ready' | 'failed' | 'disposed'

/** Unity 场景切换只允许报告协议已登记的四个有限阶段，未知文本不能进入状态或界面。 */
export type VisualizationSceneLoadStage = 'unloading-scene' | 'loading-scene' | 'initializing-scene' | 'restoring-scene'

/**
 * 当前跨场景事务的最后一条加载反馈。
 * 它不保存 Unity 对象、资源地址或无界历史；事务提交、失败或释放时立即清空，避免旧进度遗留到新视图。
 */
export interface VisualizationSceneLoadProgress {
  stageCode: VisualizationSceneLoadStage
  progress: number
}

/** 可序列化的稳定上下文，是外层状态快照和 view.changed（视图变更）事件的唯一来源。 */
export interface VisualizationStableContext {
  sceneId: SceneId
  topologyId: TopologyId
  actionId: ActionId | null
  contextRevision: number
}

/** 有限诊断不保存异常对象或完整外部载荷，只保留稳定代码与关联标识。 */
export interface VisualizationDiagnostic {
  code: string
  correlationId: string
  occurredAt: string
}

/** 事务摘要固定为 32 条；只存稳定标识和结果，不能变成无界的外层消息或 Unity 日志缓存。 */
export const VISUALIZATION_TRANSITION_SUMMARY_CAPACITY = 32

/** 事务终态用于诊断快速取代、正常提交、补偿恢复和无法证明恢复的错误状态。 */
export type VisualizationTransitionOutcome = 'completed' | 'failed' | 'superseded' | 'recovered' | 'recovery-failed'

/**
 * 有界事务摘要不含完整请求参数、资源地址、Unity 对象或异常文本。
 * 它只说明哪一份目标被处理、基于哪个稳定版本结束以及耗时，供任务-036后的回归定位使用。
 */
export interface VisualizationTransitionSummary {
  transitionId: TransitionId
  sceneId: SceneId
  topologyId: TopologyId
  actionId: ActionId | null
  previousContextRevision: number
  outcome: VisualizationTransitionOutcome
  elapsedMs: number
  diagnosticCode: string | null
}

/**
 * 可视化稳定上下文状态仓库。
 * 该仓库只保存领域标识、选择、版本、事务和有限状态；跨窗口对象、画布、命令表、资源句柄、
 * 监听器和计时器都必须由桥接、拓扑运行时和 Unity 宿主在各自生命周期中持有和释放。
 */
export const useVisualizationStore = defineStore('visualization', () => {
  const stableContext = ref<VisualizationStableContext | null>(null)
  /**
   * 当前稳定逻辑上下文对应的 Unity 物理场景实例。
   * 它与 sceneId 分离保存：同场景拓扑切换会提交新上下文版本，但绝不能伪造新的三维场景实例。
   */
  const sceneActivationId = ref<SceneActivationId | null>(null)
  const activeTransitionId = ref<TransitionId | null>(null)
  const targetSceneId = ref<SceneId | null>(null)
  const targetTopologyId = ref<TopologyId | null>(null)
  const targetActionId = ref<ActionId | null>(null)
  const runtimeStatus = ref<VisualizationRuntimeStatus>('idle')
  const unityStatus = ref<VisualizationSubsystemStatus>('idle')
  const topologyStatus = ref<VisualizationSubsystemStatus>('idle')
  /** 只保留当前活动跨场景事务的最后阶段和进度，容量固定为一条。 */
  const sceneLoadProgress = ref<VisualizationSceneLoadProgress | null>(null)
  const selectedNodeIds = ref<readonly NodeId[]>([])
  const selectedRouteIds = ref<readonly RouteId[]>([])
  const selectedSceneNodeId = ref<SceneNodeId | null>(null)
  const selectionSource = ref<VisualizationSelectionSource>('system')
  const latestDiagnostic = ref<VisualizationDiagnostic | null>(null)
  /** 只为当前活动事务计算耗时；终态写入固定长度摘要后立即清空。 */
  const activeTransitionStartedAt = ref<number | null>(null)
  const recentTransitionSummaries = ref<readonly VisualizationTransitionSummary[]>([])

  /** 稳定上下文存在才允许外层桥对外声明可用，切换中的目标字段永远不会提前暴露为当前视图。 */
  const hasStableContext = computed(() => stableContext.value !== null && runtimeStatus.value === 'ready')

  /** 当前上下文版本只从稳定上下文派生，未提交状态一律返回 0。 */
  const contextRevision = computed(() => stableContext.value?.contextRevision ?? 0)

  /**
   * 开始新的场景—拓扑事务。旧事务在协调器创建新 transitionId（切换事务标识）后失去提交权；
   * 此处不清空稳定上下文和选择，避免切换过程中出现无内容或“旧场景 + 新拓扑”的可操作混合视图。
   */
  function beginTransition(
    transitionId: TransitionId,
    sceneId: SceneId,
    topologyId: TopologyId,
    actionId: ActionId | null,
    forceSceneSwitch = false,
  ): void {
    // 新事务抵达即记录旧事务为 superseded（已取代），不等待其迟到回调；后续回调会因事务标识不匹配被过滤。
    appendActiveTransitionSummary('superseded')
    activeTransitionId.value = transitionId
    targetSceneId.value = sceneId
    targetTopologyId.value = topologyId
    targetActionId.value = actionId
    runtimeStatus.value = forceSceneSwitch || stableContext.value?.sceneId !== sceneId ? 'switching' : 'preparing'
    topologyStatus.value = 'preparing'
    activeTransitionStartedAt.value = Date.now()
    // 新事务立即丢弃旧事务反馈；迟到消息由协调器按 transitionId（切换事务标识）过滤。
    sceneLoadProgress.value = null
  }

  /** Unity 运行时仅报告阶段，不能直接写入场景、拓扑或上下文版本。 */
  function setUnityStatus(status: VisualizationSubsystemStatus): void {
    unityStatus.value = status
  }

  /** 拓扑运行时仅报告准备或激活阶段，真正的稳定提交仍由协调器统一调用 commit。 */
  function setTopologyStatus(status: VisualizationSubsystemStatus): void {
    topologyStatus.value = status
  }

  /**
   * 保存已经由协议连接器校验过的当前加载反馈。
   * 使用副本避免调用方持有可修改对象；传入 null 仅由当前事务结束路径使用，用于清除瞬态进度。
   */
  function setSceneLoadProgress(progress: VisualizationSceneLoadProgress | null): void {
    sceneLoadProgress.value = progress ? { ...progress } : null
  }

  /**
   * 仅当前事务可提交新的稳定上下文。提交时上下文版本严格递增一次，
   * 同时清空目标事务字段，防止旧回调在后续状态快照中被误识别为活动切换。
   */
  function commitStableContext(
    transitionId: TransitionId,
    sceneId: SceneId,
    topologyId: TopologyId,
    actionId: ActionId | null,
    nextSceneActivationId: SceneActivationId | null = sceneActivationId.value,
  ): boolean {
    if (activeTransitionId.value !== transitionId) return false

    appendActiveTransitionSummary('completed')
    stableContext.value = {
      sceneId,
      topologyId,
      actionId,
      contextRevision: (stableContext.value?.contextRevision ?? 0) + 1,
    }
    sceneActivationId.value = nextSceneActivationId
    activeTransitionId.value = null
    targetSceneId.value = null
    targetTopologyId.value = null
    targetActionId.value = null
    runtimeStatus.value = 'ready'
    unityStatus.value = 'ready'
    topologyStatus.value = 'ready'
    sceneLoadProgress.value = null
    activeTransitionStartedAt.value = null
    return true
  }

  /** 失败只影响当前匹配事务；旧事务失败回调不会覆盖已经进入的新稳定上下文。 */
  function failTransition(
    transitionId: TransitionId,
    diagnostic: VisualizationDiagnostic,
    outcome: Extract<VisualizationTransitionOutcome, 'failed' | 'recovered'> = 'failed',
    restoredSceneActivationId: SceneActivationId | undefined = undefined,
  ): boolean {
    if (activeTransitionId.value !== transitionId) return false

    appendActiveTransitionSummary(outcome, diagnostic.code)
    latestDiagnostic.value = { ...diagnostic }
    // 只有完成物理回退的恢复路径可替换旧实例标识；普通失败、同场景动作失败和迟到失败均不能伪造实例变化。
    if (outcome === 'recovered' && stableContext.value && restoredSceneActivationId) {
      sceneActivationId.value = restoredSceneActivationId
    }
    activeTransitionId.value = null
    targetSceneId.value = null
    targetTopologyId.value = null
    targetActionId.value = null
    runtimeStatus.value = stableContext.value ? 'ready' : 'error'
    sceneLoadProgress.value = null
    if (stableContext.value) {
      // 事务失败后继续展示上一个稳定场景与拓扑，因此两个子系统状态必须同步恢复为 ready。
      // 若保留 preparing/failed，会形成“稳定上下文可用但遮罩仍认为正在切换”的混合状态。
      unityStatus.value = 'ready'
      topologyStatus.value = 'ready'
    } else {
      unityStatus.value = 'failed'
      topologyStatus.value = 'failed'
    }
    activeTransitionStartedAt.value = null
    return true
  }

  /**
   * 仅在三维或画布的物理回退也失败时清空稳定上下文并进入明确错误态。
   * 此路径不能沿用 failTransition：后者会保留旧上下文，而物理运行时已无法证明仍与该上下文一致。
   */
  function failTransitionToError(transitionId: TransitionId, diagnostic: VisualizationDiagnostic): boolean {
    if (activeTransitionId.value !== transitionId) return false

    appendActiveTransitionSummary('recovery-failed', diagnostic.code)
    latestDiagnostic.value = { ...diagnostic }
    stableContext.value = null
    sceneActivationId.value = null
    activeTransitionId.value = null
    targetSceneId.value = null
    targetTopologyId.value = null
    targetActionId.value = null
    runtimeStatus.value = 'error'
    unityStatus.value = 'failed'
    topologyStatus.value = 'failed'
    sceneLoadProgress.value = null
    // 错误态没有可信活动拓扑，继续保留二维选择会让后续恢复流程误用过期节点与路径标识。
    selectedNodeIds.value = []
    selectedRouteIds.value = []
    selectedSceneNodeId.value = null
    selectionSource.value = 'system'
    activeTransitionStartedAt.value = null
    return true
  }

  /** 二维或三维选择统一写入有限标识数组；同一来源由协调器决定是否下发聚焦命令。 */
  function setSelection(
    nodeIds: readonly NodeId[],
    routeIds: readonly RouteId[],
    source: VisualizationSelectionSource,
    sceneNodeId: SceneNodeId | null = null,
  ): void {
    selectedNodeIds.value = [...nodeIds]
    selectedRouteIds.value = [...routeIds]
    selectedSceneNodeId.value = sceneNodeId
    selectionSource.value = source
  }

  /** 诊断替换为最后一次受控摘要，避免状态仓库积累无界错误历史或原始异常对象。 */
  function recordDiagnostic(diagnostic: VisualizationDiagnostic): void {
    latestDiagnostic.value = { ...diagnostic }
  }

  /**
   * 把当前活动事务投影为固定大小的终态摘要。调用点均在清空目标字段前，因而不需要复制任何外层原始对象。
   * 数组容量超过上限时仅淘汰最早一条；不会使用嵌套循环，也不会保存每帧进度。
   */
  function appendActiveTransitionSummary(
    outcome: VisualizationTransitionOutcome,
    diagnosticCode: string | null = null,
  ): void {
    if (
      !activeTransitionId.value
      || !targetSceneId.value
      || !targetTopologyId.value
    ) return

    const startedAt = activeTransitionStartedAt.value ?? Date.now()
    const summary: VisualizationTransitionSummary = {
      transitionId: activeTransitionId.value,
      sceneId: targetSceneId.value,
      topologyId: targetTopologyId.value,
      actionId: targetActionId.value,
      previousContextRevision: stableContext.value?.contextRevision ?? 0,
      outcome,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      diagnosticCode,
    }
    const nextSummaries = [...recentTransitionSummaries.value, summary]
    recentTransitionSummaries.value = nextSummaries.length > VISUALIZATION_TRANSITION_SUMMARY_CAPACITY
      ? nextSummaries.slice(-VISUALIZATION_TRANSITION_SUMMARY_CAPACITY)
      : nextSummaries
  }

  /** 子应用释放时清空全部可序列化上下文；已释放状态显式保留供外层桥拒绝后续命令。 */
  function release(): void {
    stableContext.value = null
    sceneActivationId.value = null
    activeTransitionId.value = null
    targetSceneId.value = null
    targetTopologyId.value = null
    targetActionId.value = null
    runtimeStatus.value = 'released'
    unityStatus.value = 'disposed'
    topologyStatus.value = 'disposed'
    sceneLoadProgress.value = null
    selectedNodeIds.value = []
    selectedRouteIds.value = []
    selectedSceneNodeId.value = null
    selectionSource.value = 'system'
    latestDiagnostic.value = null
    activeTransitionStartedAt.value = null
    recentTransitionSummaries.value = []
  }

  return {
    stableContext,
    sceneActivationId,
    activeTransitionId,
    targetSceneId,
    targetTopologyId,
    targetActionId,
    runtimeStatus,
    unityStatus,
    topologyStatus,
    sceneLoadProgress,
    selectedNodeIds,
    selectedRouteIds,
    selectedSceneNodeId,
    selectionSource,
    latestDiagnostic,
    recentTransitionSummaries,
    hasStableContext,
    contextRevision,
    beginTransition,
    setUnityStatus,
    setTopologyStatus,
    setSceneLoadProgress,
    commitStableContext,
    failTransition,
    failTransitionToError,
    setSelection,
    recordDiagnostic,
    release,
  }
})

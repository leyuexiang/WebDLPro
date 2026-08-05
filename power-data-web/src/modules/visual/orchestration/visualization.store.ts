import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ActionId, DeviceId, NodeId, RouteId, SceneId, SceneNodeId, TopologyId, TransitionId } from '@/config/scene-topology/identifiers'

/** 选择来源用于阻断二维单击、Unity 反向选择和外层事件之间的聚焦回环。 */
export type VisualizationSelectionSource = 'topology' | 'unity' | 'external' | 'system'

/** 当前子应用的有限运行阶段；窗口、Canvas、定时器和 Unity 对象均不属于状态仓库。 */
export type VisualizationRuntimeStatus = 'idle' | 'preparing' | 'switching' | 'ready' | 'error' | 'released'

/** 三维与拓扑分别记录就绪状态，协调器只在两者满足事务条件时提交稳定上下文。 */
export type VisualizationSubsystemStatus = 'idle' | 'preparing' | 'ready' | 'failed' | 'disposed'

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

/**
 * 可视化稳定上下文状态仓库。
 * 该仓库只保存领域标识、选择、版本、事务和有限状态；跨窗口对象、画布、命令表、资源句柄、
 * 监听器和计时器都必须由桥接、拓扑运行时和 Unity 宿主在各自生命周期中持有和释放。
 */
export const useVisualizationStore = defineStore('visualization', () => {
  const stableContext = ref<VisualizationStableContext | null>(null)
  const activeTransitionId = ref<TransitionId | null>(null)
  const targetSceneId = ref<SceneId | null>(null)
  const targetTopologyId = ref<TopologyId | null>(null)
  const targetActionId = ref<ActionId | null>(null)
  const runtimeStatus = ref<VisualizationRuntimeStatus>('idle')
  const unityStatus = ref<VisualizationSubsystemStatus>('idle')
  const topologyStatus = ref<VisualizationSubsystemStatus>('idle')
  const selectedNodeIds = ref<readonly NodeId[]>([])
  const selectedRouteIds = ref<readonly RouteId[]>([])
  const selectedDeviceId = ref<DeviceId | null>(null)
  const selectedSceneNodeId = ref<SceneNodeId | null>(null)
  const selectionSource = ref<VisualizationSelectionSource>('system')
  const latestDiagnostic = ref<VisualizationDiagnostic | null>(null)

  /** 稳定上下文存在才允许外层桥对外声明可用，切换中的目标字段永远不会提前暴露为当前视图。 */
  const hasStableContext = computed(() => stableContext.value !== null && runtimeStatus.value === 'ready')

  /** 当前上下文版本只从稳定上下文派生，未提交状态一律返回 0。 */
  const contextRevision = computed(() => stableContext.value?.contextRevision ?? 0)

  /**
   * 开始新的场景—拓扑事务。旧事务在协调器创建新 transitionId（切换事务标识）后失去提交权；
   * 此处不清空稳定上下文和选择，避免切换过程中出现无内容或“旧场景 + 新拓扑”的可操作混合视图。
   */
  function beginTransition(transitionId: TransitionId, sceneId: SceneId, topologyId: TopologyId, actionId: ActionId | null): void {
    activeTransitionId.value = transitionId
    targetSceneId.value = sceneId
    targetTopologyId.value = topologyId
    targetActionId.value = actionId
    runtimeStatus.value = stableContext.value?.sceneId === sceneId ? 'preparing' : 'switching'
    topologyStatus.value = 'preparing'
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
   * 仅当前事务可提交新的稳定上下文。提交时上下文版本严格递增一次，
   * 同时清空目标事务字段，防止旧回调在后续状态快照中被误识别为活动切换。
   */
  function commitStableContext(transitionId: TransitionId, sceneId: SceneId, topologyId: TopologyId, actionId: ActionId | null): boolean {
    if (activeTransitionId.value !== transitionId) return false

    stableContext.value = {
      sceneId,
      topologyId,
      actionId,
      contextRevision: (stableContext.value?.contextRevision ?? 0) + 1,
    }
    activeTransitionId.value = null
    targetSceneId.value = null
    targetTopologyId.value = null
    targetActionId.value = null
    runtimeStatus.value = 'ready'
    unityStatus.value = 'ready'
    topologyStatus.value = 'ready'
    return true
  }

  /** 失败只影响当前匹配事务；旧事务失败回调不会覆盖已经进入的新稳定上下文。 */
  function failTransition(transitionId: TransitionId, diagnostic: VisualizationDiagnostic): boolean {
    if (activeTransitionId.value !== transitionId) return false

    latestDiagnostic.value = { ...diagnostic }
    activeTransitionId.value = null
    targetSceneId.value = null
    targetTopologyId.value = null
    targetActionId.value = null
    runtimeStatus.value = stableContext.value ? 'ready' : 'error'
    if (stableContext.value) {
      // 事务失败后继续展示上一个稳定场景与拓扑，因此两个子系统状态必须同步恢复为 ready。
      // 若保留 preparing/failed，会形成“稳定上下文可用但遮罩仍认为正在切换”的混合状态。
      unityStatus.value = 'ready'
      topologyStatus.value = 'ready'
    } else {
      unityStatus.value = 'failed'
      topologyStatus.value = 'failed'
    }
    return true
  }

  /**
   * 仅在三维或画布的物理回退也失败时清空稳定上下文并进入明确错误态。
   * 此路径不能沿用 failTransition：后者会保留旧上下文，而物理运行时已无法证明仍与该上下文一致。
   */
  function failTransitionToError(transitionId: TransitionId, diagnostic: VisualizationDiagnostic): boolean {
    if (activeTransitionId.value !== transitionId) return false

    latestDiagnostic.value = { ...diagnostic }
    stableContext.value = null
    activeTransitionId.value = null
    targetSceneId.value = null
    targetTopologyId.value = null
    targetActionId.value = null
    runtimeStatus.value = 'error'
    unityStatus.value = 'failed'
    topologyStatus.value = 'failed'
    // 错误态没有可信活动拓扑，继续保留二维选择会让后续恢复流程误用过期节点与路径标识。
    selectedNodeIds.value = []
    selectedRouteIds.value = []
    selectedDeviceId.value = null
    selectedSceneNodeId.value = null
    selectionSource.value = 'system'
    return true
  }

  /** 二维或三维选择统一写入有限标识数组；同一来源由协调器决定是否下发聚焦命令。 */
  function setSelection(
    nodeIds: readonly NodeId[],
    routeIds: readonly RouteId[],
    source: VisualizationSelectionSource,
    deviceId: DeviceId | null = null,
    sceneNodeId: SceneNodeId | null = null,
  ): void {
    selectedNodeIds.value = [...nodeIds]
    selectedRouteIds.value = [...routeIds]
    selectedDeviceId.value = deviceId
    selectedSceneNodeId.value = sceneNodeId
    selectionSource.value = source
  }

  /** 诊断替换为最后一次受控摘要，避免状态仓库积累无界错误历史或原始异常对象。 */
  function recordDiagnostic(diagnostic: VisualizationDiagnostic): void {
    latestDiagnostic.value = { ...diagnostic }
  }

  /** 子应用释放时清空全部可序列化上下文；已释放状态显式保留供外层桥拒绝后续命令。 */
  function release(): void {
    stableContext.value = null
    activeTransitionId.value = null
    targetSceneId.value = null
    targetTopologyId.value = null
    targetActionId.value = null
    runtimeStatus.value = 'released'
    unityStatus.value = 'disposed'
    topologyStatus.value = 'disposed'
    selectedNodeIds.value = []
    selectedRouteIds.value = []
    selectedDeviceId.value = null
    selectedSceneNodeId.value = null
    selectionSource.value = 'system'
    latestDiagnostic.value = null
  }

  return {
    stableContext,
    activeTransitionId,
    targetSceneId,
    targetTopologyId,
    targetActionId,
    runtimeStatus,
    unityStatus,
    topologyStatus,
    selectedNodeIds,
    selectedRouteIds,
    selectedDeviceId,
    selectedSceneNodeId,
    selectionSource,
    latestDiagnostic,
    hasStableContext,
    contextRevision,
    beginTransition,
    setUnityStatus,
    setTopologyStatus,
    commitStableContext,
    failTransition,
    failTransitionToError,
    setSelection,
    recordDiagnostic,
    release,
  }
})

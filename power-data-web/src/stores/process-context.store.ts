import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  ProcessId,
  ProcessNodeId,
  ProcessPageId,
  ProcessStepId,
  RouteId,
} from '@/config/process/identifiers'
import type { ProcessConfigurationBundle, ProcessRuntimeMode } from '@/config/process/types'
import type { WebglCommandType } from '@/services/webgl/protocol'

/** 交互来源用于打断网页图形、二维拓扑和导览之间的回写循环。 */
export type ProcessSelectionSource = 'route' | 'guide' | 'topology' | 'webgl' | 'system'

/** 场景状态只描述连接生命周期；真实 iframe、窗口和画布对象绝不进入 Pinia 状态。 */
/**
 * 工艺页可序列化的场景状态镜像；它对应布局宿主的有限状态机，
 * 但不保存 iframe、Window、Canvas 或任何不可序列化的运行时资源。
 */
export type ProcessSceneStatus =
  | 'idle'
  | 'creating'
  | 'handshaking'
  | 'ready'
  | 'switching'
  | 'releasing'
  | 'degraded'
  | 'unavailable'
  | 'released'
  | 'failed'

/** 实时数据快照使用基础类型，便于序列化、诊断和未来持久化。 */
export interface ProcessMetricSnapshot {
  value: number | string | null
  updatedAt: string
  quality: 'good' | 'delayed' | 'unknown'
}

/** 最近一次协调命令用于用户态诊断，不持有通信对象或回调函数。 */
export interface ProcessCommandSnapshot {
  type: WebglCommandType | 'ui-selection'
  source: ProcessSelectionSource
  correlationId: string
  issuedAt: string
}

/**
 * 工艺上下文仓库。
 * 仅保存可序列化的页面、步骤、节点、拓扑、场景能力和数据快照；WebGL 实例、Canvas 上下文、
 * 定时器及事件监听器均由各自适配器在组件生命周期内管理，避免跨路由泄漏。
 */
export const useProcessContextStore = defineStore('process-context', () => {
  const processPageId = ref<ProcessPageId | null>(null)
  const processId = ref<ProcessId | null>(null)
  const currentStepId = ref<ProcessStepId | null>(null)
  const selectedNodeId = ref<ProcessNodeId | null>(null)
  const selectedTopologyNodeIds = ref<readonly ProcessNodeId[]>([])
  const selectedTopologyRouteIds = ref<readonly RouteId[]>([])
  const selectionSource = ref<ProcessSelectionSource>('system')
  const sceneStatus = ref<ProcessSceneStatus>('idle')
  const sceneCapabilities = ref<readonly WebglCommandType[]>([])
  const latestCommand = ref<ProcessCommandSnapshot | null>(null)
  const metricSnapshots = ref<Record<string, ProcessMetricSnapshot>>({})

  /** 只读派生值用于组件显示，避免每个组件重复判断当前页面是否已激活。 */
  const hasActivePage = computed(() => processPageId.value !== null)

  /**
   * 路由进入新工艺页时初始化纯数据上下文。
   * 非 WebGL 生效模式立即标记为降级，工作台不会等待或尝试创建未经登记的网页图形实例。
   */
  function activatePage(bundle: ProcessConfigurationBundle, effectiveRuntimeMode: ProcessRuntimeMode): void {
    const isSamePage = processPageId.value === bundle.page.processPageId

    processPageId.value = bundle.page.processPageId
    processId.value = bundle.page.processId
    currentStepId.value = bundle.page.defaultStepId ?? null
    selectedNodeId.value = null
    selectedTopologyNodeIds.value = []
    selectedTopologyRouteIds.value = []
    selectionSource.value = 'route'
    sceneCapabilities.value = effectiveRuntimeMode === 'webgl' && bundle.runtime ? [...bundle.runtime.capabilities] : []
    // 已通过配置校验的网页图形仍需等待宿主创建和握手；未登记运行时直接保持降级。
    sceneStatus.value = effectiveRuntimeMode === 'webgl' ? 'creating' : 'degraded'
    latestCommand.value = null

    // 同页重新渲染保留已到达的数据快照；换页时清空，避免设备指标串页显示。
    if (!isSamePage) {
      metricSnapshots.value = {}
    }
  }

  /** 统一更新步骤与相关拓扑高亮，不让各视图直接改写彼此状态。 */
  function selectStep(
    stepId: ProcessStepId,
    nodeIds: readonly ProcessNodeId[],
    routeIds: readonly RouteId[],
    source: ProcessSelectionSource,
  ): void {
    currentStepId.value = stepId
    selectedNodeId.value = nodeIds[0] ?? null
    selectedTopologyNodeIds.value = [...nodeIds]
    selectedTopologyRouteIds.value = [...routeIds]
    selectionSource.value = source
  }

  /** 统一记录节点点击；步骤是否联动由协调器依据配置决定。 */
  function selectNode(
    nodeId: ProcessNodeId,
    routeIds: readonly RouteId[],
    source: ProcessSelectionSource,
    matchedStepId?: ProcessStepId,
  ): void {
    selectedNodeId.value = nodeId
    selectedTopologyNodeIds.value = [nodeId]
    selectedTopologyRouteIds.value = [...routeIds]
    currentStepId.value = matchedStepId ?? currentStepId.value
    selectionSource.value = source
  }

  /** WebGL 连接器握手完成后写入已协商能力，不接受组件凭空声明场景可用。 */
  function setSceneState(status: ProcessSceneStatus, capabilities: readonly WebglCommandType[] = sceneCapabilities.value): void {
    sceneStatus.value = status
    sceneCapabilities.value = [...capabilities]
  }

  /** 只记录命令审计信息，实际 postMessage 仍由受控运行时连接器负责。 */
  function recordCommand(command: ProcessCommandSnapshot): void {
    latestCommand.value = command
  }

  /**
   * 替换当前页指标快照，并对数量设置上限。
   * 使用一次线性遍历构建新的普通对象，避免将响应式代理、Map 或无限缓存写入状态仓。
   */
  function replaceMetricSnapshots(nextSnapshots: Readonly<Record<string, ProcessMetricSnapshot>>): void {
    const nextState: Record<string, ProcessMetricSnapshot> = {}
    let acceptedCount = 0

    for (const [metricKey, snapshot] of Object.entries(nextSnapshots)) {
      if (acceptedCount >= 200) break
      nextState[metricKey] = { ...snapshot }
      acceptedCount += 1
    }

    metricSnapshots.value = nextState
  }

  /** 路由离开时释放所有页面上下文，确保下一页不会读取上一页的选择或能力快照。 */
  function release(): void {
    processPageId.value = null
    processId.value = null
    currentStepId.value = null
    selectedNodeId.value = null
    selectedTopologyNodeIds.value = []
    selectedTopologyRouteIds.value = []
    selectionSource.value = 'system'
    sceneStatus.value = 'released'
    sceneCapabilities.value = []
    latestCommand.value = null
    metricSnapshots.value = {}
  }

  return {
    processPageId,
    processId,
    currentStepId,
    selectedNodeId,
    selectedTopologyNodeIds,
    selectedTopologyRouteIds,
    selectionSource,
    sceneStatus,
    sceneCapabilities,
    latestCommand,
    metricSnapshots,
    hasActivePage,
    activatePage,
    selectStep,
    selectNode,
    setSceneState,
    recordCommand,
    replaceMetricSnapshots,
    release,
  }
})

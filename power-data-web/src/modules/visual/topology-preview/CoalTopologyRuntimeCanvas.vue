<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { LockState, Meta2d, type Meta2dData, type Pen } from '@meta2d/core'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition, TopologyDeviceStatus } from '@/config/process/types'
import type { CanvasTopologyViewState } from '@/services/topology/canvas-topology-adapter'
import type { TopologyCanvasController } from '@/modules/visual/components/topology-canvas-controller'
import { loadCoalTopologyPreviewData } from './coal-topology-preview-data'
import { getCoalTopologyTooltipContent, type CoalTopologyTooltipContent } from './coal-topology-tooltip'
import {
  COAL_TOPOLOGY_RUNTIME_BINDINGS,
  COAL_TOPOLOGY_STATUS_PRESENTATION,
  createCoalTopologyRuntimeBindingIndex,
} from './coal-topology-runtime-bindings'
import CoalTopologyLayerFilter from './CoalTopologyLayerFilter.vue'
import {
  applyCoalTopologyLayerVisibility,
  createCoalTopologyLayerBindingIndex,
  createCoalTopologyVisibilityRuleIndex,
  createDefaultCoalTopologyFilterSelection,
  toggleCoalTopologyFilter,
  type CoalTopologyFilterId,
} from './coal-topology-layer-filter'
import { readUsableTopologyViewportSize } from './topology-viewport-size'

const props = defineProps<{
  topology: TopologyDefinition
  selectedNodeIds: readonly ProcessNodeId[]
  selectedRouteIds: readonly RouteId[]
  nodeStatuses?: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>
}>()

const emit = defineEmits<{
  /** 单击只上报已登记的业务节点，三维聚焦由上层正式清单和协调器执行。 */
  selectNode: [nodeId: ProcessNodeId]
  /** 空白处单击只表达清空选择，不影响当前三维场景、流程或缩放位置。 */
  clearSelection: []
  /** 双击复用正式节点事件协议；画布本身不发送 Unity 消息或平台设备编号。 */
  doubleClickNode: [nodeId: ProcessNodeId]
}>()

interface Meta2dPointerEvent {
  readonly pen?: Pen
}

const STATUS_PEN_ID_PREFIX = 'coal-runtime-status-'
const STATUS_PEN_SIZE = 14
/** 模块加载时构建一次双向索引，状态、选择和鼠标命中路径均为常数时间查询。 */
const bindingIndex = createCoalTopologyRuntimeBindingIndex()
const canvasHost = ref<HTMLElement | null>(null)
const canvasRoot = ref<HTMLElement | null>(null)
const loadingState = ref<'loading' | 'ready' | 'error'>('loading')
const errorMessage = ref('')
/** 当前运行时只保存清单投影结果；不复制 JSON 图元，也不根据标题重建节点定义。 */
const runtimeTopology = shallowRef(props.topology)
/** 外部状态以只读快照替换，避免 Vue 深度代理 Map 并让一批更新只渲染一次。 */
const runtimeStatuses = shallowRef<ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>>(props.nodeStatuses ?? new Map())
const activeTooltipPen = shallowRef<Pen | null>(null)
const tooltipX = ref(16)
const tooltipY = ref(68)
const keyboardNodeId = ref<ProcessNodeId | null>(null)
const selectedFilterIds = ref<ReadonlySet<CoalTopologyFilterId>>(createDefaultCoalTopologyFilterSelection())
const layerBindingIndex = ref<ReadonlyMap<string, readonly CoalTopologyFilterId[]>>(new Map())
const visibilityRuleIndex = ref<ReturnType<typeof createCoalTopologyVisibilityRuleIndex>>(new Map())
/** 该索引只在正式拓扑切换时更新，悬浮、状态与键盘事件不会重复扫描节点数组。 */
const activeNodeById = computed(() => new Map(runtimeTopology.value.nodes.map((node) => [node.nodeId, node] as const)))
const activeTooltip = computed<CoalTopologyTooltipContent | null>(() => {
  const pen = activeTooltipPen.value
  if (!pen?.id) return null
  const nodeId = bindingIndex.nodeIdByPenId.get(pen.id)
  const content = getCoalTopologyTooltipContent(pen, nodeId && activeNodeById.value.has(nodeId)
    ? getEffectiveNodeStatus(nodeId)
    : 'offline')
  // 未登记到旧版正式清单的图片保持预览能力，但不能伪造业务节点或三维状态。
  return content ? { ...content, status: nodeId ? content.status : '未绑定' } : null
})
const tooltipStyle = computed(() => ({ left: `${tooltipX.value}px`, top: `${tooltipY.value}px` }))

let meta2d: Meta2d | undefined
let resizeObserver: ResizeObserver | undefined
let resizeFrame: number | undefined
let imageReadyFrame: number | undefined
let suspended = false
let pendingViewState: CanvasTopologyViewState | undefined
let disposed = false
const requestController = new AbortController()

/** 状态快照未覆盖时严格回退到正式拓扑基线；旧版燃煤清单全部为 offline（离线）。 */
function getEffectiveNodeStatus(nodeId: ProcessNodeId): TopologyDeviceStatus {
  return runtimeStatuses.value.get(nodeId) ?? activeNodeById.value.get(nodeId)?.deviceStatus ?? 'offline'
}

/**
 * 在已绑定设备旁追加一个不参与命中的状态点。
 * 原始 JSON 坐标、图层、连线和图片顺序均保持不变；状态点仅作为运行时附加图元，
 * 从而确保状态更新不需要重新请求、解析或打开整份 JSON。
 */
function appendRuntimeStatusPens(data: Meta2dData): void {
  const penById = new Map(data.pens.map((pen) => [pen.id, pen]))
  for (const binding of COAL_TOPOLOGY_RUNTIME_BINDINGS) {
    const sourcePen = penById.get(binding.penId)
    if (!sourcePen || typeof sourcePen.x !== 'number' || typeof sourcePen.y !== 'number'
      || typeof sourcePen.width !== 'number' || typeof sourcePen.height !== 'number') continue

    const presentation = COAL_TOPOLOGY_STATUS_PRESENTATION[getEffectiveNodeStatus(binding.nodeId)]
    data.pens.push({
      id: `${STATUS_PEN_ID_PREFIX}${binding.penId}`,
      name: 'circle',
      x: sourcePen.x + sourcePen.width * 0.58,
      y: sourcePen.y + Math.max(1, sourcePen.height * 0.04),
      width: STATUS_PEN_SIZE,
      height: STATUS_PEN_SIZE,
      background: presentation.color,
      color: '#ffffff',
      lineWidth: 2,
      // 运行时状态点永远不抢占设备、工艺矩形或背景的原始命中规则。
      locked: LockState.Disable,
    })
  }
}

/** 当前源图元不可见时，状态点必须同步隐藏，防止筛选后残留没有对应设备的状态提示。 */
function isBindingVisible(penId: string): boolean {
  // 先取得查询结果再访问首项，兼容画布尚未创建或图元已被释放的运行时状态。
  const pen = meta2d?.find(penId)?.[0]
  return pen?.visible !== false
}

/**
 * 一批状态更新只遍历已绑定图元并执行一次重绘；同一 nodeId 的多个图元同步更新。
 * nodeAvailable 防止当前清单未声明的图元冒充正式状态对象，isBindingVisible 保证图层
 * 筛选始终优先于状态点可见性。
 */
function applyRuntimeStatuses(): void {
  if (!meta2d || loadingState.value !== 'ready' || suspended || !readUsableTopologyViewportSize(canvasHost.value)) return

  for (const binding of COAL_TOPOLOGY_RUNTIME_BINDINGS) {
    const nodeAvailable = activeNodeById.value.has(binding.nodeId)
    const presentation = COAL_TOPOLOGY_STATUS_PRESENTATION[getEffectiveNodeStatus(binding.nodeId)]
    meta2d.setValue({
      id: binding.penId,
      filter: nodeAvailable ? presentation.filter : 'none',
    }, { render: false, doEvent: false, history: false })
    meta2d.setValue({
      id: `${STATUS_PEN_ID_PREFIX}${binding.penId}`,
      visible: nodeAvailable && isBindingVisible(binding.penId),
      background: presentation.color,
    }, { render: false, doEvent: false, history: false })
  }
  meta2d.render()
}

/** 图层筛选只更新当前图元显隐；状态、选择和 JSON 数据均不重建。 */
function applyLayerFilterSelection(): void {
  if (!meta2d || loadingState.value !== 'ready') return
  const pens = meta2d.store.data.pens
  const previousVisibilityByPenId = new Map(
    pens
      .filter((pen) => Boolean(pen.id))
      .map((pen) => [pen.id!, pen.visible]),
  )
  applyCoalTopologyLayerVisibility(pens, layerBindingIndex.value, selectedFilterIds.value, visibilityRuleIndex.value)
  // 使用 Meta2D 专用 setVisible（设置显隐）同步 calculative.visible（计算态显隐）和缓存；
  // 只处理实际变化的图元，避免筛选时重复刷新全部图元，并保证后续状态点读取到最新可见性。
  for (const pen of pens) {
    if (!pen.id || previousVisibilityByPenId.get(pen.id) === pen.visible) continue
    meta2d.setVisible(pen, pen.visible !== false, false)
  }
  activeTooltipPen.value = null
  // 图层筛选后需要复核状态点可见性，但状态颜色和源图片无需重新初始化。
  applyRuntimeStatuses()
}

function handleLayerFilterChange(filterId: CoalTopologyFilterId, checked: boolean): void {
  selectedFilterIds.value = toggleCoalTopologyFilter(selectedFilterIds.value, filterId, checked)
  applyLayerFilterSelection()
}

/** 程序化回写选择不触发 Meta2D 事件，避免 Unity 反向选中时再次发起三维聚焦。 */
function applyRuntimeSelection(nodeIds: readonly ProcessNodeId[]): void {
  if (!meta2d || loadingState.value !== 'ready' || suspended || !readUsableTopologyViewportSize(canvasHost.value)) return
  const activePens = nodeIds.flatMap((nodeId) => (
    bindingIndex.penIdsByNodeId.get(nodeId)?.flatMap((penId) => meta2d?.find(penId) ?? []) ?? []
  ))
  if (activePens.length > 0) meta2d.active(activePens, false)
  else meta2d.inactive()
}

/** 只有当前总览清单中登记的业务节点可进入二维—三维联动；未绑定图元保留只读展示。 */
function resolveActiveNodeId(pen: Pen | undefined): ProcessNodeId | undefined {
  const nodeId = pen?.id ? bindingIndex.nodeIdByPenId.get(pen.id) : undefined
  return nodeId && activeNodeById.value.has(nodeId) ? nodeId : undefined
}

function handleCanvasClick(event?: Meta2dPointerEvent): void {
  if (!event) return
  const nodeId = resolveActiveNodeId(event.pen)
  if (nodeId) {
    keyboardNodeId.value = nodeId
    emit('selectNode', nodeId)
    return
  }
  // 工艺矩形仍可本地只读选中，但它们没有正式 nodeId，禁止进入状态或三维链路。
  if (!event.pen) emit('clearSelection')
}

function handleCanvasDoubleClick(event?: Meta2dPointerEvent): void {
  const nodeId = resolveActiveNodeId(event?.pen)
  if (nodeId) emit('doubleClickNode', nodeId)
}

function handlePenEnter(pen?: Pen): void {
  activeTooltipPen.value = pen?.image ? pen : null
}

function handlePenLeave(pen?: Pen): void {
  if (!pen || activeTooltipPen.value?.id === pen.id) activeTooltipPen.value = null
}

/** 提示位置限制在画布安全区，避免移动到边缘时标题或状态被裁切。 */
function updateTooltipAnchor(event: MouseEvent): void {
  const root = canvasRoot.value
  if (!root || !activeTooltip.value) return
  const bounds = root.getBoundingClientRect()
  tooltipX.value = Math.min(Math.max(event.clientX - bounds.left, 12), Math.max(12, bounds.width - 24))
  tooltipY.value = Math.min(Math.max(event.clientY - bounds.top, 68), Math.max(68, bounds.height - 12))
}

/** 键盘仅浏览显式绑定节点，回车与鼠标单击复用同一选择事件。 */
function handleCanvasKeydown(event: KeyboardEvent): void {
  const nodeIds = Array.from(bindingIndex.penIdsByNodeId.keys()).filter((nodeId) => activeNodeById.value.has(nodeId))
  if (nodeIds.length === 0) return
  const currentIndex = Math.max(0, nodeIds.findIndex((nodeId) => nodeId === keyboardNodeId.value))
  if (event.key.startsWith('Arrow')) {
    event.preventDefault()
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
    keyboardNodeId.value = nodeIds[(currentIndex + direction + nodeIds.length) % nodeIds.length] ?? null
    if (keyboardNodeId.value) applyRuntimeSelection([keyboardNodeId.value])
    return
  }
  if ((event.key === 'Enter' || event.key === ' ') && keyboardNodeId.value) {
    event.preventDefault()
    emit('selectNode', keyboardNodeId.value)
  }
}

function fitTopologyToViewport(): void {
  if (!meta2d || loadingState.value !== 'ready' || suspended || !readUsableTopologyViewportSize(canvasHost.value)) return
  activeTooltipPen.value = null
  meta2d.fitView(true, [20, 24, 20, 24])
}

/**
 * 用户重置或画布重新显示时废弃旧视口快照，并按当前容器尺寸完整适配原始 JSON 图元。
 * 只调用 Meta2D（二维组态引擎）的视图接口，不重新请求数据、不重建图元和图片缓存。
 */
function resetView(): void {
  pendingViewState = undefined
  if (suspended) return
  // 返回第二层的显示提交可能早于浏览器布局一帧；零尺寸只等待观察器补发，不进入 Meta2D。
  if (!readUsableTopologyViewportSize(canvasHost.value)) {
    scheduleCanvasResize()
    return
  }
  fitTopologyToViewport()
}

/** 尺寸变更合并到一帧，避免全屏切换中连续触发 Meta2D 的多层画布重绘。 */
function scheduleCanvasResize(): void {
  if (suspended || !meta2d || !canvasHost.value) return
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined
    const host = canvasHost.value
    if (!host || !meta2d) return
    const viewport = readUsableTopologyViewportSize(host)
    // 0×0 仅表示容器仍隐藏，绝不能覆盖当前有效离屏画布尺寸。
    if (!viewport) return
    meta2d.resize(viewport.width, viewport.height)
    applyRuntimeStatuses()
    applyRuntimeSelection(props.selectedNodeIds)
    if (pendingViewState) restoreViewState(pendingViewState)
    else fitTopologyToViewport()
  })
}

/** 动图全部完成加载后仅执行一次适配；权威视图快照优先，不会被自动适配覆盖。 */
function fitAfterImagesReady(attempt = 0): void {
  const host = canvasHost.value
  if (!host || !meta2d || disposed || suspended || !readUsableTopologyViewportSize(host)) return
  const images = Array.from(host.querySelectorAll('img'))
  if ((images.length > 0 && images.every((image) => image.complete)) || attempt >= 360) {
    imageReadyFrame = undefined
    if (!pendingViewState) fitTopologyToViewport()
    return
  }
  imageReadyFrame = requestAnimationFrame(() => fitAfterImagesReady(attempt + 1))
}

function setTopology(topology: TopologyDefinition): void {
  runtimeTopology.value = topology
  if (suspended) return
  applyRuntimeStatuses()
  applyRuntimeSelection(props.selectedNodeIds)
}

function setSelection(nodeIds: readonly ProcessNodeId[], _routeIds: readonly RouteId[]): void {
  if (suspended) return
  applyRuntimeSelection(nodeIds)
}

function setNodeStatuses(statuses: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>): void {
  runtimeStatuses.value = statuses
  if (!suspended) applyRuntimeStatuses()
}

/** 暂停时保留 Meta2D（二维组态引擎）实例，只停止观察器、待执行帧和交互事件。 */
function setSuspended(nextSuspended: boolean): void {
  if (disposed || suspended === nextSuspended) return
  suspended = nextSuspended
  const host = canvasHost.value

  if (suspended) {
    resizeObserver?.disconnect()
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    if (imageReadyFrame !== undefined) cancelAnimationFrame(imageReadyFrame)
    resizeFrame = undefined
    imageReadyFrame = undefined
    meta2d?.off<Pen>('enter', handlePenEnter)
    meta2d?.off<Pen>('leave', handlePenLeave)
    meta2d?.off<Meta2dPointerEvent>('click', handleCanvasClick)
    meta2d?.off<Meta2dPointerEvent>('dblclick', handleCanvasDoubleClick)
    return
  }

  if (!host || !meta2d || !resizeObserver) return
  meta2d.on<Pen>('enter', handlePenEnter)
  meta2d.on<Pen>('leave', handlePenLeave)
  meta2d.on<Meta2dPointerEvent>('click', handleCanvasClick)
  meta2d.on<Meta2dPointerEvent>('dblclick', handleCanvasDoubleClick)
  resizeObserver.observe(host)
  scheduleCanvasResize()
  // 最新状态与选择由首个正尺寸刷新统一重放，避免恢复瞬间在零尺寸离屏画布上绘制。
}

function getViewState(): CanvasTopologyViewState | undefined {
  const data = meta2d?.store.data
  return data ? { zoom: data.scale, offsetX: data.x, offsetY: data.y } : pendingViewState
}

/** Meta2D 平移量依赖当前缩放倍率，因此先设置倍率再按倍率换算平移差。 */
function restoreViewState(state: CanvasTopologyViewState): void {
  pendingViewState = state
  const host = canvasHost.value
  const viewport = readUsableTopologyViewportSize(host)
  if (suspended || !meta2d || !viewport || loadingState.value !== 'ready') return
  meta2d.scale(state.zoom, { x: viewport.width / 2, y: viewport.height / 2 })
  const data = meta2d.store.data
  meta2d.translate((state.offsetX - data.x) / data.scale, (state.offsetY - data.y) / data.scale)
}

/** 主动释放和 Vue 卸载共用同一个幂等清理路径，避免保留动图、观察器或画布事件。 */
function dispose(): void {
  if (disposed) return
  disposed = true
  requestController.abort()
  resizeObserver?.disconnect()
  resizeObserver = undefined
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  if (imageReadyFrame !== undefined) cancelAnimationFrame(imageReadyFrame)
  meta2d?.off<Pen>('enter', handlePenEnter)
  meta2d?.off<Pen>('leave', handlePenLeave)
  meta2d?.off<Meta2dPointerEvent>('click', handleCanvasClick)
  meta2d?.off<Meta2dPointerEvent>('dblclick', handleCanvasDoubleClick)
  meta2d?.destroy()
  meta2d = undefined
}

const controller: TopologyCanvasController = Object.freeze({
  setTopology,
  setSelection,
  setNodeStatuses,
  getViewState,
  restoreViewState,
  resetView,
  setSuspended,
  dispose,
})
defineExpose<TopologyCanvasController>(controller)

watch(() => props.topology, setTopology)
watch(() => props.selectedNodeIds, (nodeIds) => applyRuntimeSelection(nodeIds))
watch(() => props.nodeStatuses, (statuses) => setNodeStatuses(statuses ?? new Map()))

onMounted(async () => {
  const host = canvasHost.value
  if (!host) return
  try {
    const data = await loadCoalTopologyPreviewData(requestController.signal)
    if (requestController.signal.aborted) return
    const sourceLayerBindingIndex = createCoalTopologyLayerBindingIndex(data.pens)
    appendRuntimeStatusPens(data)
    // 状态点继承原设备的图层标签，筛选时不会残留孤立状态点。
    const completeLayerBindingIndex = new Map(sourceLayerBindingIndex)
    for (const binding of COAL_TOPOLOGY_RUNTIME_BINDINGS) {
      const tags = sourceLayerBindingIndex.get(binding.penId)
      if (tags) completeLayerBindingIndex.set(`${STATUS_PEN_ID_PREFIX}${binding.penId}`, tags)
    }
    layerBindingIndex.value = completeLayerBindingIndex
    visibilityRuleIndex.value = createCoalTopologyVisibilityRuleIndex(data.pens, layerBindingIndex.value)
    applyCoalTopologyLayerVisibility(data.pens, layerBindingIndex.value, selectedFilterIds.value, visibilityRuleIndex.value)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    if (!readUsableTopologyViewportSize(host)) throw new Error('新版燃煤拓扑画布可用尺寸为零。')

    meta2d = new Meta2d(host, {
      minScale: 0.1,
      maxScale: 4,
      grid: false,
      rule: false,
      disableInput: true,
      disableClipboard: true,
    })
    meta2d.open(data)
    meta2d.on<Pen>('enter', handlePenEnter)
    meta2d.on<Pen>('leave', handlePenLeave)
    meta2d.on<Meta2dPointerEvent>('click', handleCanvasClick)
    meta2d.on<Meta2dPointerEvent>('dblclick', handleCanvasDoubleClick)
    meta2d.lock(LockState.DisableEdit)
    loadingState.value = 'ready'
    applyRuntimeStatuses()
    applyRuntimeSelection(props.selectedNodeIds)
    resizeObserver = new ResizeObserver(scheduleCanvasResize)
    resizeObserver.observe(host)
    if (pendingViewState) restoreViewState(pendingViewState)
    else requestAnimationFrame(fitTopologyToViewport)
    fitAfterImagesReady()
  } catch (error) {
    if (requestController.signal.aborted) return
    loadingState.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : '新版燃煤拓扑加载失败。'
  }
})

onBeforeUnmount(dispose)
</script>

<template>
  <div
    ref="canvasRoot"
    class="topology-canvas coal-topology-runtime-canvas"
    tabindex="0"
    aria-label="新版燃煤拓扑画布，方向键浏览已绑定设备，回车选择"
    @keydown="handleCanvasKeydown"
    @mouseleave="activeTooltipPen = null"
    @mousemove.passive="updateTooltipAnchor"
  >
    <CoalTopologyLayerFilter
      :selected-filter-ids="selectedFilterIds"
      @change="handleLayerFilterChange"
    />
    <div ref="canvasHost" class="coal-topology-runtime-canvas__host" />
    <div v-if="activeTooltip" class="coal-topology-runtime-canvas__tooltip" :style="tooltipStyle" role="tooltip">
      <strong>{{ activeTooltip.title }}</strong>
      <span>状态：{{ activeTooltip.status }}</span>
    </div>
    <p v-if="loadingState !== 'ready'" class="coal-topology-runtime-canvas__state" role="status">
      {{ loadingState === 'error' ? errorMessage : '正在加载新版燃煤拓扑…' }}
    </p>
  </div>
</template>

<style scoped>
.coal-topology-runtime-canvas {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-inline-size: 0;
  min-block-size: 0;
  overflow: hidden;
  border: 1px solid rgba(103, 232, 249, 0.28);
  border-radius: 6px;
  background: #1e2430;
  outline: none;
}

.coal-topology-runtime-canvas:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(103, 232, 249, 0.72);
}

.coal-topology-runtime-canvas__host {
  inline-size: 100%;
  block-size: 100%;
  overflow: hidden;
  background: #1e2430;
}

.coal-topology-runtime-canvas__tooltip {
  position: absolute;
  z-index: 25;
  display: grid;
  max-inline-size: min(260px, calc(100% - 24px));
  gap: 3px;
  padding: 7px 9px;
  border: 1px solid rgba(103, 232, 249, 0.72);
  border-radius: 6px;
  color: #e2f7ff;
  font: 500 11px/1.35 "Microsoft YaHei", sans-serif;
  background: rgba(3, 17, 29, 0.96);
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.42);
  pointer-events: none;
  transform: translate(10px, calc(-100% - 10px));
}

.coal-topology-runtime-canvas__tooltip strong {
  font-size: 12px;
}

.coal-topology-runtime-canvas__tooltip span {
  color: #9dd8e5;
}

.coal-topology-runtime-canvas__state {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  padding: 20px;
  background: rgba(3, 17, 29, 0.94);
  color: #b7d9e8;
  text-align: center;
}
</style>

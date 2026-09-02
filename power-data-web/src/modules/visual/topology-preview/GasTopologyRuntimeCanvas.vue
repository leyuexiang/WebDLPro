<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { LockState, Meta2d, type Pen } from '@meta2d/core'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition, TopologyDeviceStatus } from '@/config/process/types'
import type { CanvasTopologyViewState } from '@/services/topology/canvas-topology-adapter'
import type { TopologyCanvasController } from '@/modules/visual/components/topology-canvas-controller'
import { getGasTopologyStatusIconUrl, loadGasTopologyPreviewData } from './gas-topology-preview-data'
import { getGasTopologyTooltipContent, type GasTopologyTooltipContent } from './gas-topology-tooltip'
import {
  createGasTopologyRuntimeBindingIndex,
  GAS_TOPOLOGY_RUNTIME_BINDINGS,
} from './gas-topology-runtime-bindings'
import GasTopologyLayerFilter from './GasTopologyLayerFilter.vue'
import {
  applyGasTopologyLayerVisibility,
  createDefaultGasTopologyFilterSelection,
  createGasTopologyLayerBindingIndex,
  createGasTopologyVisibilityRuleIndex,
  toggleGasTopologyFilter,
  type GasTopologyFilterId,
} from './gas-topology-layer-filter'
import {
  createGasTopologyConnectedLineIndex,
  GAS_TOPOLOGY_SELECTION_COLOR,
  GAS_TOPOLOGY_SELECTION_LINE_WIDTH,
  resolveGasTopologyConnectedLineIds,
} from './gas-topology-connection-highlight'
import { readUsableTopologyViewportSize } from './topology-viewport-size'

const props = defineProps<{
  topology: TopologyDefinition
  selectedNodeIds: readonly ProcessNodeId[]
  selectedRouteIds: readonly RouteId[]
  nodeStatuses?: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>
}>()

const emit = defineEmits<{
  selectNode: [nodeId: ProcessNodeId]
  clearSelection: []
  doubleClickNode: [nodeId: ProcessNodeId]
}>()

interface Meta2dPointerEvent {
  readonly pen?: Pen
}

interface SourceLinePresentation {
  readonly color: string
  readonly lineWidth: number
}

const bindingIndex = createGasTopologyRuntimeBindingIndex()
const canvasHost = ref<HTMLElement | null>(null)
const canvasRoot = ref<HTMLElement | null>(null)
const loadingState = ref<'loading' | 'ready' | 'error'>('loading')
const errorMessage = ref('')
const runtimeTopology = shallowRef(props.topology)
const runtimeStatuses = shallowRef<ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>>(props.nodeStatuses ?? new Map())
const activeTooltipPen = shallowRef<Pen | null>(null)
const tooltipX = ref(16)
const tooltipY = ref(68)
const keyboardNodeId = ref<ProcessNodeId | null>(null)
/** 正式嵌入画布与独立预览共用同一层级状态模型，筛选不进入外层状态协议。 */
const selectedFilterIds = ref<ReadonlySet<GasTopologyFilterId>>(createDefaultGasTopologyFilterSelection())
const layerBindingIndex = ref<ReadonlyMap<string, readonly GasTopologyFilterId[]>>(new Map())
const visibilityRuleIndex = ref<ReturnType<typeof createGasTopologyVisibilityRuleIndex>>(new Map())
/** 连接索引在打开新版 JSON 时只构建一次，运行时选择不重复扫描全部图元。 */
const connectedLineIndex = ref<ReturnType<typeof createGasTopologyConnectedLineIndex>>(new Map())
const activeNodeById = computed(() => new Map(runtimeTopology.value.nodes.map((node) => [node.nodeId, node])))
const activeTooltip = computed<GasTopologyTooltipContent | null>(() => {
  const pen = activeTooltipPen.value
  if (!pen?.id) return null
  const nodeId = bindingIndex.nodeIdByPenId.get(pen.id)
  if (!nodeId || !activeNodeById.value.has(nodeId)) {
    const content = getGasTopologyTooltipContent(pen)
    return content ? { ...content, status: '未绑定' } : null
  }
  return getGasTopologyTooltipContent(pen, getEffectiveNodeStatus(nodeId)) ?? null
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
const sourceLinePresentationById = new Map<string, SourceLinePresentation>()
/** 记录每个图片图元最后提交的状态，只更新状态差异项，避免重复解码同一批动态图。 */
const appliedStatusByPenId = new Map<string, TopologyDeviceStatus>()
let highlightedLineIds: ReadonlySet<string> = new Set()

/** 状态快照未覆盖的节点回退到正式清单基线，保持原运行时“缺失即离线”的完整快照语义。 */
function getEffectiveNodeStatus(nodeId: ProcessNodeId): TopologyDeviceStatus {
  return runtimeStatuses.value.get(nodeId) ?? activeNodeById.value.get(nodeId)?.deviceStatus ?? 'offline'
}

/**
 * 将状态直接投影为设备自身的四态动态图，不再创建圆点或其他叠加图元。
 * 同一业务节点可绑定多个视觉图元；循环只遍历固定绑定表，并利用状态缓存跳过未变化项，最后统一重绘一次。
 */
function applyRuntimeStatuses(render = true): void {
  if (!meta2d || loadingState.value !== 'ready' || suspended || !readUsableTopologyViewportSize(canvasHost.value)) return

  for (const binding of GAS_TOPOLOGY_RUNTIME_BINDINGS) {
    const nodeAvailable = activeNodeById.value.has(binding.nodeId)
    // 未进入当前正式拓扑的登记图元保持正常预览态，不能继承上一套拓扑的历史状态。
    const status = nodeAvailable ? getEffectiveNodeStatus(binding.nodeId) : 'normal'
    if (appliedStatusByPenId.get(binding.penId) === status) continue
    const image = getGasTopologyStatusIconUrl(binding.penId, status)
    if (!image) continue
    meta2d.setValue({
      id: binding.penId,
      image,
    }, { render: false, doEvent: false, history: false })
    appliedStatusByPenId.set(binding.penId, status)
  }
  if (render) meta2d.render()
}

/** 将筛选结果投影到当前唯一画布；状态已经由来源图片表达，无需维护额外叠加图元。 */
function applyLayerFilterSelection(): void {
  if (!meta2d || loadingState.value !== 'ready') return
  const pens = meta2d.store.data.pens
  const previousVisibilityByPenId = new Map(
    pens
      .filter((pen) => Boolean(pen.id))
      .map((pen) => [pen.id!, pen.visible]),
  )
  applyGasTopologyLayerVisibility(pens, layerBindingIndex.value, selectedFilterIds.value, visibilityRuleIndex.value)
  // 只同步实际改变的图元并在循环外统一重绘。setVisible 会同步内部可见性、缓存和命中状态，
  // 不能用通用 setValue 直接覆盖 visible，否则隐藏设备仍可能被悬浮或被状态点读取为可见。
  for (const pen of pens) {
    if (!pen.id || previousVisibilityByPenId.get(pen.id) === pen.visible) continue
    meta2d.setVisible(pen, pen.visible !== false, false)
  }
  activeTooltipPen.value = null
  // 状态图片与来源图元共用同一个显隐字段，筛选后只需由选择高亮统一提交一次 render（重绘）。
  applyRuntimeSelection(props.selectedNodeIds)
}

/** 筛选栏只提交编号和勾选状态，主开关规则集中在这里，避免组件自行修改画布数据。 */
function handleLayerFilterChange(filterId: GasTopologyFilterId, checked: boolean): void {
  selectedFilterIds.value = toggleGasTopologyFilter(selectedFilterIds.value, filterId, checked)
  applyLayerFilterSelection()
}

/**
 * 同步图元选中框和直接关联连线的亮蓝高亮。
 * 只更新前后高亮集合的差集；取消选择时精确恢复源颜色与线宽，隐藏连线不会被重新显示。
 */
function applySelectionVisual(pens: readonly Pen[], render = true): void {
  if (!meta2d || loadingState.value !== 'ready' || suspended || !readUsableTopologyViewportSize(canvasHost.value)) return
  const activePens = pens.filter((pen) => pen.id && pen.visible !== false)
  const selectedPenIds = activePens.flatMap((pen) => pen.id ? [pen.id] : [])
  const requestedLineIds = resolveGasTopologyConnectedLineIds(selectedPenIds, connectedLineIndex.value)
  const nextHighlightedLineIds = new Set(
    [...requestedLineIds].filter((lineId) => meta2d?.find(lineId)?.[0]?.visible !== false),
  )
  const changedLineIds = new Set([...highlightedLineIds, ...nextHighlightedLineIds])

  for (const lineId of changedLineIds) {
    const source = sourceLinePresentationById.get(lineId)
    if (!source) continue
    const highlighted = nextHighlightedLineIds.has(lineId)
    meta2d.setValue({
      id: lineId,
      color: highlighted ? GAS_TOPOLOGY_SELECTION_COLOR : source.color,
      lineWidth: highlighted ? Math.max(source.lineWidth, GAS_TOPOLOGY_SELECTION_LINE_WIDTH) : source.lineWidth,
    }, { render: false, doEvent: false, history: false })
  }

  highlightedLineIds = nextHighlightedLineIds
  if (activePens.length > 0) meta2d.active(activePens, false)
  else meta2d.inactive()
  if (render) meta2d.render()
}

/** 程序化选择不触发组态事件，防止三维反向选择再次回发三维聚焦命令。 */
function applyRuntimeSelection(nodeIds: readonly ProcessNodeId[], render = true): void {
  if (!meta2d || loadingState.value !== 'ready' || suspended || !readUsableTopologyViewportSize(canvasHost.value)) return
  const activePens = nodeIds.flatMap((nodeId) => (
    bindingIndex.penIdsByNodeId.get(nodeId)?.flatMap((penId) => meta2d?.find(penId) ?? []) ?? []
  ))
  applySelectionVisual(activePens, render)
}

/** 只将已登记且属于当前活动拓扑的图片图元转换为正式节点选择。 */
function resolveActiveNodeId(pen: Pen | undefined): ProcessNodeId | undefined {
  const nodeId = pen?.id ? bindingIndex.nodeIdByPenId.get(pen.id) : undefined
  return nodeId && activeNodeById.value.has(nodeId) ? nodeId : undefined
}

function handleCanvasClick(event?: Meta2dPointerEvent): void {
  if (!event) return
  const nodeId = resolveActiveNodeId(event.pen)
  if (nodeId) {
    keyboardNodeId.value = nodeId
    // 先在当前帧显示选中效果；外层随后回传正式选择快照时会复用同一幂等路径。
    if (event.pen) applySelectionVisual([event.pen])
    emit('selectNode', nodeId)
    return
  }
  // 底部工艺矩形和未绑定图片保留本地选中与连线高亮，但不会伪装成设备节点进入三维链路。
  if (event.pen) applySelectionVisual([event.pen])
  else {
    applySelectionVisual([])
    emit('clearSelection')
  }
}

function handleCanvasDoubleClick(event?: Meta2dPointerEvent): void {
  if (!event) return
  const nodeId = resolveActiveNodeId(event.pen)
  if (nodeId) emit('doubleClickNode', nodeId)
}

function handlePenEnter(pen?: Pen): void {
  activeTooltipPen.value = pen?.image ? pen : null
}

function handlePenLeave(pen?: Pen): void {
  if (!pen || activeTooltipPen.value?.id === pen.id) activeTooltipPen.value = null
}

/** 提示锚点限制在画布安全区，样式与原拓扑共用同一标题加状态结构。 */
function updateTooltipAnchor(event: MouseEvent): void {
  const root = canvasRoot.value
  if (!root || !activeTooltip.value) return
  const bounds = root.getBoundingClientRect()
  tooltipX.value = Math.min(Math.max(event.clientX - bounds.left, 12), Math.max(12, bounds.width - 24))
  tooltipY.value = Math.min(Math.max(event.clientY - bounds.top, 68), Math.max(68, bounds.height - 12))
}

/** 键盘方向键只在已绑定且当前可见的正式节点间循环，回车与鼠标单击使用同一业务入口。 */
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
  // 恢复事务可能早于浏览器布局一帧；无有效尺寸时只登记一次尺寸刷新，不直接触发 Meta2D 重绘。
  if (!readUsableTopologyViewportSize(canvasHost.value)) {
    scheduleCanvasResize()
    return
  }
  fitTopologyToViewport()
}

/** 容器尺寸更新合并到下一动画帧，避免全屏切换期间连续重建多层画布。 */
function scheduleCanvasResize(): void {
  if (suspended || !meta2d || !canvasHost.value) return
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined
    const host = canvasHost.value
    if (!host || !meta2d) return
    const viewport = readUsableTopologyViewportSize(host)
    // 隐藏容器的 0×0 通知不是可提交尺寸；保持当前离屏画布，等待观察器在重新显示后补发正尺寸。
    if (!viewport) return
    meta2d.resize(viewport.width, viewport.height)
    // 暂停期间只保留最新快照；尺寸有效后才集中重放，避免每个父级补发命令各触发一次无效绘制。
    applyRuntimeStatuses(false)
    applyRuntimeSelection(props.selectedNodeIds)
    if (pendingViewState) restoreViewState(pendingViewState)
    else fitTopologyToViewport()
  })
}

/** 动态图片加载完成后再适配一次；已经收到运行时视图恢复时不得覆盖该权威快照。 */
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
  applyRuntimeStatuses(false)
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
  // 状态和选择由首个正尺寸刷新统一重放，不能在宿主仍为 0×0 时提前调用 Meta2D.render。
}

function getViewState(): CanvasTopologyViewState | undefined {
  const data = meta2d?.store.data
  return data ? { zoom: data.scale, offsetX: data.x, offsetY: data.y } : pendingViewState
}

/** Meta2D 的平移参数按当前倍率解释，因此以目标像素差除以倍率后再恢复。 */
function restoreViewState(state: CanvasTopologyViewState): void {
  pendingViewState = state
  const host = canvasHost.value
  const viewport = readUsableTopologyViewportSize(host)
  if (suspended || !meta2d || !viewport || loadingState.value !== 'ready') return
  meta2d.scale(state.zoom, { x: viewport.width / 2, y: viewport.height / 2 })
  const data = meta2d.store.data
  meta2d.translate((state.offsetX - data.x) / data.scale, (state.offsetY - data.y) / data.scale)
}

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
    const data = await loadGasTopologyPreviewData(requestController.signal)
    if (requestController.signal.aborted) return
    const sourceLayerBindingIndex = createGasTopologyLayerBindingIndex(data.pens)
    connectedLineIndex.value = createGasTopologyConnectedLineIndex(data.pens)
    const defaultLineColor = data.color ?? '#bdc7db'
    for (const pen of data.pens) {
      if (pen.name === 'line' && pen.id) {
        sourceLinePresentationById.set(pen.id, {
          color: pen.color ?? defaultLineColor,
          lineWidth: pen.lineWidth ?? 1,
        })
      }
    }
    layerBindingIndex.value = sourceLayerBindingIndex
    visibilityRuleIndex.value = createGasTopologyVisibilityRuleIndex(data.pens, layerBindingIndex.value)
    applyGasTopologyLayerVisibility(data.pens, layerBindingIndex.value, selectedFilterIds.value, visibilityRuleIndex.value)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    if (!readUsableTopologyViewportSize(host)) throw new Error('新版燃气拓扑画布可用尺寸为零。')

    meta2d = new Meta2d(host, {
      minScale: 0.1,
      maxScale: 4,
      grid: false,
      rule: false,
      activeColor: GAS_TOPOLOGY_SELECTION_COLOR,
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
    applyRuntimeStatuses(false)
    applyRuntimeSelection(props.selectedNodeIds)
    resizeObserver = new ResizeObserver(scheduleCanvasResize)
    resizeObserver.observe(host)
    if (pendingViewState) restoreViewState(pendingViewState)
    else requestAnimationFrame(fitTopologyToViewport)
    fitAfterImagesReady()
  } catch (error) {
    if (requestController.signal.aborted) return
    loadingState.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : '新版燃气拓扑加载失败。'
  }
})

onBeforeUnmount(dispose)
</script>

<template>
  <div
    ref="canvasRoot"
    class="topology-canvas gas-topology-runtime-canvas"
    tabindex="0"
    aria-label="新版燃气拓扑画布，方向键浏览已绑定设备，回车选择"
    @keydown="handleCanvasKeydown"
    @mouseleave="activeTooltipPen = null"
    @mousemove.passive="updateTooltipAnchor"
  >
    <GasTopologyLayerFilter
      :selected-filter-ids="selectedFilterIds"
      @change="handleLayerFilterChange"
    />
    <div ref="canvasHost" class="gas-topology-runtime-canvas__host" />
    <div v-if="activeTooltip" class="gas-topology-runtime-canvas__tooltip" :style="tooltipStyle" role="tooltip">
      <strong>{{ activeTooltip.title }}</strong>
      <span>状态：{{ activeTooltip.status }}</span>
    </div>
    <p v-if="loadingState !== 'ready'" class="gas-topology-runtime-canvas__state" role="status">
      {{ loadingState === 'error' ? errorMessage : '正在加载新版燃气拓扑…' }}
    </p>
  </div>
</template>

<style scoped>
.gas-topology-runtime-canvas {
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

.gas-topology-runtime-canvas:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(103, 232, 249, 0.72);
}

.gas-topology-runtime-canvas__host {
  inline-size: 100%;
  block-size: 100%;
  overflow: hidden;
  background: #1e2430;
}

.gas-topology-runtime-canvas__tooltip {
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

.gas-topology-runtime-canvas__tooltip strong {
  font-size: 12px;
}

.gas-topology-runtime-canvas__tooltip span {
  color: #9dd8e5;
}

.gas-topology-runtime-canvas__state {
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

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { LockState, Meta2d, type Meta2dData, type Pen } from '@meta2d/core'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition, TopologyDeviceStatus } from '@/config/process/types'
import type { CanvasTopologyViewState } from '@/services/topology/canvas-topology-adapter'
import type { TopologyCanvasController } from '@/modules/visual/components/topology-canvas-controller'
import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'
import { getCoalTopologyStatusIconUrl, loadCoalTopologyPreviewData } from './coal-topology-preview-data'
import { getCoalTopologyTooltipContent, type CoalTopologyTooltipContent } from './coal-topology-tooltip'
import {
  createCoalTopologyRuntimeBindingIndex,
  getCoalTopologyRuntimeBindings,
  type CoalTopologyRuntimeBinding,
} from './coal-topology-runtime-bindings'
import { projectCoalTopologyStatusesBeforeOpen } from './coal-topology-runtime-state'
import CoalTopologyLayerFilter from './CoalTopologyLayerFilter.vue'
import TopologyFullscreenButton from './TopologyFullscreenButton.vue'
import {
  createDefaultCoalTopologyFilterSelection,
  formatCoalTopologyFilterSelection,
  resolveCoalTopologyVariant,
  toggleCoalTopologyFilter,
  type CoalTopologyFilterId,
} from './coal-topology-layer-filter'
import {
  COAL_PROCESS_DETAIL_VARIANTS,
  COAL_TOPOLOGY_VARIANT_BY_ID,
  type CoalTopologyVariantId,
  type CoalTopologyVariantManifestEntry,
  type CoalProcessDetailVariantManifestEntry,
} from './coal-topology-variant-manifest'
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

interface Meta2dPointerEvent { readonly pen?: Pen }
interface SourceLinePresentation { readonly color: string; readonly lineWidth: number }

const canvasHost = ref<HTMLElement | null>(null)
const canvasRoot = ref<HTMLElement | null>(null)
const loadingState = ref<'loading' | 'ready' | 'error'>('loading')
const errorMessage = ref('')
const layerNotice = ref('')
const runtimeTopology = shallowRef(props.topology)
/** 中央状态快照独立于当前显示文件，切换到任何含绑定设备的层级时都会重放最新值。 */
const runtimeStatuses = shallowRef<ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>>(props.nodeStatuses ?? new Map())
const activeTooltipPen = shallowRef<Pen | null>(null)
const tooltipX = ref(16)
const tooltipY = ref(68)
const keyboardNodeId = ref<ProcessNodeId | null>(null)
const selectedFilterIds = ref<ReadonlySet<CoalTopologyFilterId>>(createDefaultCoalTopologyFilterSelection())
const currentVariantId = ref<CoalTopologyVariantId>('network-business-key-process')
/**
 * 第三层关键环节由业务上下文唯一指定整份拓扑数据，不存在层级组合选择。
 * 单独保存上下文状态可在异步 JSON 加载开始前立即隐藏筛选轨，避免短暂显示第二层控件。
 */
const processDetailContextActive = ref(false)
const currentBindings = shallowRef<readonly CoalTopologyRuntimeBinding[]>(getCoalTopologyRuntimeBindings(currentVariantId.value))
const bindingIndex = shallowRef(createCoalTopologyRuntimeBindingIndex(currentVariantId.value))
const connectedLineIndex = shallowRef<ReturnType<typeof createGasTopologyConnectedLineIndex>>(new Map())
const activeNodeById = computed(() => new Map(runtimeTopology.value.nodes.map((node) => [node.nodeId, node])))
const activeTooltip = computed<CoalTopologyTooltipContent | null>(() => {
  const pen = activeTooltipPen.value
  if (!pen?.id) return null
  const nodeId = bindingIndex.value.nodeIdByPenId.get(pen.id)
  if (!nodeId || !activeNodeById.value.has(nodeId)) {
    const content = getCoalTopologyTooltipContent(pen)
    return content ? { ...content, status: '未绑定' } : null
  }
  return getCoalTopologyTooltipContent(pen, getEffectiveNodeStatus(nodeId)) ?? null
})
const tooltipStyle = computed(() => ({ left: `${tooltipX.value}px`, top: `${tooltipY.value}px` }))

let meta2d: Meta2d | undefined
let resizeObserver: ResizeObserver | undefined
let resizeFrame: number | undefined
let imageReadyFrame: number | undefined
let topologyRequestController: AbortController | undefined
let loadRevision = 0
let suspended = false
let pendingViewState: CanvasTopologyViewState | undefined
let disposed = false
/** 返回第二层时恢复进入第三层前的筛选文件。 */
let lastBusinessVariantId: CoalTopologyVariantId = 'network-business-key-process'
const sourceLinePresentationById = new Map<string, SourceLinePresentation>()
/** 只缓存当前文件中确实完成更新的图元，切层时整体清空，避免不存在图元造成状态漏放。 */
const appliedStatusByPenId = new Map<string, TopologyDeviceStatus>()
let highlightedLineIds: ReadonlySet<string> = new Set()

/**
 * 状态快照未覆盖的节点回退到正式清单基线；理论上清单已统一为正常。
 * 最后的正常兜底仅处理异步切层中暂未建立节点索引的瞬间，不会修改或拦截外部状态快照。
 */
function getEffectiveNodeStatus(nodeId: ProcessNodeId): TopologyDeviceStatus {
  return runtimeStatuses.value.get(nodeId) ?? activeNodeById.value.get(nodeId)?.deviceStatus ?? 'normal'
}

/** 实时状态只遍历当前文件的显式绑定，批量写入后最多统一重绘一次。 */
function applyRuntimeStatuses(render = true): void {
  if (!meta2d || loadingState.value !== 'ready' || suspended || !readUsableTopologyViewportSize(canvasHost.value)) return
  let changed = false
  for (const binding of currentBindings.value) {
    const pen = meta2d.find(binding.penId)?.[0]
    if (!pen) continue
    const status = activeNodeById.value.has(binding.nodeId) ? getEffectiveNodeStatus(binding.nodeId) : 'normal'
    if (appliedStatusByPenId.get(binding.penId) === status) continue
    const image = getCoalTopologyStatusIconUrl(currentVariantId.value, binding.penId, status)
    if (!image) continue
    meta2d.setValue({ id: binding.penId, image }, { render: false, doEvent: false, history: false })
    appliedStatusByPenId.set(binding.penId, status)
    changed = true
  }
  if (render && changed) meta2d.render()
}

/** 同步图元选中框和直接关联连线；只更新前后高亮集合的差集并精确恢复源样式。 */
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

/** 程序化选择只读取当前文件索引，不回发三维聚焦事件。 */
function applyRuntimeSelection(nodeIds: readonly ProcessNodeId[], render = true): void {
  if (!meta2d || loadingState.value !== 'ready' || suspended || !readUsableTopologyViewportSize(canvasHost.value)) return
  const activePens = nodeIds.flatMap((nodeId) => (
    bindingIndex.value.penIdsByNodeId.get(nodeId)?.flatMap((penId) => meta2d?.find(penId) ?? []) ?? []
  ))
  applySelectionVisual(activePens, render)
}

/** 切层后重建所有文件级索引；公共画布实例和事件监听保持不变。 */
function commitTopologyVariant(
  data: Meta2dData,
  variant: CoalTopologyVariantManifestEntry | CoalProcessDetailVariantManifestEntry,
  bindings: readonly CoalTopologyRuntimeBinding[],
  projectedStatuses: ReadonlyMap<string, TopologyDeviceStatus>,
  revision: number,
): void {
  if (!meta2d || disposed || revision !== loadRevision) return
  activeTooltipPen.value = null
  keyboardNodeId.value = null
  highlightedLineIds = new Set()
  sourceLinePresentationById.clear()
  pendingViewState = undefined
  if (imageReadyFrame !== undefined) cancelAnimationFrame(imageReadyFrame)
  imageReadyFrame = undefined

  currentVariantId.value = variant.id
  currentBindings.value = bindings
  bindingIndex.value = createCoalTopologyRuntimeBindingIndex(variant.id)
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

  appliedStatusByPenId.clear()
  for (const [penId, status] of projectedStatuses) appliedStatusByPenId.set(penId, status)
  meta2d.open(data)
  meta2d.lock(LockState.DisableEdit)
  loadingState.value = 'ready'
  errorMessage.value = ''
  layerNotice.value = ''
  applyRuntimeSelection(props.selectedNodeIds)
  requestAnimationFrame(() => {
    if (revision === loadRevision) fitTopologyToViewport()
  })
  fitAfterImagesReady(revision)
}

/**
 * 使用递增加载序号和请求中止处理快速勾选；迟到响应不能覆盖最后一次选择。
 * 已有画布在加载失败时保持原数据，仅首次加载失败才显示阻塞错误层。
 */
async function switchTopologyVariant(
  variant: CoalTopologyVariantManifestEntry | CoalProcessDetailVariantManifestEntry,
): Promise<void> {
  if (variant.id === currentVariantId.value && loadingState.value === 'ready') {
    layerNotice.value = ''
    return
  }
  const revision = ++loadRevision
  topologyRequestController?.abort()
  const controller = new AbortController()
  topologyRequestController = controller
  if (variant.id !== 'process-detail-steam-turbine' && variant.id !== 'process-detail-boiler') lastBusinessVariantId = variant.id
  const hasCurrentCanvas = loadingState.value === 'ready'
  if (hasCurrentCanvas) {
    layerNotice.value = 'isProcessDetail' in variant
      ? '正在加载当前关键环节拓扑…'
      : `正在切换到${formatCoalTopologyFilterSelection(selectedFilterIds.value)}…`
  }
  else loadingState.value = 'loading'

  try {
    const data = await loadCoalTopologyPreviewData(variant.id, controller.signal)
    if (disposed || revision !== loadRevision || controller.signal.aborted) return
    const bindings = getCoalTopologyRuntimeBindings(variant.id)
    // 必须在打开前读取此刻的中央快照；加载期间到达的新状态同样会进入目标首帧。
    const projectedStatuses = projectCoalTopologyStatusesBeforeOpen(
      data,
      variant.id,
      bindings,
      (nodeId) => activeNodeById.value.has(nodeId),
      getEffectiveNodeStatus,
    )
    commitTopologyVariant(data, variant, bindings, projectedStatuses, revision)
  } catch (error) {
    if (disposed || revision !== loadRevision || controller.signal.aborted) return
    const message = error instanceof Error ? error.message : '燃煤拓扑加载失败。'
    if (hasCurrentCanvas) layerNotice.value = message
    else {
      loadingState.value = 'error'
      errorMessage.value = message
    }
  }
}

/**
 * 第三层上下文只加载汽轮机独立 JSON；清除上下文后恢复进入前的业务文件。
 * 过程中始终复用当前 Meta2D 实例和公共图片缓存。
 */
function setTopologyDataContext(context: TopologyDataContext | undefined): void {
  if (disposed) return
  if (!context) {
    // 先恢复筛选轨，再异步恢复进入第三层前的完整业务拓扑，界面状态与当前层级同步。
    processDetailContextActive.value = false
    if (currentVariantId.value === 'process-detail-steam-turbine' || currentVariantId.value === 'process-detail-boiler') {
      const variant = COAL_TOPOLOGY_VARIANT_BY_ID.get(lastBusinessVariantId)
      if (variant && !('isProcessDetail' in variant)) void switchTopologyVariant(variant)
    }
    return
  }
  if (context.renderer !== 'coal-v2') return
  const variant = context.contextId === 'process-detail.coal-power.boiler'
    ? COAL_PROCESS_DETAIL_VARIANTS.find((item) => item.id === 'process-detail-boiler')
    : context.contextId === 'process-detail.coal-power.steam-turbine'
      ? COAL_PROCESS_DETAIL_VARIANTS.find((item) => item.id === 'process-detail-steam-turbine')
      : undefined
  if (variant) {
    // 第三层入口一旦确认有效便立即关闭筛选；拓扑内容只由该关键环节的独立文件决定。
    processDetailContextActive.value = true
    void switchTopologyVariant(variant)
  }
}

/** 第二层更新复选状态后只做组合清单查找；第三层残留事件必须直接忽略。 */
function handleLayerFilterChange(filterId: CoalTopologyFilterId, checked: boolean): void {
  // 防止筛选组件卸载前已排队的事件改变第三层唯一拓扑上下文。
  if (processDetailContextActive.value) return
  const nextSelection = toggleCoalTopologyFilter(selectedFilterIds.value, filterId, checked)
  selectedFilterIds.value = nextSelection
  const variant = resolveCoalTopologyVariant(nextSelection)
  if (!variant) {
    ++loadRevision
    topologyRequestController?.abort()
    const selectionLabel = formatCoalTopologyFilterSelection(nextSelection)
    const missingMessage = nextSelection.size === 0
      ? '请至少选择一个有输入文件的层级。当前拓扑保持不变。'
      : `${selectionLabel}暂无独立输入文件，当前拓扑保持不变。`
    // 首次数据尚未提交时没有“当前拓扑”可保留，改为明确空态，避免中止首个请求后永久停在加载文案。
    if (loadingState.value === 'ready') layerNotice.value = missingMessage
    else {
      loadingState.value = 'error'
      errorMessage.value = missingMessage
    }
    return
  }
  void switchTopologyVariant(variant)
}

function resolveActiveNodeId(pen: Pen | undefined): ProcessNodeId | undefined {
  const nodeId = pen?.id ? bindingIndex.value.nodeIdByPenId.get(pen.id) : undefined
  return nodeId && activeNodeById.value.has(nodeId) ? nodeId : undefined
}

function handleCanvasClick(event?: Meta2dPointerEvent): void {
  if (!event) return
  const nodeId = resolveActiveNodeId(event.pen)
  if (nodeId) {
    keyboardNodeId.value = nodeId
    if (event.pen) applySelectionVisual([event.pen])
    emit('selectNode', nodeId)
    return
  }
  if (event.pen) applySelectionVisual([event.pen])
  else {
    applySelectionVisual([])
    emit('clearSelection')
  }
}

function handleCanvasDoubleClick(event?: Meta2dPointerEvent): void {
  const nodeId = resolveActiveNodeId(event?.pen)
  if (nodeId) emit('doubleClickNode', nodeId)
}

function handlePenEnter(pen?: Pen): void { activeTooltipPen.value = pen?.image ? pen : null }
function handlePenLeave(pen?: Pen): void {
  if (!pen || activeTooltipPen.value?.id === pen.id) activeTooltipPen.value = null
}

/** 提示锚点限制在画布安全区。 */
function updateTooltipAnchor(event: MouseEvent): void {
  const root = canvasRoot.value
  if (!root || !activeTooltip.value) return
  const bounds = root.getBoundingClientRect()
  tooltipX.value = Math.min(Math.max(event.clientX - bounds.left, 12), Math.max(12, bounds.width - 24))
  tooltipY.value = Math.min(Math.max(event.clientY - bounds.top, 68), Math.max(68, bounds.height - 12))
}

/** 键盘只在当前文件已绑定且正式拓扑存在的节点间循环。 */
function handleCanvasKeydown(event: KeyboardEvent): void {
  const nodeIds = Array.from(bindingIndex.value.penIdsByNodeId.keys()).filter((nodeId) => activeNodeById.value.has(nodeId))
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

/** 公共重置只恢复当前文件视图，不改变层级、中央状态或业务选择。 */
function resetView(): void {
  pendingViewState = undefined
  if (!suspended && readUsableTopologyViewportSize(canvasHost.value)) fitTopologyToViewport()
  else scheduleCanvasResize()
}

/** 容器尺寸变化合并到下一动画帧，避免全屏切换期间连续重绘。 */
function scheduleCanvasResize(): void {
  if (suspended || !meta2d || !canvasHost.value) return
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined
    const host = canvasHost.value
    const viewport = readUsableTopologyViewportSize(host)
    if (!host || !meta2d || !viewport) return
    meta2d.resize(viewport.width, viewport.height)
    applyRuntimeStatuses(false)
    applyRuntimeSelection(props.selectedNodeIds)
    if (pendingViewState) restoreViewState(pendingViewState)
    else fitTopologyToViewport()
  })
}

/** 图片完成后仅为对应加载序号补做适配，旧文件的动画帧不能影响新文件。 */
function fitAfterImagesReady(revision: number, attempt = 0): void {
  const host = canvasHost.value
  if (!host || !meta2d || disposed || suspended || revision !== loadRevision || !readUsableTopologyViewportSize(host)) return
  const images = Array.from(host.querySelectorAll('img'))
  if ((images.length > 0 && images.every((image) => image.complete)) || attempt >= 360) {
    imageReadyFrame = undefined
    if (!pendingViewState) fitTopologyToViewport()
    return
  }
  imageReadyFrame = requestAnimationFrame(() => fitAfterImagesReady(revision, attempt + 1))
}

function setTopology(topology: TopologyDefinition): void {
  runtimeTopology.value = topology
  if (!suspended) {
    applyRuntimeStatuses(false)
    applyRuntimeSelection(props.selectedNodeIds)
  }
}

function setSelection(nodeIds: readonly ProcessNodeId[], _routeIds: readonly RouteId[]): void {
  if (!suspended) applyRuntimeSelection(nodeIds)
}

function setNodeStatuses(statuses: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>): void {
  runtimeStatuses.value = statuses
  if (!suspended) applyRuntimeStatuses()
}

/** 暂停时保留同一画布实例，只移除观察器、待执行帧和交互监听。 */
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
}

function getViewState(): CanvasTopologyViewState | undefined {
  const data = meta2d?.store.data
  return data ? { zoom: data.scale, offsetX: data.x, offsetY: data.y } : pendingViewState
}

/** 二维组态引擎的平移参数按当前倍率解释，因此用目标像素差除以倍率恢复。 */
function restoreViewState(state: CanvasTopologyViewState): void {
  pendingViewState = state
  const viewport = readUsableTopologyViewportSize(canvasHost.value)
  if (suspended || !meta2d || !viewport || loadingState.value !== 'ready') return
  meta2d.scale(state.zoom, { x: viewport.width / 2, y: viewport.height / 2 })
  const data = meta2d.store.data
  meta2d.translate((state.offsetX - data.x) / data.scale, (state.offsetY - data.y) / data.scale)
}

function dispose(): void {
  if (disposed) return
  disposed = true
  ++loadRevision
  topologyRequestController?.abort()
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
  setTopology, setTopologyDataContext, setSelection, setNodeStatuses, getViewState, restoreViewState, resetView, setSuspended, dispose,
})
defineExpose<TopologyCanvasController>(controller)

watch(() => props.topology, setTopology)
watch(() => props.selectedNodeIds, (nodeIds) => applyRuntimeSelection(nodeIds))
watch(() => props.nodeStatuses, (statuses) => setNodeStatuses(statuses ?? new Map()))

onMounted(async () => {
  const host = canvasHost.value
  if (!host) return
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  if (!readUsableTopologyViewportSize(host)) {
    loadingState.value = 'error'
    errorMessage.value = '燃煤拓扑画布可用尺寸为零。'
    return
  }
  meta2d = new Meta2d(host, {
    minScale: 0.1,
    maxScale: 4,
    grid: false,
    rule: false,
    activeColor: GAS_TOPOLOGY_SELECTION_COLOR,
    disableInput: true,
    disableClipboard: true,
  })
  // 公共画布的监听与尺寸观察器只注册一次；后续层级切换仅调用 open（打开）替换完整数据。
  meta2d.on<Pen>('enter', handlePenEnter)
  meta2d.on<Pen>('leave', handlePenLeave)
  meta2d.on<Meta2dPointerEvent>('click', handleCanvasClick)
  meta2d.on<Meta2dPointerEvent>('dblclick', handleCanvasDoubleClick)
  resizeObserver = new ResizeObserver(scheduleCanvasResize)
  resizeObserver.observe(host)
  const initialVariant = resolveCoalTopologyVariant(selectedFilterIds.value)
  if (initialVariant) await switchTopologyVariant(initialVariant)
})

onBeforeUnmount(dispose)
</script>

<template>
  <div
    ref="canvasRoot"
    class="topology-canvas coal-topology-runtime-canvas"
    tabindex="0"
    aria-label="燃煤拓扑画布，方向键浏览已绑定设备，回车选择"
    @keydown="handleCanvasKeydown"
    @mouseleave="activeTooltipPen = null"
    @mousemove.passive="updateTooltipAnchor"
  >
    <CoalTopologyLayerFilter
      v-if="!processDetailContextActive"
      :selected-filter-ids="selectedFilterIds"
      @change="handleLayerFilterChange"
    />
    <TopologyFullscreenButton :target="canvasRoot" :disabled="loadingState !== 'ready'" />
    <div ref="canvasHost" class="coal-topology-runtime-canvas__host" />
    <div v-if="activeTooltip" class="coal-topology-runtime-canvas__tooltip" :style="tooltipStyle" role="tooltip">
      <strong>{{ activeTooltip.title }}</strong>
      <span>状态：{{ activeTooltip.status }}</span>
    </div>
    <p v-if="layerNotice && loadingState === 'ready'" class="coal-topology-runtime-canvas__notice" role="status">
      {{ layerNotice }}
    </p>
    <p v-if="loadingState !== 'ready'" class="coal-topology-runtime-canvas__state" role="status">
      {{ loadingState === 'error' ? errorMessage : '正在加载燃煤拓扑…' }}
    </p>
  </div>
</template>

<style scoped>
.coal-topology-runtime-canvas {
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-inline-size: 0;
  min-block-size: 0;
  overflow: hidden;
  border: 1px solid rgba(103, 232, 249, 0.28);
  border-radius: 6px;
  background: #1e2430;
  outline: none;
}

.coal-topology-runtime-canvas:focus-visible { box-shadow: inset 0 0 0 2px rgba(103, 232, 249, 0.72); }
.coal-topology-runtime-canvas:fullscreen { border: 0; border-radius: 0; }
.coal-topology-runtime-canvas__host { inline-size: 100%; block-size: 100%; overflow: hidden; background: #1e2430; }

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

.coal-topology-runtime-canvas__tooltip strong { font-size: 12px; }
.coal-topology-runtime-canvas__tooltip span { color: #9dd8e5; }

.coal-topology-runtime-canvas__notice {
  position: absolute;
  inset-block-start: 12px;
  inset-inline-start: 50%;
  z-index: 24;
  max-inline-size: min(560px, calc(100% - 120px));
  margin: 0;
  padding: 7px 12px;
  border: 1px solid rgba(250, 204, 21, 0.58);
  border-radius: 6px;
  color: #fef3c7;
  background: rgba(69, 48, 7, 0.92);
  font-size: 12px;
  text-align: center;
  pointer-events: none;
  transform: translateX(-50%);
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

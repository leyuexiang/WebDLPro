<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { LockState, Meta2d, type Meta2dData, type Pen } from '@meta2d/core'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition, TopologyDeviceStatus } from '@/config/process/types'
import type { CanvasTopologyViewState } from '@/services/topology/canvas-topology-adapter'
import type { TopologyCanvasController } from '@/modules/visual/components/topology-canvas-controller'
import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'
import { getSolarTopologyStatusIconUrl, loadSolarTopologyPreviewData } from './solar-topology-preview-data'
import { getSolarTopologyTooltipContent, type SolarTopologyTooltipContent } from './solar-topology-tooltip'
import SolarTopologyLayerFilter from './SolarTopologyLayerFilter.vue'
import TopologyFullscreenButton from './TopologyFullscreenButton.vue'
import {
  createDefaultSolarTopologyFilterSelection,
  formatSolarTopologyFilterSelection,
  resolveSolarTopologyVariant,
  toggleSolarTopologyFilter,
  type SolarTopologyFilterId,
} from './solar-topology-layer-filter'
import {
  SOLAR_PROCESS_DETAIL_VARIANTS,
  SOLAR_TOPOLOGY_VARIANT_BY_ID,
  type SolarProcessDetailVariantManifestEntry,
  type SolarTopologyVariantId,
  type SolarTopologyVariantManifestEntry,
} from './solar-topology-variant-manifest'
import {
  createSolarTopologyRuntimeBindingIndex,
  getSolarTopologyRuntimeBindings,
  type SolarTopologyRuntimeBinding,
} from './solar-topology-runtime-bindings'
import { projectSolarTopologyStatusesBeforeOpen } from './solar-topology-runtime-state'
import {
  createGasTopologyConnectedLineIndex,
  GAS_TOPOLOGY_SELECTION_COLOR,
  GAS_TOPOLOGY_SELECTION_LINE_WIDTH,
  resolveGasTopologyConnectedLineIds,
} from './gas-topology-connection-highlight'

interface Meta2dPointerEvent { readonly pen?: Pen }
interface SourceLinePresentation { readonly color: string; readonly lineWidth: number }

/** 正式嵌入时由公共面板提供全屏祖先和暂停信号；独立预览仍使用自身画布容器。 */
const props = defineProps<{
  fullscreenTarget?: HTMLElement | null
  suspended?: boolean
  topology?: TopologyDefinition
  selectedNodeIds?: readonly ProcessNodeId[]
  selectedRouteIds?: readonly RouteId[]
  nodeStatuses?: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>
}>()

const emit = defineEmits<{
  selectNode: [nodeId: ProcessNodeId]
  clearSelection: []
  doubleClickNode: [nodeId: ProcessNodeId]
}>()

const canvasHost = ref<HTMLElement | null>(null)
const canvasStage = ref<HTMLElement | null>(null)
const loadingState = ref<'loading' | 'ready' | 'error'>('loading')
const errorMessage = ref('')
const layerNotice = ref('')
const zoomPercent = ref(100)
const activeTooltipPen = shallowRef<Pen | null>(null)
const tooltipX = ref(16)
const tooltipY = ref(68)
const selectedFilterIds = ref<ReadonlySet<SolarTopologyFilterId>>(createDefaultSolarTopologyFilterSelection())
const currentVariantId = ref<SolarTopologyVariantId>('network-business-key-process')
/** 第三层入口确认后立即隐藏筛选轨，避免异步换源期间用户继续修改第二层组合。 */
const processDetailContextActive = ref(false)
/** 状态与正式拓扑节点都保存在中央快照中，切换 JSON 文件只重建文件级索引。 */
const runtimeTopology = shallowRef<TopologyDefinition | undefined>(props.topology)
const runtimeStatuses = shallowRef<ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>>(props.nodeStatuses ?? new Map())
const currentBindings = shallowRef<readonly SolarTopologyRuntimeBinding[]>(getSolarTopologyRuntimeBindings(currentVariantId.value))
const bindingIndex = shallowRef(createSolarTopologyRuntimeBindingIndex(currentVariantId.value))
const connectedLineIndex = ref<ReturnType<typeof createGasTopologyConnectedLineIndex>>(new Map())
const activeNodeById = computed(() => new Map((runtimeTopology.value?.nodes ?? []).map((node) => [node.nodeId, node])))
const activeTooltip = computed<SolarTopologyTooltipContent | null>(() => {
  const pen = activeTooltipPen.value
  if (!pen?.id) return null
  const nodeId = bindingIndex.value.nodeIdByPenId.get(pen.id)
  return getSolarTopologyTooltipContent(pen, nodeId ? getEffectiveNodeStatus(nodeId) : undefined) ?? null
})
const statusText = computed(() => loadingState.value === 'loading'
  ? '正在加载拓扑图…'
  : loadingState.value === 'error'
    ? errorMessage.value
    : `正在展示：${formatSolarTopologyFilterSelection(selectedFilterIds.value)}`)
const tooltipStyle = computed(() => ({ left: `${tooltipX.value}px`, top: `${tooltipY.value}px` }))

let meta2d: Meta2d | undefined
let resizeObserver: ResizeObserver | undefined
let resizeFrame: number | undefined
let imageReadyFrame: number | undefined
let topologyRequestController: AbortController | undefined
let loadRevision = 0
let disposed = false
let pendingViewState: CanvasTopologyViewState | undefined
/** 返回第二层时恢复用户进入关键环节前实际查看的完整文件，不强制跳回默认组合。 */
let lastBusinessVariantId: SolarTopologyVariantId = 'network-business-key-process'
const sourceLinePresentationById = new Map<string, SourceLinePresentation>()
const appliedStatusByPenId = new Map<string, TopologyDeviceStatus>()
let highlightedLineIds: ReadonlySet<string> = new Set()

function getEffectiveNodeStatus(nodeId: ProcessNodeId): TopologyDeviceStatus {
  return runtimeStatuses.value.get(nodeId) ?? activeNodeById.value.get(nodeId)?.deviceStatus ?? 'normal'
}

/** 增量状态更新只遍历当前文件的显式绑定，并把多次图元写入合并为一次重绘。 */
function applyRuntimeStatuses(render = true): void {
  if (!meta2d || loadingState.value !== 'ready' || props.suspended) return
  let changed = false
  for (const binding of currentBindings.value) {
    const status = getEffectiveNodeStatus(binding.nodeId)
    if (appliedStatusByPenId.get(binding.penId) === status) continue
    const image = getSolarTopologyStatusIconUrl(currentVariantId.value, binding.penId, status)
    if (!image || !meta2d.find(binding.penId)?.[0]) continue
    meta2d.setValue({ id: binding.penId, image }, { render: false, doEvent: false, history: false })
    appliedStatusByPenId.set(binding.penId, status)
    changed = true
  }
  if (render && changed) meta2d.render()
}

/** 工具栏倍率始终读取画布内部状态，不保存第二套缩放来源。 */
function syncZoomPercent(): void {
  zoomPercent.value = Math.round((meta2d?.store.data.scale ?? 1) * 100)
}

/** 按当前完整文件边界等比适配，不改写图元坐标、文字或连线路径。 */
function fitTopologyToViewport(): void {
  // 重置只作用于当前有效视口，不加载文件、不清空图层筛选或业务选择。
  if (!meta2d || disposed || props.suspended || loadingState.value !== 'ready') return
  if (!canvasHost.value?.clientWidth || !canvasHost.value?.clientHeight) return
  clearTopologyTooltip()
  meta2d.fitView(true, [28, 36, 28, 36])
  syncZoomPercent()
}

function changeZoom(multiplier: number): void {
  if (!meta2d || loadingState.value !== 'ready') return
  clearTopologyTooltip()
  const currentScale = meta2d.store.data.scale || 1
  const host = canvasHost.value
  meta2d.scale(Math.min(4, Math.max(0.1, currentScale * multiplier)), {
    x: (host?.clientWidth ?? 0) / 2,
    y: (host?.clientHeight ?? 0) / 2,
  })
  syncZoomPercent()
}

function updateTooltipAnchor(event: MouseEvent): void {
  const stage = canvasStage.value
  if (!stage || !activeTooltip.value) return
  const bounds = stage.getBoundingClientRect()
  tooltipX.value = Math.min(Math.max(event.clientX - bounds.left, 12), Math.max(12, bounds.width - 24))
  tooltipY.value = Math.min(Math.max(event.clientY - bounds.top, 68), Math.max(68, bounds.height - 12))
}

function handleTooltipPenEnter(pen?: Pen): void {
  activeTooltipPen.value = pen?.image ? pen : null
}

function handleTooltipPenLeave(pen?: Pen): void {
  if (!pen || activeTooltipPen.value?.id === pen.id) clearTopologyTooltip()
}

function clearTopologyTooltip(): void { activeTooltipPen.value = null }

/** 选中只更新当前文件的直接关联线，取消时按提交阶段缓存的源样式精确恢复。 */
function applySelectionVisual(pens: readonly Pen[], render = true): void {
  if (!meta2d || loadingState.value !== 'ready') return
  const activePens = pens.filter((pen) => pen.id && pen.visible !== false)
  const selectedPenIds = activePens.flatMap((pen) => pen.id ? [pen.id] : [])
  const requestedLineIds = resolveGasTopologyConnectedLineIds(selectedPenIds, connectedLineIndex.value)
  const nextHighlightedLineIds = new Set(
    [...requestedLineIds].filter((lineId) => meta2d?.find(lineId)?.[0]?.visible !== false),
  )
  for (const lineId of new Set([...highlightedLineIds, ...nextHighlightedLineIds])) {
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

/** 三维反向选择按 nodeId 常数时间取得当前文件全部镜像图元，不回发正向事件。 */
function applyRuntimeSelection(nodeIds: readonly ProcessNodeId[], render = true): void {
  if (!meta2d || loadingState.value !== 'ready' || props.suspended) return
  const pens = nodeIds.flatMap((nodeId) => (
    bindingIndex.value.penIdsByNodeId.get(nodeId)?.flatMap((penId) => meta2d?.find(penId) ?? []) ?? []
  ))
  applySelectionVisual(pens, render)
}

function resolveActiveNodeId(pen: Pen | undefined): ProcessNodeId | undefined {
  const nodeId = pen?.id ? bindingIndex.value.nodeIdByPenId.get(pen.id) : undefined
  // 光伏正式拓扑由独立 JSON 文件承载，中央本地拓扑可能只有空壳；显式绑定本身就是可交互资格。
  return nodeId
}

function handleCanvasClick(event?: Meta2dPointerEvent): void {
  if (!event) return
  const nodeId = resolveActiveNodeId(event.pen)
  if (nodeId) {
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

/** 双击只发出稳定业务 nodeId，外层运行时继续负责平台事件与三维聚焦事务。 */
function handleCanvasDoubleClick(event?: Meta2dPointerEvent): void {
  const nodeId = resolveActiveNodeId(event?.pen)
  if (nodeId) emit('doubleClickNode', nodeId)
}

/** 切换文件时清空旧文件局部状态并重建索引，二维组态引擎实例和监听器保持共用。 */
function commitTopologyVariant(
  data: Meta2dData,
  variant: SolarTopologyVariantManifestEntry | SolarProcessDetailVariantManifestEntry,
  projectedStatuses: ReadonlyMap<string, TopologyDeviceStatus>,
  revision: number,
): void {
  if (!meta2d || disposed || revision !== loadRevision) return
  clearTopologyTooltip()
  highlightedLineIds = new Set()
  sourceLinePresentationById.clear()
  if (imageReadyFrame !== undefined) cancelAnimationFrame(imageReadyFrame)
  imageReadyFrame = undefined
  currentVariantId.value = variant.id
  currentBindings.value = getSolarTopologyRuntimeBindings(variant.id)
  bindingIndex.value = createSolarTopologyRuntimeBindingIndex(variant.id)
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
  applyRuntimeStatuses(false)
  applyRuntimeSelection(props.selectedNodeIds ?? [], false)
  requestAnimationFrame(() => {
    if (revision === loadRevision) fitTopologyToViewport()
  })
  fitAfterImagesReady(revision)
}

/** 递增加载序号配合请求中止，保证快速勾选时只有最后选择可以提交。 */
async function switchTopologyVariant(
  variant: SolarTopologyVariantManifestEntry | SolarProcessDetailVariantManifestEntry,
): Promise<void> {
  if (variant.id === currentVariantId.value && loadingState.value === 'ready') {
    layerNotice.value = ''
    return
  }
  const revision = ++loadRevision
  topologyRequestController?.abort()
  const controller = new AbortController()
  topologyRequestController = controller
  if (variant.id !== 'process-detail-solar-inverter') lastBusinessVariantId = variant.id
  const hasCurrentCanvas = loadingState.value === 'ready'
  if (hasCurrentCanvas) {
    layerNotice.value = 'isProcessDetail' in variant
      ? '正在加载当前关键环节拓扑…'
      : `正在切换到${formatSolarTopologyFilterSelection(selectedFilterIds.value)}…`
  }
  else loadingState.value = 'loading'
  try {
    const data = await loadSolarTopologyPreviewData(variant.id, controller.signal)
    if (disposed || revision !== loadRevision || controller.signal.aborted) return
    const bindings = getSolarTopologyRuntimeBindings(variant.id)
    // 在 open（打开）前投影最新状态，避免切层首帧闪回正常态。
    const projectedStatuses = projectSolarTopologyStatusesBeforeOpen(
      data,
      variant.id,
      bindings,
      // 两个绑定节点已通过发布清单核验；即使本地兼容拓扑为空，也必须接收其真实状态。
      () => true,
      getEffectiveNodeStatus,
    )
    commitTopologyVariant(data, variant, projectedStatuses, revision)
  } catch (error) {
    if (disposed || revision !== loadRevision || controller.signal.aborted) return
    const message = error instanceof Error ? error.message : '光伏拓扑加载失败。'
    if (hasCurrentCanvas) layerNotice.value = message
    else {
      loadingState.value = 'error'
      errorMessage.value = message
    }
  }
}

/**
 * 第三层上下文只接受正式登记的光伏逆变器编号；清除上下文后恢复进入前的第二层完整文件。
 * 整个过程只替换同一二维组态引擎的数据源，不新建画布、监听器、观察器或图片缓存。
 */
function setTopologyDataContext(context: TopologyDataContext | undefined): void {
  if (disposed) return
  if (!context) {
    processDetailContextActive.value = false
    if (currentVariantId.value === 'process-detail-solar-inverter') {
      const variant = SOLAR_TOPOLOGY_VARIANT_BY_ID.get(lastBusinessVariantId)
      if (variant && !('isProcessDetail' in variant)) void switchTopologyVariant(variant)
    }
    return
  }
  if (context.renderer !== 'solar' || context.contextId !== 'process-detail.solar-power.inverter') return
  processDetailContextActive.value = true
  void switchTopologyVariant(SOLAR_PROCESS_DETAIL_VARIANTS[0])
}

/** 缺少独立输入的组合不发请求、不修改当前画布；第三层残留筛选事件直接丢弃。 */
function handleLayerFilterChange(filterId: SolarTopologyFilterId, checked: boolean): void {
  // 组件卸载前可能已有事件排队，必须在处理器入口再次阻断，确保第三层唯一文件不会被换走。
  if (processDetailContextActive.value) return
  const nextSelection = toggleSolarTopologyFilter(selectedFilterIds.value, filterId, checked)
  selectedFilterIds.value = nextSelection
  const variant = resolveSolarTopologyVariant(nextSelection)
  if (!variant) {
    ++loadRevision
    topologyRequestController?.abort()
    const missingMessage = nextSelection.size === 0
      ? '请至少选择一个有输入文件的层级。当前拓扑保持不变。'
      : `${formatSolarTopologyFilterSelection(nextSelection)}暂无独立输入文件，当前拓扑保持不变。`
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

/** 容器尺寸更新合并到下一动画帧，切换和全屏期间不会连续重绘。 */
function scheduleCanvasResize(): void {
  if (!meta2d || !canvasHost.value || props.suspended || disposed) return
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined
    const host = canvasHost.value
    if (!host || !meta2d || disposed || props.suspended || host.clientWidth === 0 || host.clientHeight === 0) return
    meta2d.resize(host.clientWidth, host.clientHeight)
    applyRuntimeStatuses(false)
    applyRuntimeSelection(props.selectedNodeIds ?? [], false)
    if (pendingViewState) restoreViewState(pendingViewState)
    else fitTopologyToViewport()
  })
}

/** 图片轮询携带加载序号，旧文件的延迟完成事件不能覆盖新文件视图。 */
function fitAfterImagesReady(revision: number, attempt = 0): void {
  const host = canvasHost.value
  if (!host || !meta2d || disposed || props.suspended || revision !== loadRevision) return
  const images = Array.from(host.querySelectorAll('img'))
  if ((images.length > 0 && images.every((image) => image.complete)) || attempt >= 360) {
    imageReadyFrame = undefined
    fitTopologyToViewport()
    return
  }
  imageReadyFrame = requestAnimationFrame(() => fitAfterImagesReady(revision, attempt + 1))
}

onMounted(async () => {
  const host = canvasHost.value
  if (!host) return
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  if (disposed) return
  if (host.clientWidth === 0 || host.clientHeight === 0) {
    loadingState.value = 'error'
    errorMessage.value = '拓扑画布可用尺寸为零，请检查承载区域高度。'
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
  // 监听器与尺寸观察器只注册一次；层级变化仅使用同一实例打开另一份完整数据。
  meta2d.on<Pen>('enter', handleTooltipPenEnter)
  meta2d.on<Pen>('leave', handleTooltipPenLeave)
  meta2d.on<Meta2dPointerEvent>('click', handleCanvasClick)
  meta2d.on<Meta2dPointerEvent>('dblclick', handleCanvasDoubleClick)
  resizeObserver = new ResizeObserver(scheduleCanvasResize)
  resizeObserver.observe(host)
  const initialVariant = resolveSolarTopologyVariant(selectedFilterIds.value)
  if (initialVariant) await switchTopologyVariant(initialVariant)
})

/** 隐藏态不持续观察或安排重绘；恢复只重算尺寸，保留当前文件、筛选与唯一画布实例。 */
watch(() => props.suspended, (suspended) => {
  if (suspended) {
    resizeObserver?.disconnect()
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    if (imageReadyFrame !== undefined) cancelAnimationFrame(imageReadyFrame)
    resizeFrame = undefined
    imageReadyFrame = undefined
    clearTopologyTooltip()
  } else if (canvasHost.value && !disposed) {
    resizeObserver?.observe(canvasHost.value)
    applyRuntimeStatuses(false)
    applyRuntimeSelection(props.selectedNodeIds ?? [], false)
    scheduleCanvasResize()
  }
})

function setTopology(topology: TopologyDefinition): void {
  runtimeTopology.value = topology
  if (!props.suspended) {
    applyRuntimeStatuses(false)
    applyRuntimeSelection(props.selectedNodeIds ?? [])
  }
}

function setSelection(nodeIds: readonly ProcessNodeId[], _routeIds: readonly RouteId[]): void {
  if (!props.suspended) applyRuntimeSelection(nodeIds)
}

function setNodeStatuses(statuses: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>): void {
  runtimeStatuses.value = statuses
  if (!props.suspended) applyRuntimeStatuses()
}

function getViewState(): CanvasTopologyViewState | undefined {
  const data = meta2d?.store.data
  return data ? { zoom: data.scale, offsetX: data.x, offsetY: data.y } : pendingViewState
}

/** 按当前画布倍率恢复外层保存的视口，不触碰层级选择或业务状态。 */
function restoreViewState(state: CanvasTopologyViewState): void {
  pendingViewState = state
  const host = canvasHost.value
  if (!meta2d || !host?.clientWidth || !host.clientHeight || props.suspended || loadingState.value !== 'ready') return
  meta2d.scale(state.zoom, { x: host.clientWidth / 2, y: host.clientHeight / 2 })
  const data = meta2d.store.data
  meta2d.translate((state.offsetX - data.x) / data.scale, (state.offsetY - data.y) / data.scale)
}

function resetView(): void {
  pendingViewState = undefined
  fitTopologyToViewport()
}

/** 暂停许可由父组件的 suspended 属性控制；恢复时只补一次尺寸和最新快照。 */
function setSuspended(suspended: boolean): void {
  if (!suspended) scheduleCanvasResize()
}

function dispose(): void {
  if (disposed) return
  disposed = true
  ++loadRevision
  topologyRequestController?.abort()
  resizeObserver?.disconnect()
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  if (imageReadyFrame !== undefined) cancelAnimationFrame(imageReadyFrame)
  meta2d?.off<Pen>('enter', handleTooltipPenEnter)
  meta2d?.off<Pen>('leave', handleTooltipPenLeave)
  meta2d?.off<Meta2dPointerEvent>('click', handleCanvasClick)
  meta2d?.off<Meta2dPointerEvent>('dblclick', handleCanvasDoubleClick)
  meta2d?.destroy()
  meta2d = undefined
}

const controller: TopologyCanvasController = Object.freeze({
  setTopology,
  setTopologyDataContext,
  setSelection,
  setNodeStatuses,
  getViewState,
  restoreViewState,
  resetView,
  setSuspended,
  dispose,
})
defineExpose<TopologyCanvasController & { readonly ready: boolean }>({
  ...controller,
  get ready() { return loadingState.value === 'ready' && !props.suspended },
})

watch(() => props.topology, (topology) => { if (topology) setTopology(topology) })
watch(() => props.selectedNodeIds, (nodeIds) => applyRuntimeSelection(nodeIds ?? []))
watch(() => props.nodeStatuses, (statuses) => setNodeStatuses(statuses ?? new Map()))

onBeforeUnmount(dispose)
</script>

<template>
  <main class="solar-topology-preview" :class="{ 'solar-topology-preview--embedded': props.fullscreenTarget }" :inert="props.suspended">
    <header class="solar-topology-preview__toolbar">
      <div class="solar-topology-preview__heading">
        <h1>光伏拓扑图预览</h1>
        <p>{{ statusText }}</p>
      </div>
      <div class="solar-topology-preview__actions" aria-label="拓扑图视图控制">
        <button type="button" :disabled="loadingState !== 'ready'" @click="changeZoom(0.85)">缩小</button>
        <output aria-label="当前缩放比例">{{ zoomPercent }}%</output>
        <button type="button" :disabled="loadingState !== 'ready'" @click="changeZoom(1.15)">放大</button>
        <button type="button" :disabled="loadingState !== 'ready'" @click="fitTopologyToViewport">适应画布</button>
      </div>
    </header>

    <section ref="canvasStage" class="solar-topology-preview__stage" aria-label="光伏拓扑图画布">
      <SolarTopologyLayerFilter
        v-if="!processDetailContextActive"
        :selected-filter-ids="selectedFilterIds"
        @change="handleLayerFilterChange"
      />
      <div
        ref="canvasHost"
        class="solar-topology-preview__canvas"
        @mouseleave="clearTopologyTooltip"
        @mousemove.passive="updateTooltipAnchor"
      />
      <TopologyFullscreenButton :target="props.fullscreenTarget ?? canvasStage" :disabled="loadingState !== 'ready' || props.suspended" />
      <div v-if="activeTooltip" class="solar-topology-preview__tooltip" :style="tooltipStyle" role="tooltip">
        <strong>{{ activeTooltip.title }}</strong>
        <span>状态：{{ activeTooltip.status }}</span>
      </div>
      <p v-if="layerNotice && loadingState === 'ready'" class="solar-topology-preview__notice" role="status">
        {{ layerNotice }}
      </p>
      <div v-if="loadingState !== 'ready'" class="solar-topology-preview__state" role="status">{{ statusText }}</div>
    </section>
  </main>
</template>

<style scoped>
.solar-topology-preview {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  block-size: 100vh;
  min-block-size: 480px;
  overflow: hidden;
  background: transparent;
  color: #e2f7ff;
}

/* 正式面板已经分配唯一弹性轨道，不用固定最小高度撑破父容器。 */
.solar-topology-preview--embedded { block-size: 100%; min-block-size: 0; }

.solar-topology-preview__toolbar {
  /* 正式面板统一提供工具栏，嵌入态隐藏预览专用白色标题栏。 */
  display: none;
  position: relative;
  z-index: 20;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-block-size: 72px;
  padding: 12px 24px;
  border-block-end: 1px solid #d8dee9;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 4px 16px rgba(29, 42, 68, 0.08);
}

.solar-topology-preview__heading h1 { margin: 0; font-size: 20px; line-height: 1.4; }
.solar-topology-preview__heading p { margin: 2px 0 0; color: #667085; font-size: 12px; }
.solar-topology-preview__actions { display: flex; align-items: center; gap: 8px; white-space: nowrap; }

.solar-topology-preview__actions button {
  min-block-size: 36px;
  padding: 7px 13px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #24324a;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.solar-topology-preview__actions button:hover:not(:disabled) { border-color: #2563eb; color: #1d4ed8; }
.solar-topology-preview__actions button:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.25); outline-offset: 2px; }
.solar-topology-preview__actions button:disabled { cursor: not-allowed; opacity: 0.45; }
.solar-topology-preview__actions output { inline-size: 58px; color: #475467; text-align: center; font-variant-numeric: tabular-nums; }

.solar-topology-preview__stage {
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-block-size: 0;
  margin: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: #1e2430;
  box-shadow: none;
}

.solar-topology-preview__canvas { inline-size: 100%; block-size: 100%; overflow: hidden; background: #1e2430; }
.solar-topology-preview__stage:fullscreen { margin: 0; border: 0; border-radius: 0; }

.solar-topology-preview__tooltip {
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

.solar-topology-preview__tooltip strong { font-size: 12px; }
.solar-topology-preview__tooltip span { color: #9dd8e5; }

.solar-topology-preview__notice {
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

.solar-topology-preview__state {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(255, 255, 255, 0.92);
  color: #475467;
  text-align: center;
}

@media (max-width: 760px) {
  .solar-topology-preview__toolbar { align-items: flex-start; flex-direction: column; gap: 10px; padding: 10px 12px; }
  .solar-topology-preview__actions { inline-size: 100%; overflow-x: auto; padding-block-end: 2px; }
  .solar-topology-preview__stage { margin: 0; }
}
</style>



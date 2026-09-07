<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { LockState, Meta2d, type Meta2dData, type Pen } from '@meta2d/core'
import { loadGasV3TopologyPreviewData } from './gas-v3-topology-preview-data'
import { getGasV3TopologyTooltipContent, type GasV3TopologyTooltipContent } from './gas-v3-topology-tooltip'
import GasV3TopologyLayerFilter from './GasV3TopologyLayerFilter.vue'
import TopologyFullscreenButton from './TopologyFullscreenButton.vue'
import {
  createDefaultGasV3TopologyFilterSelection,
  formatGasV3TopologyFilterSelection,
  resolveGasV3TopologyVariant,
  toggleGasV3TopologyFilter,
  type GasV3TopologyFilterId,
} from './gas-v3-topology-layer-filter'
import type { GasV3TopologyVariantId, GasV3TopologyVariantManifestEntry } from './gas-v3-topology-variant-manifest'
import {
  createGasTopologyConnectedLineIndex,
  GAS_TOPOLOGY_SELECTION_COLOR,
  GAS_TOPOLOGY_SELECTION_LINE_WIDTH,
  resolveGasTopologyConnectedLineIds,
} from './gas-topology-connection-highlight'

interface Meta2dPointerEvent { readonly pen?: Pen }
interface SourceLinePresentation { readonly color: string; readonly lineWidth: number }

const canvasHost = ref<HTMLElement | null>(null)
const canvasStage = ref<HTMLElement | null>(null)
const loadingState = ref<'loading' | 'ready' | 'error'>('loading')
const errorMessage = ref('')
const layerNotice = ref('')
const zoomPercent = ref(100)
const activeTooltip = ref<GasV3TopologyTooltipContent | null>(null)
const tooltipX = ref(16)
const tooltipY = ref(68)
const selectedFilterIds = ref<ReadonlySet<GasV3TopologyFilterId>>(createDefaultGasV3TopologyFilterSelection())
const currentVariantId = ref<GasV3TopologyVariantId>('network-business-key-process')
const connectedLineIndex = ref<ReturnType<typeof createGasTopologyConnectedLineIndex>>(new Map())
const statusText = computed(() => loadingState.value === 'loading'
  ? '正在加载拓扑图…'
  : loadingState.value === 'error'
    ? errorMessage.value
    : `正在展示：${formatGasV3TopologyFilterSelection(selectedFilterIds.value)}`)
const tooltipStyle = computed(() => ({ left: `${tooltipX.value}px`, top: `${tooltipY.value}px` }))

let meta2d: Meta2d | undefined
let resizeObserver: ResizeObserver | undefined
let resizeFrame: number | undefined
let imageReadyFrame: number | undefined
let topologyRequestController: AbortController | undefined
let loadRevision = 0
let disposed = false
const sourceLinePresentationById = new Map<string, SourceLinePresentation>()
let highlightedLineIds: ReadonlySet<string> = new Set()

/** 工具栏倍率始终读取画布内部状态，不保存第二套缩放来源。 */
function syncZoomPercent(): void {
  zoomPercent.value = Math.round((meta2d?.store.data.scale ?? 1) * 100)
}

/** 按当前完整文件边界等比适配，不改写图元坐标、文字或连线路径。 */
function fitTopologyToViewport(): void {
  if (!meta2d || loadingState.value !== 'ready') return
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
  activeTooltip.value = pen ? getGasV3TopologyTooltipContent(pen) ?? null : null
}

function handleTooltipPenLeave(pen?: Pen): void {
  if (!pen || activeTooltip.value?.penId === pen.id) clearTopologyTooltip()
}

function clearTopologyTooltip(): void { activeTooltip.value = null }

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

function handleCanvasClick(event?: Meta2dPointerEvent): void {
  applySelectionVisual(event?.pen ? [event.pen] : [])
}

/** 切换文件时清空旧文件局部状态并重建索引，二维组态引擎实例和监听器保持共用。 */
function commitTopologyVariant(
  data: Meta2dData,
  variant: GasV3TopologyVariantManifestEntry,
  revision: number,
): void {
  if (!meta2d || disposed || revision !== loadRevision) return
  clearTopologyTooltip()
  highlightedLineIds = new Set()
  sourceLinePresentationById.clear()
  if (imageReadyFrame !== undefined) cancelAnimationFrame(imageReadyFrame)
  imageReadyFrame = undefined
  currentVariantId.value = variant.id
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
  meta2d.open(data)
  meta2d.lock(LockState.DisableEdit)
  loadingState.value = 'ready'
  errorMessage.value = ''
  layerNotice.value = ''
  requestAnimationFrame(() => {
    if (revision === loadRevision) fitTopologyToViewport()
  })
  fitAfterImagesReady(revision)
}

/** 递增加载序号配合请求中止，保证快速勾选时只有最后选择可以提交。 */
async function switchTopologyVariant(variant: GasV3TopologyVariantManifestEntry): Promise<void> {
  if (variant.id === currentVariantId.value && loadingState.value === 'ready') {
    layerNotice.value = ''
    return
  }
  const revision = ++loadRevision
  topologyRequestController?.abort()
  const controller = new AbortController()
  topologyRequestController = controller
  const hasCurrentCanvas = loadingState.value === 'ready'
  if (hasCurrentCanvas) layerNotice.value = `正在切换到${formatGasV3TopologyFilterSelection(selectedFilterIds.value)}…`
  else loadingState.value = 'loading'
  try {
    const data = await loadGasV3TopologyPreviewData(variant.id, controller.signal)
    if (disposed || revision !== loadRevision || controller.signal.aborted) return
    commitTopologyVariant(data, variant, revision)
  } catch (error) {
    if (disposed || revision !== loadRevision || controller.signal.aborted) return
    const message = error instanceof Error ? error.message : '燃气拓扑加载失败。'
    if (hasCurrentCanvas) layerNotice.value = message
    else {
      loadingState.value = 'error'
      errorMessage.value = message
    }
  }
}

/** 缺少独立输入的组合不发请求、不修改当前画布，只更新勾选并显示非阻塞提示。 */
function handleLayerFilterChange(filterId: GasV3TopologyFilterId, checked: boolean): void {
  const nextSelection = toggleGasV3TopologyFilter(selectedFilterIds.value, filterId, checked)
  selectedFilterIds.value = nextSelection
  const variant = resolveGasV3TopologyVariant(nextSelection)
  if (!variant) {
    ++loadRevision
    topologyRequestController?.abort()
    const missingMessage = nextSelection.size === 0
      ? '请至少选择一个有输入文件的层级。当前拓扑保持不变。'
      : `${formatGasV3TopologyFilterSelection(nextSelection)}暂无独立输入文件，当前拓扑保持不变。`
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
  if (!meta2d || !canvasHost.value) return
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined
    const host = canvasHost.value
    if (!host || !meta2d || host.clientWidth === 0 || host.clientHeight === 0) return
    meta2d.resize(host.clientWidth, host.clientHeight)
    fitTopologyToViewport()
  })
}

/** 图片轮询携带加载序号，旧文件的延迟完成事件不能覆盖新文件视图。 */
function fitAfterImagesReady(revision: number, attempt = 0): void {
  const host = canvasHost.value
  if (!host || !meta2d || disposed || revision !== loadRevision) return
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
  resizeObserver = new ResizeObserver(scheduleCanvasResize)
  resizeObserver.observe(host)
  const initialVariant = resolveGasV3TopologyVariant(selectedFilterIds.value)
  if (initialVariant) await switchTopologyVariant(initialVariant)
})

onBeforeUnmount(() => {
  disposed = true
  ++loadRevision
  topologyRequestController?.abort()
  resizeObserver?.disconnect()
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  if (imageReadyFrame !== undefined) cancelAnimationFrame(imageReadyFrame)
  meta2d?.off<Pen>('enter', handleTooltipPenEnter)
  meta2d?.off<Pen>('leave', handleTooltipPenLeave)
  meta2d?.off<Meta2dPointerEvent>('click', handleCanvasClick)
  meta2d?.destroy()
  meta2d = undefined
})
</script>

<template>
  <main class="gas-topology-preview">
    <header class="gas-topology-preview__toolbar">
      <div class="gas-topology-preview__heading">
        <h1>燃气拓扑图预览</h1>
        <p>{{ statusText }}</p>
      </div>
      <div class="gas-topology-preview__actions" aria-label="拓扑图视图控制">
        <button type="button" :disabled="loadingState !== 'ready'" @click="changeZoom(0.85)">缩小</button>
        <output aria-label="当前缩放比例">{{ zoomPercent }}%</output>
        <button type="button" :disabled="loadingState !== 'ready'" @click="changeZoom(1.15)">放大</button>
        <button type="button" :disabled="loadingState !== 'ready'" @click="fitTopologyToViewport">适应画布</button>
      </div>
    </header>

    <section ref="canvasStage" class="gas-topology-preview__stage" aria-label="燃气拓扑图画布">
      <GasV3TopologyLayerFilter :selected-filter-ids="selectedFilterIds" @change="handleLayerFilterChange" />
      <div
        ref="canvasHost"
        class="gas-topology-preview__canvas"
        @mouseleave="clearTopologyTooltip"
        @mousemove.passive="updateTooltipAnchor"
      />
      <TopologyFullscreenButton :target="canvasStage" :disabled="loadingState !== 'ready'" />
      <div v-if="activeTooltip" class="gas-topology-preview__tooltip" :style="tooltipStyle" role="tooltip">
        <strong>{{ activeTooltip.title }}</strong>
        <span>状态：{{ activeTooltip.status }}</span>
      </div>
      <p v-if="layerNotice && loadingState === 'ready'" class="gas-topology-preview__notice" role="status">
        {{ layerNotice }}
      </p>
      <div v-if="loadingState !== 'ready'" class="gas-topology-preview__state" role="status">{{ statusText }}</div>
    </section>
  </main>
</template>

<style scoped>
.gas-topology-preview {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  block-size: 100vh;
  min-block-size: 480px;
  overflow: hidden;
  background: #eef2f7;
  color: #172033;
}

.gas-topology-preview__toolbar {
  position: relative;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-block-size: 72px;
  padding: 12px 24px;
  border-block-end: 1px solid #d8dee9;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 4px 16px rgba(29, 42, 68, 0.08);
}

.gas-topology-preview__heading h1 { margin: 0; font-size: 20px; line-height: 1.4; }
.gas-topology-preview__heading p { margin: 2px 0 0; color: #667085; font-size: 12px; }
.gas-topology-preview__actions { display: flex; align-items: center; gap: 8px; white-space: nowrap; }

.gas-topology-preview__actions button {
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

.gas-topology-preview__actions button:hover:not(:disabled) { border-color: #2563eb; color: #1d4ed8; }
.gas-topology-preview__actions button:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.25); outline-offset: 2px; }
.gas-topology-preview__actions button:disabled { cursor: not-allowed; opacity: 0.45; }
.gas-topology-preview__actions output { inline-size: 58px; color: #475467; text-align: center; font-variant-numeric: tabular-nums; }

.gas-topology-preview__stage {
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-block-size: 0;
  margin: 16px;
  overflow: hidden;
  border: 1px solid #cfd7e5;
  border-radius: 8px;
  background: #1e2430;
  box-shadow: 0 12px 30px rgba(29, 42, 68, 0.1);
}

.gas-topology-preview__canvas { inline-size: 100%; block-size: 100%; overflow: hidden; background: #1e2430; }
.gas-topology-preview__stage:fullscreen { margin: 0; border: 0; border-radius: 0; }

.gas-topology-preview__tooltip {
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

.gas-topology-preview__tooltip strong { font-size: 12px; }
.gas-topology-preview__tooltip span { color: #9dd8e5; }

.gas-topology-preview__notice {
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

.gas-topology-preview__state {
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
  .gas-topology-preview__toolbar { align-items: flex-start; flex-direction: column; gap: 10px; padding: 10px 12px; }
  .gas-topology-preview__actions { inline-size: 100%; overflow-x: auto; padding-block-end: 2px; }
  .gas-topology-preview__stage { margin: 8px; }
}
</style>

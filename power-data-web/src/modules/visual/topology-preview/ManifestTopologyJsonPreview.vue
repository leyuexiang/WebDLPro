<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LockState, Meta2d, type Meta2dData, type Pen } from '@meta2d/core'
import TopologyLayerFilterRail from './TopologyLayerFilterRail.vue'
import TopologyFullscreenButton from './TopologyFullscreenButton.vue'
import type {
  ManifestTopologyPreviewProfile,
  ManifestTopologyPreviewTooltip,
  ManifestTopologyPreviewVariant,
} from './manifest-topology-preview-profile'
import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'
import {
  createGasTopologyConnectedLineIndex,
  GAS_TOPOLOGY_SELECTION_COLOR,
  GAS_TOPOLOGY_SELECTION_LINE_WIDTH,
  resolveGasTopologyConnectedLineIds,
} from './gas-topology-connection-highlight'

interface Meta2dPointerEvent { readonly pen?: Pen }
interface SourceLinePresentation { readonly color: string; readonly lineWidth: number }

/**
 * 业务包装层只提供不可变清单和文案；公共画布负责唯一引擎实例、加载竞态、视口、提示与高亮。
 * 这种边界让风电和降压站复用完整运行时能力，同时避免公共层读取任何场景专属图元编号。
 */
const props = defineProps<{
  profile: ManifestTopologyPreviewProfile
  fullscreenTarget?: HTMLElement | null
  suspended?: boolean
}>()

const canvasHost = ref<HTMLElement | null>(null)
const canvasStage = ref<HTMLElement | null>(null)
const loadingState = ref<'loading' | 'ready' | 'error'>('loading')
const errorMessage = ref('')
const layerNotice = ref('')
const zoomPercent = ref(100)
const activeTooltip = ref<ManifestTopologyPreviewTooltip | null>(null)
const tooltipX = ref(16)
const tooltipY = ref(68)
const selectedFilterIds = ref<ReadonlySet<string>>(props.profile.createDefaultSelection())
const currentVariantId = ref(props.profile.defaultVariantId)
/** 第三层上下文存在时隐藏第二层筛选轨；退出后恢复离开前的第二层完整文件。 */
const activeDataContext = ref<TopologyDataContext | undefined>()
const connectedLineIndex = ref<ReturnType<typeof createGasTopologyConnectedLineIndex>>(new Map())
const statusText = computed(() => loadingState.value === 'loading'
  ? '正在加载拓扑图…'
  : loadingState.value === 'error'
    ? errorMessage.value
    : activeDataContext.value
      ? `正在展示：${activeDataContext.value.contextId}`
      : `正在展示：${props.profile.formatSelection(selectedFilterIds.value)}`)
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
  // 重置只作用于当前有效视口，不加载文件、不清空图层筛选或业务选择。
  if (!meta2d || disposed || props.suspended || loadingState.value !== 'ready') return
  if (!canvasHost.value?.clientWidth || !canvasHost.value?.clientHeight) return
  clearTopologyTooltip()
  meta2d.fitView(true, [28, 36, 28, 36])
  syncZoomPercent()
}

/**
 * 第三层仍复用当前唯一画布实例。设置 undefined 时重新加载原第二层文件，禁止把第三层图元残留到
 * 层级筛选；快速切换沿用同一中止控制器和递增序号，仅最后一个上下文可以提交。
 */
async function setTopologyDataContext(context: TopologyDataContext | undefined): Promise<void> {
  if (context?.renderer !== 'manifest-json' && context !== undefined) return
  if (context?.contextId === activeDataContext.value?.contextId && loadingState.value === 'ready') return
  const revision = ++loadRevision
  topologyRequestController?.abort()
  const controller = new AbortController()
  topologyRequestController = controller
  loadingState.value = 'loading'
  activeDataContext.value = context
  try {
    if (context) {
      if (!props.profile.loadDataContext) throw new Error(`${props.profile.sceneLabel}未登记第三层拓扑加载器。`)
      const data = await props.profile.loadDataContext(context, controller.signal)
      if (disposed || revision !== loadRevision || controller.signal.aborted) return
      commitTopologyVariant(data, {
        id: context.contextId,
        combinationKey: context.contextId,
        layerIds: [],
        topologyPath: context.topologyPath,
        sourceSha256: context.sourceSha256,
        expectedPenCount: context.expectedPenCount,
      }, revision)
      return
    }
    const variant = props.profile.resolveVariant(selectedFilterIds.value)
    if (!variant) throw new Error(`${props.profile.sceneLabel}第二层拓扑版本未登记。`)
    const data = await props.profile.loadData(variant.id, controller.signal)
    if (disposed || revision !== loadRevision || controller.signal.aborted) return
    commitTopologyVariant(data, variant, revision)
  } catch (error) {
    if (disposed || revision !== loadRevision || controller.signal.aborted) return
    loadingState.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : `${props.profile.sceneLabel}拓扑加载失败。`
  }
}

/** 窄接口不暴露引擎本体；只增加受控第三层上下文切换，供正式面板稳定代理调用。 */
defineExpose({
  ready: computed(() => loadingState.value === 'ready' && !props.suspended),
  resetView: fitTopologyToViewport,
  setTopologyDataContext,
})

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
  activeTooltip.value = pen ? props.profile.getTooltipContent(pen) ?? null : null
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
  variant: ManifestTopologyPreviewVariant,
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
async function switchTopologyVariant(variant: ManifestTopologyPreviewVariant): Promise<void> {
  if (variant.id === currentVariantId.value && loadingState.value === 'ready') {
    layerNotice.value = ''
    return
  }
  const revision = ++loadRevision
  topologyRequestController?.abort()
  const controller = new AbortController()
  topologyRequestController = controller
  const hasCurrentCanvas = loadingState.value === 'ready'
  if (hasCurrentCanvas) layerNotice.value = `正在切换到${props.profile.formatSelection(selectedFilterIds.value)}…`
  else loadingState.value = 'loading'
  try {
    const data = await props.profile.loadData(variant.id, controller.signal)
    if (disposed || revision !== loadRevision || controller.signal.aborted) return
    commitTopologyVariant(data, variant, revision)
  } catch (error) {
    if (disposed || revision !== loadRevision || controller.signal.aborted) return
    const message = error instanceof Error ? error.message : `${props.profile.sceneLabel}拓扑加载失败。`
    if (hasCurrentCanvas) layerNotice.value = message
    else {
      loadingState.value = 'error'
      errorMessage.value = message
    }
  }
}

/** 缺少独立输入的组合不发请求、不修改当前画布，只更新勾选并显示非阻塞提示。 */
function handleLayerFilterChange(filterId: string, checked: boolean): void {
  if (activeDataContext.value) return
  const nextSelection = props.profile.toggleFilter(selectedFilterIds.value, filterId, checked)
  selectedFilterIds.value = nextSelection
  const variant = props.profile.resolveVariant(nextSelection)
  if (!variant) {
    ++loadRevision
    topologyRequestController?.abort()
    const missingMessage = nextSelection.size === 0
      ? '请至少选择一个有输入文件的层级。当前拓扑保持不变。'
      : `${props.profile.formatSelection(nextSelection)}暂无独立输入文件，当前拓扑保持不变。`
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
    fitTopologyToViewport()
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
  resizeObserver = new ResizeObserver(scheduleCanvasResize)
  resizeObserver.observe(host)
  const initialVariant = props.profile.resolveVariant(selectedFilterIds.value)
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
    scheduleCanvasResize()
  }
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
  <main class="manifest-topology-preview" :class="{ 'manifest-topology-preview--embedded': props.fullscreenTarget }" :inert="props.suspended">
    <header class="manifest-topology-preview__toolbar">
      <div class="manifest-topology-preview__heading">
        <h1>{{ props.profile.sceneLabel }}拓扑图预览</h1>
        <p>{{ statusText }}</p>
      </div>
      <div class="manifest-topology-preview__actions" aria-label="拓扑图视图控制">
        <button type="button" :disabled="loadingState !== 'ready'" @click="changeZoom(0.85)">缩小</button>
        <output aria-label="当前缩放比例">{{ zoomPercent }}%</output>
        <button type="button" :disabled="loadingState !== 'ready'" @click="changeZoom(1.15)">放大</button>
        <button type="button" :disabled="loadingState !== 'ready'" @click="fitTopologyToViewport">适应画布</button>
      </div>
    </header>

    <section ref="canvasStage" class="manifest-topology-preview__stage" :aria-label="`${props.profile.sceneLabel}拓扑图画布`">
      <TopologyLayerFilterRail
        v-if="!activeDataContext"
        :groups="props.profile.filterGroups"
        :selected-filter-ids="selectedFilterIds"
        @change="handleLayerFilterChange"
      />
      <div
        ref="canvasHost"
        class="manifest-topology-preview__canvas"
        @mouseleave="clearTopologyTooltip"
        @mousemove.passive="updateTooltipAnchor"
      />
      <TopologyFullscreenButton :target="props.fullscreenTarget ?? canvasStage" :disabled="loadingState !== 'ready' || props.suspended" />
      <div v-if="activeTooltip" class="manifest-topology-preview__tooltip" :style="tooltipStyle" role="tooltip">
        <strong>{{ activeTooltip.title }}</strong>
        <span>状态：{{ activeTooltip.status }}</span>
      </div>
      <p v-if="layerNotice && loadingState === 'ready'" class="manifest-topology-preview__notice" role="status">
        {{ layerNotice }}
      </p>
      <div v-if="loadingState !== 'ready'" class="manifest-topology-preview__state" role="status">{{ statusText }}</div>
    </section>
  </main>
</template>

<style scoped>
.manifest-topology-preview {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  block-size: 100vh;
  min-block-size: 480px;
  overflow: hidden;
  background: transparent;
  color: #e2f7ff;
}

/* 正式面板已经分配唯一弹性轨道，不用固定最小高度撑破父容器。 */
.manifest-topology-preview--embedded { block-size: 100%; min-block-size: 0; }

.manifest-topology-preview__toolbar {
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

.manifest-topology-preview__heading h1 { margin: 0; font-size: 20px; line-height: 1.4; }
.manifest-topology-preview__heading p { margin: 2px 0 0; color: #667085; font-size: 12px; }
.manifest-topology-preview__actions { display: flex; align-items: center; gap: 8px; white-space: nowrap; }

.manifest-topology-preview__actions button {
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

.manifest-topology-preview__actions button:hover:not(:disabled) { border-color: #2563eb; color: #1d4ed8; }
.manifest-topology-preview__actions button:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.25); outline-offset: 2px; }
.manifest-topology-preview__actions button:disabled { cursor: not-allowed; opacity: 0.45; }
.manifest-topology-preview__actions output { inline-size: 58px; color: #475467; text-align: center; font-variant-numeric: tabular-nums; }

.manifest-topology-preview__stage {
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

.manifest-topology-preview__canvas { inline-size: 100%; block-size: 100%; overflow: hidden; background: #1e2430; }
.manifest-topology-preview__stage:fullscreen { margin: 0; border: 0; border-radius: 0; }

.manifest-topology-preview__tooltip {
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

.manifest-topology-preview__tooltip strong { font-size: 12px; }
.manifest-topology-preview__tooltip span { color: #9dd8e5; }

.manifest-topology-preview__notice {
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

.manifest-topology-preview__state {
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
  .manifest-topology-preview__toolbar { align-items: flex-start; flex-direction: column; gap: 10px; padding: 10px 12px; }
  .manifest-topology-preview__actions { inline-size: 100%; overflow-x: auto; padding-block-end: 2px; }
  .manifest-topology-preview__stage { margin: 0; }
}
</style>



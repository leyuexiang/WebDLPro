<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { LockState, Meta2d, type Pen } from '@meta2d/core'
import { loadCoalTopologyPreviewData } from '@/modules/visual/topology-preview/coal-topology-preview-data'
import {
  getCoalTopologyTooltipContent,
  type CoalTopologyTooltipContent,
} from '@/modules/visual/topology-preview/coal-topology-tooltip'
import CoalTopologyLayerFilter from './CoalTopologyLayerFilter.vue'
import {
  applyCoalTopologyLayerVisibility,
  createDefaultCoalTopologyFilterSelection,
  createCoalTopologyLayerBindingIndex,
  createCoalTopologyVisibilityRuleIndex,
  toggleCoalTopologyFilter,
  type CoalTopologyFilterId,
} from './coal-topology-layer-filter'

const canvasHost = ref<HTMLElement | null>(null)
const canvasStage = ref<HTMLElement | null>(null)
const loadingState = ref<'loading' | 'ready' | 'error'>('loading')
const errorMessage = ref('')
const zoomPercent = ref(100)
const activeTooltip = ref<CoalTopologyTooltipContent | null>(null)
const tooltipX = ref(16)
const tooltipY = ref(68)
/** 筛选状态只保存稳定编号；图元显隐由同一份层级索引投影到 Meta2D（网页二维组态引擎）。 */
const selectedFilterIds = ref<ReadonlySet<CoalTopologyFilterId>>(createDefaultCoalTopologyFilterSelection())
const layerBindingIndex = ref<ReadonlyMap<string, readonly CoalTopologyFilterId[]>>(new Map())
const visibilityRuleIndex = ref<ReturnType<typeof createCoalTopologyVisibilityRuleIndex>>(new Map())
const statusText = computed(() => loadingState.value === 'loading'
  ? '正在加载拓扑图…'
  : loadingState.value === 'error'
    ? errorMessage.value
    : '已按原始拓扑数据渲染')
const tooltipStyle = computed(() => ({
  left: `${tooltipX.value}px`,
  top: `${tooltipY.value}px`,
}))

let meta2d: Meta2d | undefined
let resizeObserver: ResizeObserver | undefined
let resizeFrame: number | undefined
let imageReadyFrame: number | undefined
const requestController = new AbortController()

/** 同步第三方画布内部倍率，工具栏只显示整数百分比，避免响应式层保存另一套缩放状态。 */
function syncZoomPercent(): void {
  zoomPercent.value = Math.round((meta2d?.store.data.scale ?? 1) * 100)
}

/**
 * 按全部图元的实际边界等比适配当前容器。
 * 只改变统一的画布观察倍率，不单独改写文字、设备、连线的坐标和尺寸，避免破坏数据中的相对布局。
 */
function fitTopologyToViewport(): void {
  if (!meta2d || loadingState.value !== 'ready') return
  clearTopologyTooltip()
  meta2d.fitView(true, [28, 36, 28, 36])
  syncZoomPercent()
}

/**
 * Meta2D 的 scale 参数是目标倍率而非增量，先读取当前倍率再计算，避免连续点击产生比例跳变。
 */
function changeZoom(multiplier: number): void {
  if (!meta2d || loadingState.value !== 'ready') return
  clearTopologyTooltip()
  const currentScale = meta2d.store.data.scale || 1
  const nextScale = Math.min(4, Math.max(0.1, currentScale * multiplier))
  const host = canvasHost.value
  meta2d.scale(nextScale, {
    x: (host?.clientWidth ?? 0) / 2,
    y: (host?.clientHeight ?? 0) / 2,
  })
  syncZoomPercent()
}

/** 将提示锚点限制在画布安全区，定位算法与原拓扑提示保持一致。 */
function updateTooltipAnchor(event: MouseEvent): void {
  const stage = canvasStage.value
  if (!stage || !activeTooltip.value) return

  const bounds = stage.getBoundingClientRect()
  tooltipX.value = Math.min(Math.max(event.clientX - bounds.left, 12), Math.max(12, bounds.width - 24))
  tooltipY.value = Math.min(Math.max(event.clientY - bounds.top, 68), Math.max(68, bounds.height - 12))
}

/** 背景图元在选择策略中已完全禁用；这里再按提示内容门禁，避免未来数据变更产生空卡片。 */
function handleTooltipPenEnter(pen?: Pen): void {
  activeTooltip.value = pen ? getCoalTopologyTooltipContent(pen) ?? null : null
}

/** 仅离开当前提示图元时关闭卡片，避免相邻设备快速切换产生错误清除。 */
function handleTooltipPenLeave(pen?: Pen): void {
  if (!pen || activeTooltip.value?.penId === pen.id) clearTopologyTooltip()
}

function clearTopologyTooltip(): void {
  activeTooltip.value = null
}

/** 一次筛选变化只更新每个图元的 visible 字段并统一渲染，避免重建 JSON、动图或画布实例。 */
function applyLayerFilterSelection(): void {
  if (!meta2d || loadingState.value !== 'ready') return
  const pens = meta2d.store.data.pens
  const previousVisibilityByPenId = new Map(
    pens
      .filter((pen) => Boolean(pen.id))
      .map((pen) => [pen.id!, pen.visible]),
  )
  applyCoalTopologyLayerVisibility(pens, layerBindingIndex.value, selectedFilterIds.value, visibilityRuleIndex.value)

  // Meta2D 的专用显隐接口（setVisible）除了更新 visible 字段，还会同步 calculative.visible、图片缓存和子图元状态。
  // 之前只调用 setValue 时，部分普通矩形边框在数据状态已变更后仍保留旧画布缓存；这里只处理真正发生变化的图元，
  // 避免每次筛选都重复初始化 102 个图元的图片缓存，再统一执行一次 render，兼顾显示正确性与切换性能。
  for (const pen of pens) {
    if (!pen.id || previousVisibilityByPenId.get(pen.id) === pen.visible) continue
    meta2d.setVisible(pen, pen.visible !== false, false)
  }
  clearTopologyTooltip()
  meta2d.render()
}

/** 主开关和各层复选框均通过纯函数更新，保证两个页面的交互规则完全一致。 */
function handleLayerFilterChange(filterId: CoalTopologyFilterId, checked: boolean): void {
  selectedFilterIds.value = toggleCoalTopologyFilter(selectedFilterIds.value, filterId, checked)
  applyLayerFilterSelection()
}

/** 容器尺寸变化合并到下一动画帧，并从当前源倍率重新等比适配全部图元。 */
function scheduleCanvasResize(): void {
  if (!meta2d || !canvasHost.value) return
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined
    const host = canvasHost.value
    if (!host || !meta2d) return
    meta2d.resize(host.clientWidth, host.clientHeight)
    fitTopologyToViewport()
  })
}

/**
 * 动态图片文档对象加载后，按源倍率对整图做一次等比适配，确保图片参与最终边界计算。
 * 使用动画帧轮询现有图片节点，不新增图片请求或常驻定时器，完成后立即停止。
 */
function fitAfterImagesReady(attempt = 0): void {
  const host = canvasHost.value
  if (!host || !meta2d || requestController.signal.aborted) return
  const images = Array.from(host.querySelectorAll('img'))
  const allImagesReady = images.length > 0 && images.every((image) => image.complete)

  if (allImagesReady || attempt >= 360) {
    imageReadyFrame = undefined
    fitTopologyToViewport()
    return
  }

  imageReadyFrame = requestAnimationFrame(() => fitAfterImagesReady(attempt + 1))
}

onMounted(async () => {
  const host = canvasHost.value
  if (!host) return

  try {
    const topologyData = await loadCoalTopologyPreviewData(requestController.signal)
    if (requestController.signal.aborted) return

    layerBindingIndex.value = createCoalTopologyLayerBindingIndex(topologyData.pens)
    visibilityRuleIndex.value = createCoalTopologyVisibilityRuleIndex(topologyData.pens, layerBindingIndex.value)
    applyCoalTopologyLayerVisibility(topologyData.pens, layerBindingIndex.value, selectedFilterIds.value, visibilityRuleIndex.value)

    // 等待布局完成后再创建引擎；Meta2D 初始化时会立即按容器尺寸创建离屏画布，零尺寸会导致图片层绘制失败。
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    if (host.clientWidth === 0 || host.clientHeight === 0) {
      throw new Error('拓扑画布可用尺寸为零，请检查承载区域高度。')
    }

    // 使用生成该 JSON 的原生 Meta2D（网页二维组态引擎）打开数据，避免手工解释坐标与文字布局造成偏差。
    meta2d = new Meta2d(host, {
      minScale: 0.1,
      maxScale: 4,
      grid: false,
      rule: false,
      disableInput: true,
      disableClipboard: true,
    })
    meta2d.open(topologyData)
    // 复用组态引擎已有命中索引，不额外扫描 102 个图元；全画布只维护一个文档提示层。
    meta2d.on<Pen>('enter', handleTooltipPenEnter)
    meta2d.on<Pen>('leave', handleTooltipPenLeave)
    // 禁止改图，但保留空白拖动画布和滚轮缩放，便于查看原始细节。
    meta2d.lock(LockState.DisableEdit)
    loadingState.value = 'ready'
    resizeObserver = new ResizeObserver(scheduleCanvasResize)
    resizeObserver.observe(host)
    requestAnimationFrame(fitTopologyToViewport)
    fitAfterImagesReady()
  }
  catch (error) {
    if (requestController.signal.aborted) return
    loadingState.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : '拓扑图加载失败。'
  }
})

onBeforeUnmount(() => {
  requestController.abort()
  resizeObserver?.disconnect()
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  if (imageReadyFrame !== undefined) cancelAnimationFrame(imageReadyFrame)
  meta2d?.off<Pen>('enter', handleTooltipPenEnter)
  meta2d?.off<Pen>('leave', handleTooltipPenLeave)
  // 显式释放多层 Canvas、动图文档对象和事件监听，避免返回旧燃煤拓扑后保留预览资源。
  meta2d?.destroy()
  meta2d = undefined
})
</script>

<template>
  <main class="coal-topology-preview">
    <header class="coal-topology-preview__toolbar">
      <div class="coal-topology-preview__heading">
        <h1>燃煤拓扑图预览</h1>
        <p>{{ statusText }}</p>
      </div>

      <div class="coal-topology-preview__actions" aria-label="拓扑图视图控制">
        <button type="button" :disabled="loadingState !== 'ready'" @click="changeZoom(0.85)">缩小</button>
        <output aria-label="当前缩放比例">{{ zoomPercent }}%</output>
        <button type="button" :disabled="loadingState !== 'ready'" @click="changeZoom(1.15)">放大</button>
        <button type="button" :disabled="loadingState !== 'ready'" @click="fitTopologyToViewport">适应画布</button>
        <RouterLink to="/embed?directAccess=1&amp;sceneId=coal-power">返回原燃煤拓扑</RouterLink>
      </div>
    </header>

    <section ref="canvasStage" class="coal-topology-preview__stage" aria-label="燃煤拓扑图画布">
      <CoalTopologyLayerFilter
        :selected-filter-ids="selectedFilterIds"
        @change="handleLayerFilterChange"
      />
      <div
        ref="canvasHost"
        class="coal-topology-preview__canvas"
        @mouseleave="clearTopologyTooltip"
        @mousemove.passive="updateTooltipAnchor"
      />
      <!-- 提示层与第三方引擎管理的画布容器保持同级，避免响应式更新干扰引擎追加的多层 Canvas 和动图元素。 -->
      <div
        v-if="activeTooltip"
        class="coal-topology-preview__tooltip"
        :style="tooltipStyle"
        role="tooltip"
        aria-live="polite"
      >
        <strong>{{ activeTooltip.title }}</strong>
        <span>状态：{{ activeTooltip.status }}</span>
      </div>
      <div v-if="loadingState !== 'ready'" class="coal-topology-preview__state" role="status">
        {{ statusText }}
      </div>
    </section>
  </main>
</template>

<style scoped>
.coal-topology-preview {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  block-size: 100vh;
  min-block-size: 480px;
  overflow: hidden;
  background: #eef2f7;
  color: #172033;
}

.coal-topology-preview__toolbar {
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

.coal-topology-preview__heading h1 {
  margin: 0;
  font-size: 20px;
  line-height: 1.4;
}

.coal-topology-preview__heading p {
  margin: 2px 0 0;
  color: #667085;
  font-size: 12px;
}

.coal-topology-preview__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.coal-topology-preview__actions button,
.coal-topology-preview__actions a {
  min-block-size: 36px;
  padding: 7px 13px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  color: #24324a;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-decoration: none;
  cursor: pointer;
}

.coal-topology-preview__actions button:hover:not(:disabled),
.coal-topology-preview__actions a:hover {
  border-color: #2563eb;
  color: #1d4ed8;
}

.coal-topology-preview__actions button:focus-visible,
.coal-topology-preview__actions a:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.25);
  outline-offset: 2px;
}

.coal-topology-preview__actions button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.coal-topology-preview__actions output {
  inline-size: 58px;
  color: #475467;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.coal-topology-preview__stage {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-block-size: 0;
  margin: 16px;
  overflow: hidden;
  border: 1px solid #cfd7e5;
  border-radius: 8px;
  background: #1e2430;
  box-shadow: 0 12px 30px rgba(29, 42, 68, 0.1);
}

.coal-topology-preview__canvas {
  inline-size: 100%;
  block-size: 100%;
  overflow: hidden;
  background: #1e2430;
}

/* 与原拓扑共用深色青边提示规范；全画布只有当前悬浮图元对应的一个提示实例。 */
.coal-topology-preview__tooltip {
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

.coal-topology-preview__tooltip strong {
  font-size: 12px;
}

.coal-topology-preview__tooltip span {
  color: #9dd8e5;
}

.coal-topology-preview__state {
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
  .coal-topology-preview__toolbar {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
    padding: 10px 12px;
  }

  .coal-topology-preview__actions {
    inline-size: 100%;
    overflow-x: auto;
    padding-block-end: 2px;
  }

  .coal-topology-preview__stage {
    margin: 8px;
  }
}
</style>


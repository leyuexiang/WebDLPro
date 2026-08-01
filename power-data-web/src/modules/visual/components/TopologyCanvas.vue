<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition } from '@/config/process/types'
import { CanvasTopologyAdapter } from '@/services/topology/canvas-topology-adapter'

const props = defineProps<{
  topology: TopologyDefinition
  selectedNodeIds: readonly ProcessNodeId[]
  selectedRouteIds: readonly RouteId[]
  /** 全屏容器接管高度后，画布改为填充剩余空间而非继续使用常规工作区尺寸。 */
  fullscreen?: boolean
}>()

const emit = defineEmits<{
  selectNode: [nodeId: ProcessNodeId]
}>()

const containerElement = ref<HTMLElement | null>(null)
const canvasElement = ref<HTMLCanvasElement | null>(null)
const zoomLevel = ref(1)
const isPanning = ref(false)
let adapter: CanvasTopologyAdapter | undefined
let resizeObserver: ResizeObserver | undefined
let lastPointerX = 0
let lastPointerY = 0
let hasMovedSincePointerDown = false

/** 统一向适配器推送配置与选中状态，组件不直接操作 Canvas 绘制命令。 */
function syncRenderer(): void {
  if (!adapter) return
  adapter.setTopology(props.topology)
  adapter.setSelection(props.selectedNodeIds, props.selectedRouteIds)
}

/** 容器变化时只调整当前画布尺寸；适配器会合并多次回调为一帧重绘。 */
function handleResize(entries: readonly ResizeObserverEntry[]): void {
  const entry = entries[0]

  if (entry && adapter) {
    adapter.resize(entry.contentRect.width, entry.contentRect.height)
  }
}

/** 复用绘制期缓存做命中测试，点击只向父层发出稳定节点 ID。 */
function handleCanvasClick(event: MouseEvent): void {
  const canvas = canvasElement.value

  if (!canvas || !adapter) return
  // 拖拽结束后的 click 由浏览器自动触发，必须忽略以避免误选经过的设备节点。
  if (hasMovedSincePointerDown) {
    hasMovedSincePointerDown = false
    return
  }
  const bounds = canvas.getBoundingClientRect()
  const nodeId = adapter.pickNodeAt(event.clientX - bounds.left, event.clientY - bounds.top)

  if (nodeId) emit('selectNode', nodeId)
}

/** 缩放按钮只调整当前 Canvas 视图，拓扑配置、选择状态和场景联动均不重新初始化。 */
function changeZoom(delta: number): void {
  if (!adapter) return
  zoomLevel.value = adapter.zoomBy(delta)
}

/** 还原全局视图，便于从局部控制器或现场设备回到完整分层关系。 */
function resetZoom(): void {
  if (!adapter) return
  zoomLevel.value = adapter.resetZoom()
}

/** 鼠标位于画布内时将滚轮解释为缩放，阻止外层页面因查看细节发生误滚动。 */
function handleCanvasWheel(event: WheelEvent): void {
  changeZoom(event.deltaY > 0 ? -0.15 : 0.15)
}

/** 左键按下后进入平移模式，并捕获指针以保证移出画布边缘时仍能可靠结束拖拽。 */
function handlePointerDown(event: PointerEvent): void {
  const canvas = canvasElement.value

  if (!adapter || !canvas || event.button !== 0) return
  isPanning.value = true
  hasMovedSincePointerDown = false
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  canvas.setPointerCapture(event.pointerId)
}

/** 以相邻指针位置差平移视图，不修改配置坐标、节点选择或三维联动状态。 */
function handlePointerMove(event: PointerEvent): void {
  if (!adapter || !isPanning.value) return
  const deltaX = event.clientX - lastPointerX
  const deltaY = event.clientY - lastPointerY

  if (deltaX !== 0 || deltaY !== 0) {
    hasMovedSincePointerDown = true
    adapter.panBy(deltaX, deltaY)
    lastPointerX = event.clientX
    lastPointerY = event.clientY
  }
}

/** 无论在画布内抬起还是因浏览器取消指针，均退出平移态，避免光标和点击状态残留。 */
function handlePointerEnd(event: PointerEvent): void {
  const canvas = canvasElement.value

  if (!isPanning.value) return
  isPanning.value = false
  if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
}

onMounted(() => {
  const container = containerElement.value
  const canvas = canvasElement.value

  if (!container || !canvas) return
  adapter = new CanvasTopologyAdapter(canvas)
  zoomLevel.value = 1
  resizeObserver = new ResizeObserver(handleResize)
  resizeObserver.observe(container)
  adapter.resize(container.clientWidth, container.clientHeight)
  syncRenderer()
})

/** 配置或高亮变化仅更新适配器缓存，避免 Vue 为每个节点创建大量 DOM。 */
watch(() => [props.topology, props.selectedNodeIds, props.selectedRouteIds], syncRenderer)

/** 断开观察器并释放动画帧，路由切换后不会残留旧页面的 Canvas 回调。 */
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = undefined
  adapter?.dispose()
  adapter = undefined
})
</script>

<template>
  <div ref="containerElement" :class="['topology-canvas', { 'topology-canvas--fullscreen': props.fullscreen }]">
    <canvas
      ref="canvasElement"
      :class="{ 'topology-canvas__surface--panning': isPanning }"
      aria-label="工艺二维拓扑，可在画布内缩放并按住鼠标左键拖拽"
      role="img"
      @click="handleCanvasClick"
      @pointercancel="handlePointerEnd"
      @pointerdown.prevent="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerEnd"
      @wheel.prevent="handleCanvasWheel"
    />
    <div class="topology-canvas__toolbar" aria-label="拓扑缩放控制">
      <button type="button" title="缩小拓扑" :disabled="zoomLevel <= 0.55" @click="changeZoom(-0.15)">−</button>
      <output aria-label="当前拓扑缩放比例">{{ Math.round(zoomLevel * 100) }}%</output>
      <button type="button" title="放大拓扑" :disabled="zoomLevel >= 2.25" @click="changeZoom(0.15)">+</button>
      <button type="button" title="重置拓扑视图" @click="resetZoom">重置</button>
    </div>
  </div>
</template>

<style scoped>
.topology-canvas {
  position: relative;
  /* 参考原型的上下等分策略：常规视图随窗口高度小幅伸缩，并设置上下限避免页面持续增高。 */
  block-size: clamp(270px, 30dvh, 320px);
  min-block-size: 0;
  overflow: hidden;
  border: 1px solid rgba(34, 211, 238, 0.38);
  border-radius: var(--radius-md);
  background: #03111d;
  box-shadow: inset 0 0 28px rgba(8, 145, 178, 0.12);
}

.topology-canvas canvas {
  display: block;
  cursor: grab;
  touch-action: none;
}

.topology-canvas canvas.topology-canvas__surface--panning {
  cursor: grabbing;
}

/* 全屏遮罩由父面板提供边框和标题；画布仅占用标题、提示之外的全部剩余空间。 */
.topology-canvas--fullscreen {
  block-size: 100%;
  min-block-size: 0;
}

/* 缩放工具栏悬浮于画布内，不参与文档流，也不改变固定容器尺寸。 */
.topology-canvas__toolbar {
  position: absolute;
  inset-block-end: 10px;
  inset-inline-end: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(34, 211, 238, 0.5);
  border-radius: 6px;
  background: rgba(3, 17, 29, 0.86);
  box-shadow: 0 0 14px rgba(8, 145, 178, 0.18);
}

.topology-canvas__toolbar button,
.topology-canvas__toolbar output {
  min-inline-size: 28px;
  min-block-size: 26px;
  border: 0;
  border-radius: 4px;
  color: #d9f8ff;
  font: 600 12px/1 Microsoft YaHei, sans-serif;
}

.topology-canvas__toolbar button {
  padding-inline: 7px;
  background: rgba(14, 116, 144, 0.42);
  cursor: pointer;
}

.topology-canvas__toolbar button:hover:not(:disabled) {
  background: rgba(34, 211, 238, 0.3);
}

.topology-canvas__toolbar button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.topology-canvas__toolbar output {
  display: grid;
  min-inline-size: 42px;
  place-items: center;
  color: #67e8f9;
}

@media (width < 620px) {
  .topology-canvas {
    block-size: 240px;
  }
}
</style>

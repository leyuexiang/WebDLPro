<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition, TopologyDeviceStatus } from '@/config/process/types'
import { CanvasTopologyAdapter, type CanvasTopologyViewState } from '@/services/topology/canvas-topology-adapter'
import { TopologyCanvasUpdateCoordinator } from '@/modules/visual/components/topology-canvas-update-coordinator'
import type { TopologyCanvasController } from '@/modules/visual/components/topology-canvas-controller'

const props = defineProps<{
  topology: TopologyDefinition
  selectedNodeIds: readonly ProcessNodeId[]
  selectedRouteIds: readonly RouteId[]
  /** 外层以不可变快照传入节点状态；当前画布只重绘状态图元，不重建拓扑和路径。 */
  nodeStatuses?: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>
  /** 全屏容器接管高度后，画布改为填充剩余空间而非继续使用常规工作区尺寸。 */
  fullscreen?: boolean
}>()

const emit = defineEmits<{
  selectNode: [nodeId: ProcessNodeId]
  /** 双击只上报命中的二维节点；设备与三维映射必须由正式拓扑运行时显式解析。 */
  doubleClickNode: [nodeId: ProcessNodeId]
}>()

const containerElement = ref<HTMLElement | null>(null)
const canvasElement = ref<HTMLCanvasElement | null>(null)
const zoomLevel = ref(1)
const isPanning = ref(false)
let adapter: CanvasTopologyAdapter | undefined
let updateCoordinator: TopologyCanvasUpdateCoordinator | undefined
let resizeObserver: ResizeObserver | undefined
let lastPointerX = 0
let lastPointerY = 0
let hasMovedSincePointerDown = false
/** 无运行时状态时复用空快照，避免每次同步创建临时 Map（映射）。 */
const emptyNodeStatuses: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus> = new Map()

/**
 * 拓扑定义变化才调用 setTopology；该调用会重建节点索引和路径缓存，
 * 因而绝不能与高频选择、状态或容器尺寸变化共用同一个观察器。
 */
function syncTopologyDefinition(): void {
  updateCoordinator?.updateTopology(props.topology)
}

/**
 * 选择变化只调用 setSelection，复用现有拓扑、图元和路径缓存。
 * 这保证单击节点不会触发全图重建，后续设备状态增量也可沿用同一分离边界。
 */
function syncSelection(): void {
  updateCoordinator?.updateSelection(props.selectedNodeIds, props.selectedRouteIds)
}

/** 节点状态与选择、配置分离观察；状态批次会被适配器合并至单个动画帧。 */
function syncNodeStatuses(): void {
  updateCoordinator?.updateNodeStatuses(props.nodeStatuses ?? emptyNodeStatuses)
}

/** 容器变化时只调整当前画布尺寸；适配器会合并多次回调为一帧重绘。 */
function handleResize(entries: readonly ResizeObserverEntry[]): void {
  const entry = entries[0]

  if (entry && updateCoordinator) {
    updateCoordinator.updateContainerSize(entry.contentRect.width, entry.contentRect.height)
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

/**
 * 双击沿用已有命中缓存，只产生节点意图而不调用 Unity、外层桥或状态仓库。
 * 浏览器在双击时仍会触发两次 click（单击）事件；后续协调器对相同选择保持幂等，
 * 因此这里不延迟首个单击，也不会由双击重复下发三维聚焦命令。
 */
function handleCanvasDoubleClick(event: MouseEvent): void {
  const canvas = canvasElement.value

  if (!canvas || !adapter || hasMovedSincePointerDown) return
  const bounds = canvas.getBoundingClientRect()
  const nodeId = adapter.pickNodeAt(event.clientX - bounds.left, event.clientY - bounds.top)

  if (nodeId) emit('doubleClickNode', nodeId)
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

/**
 * 由运行时在跨拓扑前读取当前视图；未挂载或已释放时返回 undefined，调用方必须回退到默认视图。
 * 此读取不修改拓扑定义，因此不会触发节点索引、路径缓存或图元资源重建。
 */
function getViewState(): CanvasTopologyViewState | undefined {
  return adapter?.getViewState()
}

/**
 * 由运行时恢复先前保存的视图，并同步工具栏显示的缩放百分比。
 * 状态有效性与平移边界均由适配器二次校验，组件不保存另一份可能漂移的缩放来源。
 */
function restoreViewState(state: CanvasTopologyViewState): void {
  if (!adapter) return
  adapter.restoreViewState(state)
  zoomLevel.value = adapter.getViewState().zoom
}

/**
 * 运行时只可通过受控协调器替换拓扑定义，不会创建第二个 Canvas 或修改 Vue 父组件的只读属性。
 * 后续父组件传入新配置时仍由既有观察器覆盖为最新声明值，保证配置是唯一事实来源。
 */
function setTopology(topology: TopologyDefinition): void {
  updateCoordinator?.updateTopology(topology)
}

/**
 * 运行时选择与组件属性选择共用同一个局部高亮更新路径，不会重新计算节点布局或路径缓存。
 */
function setSelection(nodeIds: readonly ProcessNodeId[], routeIds: readonly RouteId[]): void {
  updateCoordinator?.updateSelection(nodeIds, routeIds)
}

/**
 * 运行时端口补发状态时复用与属性观察器完全相同的增量路径。
 * 它只传入只读节点状态快照，不修改拓扑配置、选择或当前缩放平移，适配器会继续按帧合并重绘。
 */
function setNodeStatuses(statuses: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>): void {
  updateCoordinator?.updateNodeStatuses(statuses)
}

/**
 * 主动释放与组件卸载共用相同的幂等清理方式，避免拓扑运行时先释放后 Vue 再卸载时保留观察器。
 */
function dispose(): void {
  resizeObserver?.disconnect()
  resizeObserver = undefined
  adapter?.dispose()
  adapter = undefined
  updateCoordinator = undefined
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
  updateCoordinator = new TopologyCanvasUpdateCoordinator(adapter)
  zoomLevel.value = 1
  resizeObserver = new ResizeObserver(handleResize)
  resizeObserver.observe(container)
  adapter.resize(container.clientWidth, container.clientHeight)
  syncTopologyDefinition()
  syncSelection()
  syncNodeStatuses()
})

/**
 * 定义与选择必须使用独立观察器：前者允许重建路径，后者只允许局部高亮重绘。
 * Canvas 仍由单一适配器绘制，Vue 不会为每个节点创建额外 DOM。
 */
watch(() => props.topology, syncTopologyDefinition)
watch(() => [props.selectedNodeIds, props.selectedRouteIds] as const, syncSelection)
watch(() => props.nodeStatuses, syncNodeStatuses)

/** 断开观察器并释放动画帧，路由切换后不会残留旧页面的 Canvas 回调。 */
onBeforeUnmount(() => {
  dispose()
})

/** 仅向组合根暴露受控端口；模板和业务组件仍不能访问原生 Canvas 或适配器实例。 */
defineExpose<TopologyCanvasController>({
  setTopology,
  setSelection,
  setNodeStatuses,
  getViewState,
  restoreViewState,
  dispose,
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
      @dblclick="handleCanvasDoubleClick"
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

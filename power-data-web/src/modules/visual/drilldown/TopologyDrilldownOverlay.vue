<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue'
import type { TopologyDeviceStatus } from '@/config/process/types'
import type { TopologyDrilldownContent } from '@/config/scene-topology/types'
import {
  createTopologyDrilldownRenderModel,
  TopologyDrilldownViewState,
  type TopologyDrilldownViewSnapshot,
} from '@/modules/visual/drilldown/topology-drilldown-view-state'
import { getTopologyIconUrl } from '@/services/topology/topology-icon-registry'

const props = defineProps<{
  content?: TopologyDrilldownContent
  errorMessage?: string
  /** 下钻不创建说明节点状态；所有提示沿用触发入口当前正式状态。 */
  status?: TopologyDeviceStatus
  fullscreen: boolean
}>()

const emit = defineEmits<{
  close: []
  toggleFullscreen: []
}>()

/** Vue（渐进式网页框架）提供的实例标识稳定关联标题与对话框，不引入随机值影响视觉回归。 */
const titleId = `topology-drilldown-title-${useId()}`
const drilldownTooltipId = `topology-drilldown-tooltip-${useId()}`
const closeButton = ref<HTMLButtonElement | null>(null)
const svgElement = ref<SVGSVGElement | null>(null)
const workspaceElement = ref<HTMLElement | null>(null)
const viewStateController = new TopologyDrilldownViewState()
const viewSnapshot = ref<TopologyDrilldownViewSnapshot>(viewStateController.getSnapshot())
const renderModel = computed(() => props.content ? createTopologyDrilldownRenderModel(props.content) : undefined)
const instanceById = computed(() => new Map(renderModel.value?.instances.map((instance) => [instance.instanceId, instance] as const) ?? []))
const graphTransform = computed(() => {
  const { zoom, offsetX, offsetY } = viewSnapshot.value
  return `translate(${offsetX} ${offsetY}) translate(500 250) scale(${zoom}) translate(-500 -250)`
})

/** 下钻只保留一个提示实例，避免每个视觉副本都创建文档对象和监听器。 */
const hoveredInstanceId = ref<string | null>(null)
const tooltipX = ref(16)
const tooltipY = ref(68)
const tooltipUsesKeyboardPosition = ref(false)
const activeTooltipInstance = computed(() => {
  const instanceId = hoveredInstanceId.value
  return instanceId ? instanceById.value.get(instanceId) : undefined
})
const activeTooltipStatus = computed(() => ({
  normal: '正常',
  alarm: '告警',
  fault: '故障',
  offline: '离线',
} as const)[props.status ?? 'offline'])
const tooltipStyle = computed(() => tooltipUsesKeyboardPosition.value
  ? undefined
  : { left: `${tooltipX.value}px`, top: `${tooltipY.value}px` })

let panningPointerId: number | undefined
let lastPointerX = 0
let lastPointerY = 0

/** 覆盖层初始焦点固定落在关闭按钮，避免键盘继续停留于已 inert（不可交互）的原画布。 */
function focusInitial(): void {
  closeButton.value?.focus()
}

/** 局部缩放只更新说明层的轻量视图状态，不调用正式拓扑适配器。 */
function changeZoom(delta: number): void {
  viewSnapshot.value = viewStateController.zoomBy(delta)
}

function resetView(): void {
  viewSnapshot.value = viewStateController.reset()
}

/** 将悬浮提示锚点限制在覆盖层工作区内，避免边缘节点的完整名称被裁切。 */
function updateTooltipAnchor(clientX: number, clientY: number): void {
  const bounds = workspaceElement.value?.getBoundingClientRect()
  if (!bounds) return
  tooltipX.value = Math.min(Math.max(clientX - bounds.left, 12), Math.max(12, bounds.width - 24))
  tooltipY.value = Math.min(Math.max(clientY - bounds.top, 68), Math.max(68, bounds.height - 12))
}

/** 鼠标悬浮和键盘聚焦共用同一提示内容；说明层不伪造实时设备状态。 */
function showNodeTooltip(instanceId: string, event?: PointerEvent): void {
  hoveredInstanceId.value = instanceId
  tooltipUsesKeyboardPosition.value = !event
  if (event) updateTooltipAnchor(event.clientX, event.clientY)
}

/** 节点内移动时同步提示锚点，和总览画布的连续鼠标命中定位保持一致。 */
function handleNodePointerMove(instanceId: string, event: PointerEvent): void {
  if (panningPointerId !== undefined) return
  showNodeTooltip(instanceId, event)
}

function clearNodeTooltip(): void {
  hoveredInstanceId.value = null
  tooltipUsesKeyboardPosition.value = false
}

function handleWheel(event: WheelEvent): void {
  changeZoom(event.deltaY > 0 ? -0.15 : 0.15)
}

/** 说明图平移使用自身指针捕获；事件在覆盖层终止，不会落入原画布选择或三维聚焦链路。 */
function handlePointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !svgElement.value) return
  // 拖拽开始后隐藏提示，避免提示跟随起点停留并遮挡正在查看的关联线。
  clearNodeTooltip()
  panningPointerId = event.pointerId
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  svgElement.value.setPointerCapture(event.pointerId)
}

function handlePointerMove(event: PointerEvent): void {
  if (panningPointerId !== event.pointerId || !svgElement.value) return
  const deltaX = event.clientX - lastPointerX
  const deltaY = event.clientY - lastPointerY
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  const bounds = svgElement.value.getBoundingClientRect()
  viewSnapshot.value = viewStateController.panBy(deltaX, deltaY, bounds.width, bounds.height)
}

function handlePointerEnd(event: PointerEvent): void {
  if (panningPointerId !== event.pointerId) return
  if (svgElement.value?.hasPointerCapture(event.pointerId)) svgElement.value.releasePointerCapture(event.pointerId)
  panningPointerId = undefined
}

/** 组件释放时丢弃局部指针标识和提示节点引用；没有全局监听器、动画帧或第二个 Canvas 需要保留。 */
onBeforeUnmount(() => {
  panningPointerId = undefined
  clearNodeTooltip()
})

defineExpose({ focusInitial })
</script>

<template>
  <section
    class="topology-drilldown"
    role="dialog"
    :aria-labelledby="titleId"
    @click.stop
    @dblclick.stop
    @pointerdown.stop
  >
    <header class="topology-drilldown__header">
      <div>
        <p>拓扑关联下钻</p>
        <h2 :id="titleId">{{ props.content?.title ?? '下钻内容不可用' }}</h2>
      </div>
      <div class="topology-drilldown__actions">
        <button
          type="button"
          :aria-label="props.fullscreen ? '退出拓扑图全屏展示' : '全屏展示拓扑图'"
          :aria-pressed="props.fullscreen"
          :title="props.fullscreen ? '退出全屏' : '全屏展示'"
          @click="emit('toggleFullscreen')"
        >
          <span aria-hidden="true">{{ props.fullscreen ? '×' : '⛶' }}</span>
        </button>
        <button ref="closeButton" type="button" aria-label="关闭下钻" title="关闭下钻" @click="emit('close')">
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </header>

    <div v-if="renderModel" ref="workspaceElement" class="topology-drilldown__workspace">
      <svg
        ref="svgElement"
        viewBox="0 0 1000 500"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        :aria-label="`${props.content?.title ?? '下钻说明'}，可缩放并拖拽查看`"
        @pointercancel="handlePointerEnd"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerEnd"
        @wheel.prevent="handleWheel"
      >
        <defs>
          <marker id="drilldown-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="#38bdf8" />
          </marker>
          <pattern id="drilldown-grid" width="36" height="36" patternUnits="userSpaceOnUse">
            <path d="M 36 0 L 0 0 0 36" fill="none" stroke="rgba(56, 189, 248, 0.08)" stroke-width="1" />
          </pattern>
        </defs>
        <rect width="1000" height="500" fill="#03111d" />
        <rect width="1000" height="500" fill="url(#drilldown-grid)" />
        <g :transform="graphTransform">
          <!-- 视觉上只有两个网络层级；现场子节点和模型说明节点仅在同一现场层中分两行排布。 -->
          <rect x="12" y="16" width="976" height="150" rx="12" fill="rgba(34, 197, 94, 0.07)" stroke="rgba(34, 197, 94, 0.52)" stroke-dasharray="7 6" />
          <text x="30" y="46" class="topology-drilldown__layer-title">单元控制层</text>
          <rect x="12" y="176" width="976" height="310" rx="12" fill="rgba(251, 146, 60, 0.06)" stroke="rgba(251, 146, 60, 0.48)" stroke-dasharray="7 6" />
          <text x="30" y="207" class="topology-drilldown__layer-title topology-drilldown__layer-title--field">现场设备层</text>

          <g class="topology-drilldown__edges" aria-hidden="true">
            <line
              v-for="edge in renderModel.edges"
              :key="edge.instanceId"
              :x1="(instanceById.get(edge.fromInstanceId)?.x ?? 0) * 10"
              :y1="(instanceById.get(edge.fromInstanceId)?.y ?? 0) * 5 + 38"
              :x2="(instanceById.get(edge.toInstanceId)?.x ?? 0) * 10"
              :y2="(instanceById.get(edge.toInstanceId)?.y ?? 0) * 5 - 38"
              marker-end="url(#drilldown-arrow)"
            />
          </g>

          <foreignObject
            v-for="instance in renderModel.instances"
            :key="instance.instanceId"
            :x="instance.x * 10 - 92"
            :y="instance.y * 5 - 40"
            width="184"
            height="84"
          >
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              :class="[
                'topology-drilldown__node',
                `topology-drilldown__node--${instance.kind}`,
                { 'topology-drilldown__node--duplicate': instance.duplicate },
              ]"
              role="group"
              tabindex="0"
              :aria-label="`${instance.title}，状态：${activeTooltipStatus}`"
              :aria-describedby="activeTooltipInstance?.instanceId === instance.instanceId ? drilldownTooltipId : undefined"
              :data-semantic-node-id="instance.semanticNodeId"
              :data-render-instance-id="instance.instanceId"
              @pointerenter="showNodeTooltip(instance.instanceId, $event)"
              @pointermove="handleNodePointerMove(instance.instanceId, $event)"
              @pointerleave="clearNodeTooltip"
              @focus="showNodeTooltip(instance.instanceId)"
              @blur="clearNodeTooltip"
            >
              <!-- 下钻节点与总览保持同一视觉语言：正式受控图标位于上方，名称位于图标下方。 -->
              <img
                class="topology-drilldown__node-icon"
                :src="getTopologyIconUrl(instance.iconKey, 'normal')"
                :alt="`${instance.title}图标`"
                draggable="false"
              />
              <strong>{{ instance.title }}</strong>
            </div>
          </foreignObject>
        </g>
      </svg>

      <!-- 与总览拓扑共用单实例提示格式：只显示节点标题和当前状态，不展示关联类型等说明文本。 -->
      <div
        v-if="activeTooltipInstance"
        :id="drilldownTooltipId"
        :class="['topology-drilldown__tooltip', { 'topology-drilldown__tooltip--keyboard': tooltipUsesKeyboardPosition }]"
        :style="tooltipStyle"
        role="tooltip"
        aria-live="polite"
      >
        <strong>{{ activeTooltipInstance.title }}</strong>
        <span>状态：{{ activeTooltipStatus }}</span>
      </div>

      <div class="topology-drilldown__toolbar" aria-label="下钻说明图缩放控制">
        <button type="button" aria-label="缩小下钻说明图" :disabled="viewSnapshot.zoom <= 0.7" @click="changeZoom(-0.15)">−</button>
        <output aria-label="当前下钻说明图缩放比例">{{ Math.round(viewSnapshot.zoom * 100) }}%</output>
        <button type="button" aria-label="放大下钻说明图" :disabled="viewSnapshot.zoom >= 2.25" @click="changeZoom(0.15)">+</button>
        <button type="button" @click="resetView">重置</button>
      </div>
    </div>

    <div v-else class="topology-drilldown__empty" role="status">
      <strong>无法显示下钻内容</strong>
      <span>{{ props.errorMessage ?? '下钻内容为空，请联系维护人员核对正式资源。' }}</span>
    </div>
  </section>
</template>

<style scoped>
.topology-drilldown {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: grid;
  min-inline-size: 0;
  min-block-size: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  padding: var(--space-4);
  box-sizing: border-box;
  overflow: hidden;
  border-radius: inherit;
  color: #e2f7ff;
  background: #03111d;
  box-shadow: inset 0 0 42px rgba(8, 145, 178, 0.18);
}

.topology-drilldown__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.topology-drilldown__header p,
.topology-drilldown__header h2 {
  margin: 0;
}

.topology-drilldown__header p {
  color: #67e8f9;
  font-size: 0.75rem;
}

.topology-drilldown__header h2 {
  margin-block-start: 4px;
  font-size: 1rem;
}

.topology-drilldown__actions,
.topology-drilldown__toolbar {
  display: flex;
  align-items: center;
  gap: 5px;
}

.topology-drilldown button,
.topology-drilldown output {
  min-inline-size: 30px;
  min-block-size: 30px;
  border: 1px solid rgba(103, 232, 249, 0.44);
  border-radius: 5px;
  color: #d9f8ff;
  background: rgba(8, 47, 73, 0.8);
  font: 600 12px/1 Microsoft YaHei, sans-serif;
}

.topology-drilldown button {
  cursor: pointer;
}

.topology-drilldown button:hover:not(:disabled),
.topology-drilldown button:focus-visible {
  border-color: #67e8f9;
  background: rgba(8, 145, 178, 0.52);
}

.topology-drilldown button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.topology-drilldown__workspace {
  position: relative;
  min-block-size: 0;
  overflow: hidden;
  border: 1px solid rgba(34, 211, 238, 0.38);
  border-radius: 8px;
  background: #03111d;
}

/* 下钻提示沿用总览的深色单实例提示层，避免为每个说明节点创建独立浮层。 */
.topology-drilldown__tooltip {
  position: absolute;
  z-index: 5;
  display: grid;
  max-inline-size: min(260px, calc(100% - 24px));
  gap: 3px;
  padding: 7px 9px;
  border: 1px solid rgba(103, 232, 249, 0.72);
  border-radius: 6px;
  color: #e2f7ff;
  font: 500 11px/1.35 Microsoft YaHei, sans-serif;
  background: rgba(3, 17, 29, 0.96);
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.42);
  pointer-events: none;
  transform: translate(10px, calc(-100% - 10px));
}

.topology-drilldown__tooltip strong {
  font-size: 12px;
}

.topology-drilldown__tooltip span {
  color: #9dd8e5;
}

.topology-drilldown__tooltip--keyboard {
  inset-block-start: 10px;
  inset-inline-start: 50%;
  transform: translateX(-50%);
}

.topology-drilldown__workspace svg {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  min-block-size: 0;
  cursor: grab;
  touch-action: none;
}

.topology-drilldown__workspace svg:active {
  cursor: grabbing;
}

.topology-drilldown__layer-title {
  fill: #4ade80;
  font: 700 17px Microsoft YaHei, sans-serif;
}

.topology-drilldown__layer-title--field {
  fill: #fb923c;
}

.topology-drilldown__edges line {
  stroke: #38bdf8;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.topology-drilldown__node {
  display: grid;
  inline-size: 100%;
  block-size: 100%;
  box-sizing: border-box;
  place-content: center;
  grid-template-rows: 48px auto;
  gap: 3px;
  padding: 3px 6px;
  border: 0;
  border-radius: 0;
  color: #e2e8f0;
  background: transparent;
  text-align: center;
  pointer-events: auto;
  outline: none;
}

.topology-drilldown__node:focus-visible {
  outline: 2px solid #67e8f9;
  outline-offset: 3px;
  border-radius: 6px;
}

.topology-drilldown__node-icon {
  inline-size: 48px;
  block-size: 48px;
  justify-self: center;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}

.topology-drilldown__node strong {
  overflow: hidden;
  font: 700 13px/1.25 Microsoft YaHei, sans-serif;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topology-drilldown__node--source {
  color: #ecfdf5;
  filter: drop-shadow(0 0 8px rgba(34, 197, 94, 0.32));
}

.topology-drilldown__node--logic {
  color: #e0f2fe;
}

.topology-drilldown__node--boundary {
  color: #ffedd5;
}

.topology-drilldown__node--duplicate {
  border-style: dashed;
}

.topology-drilldown__toolbar {
  position: absolute;
  z-index: 4;
  inset-inline-end: 10px;
  inset-block-end: 10px;
  padding: 4px;
  border: 1px solid rgba(34, 211, 238, 0.5);
  border-radius: 6px;
  background: rgba(3, 17, 29, 0.9);
}

.topology-drilldown__toolbar output {
  display: grid;
  min-inline-size: 44px;
  place-items: center;
  border: 0;
  background: transparent;
  color: #67e8f9;
}

.topology-drilldown__empty {
  display: grid;
  place-content: center;
  gap: 8px;
  min-block-size: 0;
  border: 1px dashed rgba(148, 163, 184, 0.5);
  border-radius: 8px;
  color: #94a3b8;
  text-align: center;
}

.topology-drilldown__empty strong {
  color: #e2e8f0;
}

@media (width < 620px) {
  .topology-drilldown {
    padding: 10px;
  }

  .topology-drilldown__header h2 {
    max-inline-size: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>

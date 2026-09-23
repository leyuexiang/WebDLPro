<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue'
import type { TopologyDrilldownContent } from '@/config/scene-topology/types'
import {
  createTopologyDrilldownRenderModel,
  TopologyDrilldownViewState,
  type TopologyDrilldownViewSnapshot,
} from '@/modules/visual/drilldown/topology-drilldown-view-state'

const props = defineProps<{
  content?: TopologyDrilldownContent
  errorMessage?: string
  fullscreen: boolean
}>()

const emit = defineEmits<{
  close: []
  toggleFullscreen: []
}>()

/** Vue（渐进式网页框架）提供的实例标识稳定关联标题与对话框，不引入随机值影响视觉回归。 */
const titleId = `topology-drilldown-title-${useId()}`
const closeButton = ref<HTMLButtonElement | null>(null)
const svgElement = ref<SVGSVGElement | null>(null)
const viewStateController = new TopologyDrilldownViewState()
const viewSnapshot = ref<TopologyDrilldownViewSnapshot>(viewStateController.getSnapshot())
const renderModel = computed(() => props.content ? createTopologyDrilldownRenderModel(props.content) : undefined)
const instanceById = computed(() => new Map(renderModel.value?.instances.map((instance) => [instance.instanceId, instance] as const) ?? []))
const graphTransform = computed(() => {
  const { zoom, offsetX, offsetY } = viewSnapshot.value
  return `translate(${offsetX} ${offsetY}) translate(500 250) scale(${zoom}) translate(-500 -250)`
})

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

function handleWheel(event: WheelEvent): void {
  changeZoom(event.deltaY > 0 ? -0.15 : 0.15)
}

/** 说明图平移使用自身指针捕获；事件在覆盖层终止，不会落入原画布选择或三维聚焦链路。 */
function handlePointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !svgElement.value) return
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

/** 组件释放时丢弃局部指针标识；没有悬浮提示、全局监听器、动画帧或第二个 Canvas 需要保留。 */
onBeforeUnmount(() => {
  panningPointerId = undefined
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

    <div v-if="renderModel" class="topology-drilldown__workspace">
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
              :y1="(instanceById.get(edge.fromInstanceId)?.y ?? 0) * 5 + 28"
              :x2="(instanceById.get(edge.toInstanceId)?.x ?? 0) * 10"
              :y2="(instanceById.get(edge.toInstanceId)?.y ?? 0) * 5 - 28"
              marker-end="url(#drilldown-arrow)"
            />
          </g>

          <foreignObject
            v-for="instance in renderModel.instances"
            :key="instance.instanceId"
            :x="instance.x * 10 - 92"
            :y="instance.y * 5 - 30"
            width="184"
            height="66"
          >
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              :class="[
                'topology-drilldown__node',
                `topology-drilldown__node--${instance.kind}`,
                { 'topology-drilldown__node--duplicate': instance.duplicate },
              ]"
              :data-semantic-node-id="instance.semanticNodeId"
              :data-render-instance-id="instance.instanceId"
            >
              <!-- 节点卡片只展示正式业务标题；不绑定悬浮提示事件，避免鼠标经过时遮挡关联关系。 -->
              <strong>{{ instance.title }}</strong>
            </div>
          </foreignObject>
        </g>
      </svg>

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
  padding: 7px 10px;
  border: 1px solid rgba(148, 163, 184, 0.8);
  border-radius: 8px;
  color: #e2e8f0;
  background: rgba(15, 23, 42, 0.96);
  text-align: center;
  pointer-events: auto;
}

.topology-drilldown__node strong {
  overflow: hidden;
  font: 700 13px/1.25 Microsoft YaHei, sans-serif;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topology-drilldown__node--source {
  border-color: #4ade80;
  color: #ecfdf5;
  background: rgba(20, 83, 45, 0.9);
  box-shadow: 0 0 18px rgba(34, 197, 94, 0.18);
}

.topology-drilldown__node--logic {
  border-color: #67e8f9;
}

.topology-drilldown__node--boundary {
  border-color: #fb923c;
  background: rgba(67, 38, 20, 0.94);
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

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition, TopologyDeviceStatus } from '@/config/process/types'
import TopologyCanvas from '@/modules/visual/components/TopologyCanvas.vue'
import CoalTopologyRuntimeCanvas from '@/modules/visual/topology-preview/CoalTopologyRuntimeCanvas.vue'
import GasV3TopologyRuntimeCanvas from '@/modules/visual/topology-preview/GasV3TopologyRuntimeCanvas.vue'
import { createTopologyPanelPresentation } from '@/modules/visual/components/topology-panel-presentation'
import type { TopologyCanvasController } from '@/modules/visual/components/topology-canvas-controller'
import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'

const props = defineProps<{
  topology: TopologyDefinition
  selectedNodeIds: readonly ProcessNodeId[]
  selectedRouteIds: readonly RouteId[]
  /**
   * 平台总览隐藏态为 true。此时保留唯一二维画布实例，只暂停输入、尺寸观察和重绘；
   * 业务层与第三层关键环节均保持双区布局，并在同一实例上切换拓扑数据上下文。
   */
  suspended?: boolean
  /** 状态快照是独立运行时数据，不会改写当前拓扑定义或触发画布路径重建。 */
  nodeStatuses?: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>
}>()

const emit = defineEmits<{
  selectNode: [nodeId: ProcessNodeId]
  /** 面板只透传空白取消意图，不在展示层自行修改选择快照。 */
  clearSelection: []
  /** 双击只转发稳定二维节点标识；正式设备事件由上层运行时按清单明确映射。 */
  doubleClickNode: [nodeId: ProcessNodeId]
}>()

const topologyCanvas = ref<TopologyCanvasController | null>(null)

/**
 * 最新 JSON 组态图接管燃气、燃煤两个“总览”拓扑；两类场景均已下线流程子图。新版燃煤
 * 明确不需要子拓扑，因而只能精确匹配 `topology.coal-power.overview`，不得依据标题、
 * sceneId（场景标识）或节点数量泛化替换任何过滤视图。两种画布都继续复用同一控制器、
 * 状态快照和事件协议，不会改变原有的 Unity（三维引擎）协调链路。
 */
const usesLatestJsonOverviewCanvas = computed(() => {
  const topologyKey = String(props.topology.topologyKey)
  return topologyKey === 'topology.gas-power.overview' || topologyKey === 'topology.coal-power.overview'
})

/** 该开关只在已确认的燃煤总览键成立，防止其他场景意外创建燃煤 JSON 运行时画布。 */
const usesLatestCoalOverviewCanvas = computed(() => String(props.topology.topologyKey) === 'topology.coal-power.overview')

/**
 * 拓扑切换时 Vue（渐进式网页框架）会在下一渲染批次替换实际画布组件，而运行时会在同一同步事务内
 * 连续调用 setTopology、restoreViewState 和 setSelection。稳定代理先缓存最新命令，再在新画布挂载后
 * 一次性补发，防止命令误落到即将卸载的旧画布或丢失三维反向选择。
 */
let pendingControllerTopology = props.topology
let pendingControllerNodeIds: readonly ProcessNodeId[] = props.selectedNodeIds
let pendingControllerRouteIds: readonly RouteId[] = props.selectedRouteIds
let pendingControllerStatuses: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus> = props.nodeStatuses ?? new Map()
let pendingControllerViewState: ReturnType<TopologyCanvasController['getViewState']>
let pendingControllerDataContext: TopologyDataContext | undefined
let canvasControllerDisposed = false
let canvasControllerSuspended = Boolean(props.suspended)

const stableCanvasController: TopologyCanvasController = Object.freeze({
  setTopology(topology: TopologyDefinition) {
    pendingControllerTopology = topology
    // 新拓扑没有视图快照时不能继承上一拓扑的平移与缩放；运行时若有快照会紧接着重新写入。
    pendingControllerViewState = undefined
    if (!canvasControllerSuspended) topologyCanvas.value?.setTopology(topology)
  },
  setSelection(nodeIds: readonly ProcessNodeId[], routeIds: readonly RouteId[]) {
    pendingControllerNodeIds = nodeIds
    pendingControllerRouteIds = routeIds
    if (!canvasControllerSuspended) topologyCanvas.value?.setSelection(nodeIds, routeIds)
  },
  setTopologyDataContext(context: TopologyDataContext | undefined) {
    pendingControllerDataContext = context
    if (!canvasControllerSuspended) topologyCanvas.value?.setTopologyDataContext?.(context)
  },
  setNodeStatuses(statuses: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>) {
    pendingControllerStatuses = statuses
    if (!canvasControllerSuspended) topologyCanvas.value?.setNodeStatuses(statuses)
  },
  getViewState() {
    return topologyCanvas.value?.getViewState() ?? pendingControllerViewState
  },
  restoreViewState(state: ReturnType<TopologyCanvasController['getViewState']> extends infer ViewState
    ? Exclude<ViewState, undefined>
    : never) {
    pendingControllerViewState = state
    if (!canvasControllerSuspended) topologyCanvas.value?.restoreViewState(state)
  },
  resetView() {
    // 显式重置会废弃旧视口快照，避免后续恢复或画布实现替换时再次回放已经失效的位置。
    pendingControllerViewState = undefined
    if (!canvasControllerSuspended) topologyCanvas.value?.resetView()
  },
  setSuspended(suspended: boolean) {
    if (canvasControllerDisposed || canvasControllerSuspended === suspended) return
    canvasControllerSuspended = suspended
    const controller = topologyCanvas.value
    if (!controller) return

    controller.setSuspended(suspended)
    if (suspended) return

    // 暂停期间只保留每类数据的最新快照；恢复时按固定顺序一次补发，避免触发重复布局。
    controller.setTopology(pendingControllerTopology)
    controller.setTopologyDataContext?.(pendingControllerDataContext)
    controller.setNodeStatuses(pendingControllerStatuses)
    controller.setSelection(pendingControllerNodeIds, pendingControllerRouteIds)
    if (pendingControllerViewState) controller.restoreViewState(pendingControllerViewState)
    // 每次从全屏三维重新显示第二层拓扑，都以当前容器尺寸完整适配并居中；只重置视口，不重建画布。
    pendingControllerViewState = undefined
    controller.resetView()
  },
  dispose() {
    if (canvasControllerDisposed) return
    canvasControllerDisposed = true
    topologyCanvas.value?.dispose()
  },
})

/**
 * 组合根只能取得当前已挂载画布的受控端口，不能越过面板创建第二个 Canvas（画布）。
 * 空拓扑会保留同一个隐藏画布以避免切换时反复创建资源；调用方仍必须依据活动拓扑上下文判断是否可操作，
 * 不能因为端口存在就猜测存在业务节点、设备或三维映射。
 */
function getCanvasController(): TopologyCanvasController | undefined {
  return stableCanvasController
}

/** 仅暴露单画布端口；面板外观统一由公共满高布局管理，不向上层暴露文档对象模型元素。 */
defineExpose({ getCanvasController })

/** 展示模型只从当前拓扑计算，切换场景或拓扑时无需复制组件或维护燃气专用条件分支。 */
const presentation = computed(() => createTopologyPanelPresentation(props.topology))

/**
 * 公共重置入口只调用受控画布端口，不直接接触 Meta2D（网页二维组态引擎）或具体拓扑实现。
 * 因此燃气、燃煤和后续新增拓扑都复用同一套“适应画布并居中”逻辑；空态和暂停态不发无效命令。
 */
function resetTopologyView(): void {
  if (presentation.value.isEmpty || Boolean(props.suspended)) return
  stableCanvasController.resetView()
}

/** 画布实现发生替换后补发同一份运行时快照；每类数据只保留最新值，不累积历史命令。 */
watch(topologyCanvas, (controller) => {
  if (!controller || canvasControllerDisposed) return
  controller.setSuspended(canvasControllerSuspended)
  if (canvasControllerSuspended) return
  controller.setTopology(pendingControllerTopology)
  controller.setTopologyDataContext?.(pendingControllerDataContext)
  controller.setNodeStatuses(pendingControllerStatuses)
  controller.setSelection(pendingControllerNodeIds, pendingControllerRouteIds)
  if (pendingControllerViewState) controller.restoreViewState(pendingControllerViewState)
}, { flush: 'post' })

/**
 * 模式切换只改变现有控制器的运行许可，不参与画布组件选择，因此第三层往返不会触发卸载和重建。
 */
watch(() => props.suspended, (suspended) => {
  stableCanvasController.setSuspended(Boolean(suspended))
}, { immediate: true, flush: 'post' })

watch(() => props.nodeStatuses, (statuses) => {
  pendingControllerStatuses = statuses ?? new Map()
})

</script>

<template>
  <section class="topology-panel" :aria-label="presentation.title">
    <!-- 公共层统一提供视图重置按钮，避免每个拓扑包装组件重复实现或遗漏该能力。 -->
    <button
      type="button"
      class="topology-panel__reset"
      :disabled="presentation.isEmpty || Boolean(props.suspended)"
      aria-label="重置拓扑图位置"
      title="重置拓扑图位置"
      @click="resetTopologyView"
    >
      重置
    </button>
    <div class="topology-panel__content">
    <!--
      公共面板默认只承载画布；唯一通用操作是上方的视图重置按钮，不为具体业务拓扑复制操作栏。
      因此当前燃气、燃煤以及后续接入的拓扑都会自动占满面板高度。
    -->
    <CoalTopologyRuntimeCanvas
      v-if="usesLatestCoalOverviewCanvas"
      ref="topologyCanvas"
      :topology="props.topology"
      :selected-node-ids="props.selectedNodeIds"
      :selected-route-ids="props.selectedRouteIds"
      :node-statuses="props.nodeStatuses"
      @select-node="emit('selectNode', $event)"
      @clear-selection="emit('clearSelection')"
      @double-click-node="emit('doubleClickNode', $event)"
    />
    <GasV3TopologyRuntimeCanvas
      v-else-if="usesLatestJsonOverviewCanvas"
      ref="topologyCanvas"
      :topology="props.topology"
      :selected-node-ids="props.selectedNodeIds"
      :selected-route-ids="props.selectedRouteIds"
      :node-statuses="props.nodeStatuses"
      @select-node="emit('selectNode', $event)"
      @clear-selection="emit('clearSelection')"
      @double-click-node="emit('doubleClickNode', $event)"
    />
    <TopologyCanvas
      v-else
      ref="topologyCanvas"
      v-show="!presentation.isEmpty"
      :topology="props.topology"
      :selected-node-ids="props.selectedNodeIds"
      :selected-route-ids="props.selectedRouteIds"
      :node-statuses="props.nodeStatuses"
      @select-node="emit('selectNode', $event)"
      @clear-selection="emit('clearSelection')"
      @double-click-node="emit('doubleClickNode', $event)"
    />
    <!-- 空态提示与隐藏的唯一预备画布独立渲染：保留实例避免切换时重建资源，提示仍准确说明尚无已激活拓扑。 -->
    <p v-if="presentation.isEmpty" class="topology-panel__empty">{{ presentation.emptyMessage }}</p>
    </div>
  </section>
</template>

<style scoped>
.topology-panel {
  position: relative;
  min-block-size: 0;
  overflow: hidden;
  padding: var(--space-4);
  border: 1px solid #0e7490;
  border-radius: var(--radius-md);
  background:
    linear-gradient(135deg, rgba(8, 47, 73, 0.96), rgba(3, 17, 29, 0.98)),
    #03111d;
  box-shadow: 0 12px 28px rgba(2, 8, 23, 0.2);
  color: #e2f7ff;
}

/* 原拓扑内容与覆盖层是同一相对定位面板内的兄弟节点；inert 只施加在本容器，覆盖层仍可聚焦。 */
.topology-panel__content {
  display: grid;
  min-block-size: 0;
  block-size: 100%;
  /* 单一弹性轨道是所有拓扑的默认值，未来画布接入后无需再声明专用满高修饰类。 */
  grid-template-rows: minmax(0, 1fr);
  gap: 0;
}

/*
 * 按钮悬浮在画布右上角并避开各拓扑自己的全屏按钮；它不参与网格排版，
 * 所以不会为后续拓扑增加标题行或挤压画布的可用高度。
 */
.topology-panel__reset {
  position: absolute;
  z-index: 23;
  inset-block-start: calc(var(--space-4) + 8px);
  inset-inline-end: calc(var(--space-4) + 48px);
  min-inline-size: 46px;
  min-block-size: 32px;
  padding: 0 9px;
  border: 1px solid rgba(103, 232, 249, 0.44);
  border-radius: 5px;
  background: rgba(8, 47, 73, 0.86);
  color: #bff7ff;
  font: 600 12px/1 "Microsoft YaHei", sans-serif;
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
}

.topology-panel__reset:hover:not(:disabled),
.topology-panel__reset:focus-visible {
  border-color: #67e8f9;
  background: rgba(8, 145, 178, 0.8);
  color: #ffffff;
}

.topology-panel__reset:focus-visible {
  outline: 2px solid rgba(103, 232, 249, 0.55);
  outline-offset: 2px;
}

.topology-panel__reset:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.topology-panel__empty {
  display: grid;
  min-block-size: 260px;
  place-items: center;
  padding: var(--space-6);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  line-height: 1.65;
  text-align: center;
  margin: 0;
}
</style>

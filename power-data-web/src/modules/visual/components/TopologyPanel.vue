<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition, TopologyDeviceStatus } from '@/config/process/types'
import TopologyCanvas from '@/modules/visual/components/TopologyCanvas.vue'
import CoalTopologyRuntimeCanvas from '@/modules/visual/topology-preview/CoalTopologyRuntimeCanvas.vue'
import GasTopologyRuntimeCanvas from '@/modules/visual/topology-preview/GasTopologyRuntimeCanvas.vue'
import { createTopologyPanelPresentation } from '@/modules/visual/components/topology-panel-presentation'
import type { TopologyCanvasController } from '@/modules/visual/components/topology-canvas-controller'

const props = defineProps<{
  topology: TopologyDefinition
  selectedNodeIds: readonly ProcessNodeId[]
  selectedRouteIds: readonly RouteId[]
  /**
   * 第三层关键环节稳定态为 true。此时保留唯一二维画布实例，只暂停输入、尺寸观察和重绘；
   * 返回第二层后在同一实例上恢复已保存的拓扑、视口与选择。
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

const panelElement = ref<HTMLElement | null>(null)
const isFullscreen = ref(false)
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

/** 仅暴露单画布端口；全屏状态和 DOM（文档对象模型）元素继续由面板内部管理。 */
defineExpose({ getCanvasController })

/** 展示模型只从当前拓扑计算，切换场景或拓扑时无需复制组件或维护燃气专用条件分支。 */
const presentation = computed(() => createTopologyPanelPresentation(props.topology))

/** 画布实现发生替换后补发同一份运行时快照；每类数据只保留最新值，不累积历史命令。 */
watch(topologyCanvas, (controller) => {
  if (!controller || canvasControllerDisposed) return
  controller.setSuspended(canvasControllerSuspended)
  if (canvasControllerSuspended) return
  controller.setTopology(pendingControllerTopology)
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

/**
 * 全屏状态只以浏览器实际登记的全屏元素为准，不能在点击后直接反转本地布尔值。
 * 平台通过 iframe（内嵌框架）承载本应用时，只要父 iframe 声明 fullscreen（全屏）权限，
 * 当前面板就会与三维容器一样越过平台内容区进入浏览器原生全屏；按 Esc、浏览器拒绝请求
 * 或其他元素接管全屏时，按钮名称和画布尺寸都会跟随 fullscreenchange（全屏变化）恢复。
 */
function synchronizeFullscreenState(): void {
  isFullscreen.value = document.fullscreenElement === panelElement.value
}

/**
 * 请求当前拓扑面板进入浏览器原生全屏，并始终复用已挂载的唯一画布实例。
 * 请求失败时不伪造全屏状态，也不重建拓扑、清空选择或改变三维运行时；用户可继续使用常规布局。
 */
async function toggleFullscreen(): Promise<void> {
  const panel = panelElement.value
  if (!panel) return

  try {
    if (document.fullscreenElement === panel) {
      await document.exitFullscreen()
      return
    }

    await panel.requestFullscreen()
  } catch {
    // 权限策略或浏览器窗口状态可能拒绝原生全屏；重新读取真实状态，禁止显示虚假的退出按钮。
    synchronizeFullscreenState()
  }
}

/**
 * 工具栏重置与自动恢复使用同一受控端口，确保普通 Canvas 和两种 Meta2D 画布行为一致。
 * 空态和暂停态不执行命令，防止隐藏画布在尺寸为零时产生无效视口。
 */
function resetTopologyView(): void {
  if (presentation.value.isEmpty || canvasControllerSuspended) return
  stableCanvasController.resetView()
}

/** 监听浏览器原生全屏状态；组件卸载后立即移除，避免多拓扑切换累积监听器。 */
onMounted(() => {
  document.addEventListener('fullscreenchange', synchronizeFullscreenState)
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', synchronizeFullscreenState)
})
</script>

<template>
  <section ref="panelElement" :class="['topology-panel', { 'topology-panel--fullscreen': isFullscreen }]" :aria-label="presentation.title">
    <div class="topology-panel__content">
    <header class="topology-panel__header">
      <div>
        <p class="eyebrow">控制网络拓扑</p>
        <h2>{{ presentation.title }}</h2>
      </div>
      <div class="topology-panel__actions">
        <div v-if="presentation.legends.length > 0" class="topology-panel__legend" aria-label="当前拓扑连线图例">
          <span v-for="legend in presentation.legends" :key="legend.modifier">
            <i :class="['topology-panel__line', `topology-panel__line--${legend.modifier}`]" />{{ legend.label }}
          </span>
        </div>
        <button
          type="button"
          class="topology-panel__action-button topology-panel__action-button--text"
          :disabled="presentation.isEmpty || Boolean(props.suspended)"
          aria-label="重置拓扑图位置"
          title="重置拓扑图位置"
          @click="resetTopologyView"
        >
          重置
        </button>
        <!-- 常规态显示放大图标；全屏态改为关闭图标，减少用户寻找退出入口的成本。 -->
        <button
          type="button"
          class="topology-panel__action-button"
          :aria-label="isFullscreen ? '退出拓扑图全屏展示' : '全屏展示拓扑图'"
          :aria-pressed="isFullscreen"
          :title="isFullscreen ? '退出全屏' : '全屏展示'"
          @click="void toggleFullscreen()"
        >
          <span aria-hidden="true">{{ isFullscreen ? '×' : '⛶' }}</span>
        </button>
      </div>
    </header>
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
    <GasTopologyRuntimeCanvas
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
      :fullscreen="isFullscreen"
      @select-node="emit('selectNode', $event)"
      @clear-selection="emit('clearSelection')"
      @double-click-node="emit('doubleClickNode', $event)"
    />
    <!-- 空态提示与隐藏的唯一预备画布独立渲染：保留实例避免切换时重建资源，提示仍准确说明尚无已激活拓扑。 -->
    <p v-if="presentation.isEmpty" class="topology-panel__empty">{{ presentation.emptyMessage }}</p>
    <!-- 与参考原型一致，提供键盘退出提示；按钮本身始终保留为可见的关闭入口。 -->
    <p v-if="isFullscreen" class="topology-panel__fullscreen-hint" role="status">按 Esc 键退出全屏</p>
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
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--space-3);
}

.topology-panel__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--space-3);
}

.topology-panel__header > div:first-child {
  min-inline-size: 0;
}

.topology-panel__actions {
  display: flex;
  align-items: start;
  flex-wrap: wrap;
  justify-content: end;
  gap: var(--space-2);
}

.topology-panel__header h2,
.topology-panel__header p,
.topology-panel__empty {
  margin: 0;
}

.topology-panel__header h2 {
  margin-block-start: var(--space-1);
  font-size: 1rem;
}

.topology-panel__header .eyebrow {
  color: #67e8f9;
}

.topology-panel__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: end;
  color: #b7d9e8;
  font-size: 0.75rem;
}

.topology-panel__action-button {
  display: inline-grid;
  flex: 0 0 auto;
  inline-size: 30px;
  block-size: 30px;
  place-items: center;
  border: 1px solid rgba(103, 232, 249, 0.44);
  border-radius: 5px;
  background: rgba(8, 47, 73, 0.56);
  color: #bff7ff;
  font-size: 1rem;
  line-height: 1;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
}

.topology-panel__action-button:hover:not(:disabled),
.topology-panel__action-button:focus-visible {
  border-color: #67e8f9;
  background: rgba(8, 145, 178, 0.42);
  color: #ffffff;
}

.topology-panel__action-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

/* 重置按钮保留可见文字，避免只靠图标或悬浮提示表达关键恢复能力。 */
.topology-panel__action-button--text {
  inline-size: auto;
  min-inline-size: 46px;
  padding-inline: 9px;
  font-size: 0.75rem;
}

.topology-panel__legend span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.topology-panel__line {
  inline-size: 18px;
  border-block-start: 2px solid #22d3ee;
}

.topology-panel__line--pending {
  border-block-start-style: dashed;
  border-color: #f59e0b;
}

.topology-panel__line--conceptual {
  border-block-start-style: dashed;
  border-color: #64748b;
}

/* 新原子清单未声明连线证据时使用中性虚线，不借用旧燃气的“已确认”视觉语义。 */
.topology-panel__line--unclassified {
  border-block-start-style: dashed;
  border-color: #94a3b8;
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
}

/*
 * 浏览器原生全屏元素直接占满物理屏幕可用区域，与三维容器使用相同机制。
 * 不再使用 fixed（固定定位）遮罩，因此嵌入平台后不会被限制在平台为 iframe 分配的内容尺寸内。
 */
.topology-panel--fullscreen {
  position: relative;
  inline-size: 100%;
  block-size: 100%;
  min-inline-size: 0;
  min-block-size: 0;
  box-sizing: border-box;
  overflow: hidden;
  padding: clamp(12px, 1.5vw, 22px);
  border: 0;
  border-radius: 0;
  background: #03111d;
  box-shadow: none;
}

/* 全屏时画布接管面板最后一行；ResizeObserver 会在尺寸变更后重绘而不重建缓存。 */
.topology-panel--fullscreen :deep(.topology-canvas) {
  min-block-size: 0;
}

.topology-panel__fullscreen-hint {
  position: absolute;
  inset-block-start: 18px;
  inset-inline-end: 64px;
  margin: 0;
  padding: 5px 9px;
  border: 1px solid rgba(103, 232, 249, 0.28);
  border-radius: 5px;
  background: rgba(3, 17, 29, 0.78);
  color: #b7d9e8;
  font-size: 0.75rem;
  pointer-events: none;
}

@media (width < 620px) {
  .topology-panel__header {
    align-items: start;
    flex-direction: column;
  }

  .topology-panel__legend {
    justify-content: start;
  }

  .topology-panel__actions {
    inline-size: 100%;
    justify-content: space-between;
  }

  .topology-panel__fullscreen-hint {
    display: none;
  }
}
</style>

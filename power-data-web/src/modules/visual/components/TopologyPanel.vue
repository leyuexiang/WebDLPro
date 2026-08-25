<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition, TopologyDeviceStatus } from '@/config/process/types'
import type { TopologyDrilldownContent } from '@/config/scene-topology/types'
import type { TopologyDrilldownLookupResult } from '@/config/scene-topology/topology-drilldown-registry'
import TopologyCanvas from '@/modules/visual/components/TopologyCanvas.vue'
import { createTopologyPanelPresentation } from '@/modules/visual/components/topology-panel-presentation'
import type { TopologyCanvasController } from '@/modules/visual/components/topology-canvas-controller'
import {
  TopologyDrilldownCanvasViewSession,
  type TopologyDrilldownCloseReason,
} from '@/modules/visual/components/topology-drilldown-canvas-view-session'
import TopologyDrilldownOverlay from '@/modules/visual/drilldown/TopologyDrilldownOverlay.vue'

const props = defineProps<{
  topology: TopologyDefinition
  selectedNodeIds: readonly ProcessNodeId[]
  selectedRouteIds: readonly RouteId[]
  /** 状态快照是独立运行时数据，不会改写当前拓扑定义或触发画布路径重建。 */
  nodeStatuses?: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>
  /** 内容解析保持只读和常数时间；没有解析器时入口仍显示固定空态，不按标题生成内容。 */
  resolveDrilldownContent?: (contentKey: string, version: string) => TopologyDrilldownLookupResult
  /** 由壳层稳定上下文门禁控制；场景切换期间隐藏旧拓扑遗留的下钻入口。 */
  drilldownEnabled?: boolean
}>()

const emit = defineEmits<{
  selectNode: [nodeId: ProcessNodeId]
  /** 面板只透传空白取消意图，不在展示层自行修改选择快照。 */
  clearSelection: []
  /** 双击只转发稳定二维节点标识；正式设备事件由上层运行时按清单明确映射。 */
  doubleClickNode: [nodeId: ProcessNodeId]
}>()

const panelElement = ref<HTMLElement | null>(null)
const panelTitleElement = ref<HTMLHeadingElement | null>(null)
const isFullscreen = ref(false)
const topologyCanvas = ref<TopologyCanvasController | null>(null)
const drilldownOverlay = ref<InstanceType<typeof TopologyDrilldownOverlay> | null>(null)
/** 独立会话统一消费画布快照，确保同一旧快照不会被重复恢复或跨拓扑复用。 */
const canvasViewSession = new TopologyDrilldownCanvasViewSession()
const activeDrilldown = shallowRef<{
  content?: TopologyDrilldownContent
  errorMessage?: string
  /** 下钻提示沿用触发入口当前状态，子节点和模型说明节点不另造状态快照。 */
  sourceNodeId: ProcessNodeId
  triggerElement: HTMLButtonElement
} | null>(null)
/** 浏览器可能先发 fullscreenchange（全屏变化）再把同一次 Escape（退出键）交给文档，需短时去重。 */
let lastNativeFullscreenExitAt = Number.NEGATIVE_INFINITY
/** 从覆盖层进入原生全屏后，下一次退出键只负责退出全屏，不得同时关闭说明层。 */
let preserveOverlayForNextEscape = false

const isDrilldownOpen = computed(() => activeDrilldown.value !== null)
const activeDrilldownStatus = computed<TopologyDeviceStatus>(() => {
  const sourceNodeId = activeDrilldown.value?.sourceNodeId
  const sourceNode = sourceNodeId
    ? props.topology.nodes.find((node) => node.nodeId === sourceNodeId)
    : undefined
  // 说明节点没有正式设备状态；统一复用入口状态，缺失时回退到发布基线的离线状态。
  return sourceNodeId
    ? props.nodeStatuses?.get(sourceNodeId) ?? sourceNode?.deviceStatus ?? 'offline'
    : 'offline'
})

/**
 * 组合根只能取得当前已挂载画布的受控端口，不能越过面板创建第二个 Canvas（画布）。
 * 空拓扑会保留同一个隐藏画布以避免切换时反复创建资源；调用方仍必须依据活动拓扑上下文判断是否可操作，
 * 不能因为端口存在就猜测存在业务节点、设备或三维映射。
 */
function getCanvasController(): TopologyCanvasController | undefined {
  return topologyCanvas.value ?? undefined
}

/** 仅暴露单画布端口；全屏状态和 DOM（文档对象模型）元素继续由面板内部管理。 */
defineExpose({ getCanvasController })

/** 展示模型只从当前拓扑计算，切换场景或拓扑时无需复制组件或维护燃气专用条件分支。 */
const presentation = computed(() => createTopologyPanelPresentation(props.topology))

/**
 * 全屏状态只以浏览器实际登记的全屏元素为准，不能在点击后直接反转本地布尔值。
 * 平台通过 iframe（内嵌框架）承载本应用时，只要父 iframe 声明 fullscreen（全屏）权限，
 * 当前面板就会与三维容器一样越过平台内容区进入浏览器原生全屏；按 Esc、浏览器拒绝请求
 * 或其他元素接管全屏时，按钮名称和画布尺寸都会跟随 fullscreenchange（全屏变化）恢复。
 */
function synchronizeFullscreenState(): void {
  const wasFullscreen = isFullscreen.value
  isFullscreen.value = document.fullscreenElement === panelElement.value
  if (!wasFullscreen && isFullscreen.value && isDrilldownOpen.value) preserveOverlayForNextEscape = true
  if (wasFullscreen && !isFullscreen.value && isDrilldownOpen.value) {
    lastNativeFullscreenExitAt = globalThis.performance.now()
  }
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
      // 用户点击覆盖层自身的退出全屏按钮不需要保留下一次 Escape（退出键）。
      preserveOverlayForNextEscape = false
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
 * 打开前只保存一次正式画布视图快照；说明内容必须同时匹配当前节点、内容键和拓扑版本。
 * 所有失败都停留在局部固定空态，不替换正式拓扑、发送三维命令或触发外层事务。
 */
async function handleOpenDrilldown(nodeId: ProcessNodeId, contentKey: string, triggerElement: HTMLButtonElement): Promise<void> {
  const sourceNode = props.topology.nodes.find((node) => node.nodeId === nodeId)
  canvasViewSession.capture(props.topology.topologyKey, topologyCanvas.value?.getViewState())

  let content: TopologyDrilldownContent | undefined
  let errorMessage: string | undefined
  if (!sourceNode || sourceNode.drilldown?.contentKey !== contentKey) {
    errorMessage = '当前拓扑中不存在匹配的下钻入口。'
  } else if (!props.resolveDrilldownContent) {
    errorMessage = '下钻说明资源尚未加载。'
  } else {
    const result = props.resolveDrilldownContent(contentKey, props.topology.configVersion)
    if (result.status === 'missing') errorMessage = '下钻说明内容缺失。'
    else if (result.status === 'version-mismatch') errorMessage = '下钻说明内容版本与当前拓扑不一致。'
    else if (String(result.content.sourceNodeId) !== String(nodeId)) errorMessage = '下钻说明内容与当前入口不匹配。'
    else if (result.content.nodes.length === 0 || result.content.edges.length === 0) errorMessage = '下钻说明内容为空。'
    else content = result.content
  }

  activeDrilldown.value = { content, errorMessage, sourceNodeId: nodeId, triggerElement }
  await nextTick()
  drilldownOverlay.value?.focusInitial()
}

/**
 * 普通关闭恢复同一拓扑的画布数值快照；拓扑切换关闭只丢弃旧快照，不得覆盖新拓扑刚恢复的视图。
 * 全程不调用 prepare/activate（准备/激活）且不重建 Canvas（画布）；触发按钮消失时焦点回退到面板标题。
 */
async function closeDrilldown(reason: TopologyDrilldownCloseReason = 'regular-close', returnFocus = true): Promise<void> {
  const previous = activeDrilldown.value
  if (!previous) return
  activeDrilldown.value = null
  preserveOverlayForNextEscape = false
  // 在等待界面刷新前先消费快照；拓扑切换路径会在此处立即丢弃旧拓扑状态。
  const snapshot = canvasViewSession.finish(reason)
  await nextTick()
  // 普通关闭等待期间也可能发生拓扑切换，因此恢复前必须再次核对快照归属。
  if (snapshot?.topologyKey === props.topology.topologyKey) {
    topologyCanvas.value?.restoreViewState(snapshot.viewState)
  }
  if (!returnFocus) return
  if (previous.triggerElement.isConnected) previous.triggerElement.focus()
  else panelTitleElement.value?.focus()
}

/** 原生全屏中的第一次退出键交给浏览器退出全屏；常规态退出键只关闭局部覆盖层。 */
function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !isDrilldownOpen.value) return
  if (preserveOverlayForNextEscape) {
    preserveOverlayForNextEscape = false
    return
  }
  if (isFullscreen.value || document.fullscreenElement === panelElement.value) return
  // 同一次物理退出键不得同时退出原生全屏和关闭覆盖层；稍后的第二次退出键仍按正常关闭处理。
  if (globalThis.performance.now() - lastNativeFullscreenExitAt < 350) return
  event.preventDefault()
  void closeDrilldown()
}

/** 监听浏览器原生 Esc 与权限状态变化；组件卸载后立即移除，避免多拓扑切换累积监听器。 */
onMounted(() => {
  document.addEventListener('fullscreenchange', synchronizeFullscreenState)
  document.addEventListener('keydown', handleDocumentKeydown)
})

/** 切换拓扑时立即释放旧说明层；新拓扑必须由自身可见入口重新打开，禁止迟到内容恢复。 */
watch(() => props.topology.topologyKey, () => {
  if (isDrilldownOpen.value) void closeDrilldown('topology-change', false)
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', synchronizeFullscreenState)
  document.removeEventListener('keydown', handleDocumentKeydown)
  activeDrilldown.value = null
  canvasViewSession.clear()
})
</script>

<template>
  <section ref="panelElement" :class="['topology-panel', { 'topology-panel--fullscreen': isFullscreen }]" :aria-label="presentation.title">
    <div class="topology-panel__content" :inert="isDrilldownOpen" :aria-hidden="isDrilldownOpen ? 'true' : undefined">
    <header class="topology-panel__header">
      <div>
        <p class="eyebrow">控制网络拓扑</p>
        <h2 ref="panelTitleElement" tabindex="-1">{{ presentation.title }}</h2>
      </div>
      <div class="topology-panel__actions">
        <div v-if="presentation.legends.length > 0" class="topology-panel__legend" aria-label="当前拓扑连线图例">
          <span v-for="legend in presentation.legends" :key="legend.modifier">
            <i :class="['topology-panel__line', `topology-panel__line--${legend.modifier}`]" />{{ legend.label }}
          </span>
        </div>
        <!-- 常规态显示放大图标；全屏态改为关闭图标，减少用户寻找退出入口的成本。 -->
        <button
          type="button"
          class="topology-panel__fullscreen-button"
          :aria-label="isFullscreen ? '退出拓扑图全屏展示' : '全屏展示拓扑图'"
          :aria-pressed="isFullscreen"
          :title="isFullscreen ? '退出全屏' : '全屏展示'"
          @click="void toggleFullscreen()"
        >
          <span aria-hidden="true">{{ isFullscreen ? '×' : '⛶' }}</span>
        </button>
      </div>
    </header>
    <TopologyCanvas
      ref="topologyCanvas"
      v-show="!presentation.isEmpty"
      :topology="props.topology"
      :selected-node-ids="props.selectedNodeIds"
      :selected-route-ids="props.selectedRouteIds"
      :node-statuses="props.nodeStatuses"
      :fullscreen="isFullscreen"
      :drilldown-enabled="props.drilldownEnabled"
      @select-node="emit('selectNode', $event)"
      @clear-selection="emit('clearSelection')"
      @double-click-node="emit('doubleClickNode', $event)"
      @open-drilldown="handleOpenDrilldown"
    />
    <!-- 空态提示与隐藏的唯一预备画布独立渲染：保留实例避免切换时重建资源，提示仍准确说明尚无已激活拓扑。 -->
    <p v-if="presentation.isEmpty" class="topology-panel__empty">{{ presentation.emptyMessage }}</p>
    <!-- 与参考原型一致，提供键盘退出提示；按钮本身始终保留为可见的关闭入口。 -->
    <p v-if="isFullscreen" class="topology-panel__fullscreen-hint" role="status">按 Esc 键退出全屏</p>
    </div>
    <TopologyDrilldownOverlay
      v-if="activeDrilldown"
      ref="drilldownOverlay"
      :content="activeDrilldown.content"
      :error-message="activeDrilldown.errorMessage"
      :status="activeDrilldownStatus"
      :fullscreen="isFullscreen"
      @close="void closeDrilldown()"
      @toggle-fullscreen="void toggleFullscreen()"
    />
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

.topology-panel__fullscreen-button {
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

.topology-panel__fullscreen-button:hover,
.topology-panel__fullscreen-button:focus-visible {
  border-color: #67e8f9;
  background: rgba(8, 145, 178, 0.42);
  color: #ffffff;
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

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition } from '@/config/process/types'
import TopologyCanvas from '@/modules/visual/components/TopologyCanvas.vue'

const props = defineProps<{
  topology: TopologyDefinition
  selectedNodeIds: readonly ProcessNodeId[]
  selectedRouteIds: readonly RouteId[]
}>()

const emit = defineEmits<{
  selectNode: [nodeId: ProcessNodeId]
}>()

const isFullscreen = ref(false)

/** 采用参考原型的视口遮罩模式，全屏时保留现有画布实例、选中状态和缩放平移状态。 */
function toggleFullscreen(): void {
  isFullscreen.value = !isFullscreen.value
}

/** 仅在拓扑遮罩已打开时响应 Esc，避免干扰页面上其他组件的键盘交互。 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isFullscreen.value) isFullscreen.value = false
}

/** 键盘监听与组件生命周期绑定，路由切换后不遗留全局事件监听器。 */
onMounted(() => globalThis.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => globalThis.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <section :class="['topology-panel', { 'topology-panel--fullscreen': isFullscreen }]" aria-label="燃气发电控制网络拓扑">
    <header class="topology-panel__header">
      <div>
        <p class="eyebrow">控制网络拓扑</p>
        <h2>燃气发电分层通信关系</h2>
      </div>
      <div class="topology-panel__actions">
        <div class="topology-panel__legend" aria-label="拓扑图例">
          <span><i class="topology-panel__line topology-panel__line--verified" />已确认</span>
          <span><i class="topology-panel__line topology-panel__line--pending" />待确认</span>
          <span><i class="topology-panel__line topology-panel__line--conceptual" />概念连接</span>
        </div>
        <!-- 常规态显示放大图标；全屏态改为关闭图标，减少用户寻找退出入口的成本。 -->
        <button
          type="button"
          class="topology-panel__fullscreen-button"
          :aria-label="isFullscreen ? '退出拓扑图全屏展示' : '全屏展示拓扑图'"
          :aria-pressed="isFullscreen"
          :title="isFullscreen ? '退出全屏' : '全屏展示'"
          @click="toggleFullscreen"
        >
          <span aria-hidden="true">{{ isFullscreen ? '×' : '⛶' }}</span>
        </button>
      </div>
    </header>
    <!-- 实时状态契约尚未发布时明确提示，防止离线图元被误认为设备运行结论。 -->
    <p v-if="props.topology.nodes.length > 0" class="topology-panel__status">设备实时状态待接入，当前图元按离线状态展示；青色描边仅表示当前选择。</p>
    <TopologyCanvas
      v-if="props.topology.nodes.length > 0"
      :topology="props.topology"
      :selected-node-ids="props.selectedNodeIds"
      :selected-route-ids="props.selectedRouteIds"
      :fullscreen="isFullscreen"
      @select-node="emit('selectNode', $event)"
    />
    <p v-else class="topology-panel__empty">该页面的二维拓扑尚未发布，未尝试根据页面标题或资源名称推断结构。</p>
    <!-- 与参考原型一致，提供键盘退出提示；按钮本身始终保留为可见的关闭入口。 -->
    <p v-if="isFullscreen" class="topology-panel__fullscreen-hint" role="status">按 Esc 键退出全屏</p>
  </section>
</template>

<style scoped>
.topology-panel {
  display: grid;
  min-block-size: 0;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid #0e7490;
  border-radius: var(--radius-md);
  background:
    linear-gradient(135deg, rgba(8, 47, 73, 0.96), rgba(3, 17, 29, 0.98)),
    #03111d;
  box-shadow: 0 12px 28px rgba(2, 8, 23, 0.2);
  color: #e2f7ff;
}

.topology-panel__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--space-3);
}

.topology-panel__actions {
  display: flex;
  align-items: start;
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

.topology-panel__status {
  margin: 0;
  padding: 8px 10px;
  border-inline-start: 2px solid #94a3b8;
  background: rgba(15, 23, 42, 0.46);
  color: #b7d9e8;
  font-size: 0.75rem;
  line-height: 1.5;
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

/* 参考原型的全视口遮罩：不调用浏览器原生全屏，Esc 与关闭按钮均可稳定退出。 */
.topology-panel--fullscreen {
  position: fixed;
  inset: 12px;
  z-index: 1200;
  block-size: calc(100dvh - 24px);
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
  padding: clamp(12px, 1.5vw, 22px);
  border-color: rgba(34, 211, 238, 0.78);
  box-shadow: 0 0 0 100vmax rgba(2, 8, 23, 0.84), 0 18px 54px rgba(2, 8, 23, 0.8);
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

  .topology-panel--fullscreen {
    inset: 6px;
    block-size: calc(100dvh - 12px);
  }

  .topology-panel__fullscreen-hint {
    display: none;
  }
}
</style>

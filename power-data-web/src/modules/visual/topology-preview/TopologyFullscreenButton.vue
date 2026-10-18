<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  /** 原生全屏承载元素；传入拓扑根容器，保证筛选、提示和画布一起进入全屏。 */
  target: HTMLElement | null
  disabled?: boolean
}>()

const isFullscreen = ref(false)

/** 全屏状态以浏览器实际元素为准，兼容 Esc、系统手势和其他页面逻辑触发的退出。 */
function synchronizeFullscreenState(): void {
  isFullscreen.value = document.fullscreenElement === props.target
}

/** 请求或退出当前拓扑根容器的原生全屏；拒绝请求时保持页面可用并允许再次重试。 */
async function toggleFullscreen(): Promise<void> {
  const target = props.target
  if (!target || props.disabled) return

  try {
    if (document.fullscreenElement === target) await document.exitFullscreen()
    else await target.requestFullscreen()
  }
  catch {
    // 浏览器策略或嵌入环境可能禁止全屏，不让异常打断拓扑交互。
  }
  synchronizeFullscreenState()
}

onMounted(() => document.addEventListener('fullscreenchange', synchronizeFullscreenState))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', synchronizeFullscreenState))
</script>

<template>
  <!-- 公共全屏入口：由所有二维拓扑画布复用，统一右上角位置、键盘语义和退出行为。 -->
  <button
    type="button"
    class="topology-fullscreen-button"
    :disabled="props.disabled"
    :aria-label="isFullscreen ? '退出拓扑图全屏展示' : '全屏展示拓扑图'"
    :aria-pressed="isFullscreen"
    :title="isFullscreen ? '退出全屏' : '全屏展示'"
    @click="void toggleFullscreen()"
  >
    <span aria-hidden="true">{{ isFullscreen ? '×' : '⛶' }}</span>
  </button>
</template>

<style scoped>
/*
 * 与公共筛选条共用宽度并贴住画布物理右边界；正方形比例和原有图标比例保持不变。
 * 筛选入口以“顶部 8 像素 + 本按钮高度 + 间隔 8 像素”定位，无须查询或监听按钮尺寸。
 */
.topology-fullscreen-button {
  position: absolute;
  z-index: 22;
  inset-block-start: 8px;
  right: 0;
  display: grid;
  inline-size: var(--topology-control-inline-size);
  block-size: var(--topology-control-inline-size);
  place-items: center;
  padding: 0;
  border: 1px solid rgba(148, 163, 184, 0.65);
  border-radius: calc(var(--topology-control-inline-size) * 0.15625);
  background: rgba(16, 19, 27, 0.92);
  color: #d6deeb;
  font: calc(var(--topology-control-inline-size) * 0.625)/1 sans-serif;
  cursor: pointer;
}

.topology-fullscreen-button:hover:not(:disabled),
.topology-fullscreen-button:focus-visible {
  border-color: #67e8f9;
  color: #67e8f9;
}

.topology-fullscreen-button:focus-visible {
  outline: 2px solid rgba(103, 232, 249, 0.55);
  outline-offset: 2px;
}

.topology-fullscreen-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
</style>

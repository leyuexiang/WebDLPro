<script setup lang="ts">
/**
 * 可复用详情抽屉采用受控开关，由父页面保存当前选中业务对象。
 * 组件自身不缓存详情数据，因此切换或卸载时不会残留过期领域状态。
 */
defineProps<{
  open: boolean
  title: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

/** 关闭请求只向父组件同步状态，方便父组件统一处理焦点恢复和详情清理。 */
function close(): void {
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="base-detail-drawer" role="presentation" @click.self="close">
      <aside class="base-detail-drawer__panel" role="dialog" aria-modal="true" :aria-label="title">
        <header class="base-detail-drawer__header">
          <h2>{{ title }}</h2>
          <button type="button" class="base-detail-drawer__close" aria-label="关闭详情" @click="close">×</button>
        </header>
        <div class="base-detail-drawer__content"><slot /></div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.base-detail-drawer {
  display: flex;
  position: fixed;
  z-index: var(--z-drawer);
  inset: 0;
  justify-content: end;
  background: rgb(6 17 34 / 42%);
}

.base-detail-drawer__panel {
  display: grid;
  inline-size: min(100%, 480px);
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}

.base-detail-drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-block-end: 1px solid var(--color-border);
}

.base-detail-drawer__header h2 {
  margin: 0;
  font-size: 1.125rem;
}

.base-detail-drawer__close {
  inline-size: 32px;
  block-size: 32px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 1.5rem;
}

.base-detail-drawer__close:hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}

.base-detail-drawer__content {
  overflow: auto;
  padding: var(--space-5);
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app.store'

/**
 * 三类布局共用的顶栏，只负责标题、主题入口与导航收缩动作。
 * 它不读取或保存工艺页、图表、网页图形等领域运行时状态。
 */
const route = useRoute()
const appStore = useAppStore()
const pageTitle = computed(() => route.meta.title ?? '电力全流程平台')
</script>

<template>
  <header class="shell-header">
    <RouterLink class="shell-header__brand" to="/portal">电力全流程平台</RouterLink>
    <div class="shell-header__title">{{ pageTitle }}</div>
    <div class="shell-header__actions">
      <button type="button" class="shell-header__action" @click="appStore.toggleNavigation">
        {{ appStore.isNavigationCollapsed ? '展开导航' : '收起导航' }}
      </button>
      <button type="button" class="shell-header__action" @click="appStore.toggleTheme">
        切换{{ appStore.theme === 'light' ? '深色' : '浅色' }}主题
      </button>
    </div>
  </header>
</template>

<style scoped>
.shell-header {
  display: flex;
  position: relative;
  z-index: var(--z-navigation);
  align-items: center;
  min-block-size: 56px;
  gap: var(--space-5);
  padding: 0 var(--space-6);
  border-block-end: 1px solid var(--color-border);
  background: var(--color-surface);
}

.shell-header__brand {
  flex: 0 0 auto;
  color: var(--color-primary);
  font-weight: 800;
}

.shell-header__title {
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shell-header__actions {
  display: flex;
  gap: var(--space-2);
  margin-inline-start: auto;
}

.shell-header__action {
  min-block-size: 32px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
}

.shell-header__action:hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}

@media (width < 720px) {
  .shell-header {
    gap: var(--space-2);
    padding-inline: var(--space-3);
  }

  .shell-header__title {
    display: none;
  }

  .shell-header__action {
    font-size: 0.75rem;
  }
}
</style>

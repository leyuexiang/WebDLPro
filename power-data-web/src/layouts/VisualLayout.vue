<script setup lang="ts">
import PrimaryNavigation from '@/layouts/PrimaryNavigation.vue'
import ShellHeader from '@/layouts/ShellHeader.vue'
import { useAppStore } from '@/stores/app.store'

/**
 * 可视化布局为后续三栏工作台预留固定工作区。
 * 当前只装配导航与路由出口，不持有任何网页图形实例，单实例宿主将在任务 031 后接入。
 */
const appStore = useAppStore()
</script>

<template>
  <div class="visual-layout" :class="{ 'visual-layout--collapsed': appStore.isNavigationCollapsed }">
    <ShellHeader />
    <aside class="visual-layout__navigation">
      <PrimaryNavigation />
    </aside>
    <main class="visual-layout__content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.visual-layout {
  display: grid;
  min-block-size: 100dvh;
  grid-template-columns: 236px minmax(720px, 1fr);
  grid-template-rows: 56px minmax(0, 1fr);
  overflow: hidden;
}

.visual-layout--collapsed {
  grid-template-columns: 0 minmax(720px, 1fr);
}

.visual-layout :deep(.shell-header) {
  grid-column: 1 / -1;
}

.visual-layout__navigation {
  overflow-y: auto;
  padding: var(--space-4);
  border-inline-end: 1px solid var(--color-border);
  background: var(--color-surface);
}

.visual-layout__content {
  min-inline-size: 0;
  overflow: auto;
}

@media (width < 1440px) {
  .visual-layout {
    grid-template-columns: 208px minmax(0, 1fr);
  }

  .visual-layout--collapsed {
    grid-template-columns: 0 minmax(0, 1fr);
  }
}

@media (width < 1024px) {
  .visual-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .visual-layout__navigation {
    display: none;
  }
}
</style>

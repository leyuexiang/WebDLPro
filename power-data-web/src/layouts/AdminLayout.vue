<script setup lang="ts">
import PrimaryNavigation from '@/layouts/PrimaryNavigation.vue'
import ShellHeader from '@/layouts/ShellHeader.vue'
import { useAppStore } from '@/stores/app.store'

/** 后台布局包含一级导航与可滚动内容区，适用于采集、数据和系统管理模块。 */
const appStore = useAppStore()
</script>

<template>
  <div class="admin-layout" :class="{ 'admin-layout--collapsed': appStore.isNavigationCollapsed }">
    <ShellHeader />
    <aside class="admin-layout__navigation">
      <PrimaryNavigation />
    </aside>
    <main class="admin-layout__content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.admin-layout {
  display: grid;
  min-block-size: 100dvh;
  grid-template-columns: 236px minmax(0, 1fr);
  grid-template-rows: 56px minmax(0, 1fr);
}

.admin-layout--collapsed {
  grid-template-columns: 0 minmax(0, 1fr);
}

.admin-layout :deep(.shell-header) {
  grid-column: 1 / -1;
}

.admin-layout__navigation {
  overflow: hidden;
  padding: var(--space-4);
  border-inline-end: 1px solid var(--color-border);
  background: var(--color-surface);
}

.admin-layout__content {
  min-inline-size: 0;
  overflow: auto;
}

@media (width < 1280px) {
  .admin-layout {
    grid-template-columns: 208px minmax(0, 1fr);
  }

  .admin-layout--collapsed {
    grid-template-columns: 0 minmax(0, 1fr);
  }
}

@media (width < 1024px) {
  .admin-layout {
    grid-template-columns: 0 minmax(0, 1fr);
  }

  .admin-layout__navigation {
    display: none;
  }
}
</style>

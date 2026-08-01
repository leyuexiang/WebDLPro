<script setup lang="ts">
/**
 * 工艺工作台三栏骨架。
 * 左侧放配置驱动导航，中间承载场景与二维拓扑，右侧放导览与详情；窄屏时按阅读顺序降为单栏。
 */
</script>

<template>
  <div class="process-workbench-layout">
    <aside class="process-workbench-layout__left"><slot name="navigation" /></aside>
    <main class="process-workbench-layout__main"><slot name="main" /></main>
    <aside class="process-workbench-layout__right"><slot name="detail" /></aside>
  </div>
</template>

<style scoped>
.process-workbench-layout {
  display: grid;
  min-block-size: 0;
  grid-template-columns: 236px minmax(0, 1fr) 352px;
  gap: var(--space-4);
}

.process-workbench-layout__left,
.process-workbench-layout__main,
.process-workbench-layout__right {
  min-inline-size: 0;
  min-block-size: 0;
}

.process-workbench-layout__main {
  display: grid;
  align-content: start;
  gap: var(--space-4);
}

.process-workbench-layout__right {
  display: grid;
  align-content: start;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

@media (width < 1440px) {
  .process-workbench-layout {
    grid-template-columns: 208px minmax(0, 1fr) 320px;
  }
}

@media (width < 1180px) {
  .process-workbench-layout {
    grid-template-columns: 208px minmax(0, 1fr);
  }

  .process-workbench-layout__right {
    grid-column: 1 / -1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (width < 820px) {
  .process-workbench-layout {
    grid-template-columns: 1fr;
  }

  .process-workbench-layout__right {
    grid-column: auto;
    grid-template-columns: 1fr;
  }
}
</style>

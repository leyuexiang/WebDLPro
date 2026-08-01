<script setup lang="ts">
/**
 * 图表容器只提供统一标题、尺寸和空态，具体图表实例由后续图表适配器持有。
 * 此边界避免 Pinia 或页面组件保存图表运行时对象，便于在卸载时完全释放资源。
 */
defineProps<{
  title: string
  description?: string
  height?: string
}>()
</script>

<template>
  <section class="base-chart-container" :style="{ minBlockSize: height || '280px' }">
    <header class="base-chart-container__header">
      <div>
        <h2>{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <slot name="actions" />
    </header>
    <div class="base-chart-container__body">
      <slot>
        <p>图表数据与指标口径待确认后接入。</p>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.base-chart-container {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.base-chart-container__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4);
  border-block-end: 1px solid var(--color-border);
}

.base-chart-container__header h2,
.base-chart-container__header p {
  margin: 0;
}

.base-chart-container__header h2 {
  font-size: 1rem;
}

.base-chart-container__header p,
.base-chart-container__body {
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}

.base-chart-container__body {
  display: grid;
  place-items: center;
  padding: var(--space-4);
}
</style>

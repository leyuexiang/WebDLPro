<script setup lang="ts">
/**
 * 普通业务模块的安全占位页。
 * 在任务 012 确认字段、流程、权限与接口前，它只陈述待交付能力，禁止伪造业务表单和数据。
 */
defineProps<{
  title: string
  description: string
  pendingItems: readonly string[]
}>()
</script>

<template>
  <section class="module-entry-placeholder page-content">
    <p class="eyebrow">基础框架已就绪</p>
    <h1 class="page-title">{{ title }}</h1>
    <p class="page-description">{{ description }}</p>
    <article class="module-entry-placeholder__card">
      <h2>待确认业务契约</h2>
      <ul>
        <li v-for="item in pendingItems" :key="item">{{ item }}</li>
      </ul>
      <RouterLink class="button button--secondary" to="/system/components">查看通用组件基座</RouterLink>
    </article>
  </section>
</template>

<style scoped>
.module-entry-placeholder__card {
  max-inline-size: 720px;
  margin-block-start: var(--space-6);
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.module-entry-placeholder__card h2 {
  margin-block-start: 0;
  font-size: 1.125rem;
}

.module-entry-placeholder__card ul {
  display: grid;
  gap: var(--space-2);
  margin-block: var(--space-4);
  padding-inline-start: var(--space-5);
  color: var(--color-text-secondary);
}
</style>

<template>
  <!-- 查询区仅提供布局与操作槽位；具体筛选字段必须来自已确认的字段字典。 -->
  <section class="base-query-bar" aria-label="查询条件">
    <div class="base-query-bar__fields"><slot /></div>
    <div class="base-query-bar__actions"><slot name="actions" /></div>
  </section>
</template>

<style scoped>
.base-query-bar {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.base-query-bar__fields,
.base-query-bar__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

@media (width < 720px) {
  .base-query-bar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>

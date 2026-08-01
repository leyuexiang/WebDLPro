<script setup lang="ts">
/** 通用表格列定义只描述展示字段，不包含任何业务查询或写入逻辑。 */
export interface BaseTableColumn {
  key: string
  label: string
  width?: string
}

defineProps<{
  columns: readonly BaseTableColumn[]
  rows: readonly Record<string, unknown>[]
  rowKey: string
  emptyText?: string
}>()

/**
 * 将任意基础展示值统一转换为文本。
 * 非基础类型使用安全 JSON 展示，避免模板在面对空值或对象时直接抛出异常。
 */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
</script>

<template>
  <div class="base-data-table">
    <div class="base-data-table__scroll">
      <table>
        <thead>
          <tr>
            <th v-for="column in columns" :key="column.key" :style="{ width: column.width }" scope="col">
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row[rowKey])">
            <td v-for="column in columns" :key="column.key">{{ formatCell(row[column.key]) }}</td>
          </tr>
          <tr v-if="rows.length === 0">
            <td class="base-data-table__empty" :colspan="columns.length">{{ emptyText || '暂无数据' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.base-data-table {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.base-data-table__scroll {
  overflow: auto;
}

table {
  inline-size: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

th,
td {
  padding: var(--space-3) var(--space-4);
  border-block-end: 1px solid var(--color-border);
  text-align: start;
  white-space: nowrap;
}

th {
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-weight: 700;
}

tbody tr:last-child td {
  border-block-end: 0;
}

.base-data-table__empty {
  padding-block: var(--space-8);
  color: var(--color-text-secondary);
  text-align: center;
}
</style>

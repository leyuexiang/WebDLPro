<script setup lang="ts">
import { ref } from 'vue'
import BaseChartContainer from '@/shared/components/BaseChartContainer.vue'
import BaseDataTable, { type BaseTableColumn } from '@/shared/components/BaseDataTable.vue'
import BaseDetailDrawer from '@/shared/components/BaseDetailDrawer.vue'
import BaseFormField from '@/shared/components/BaseFormField.vue'
import BaseQueryBar from '@/shared/components/BaseQueryBar.vue'

/**
 * 无业务含义的组件示例用于验证任务 011 的复用基座。
 * 示例数据只描述组件能力，不代表任何后端接口或电力业务字段。
 */
const drawerOpen = ref(false)
const columns: readonly BaseTableColumn[] = [
  { key: 'name', label: '示例名称' },
  { key: 'status', label: '展示状态' },
]
const rows: readonly Record<string, unknown>[] = [
  { id: 'component-table', name: '通用表格', status: '可复用' },
  { id: 'component-form', name: '通用表单字段', status: '可复用' },
]

/** 打开受控详情抽屉，抽屉关闭后不会保留业务对象引用。 */
function openDrawer(): void {
  drawerOpen.value = true
}
</script>

<template>
  <section class="component-showcase page-content">
    <p class="eyebrow">任务 011</p>
    <h1 class="page-title">普通后台组件基座</h1>
    <p class="page-description">以下示例不绑定业务接口，用于验证表格、表单、查询、详情与图表容器的复用边界。</p>

    <div class="component-showcase__stack">
      <BaseQueryBar>
        <BaseFormField field-id="component-search" label="示例查询" hint="此字段仅展示布局能力。">
          <input id="component-search" class="component-showcase__input" placeholder="输入任意文本" />
        </BaseFormField>
        <template #actions>
          <button type="button" class="button button--primary">查询示例</button>
          <button type="button" class="button button--secondary" @click="openDrawer">打开详情抽屉</button>
        </template>
      </BaseQueryBar>

      <BaseDataTable :columns="columns" :rows="rows" row-key="id" />

      <BaseChartContainer title="图表容器" description="指标、口径和实时数据协议确认后再接入具体图表。" />
    </div>

    <BaseDetailDrawer v-model:open="drawerOpen" title="详情抽屉示例">
      <p>该抽屉由父页面控制开关，不保存任何业务详情数据。</p>
    </BaseDetailDrawer>
  </section>
</template>

<style scoped>
.component-showcase__stack {
  display: grid;
  gap: var(--space-4);
  margin-block-start: var(--space-6);
}

.component-showcase__input {
  min-block-size: 36px;
  min-inline-size: 240px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
}
</style>

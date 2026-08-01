<script setup lang="ts">
import { computed } from 'vue'
import type { MetricKey, ProcessNodeId } from '@/config/process/identifiers'
import type { DetailBlockDefinition, DetailDefinition, TopologyDefinition } from '@/config/process/types'
import type { ProcessMetricSnapshot } from '@/stores/process-context.store'
import { usePermissionStore } from '@/stores/permission.store'

const props = defineProps<{
  topology: TopologyDefinition
  details: DetailDefinition
  selectedNodeId: ProcessNodeId | null
  metricSnapshots: Readonly<Record<string, ProcessMetricSnapshot>>
}>()

const permissionStore = usePermissionStore()

/** 详情和指标都先建索引，避免每个详情块渲染时重复扫描完整配置数组。 */
const selectedNode = computed(() => props.topology.nodes.find((node) => node.nodeId === props.selectedNodeId))
const metricByKey = computed(() => new Map(props.details.metrics.map((metric) => [metric.metricKey, metric])))

/** 权限不满足的详情块直接不渲染；没有数据时保留真实的等待状态而非虚构数字。 */
const visibleBlocks = computed(() => {
  const nodeId = selectedNode.value?.nodeId
  const blocks = nodeId ? props.details.blocksByNodeId[nodeId] ?? [] : []

  return blocks.filter((block) => {
    const hasPagePermission = !block.pagePermissionCode || permissionStore.hasPermission('page', block.pagePermissionCode)
    const hasDataPermission = !block.dataPermissionCode || permissionStore.hasPermission('data', block.dataPermissionCode)
    return hasPagePermission && hasDataPermission
  })
})

/** 将单个指标转换为展示状态；未接实时数据契约时只输出已声明的缺失原因。 */
function metricText(metricKey: MetricKey): string {
  const definition = metricByKey.value.get(metricKey)
  const snapshot = props.metricSnapshots[metricKey]

  if (snapshot) return `${snapshot.value ?? '—'} ${definition?.unit ?? ''}`.trim()
  if (definition?.availability === 'pending') return '等待数据契约'
  return '暂无数据'
}

/** 基础块不读取后端数据，仅说明当前稳定业务节点。 */
function basicText(block: DetailBlockDefinition): string {
  return block.kind === 'basic' ? '当前选择已同步至工艺上下文。' : ''
}
</script>

<template>
  <section class="process-detail" aria-label="设备详情">
    <p class="eyebrow">设备详情</p>
    <h2>{{ selectedNode?.title ?? '请选择拓扑节点' }}</h2>
    <p v-if="!selectedNode" class="process-detail__empty">从二维拓扑或工艺导览选择设备后，可查看已授权的配置与数据状态。</p>
    <div v-else-if="visibleBlocks.length > 0" class="process-detail__blocks">
      <article v-for="block in visibleBlocks" :key="block.blockId" class="process-detail__block">
        <h3>{{ block.title }}</h3>
        <p v-if="block.kind === 'basic'">{{ basicText(block) }}</p>
        <dl v-else-if="block.metricKeys.length > 0">
          <template v-for="metricKey in block.metricKeys" :key="metricKey">
            <dt>{{ metricByKey.get(metricKey)?.title ?? metricKey }}</dt>
            <dd>{{ metricText(metricKey) }}</dd>
          </template>
        </dl>
        <p v-else>当前详情块尚无可展示的已授权数据。</p>
      </article>
    </div>
    <p v-else-if="selectedNode" class="process-detail__empty">该节点尚未发布可访问的详情块。</p>
  </section>
</template>

<style scoped>
.process-detail {
  display: grid;
  gap: var(--space-2);
}

.process-detail h2,
.process-detail h3,
.process-detail p,
.process-detail dl {
  margin: 0;
}

.process-detail h2 {
  font-size: 1rem;
}

.process-detail__blocks {
  display: grid;
  gap: var(--space-2);
}

.process-detail__block {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
}

.process-detail__block h3 {
  font-size: 0.875rem;
}

.process-detail__block p,
.process-detail__empty,
.process-detail dt,
.process-detail dd {
  color: var(--color-text-secondary);
  font-size: 0.8125rem;
  line-height: 1.55;
}

.process-detail dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px var(--space-2);
}

.process-detail dd {
  margin: 0;
  color: var(--color-text);
  text-align: end;
}
</style>

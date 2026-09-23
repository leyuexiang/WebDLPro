<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { getProcessDetailTopologyDataContext } from '@/modules/visual/topology/process-detail-topology-contexts'
import ManifestTopologyJsonPreview from './ManifestTopologyJsonPreview.vue'
import { WIND_TOPOLOGY_PREVIEW_PROFILE } from './wind-topology-preview-profile'

const CONTEXT_IDS = ['process-detail.wind-power.wind-turbine', 'process-detail.wind-power.gearbox'] as const
type WindProcessDetailContextId = (typeof CONTEXT_IDS)[number]

const TITLES: Readonly<Record<WindProcessDetailContextId, string>> = Object.freeze({
  'process-detail.wind-power.wind-turbine': '风机',
  'process-detail.wind-power.gearbox': '风电齿轮箱',
})

const route = useRoute()
const preview = ref<InstanceType<typeof ManifestTopologyJsonPreview> | null>(null)
const activeContextId = ref<WindProcessDetailContextId>(resolveContextId(route.query.context))
const activeTitle = computed(() => TITLES[activeContextId.value])

/** 只接受固定上下文编号；未知查询参数回退风机拓扑，不会形成任意文件读取路径。 */
function resolveContextId(value: unknown): WindProcessDetailContextId {
  return CONTEXT_IDS.find((contextId) => contextId === value) ?? CONTEXT_IDS[0]
}

/** 切换时由共享预览组件在同一个 Meta2D 实例中替换完整拓扑数据。 */
async function selectContext(contextId: WindProcessDetailContextId): Promise<void> {
  activeContextId.value = contextId
  const context = getProcessDetailTopologyDataContext(contextId)
  if (context) await preview.value?.setTopologyDataContext(context)
}
const initialContext = getProcessDetailTopologyDataContext(activeContextId.value)
</script>

<template>
  <main class="wind-detail-preview">
    <nav class="wind-detail-preview__switch" aria-label="风电关键环节">
      <button
        v-for="contextId in CONTEXT_IDS"
        :key="contextId"
        type="button"
        :aria-pressed="activeContextId === contextId"
        @click="selectContext(contextId)"
      >
        {{ TITLES[contextId] }}
      </button>
    </nav>
    <ManifestTopologyJsonPreview
      ref="preview"
      class="wind-detail-preview__canvas"
      :profile="WIND_TOPOLOGY_PREVIEW_PROFILE"
      :initial-data-context="initialContext"
    />
    <span class="wind-detail-preview__title" aria-live="polite">{{ activeTitle }}</span>
  </main>
</template>

<style scoped>
.wind-detail-preview {
  position: relative;
  inline-size: 100%;
  block-size: 100vh;
  min-block-size: 480px;
  overflow: hidden;
  background: #1e2430;
}

.wind-detail-preview__canvas { inline-size: 100%; block-size: 100%; }

.wind-detail-preview__switch {
  position: absolute;
  inset-block-start: 12px;
  inset-inline-start: 50%;
  z-index: 40;
  display: flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid rgba(148, 163, 184, 0.48);
  border-radius: 6px;
  background: rgba(15, 23, 32, 0.92);
  transform: translateX(-50%);
}

.wind-detail-preview__switch button {
  min-block-size: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 4px;
  color: #d6e3ed;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.wind-detail-preview__switch button[aria-pressed="true"] {
  color: #10231f;
  background: #71d6b2;
}

.wind-detail-preview__switch button:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

.wind-detail-preview__title {
  position: absolute;
  inset-inline-start: 12px;
  inset-block-end: 12px;
  z-index: 35;
  padding: 6px 9px;
  border: 1px solid rgba(148, 163, 184, 0.48);
  border-radius: 4px;
  color: #e4edf2;
  background: rgba(15, 23, 32, 0.86);
  font-size: 12px;
  pointer-events: none;
}
</style>

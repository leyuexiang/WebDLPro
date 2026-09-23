<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import ManifestTopologyJsonPreview from './ManifestTopologyJsonPreview.vue'
import { STEP_DOWN_SUBSTATION_TOPOLOGY_PREVIEW_PROFILE } from './step-down-substation-topology-preview-profile'
import { getProcessDetailTopologyDataContext } from '@/modules/visual/topology/process-detail-topology-contexts'

/** 预览页只核对三份公共图纸；正式四个站类场景的十一项绑定仍以场景限定的上下文编号为准。 */
const protectionOptions = Object.freeze([
  Object.freeze({ key: 'transformer-protection', label: '变压保护' }),
  Object.freeze({ key: 'busbar-protection', label: '母线保护' }),
  Object.freeze({ key: 'line-protection', label: '线路保护' }),
])
type ProtectionKey = typeof protectionOptions[number]['key']

const previewRoot = ref<HTMLElement | null>(null)
const preview = ref<InstanceType<typeof ManifestTopologyJsonPreview> | null>(null)
const activeKey = ref(protectionOptions[0]!.key)
const activeLabel = computed(() => protectionOptions.find((item) => item.key === activeKey.value)?.label ?? '')

/**
 * 独立验收入口固定使用降压站命名空间，避免引入虚假的三维动作；四个站类场景共享同一文件，
 * 因而这里看到的画面与升压站、换流站对应关键环节完全一致。
 */
async function showProtection(key: ProtectionKey): Promise<void> {
  const context = getProcessDetailTopologyDataContext(`process-detail.step-down-substation.${key}`)
  if (!context) return
  activeKey.value = key
  await preview.value?.setTopologyDataContext(context)
}

onMounted(async () => {
  await nextTick()
  await showProtection(activeKey.value)
})
</script>

<template>
  <main ref="previewRoot" class="protection-preview">
    <header class="protection-preview__toolbar">
      <div>
        <h1>保护关键环节拓扑预览</h1>
        <p>当前：{{ activeLabel }}；四个站类场景共用画面文件，正式状态上下文相互独立。</p>
      </div>
      <nav aria-label="保护关键环节切换">
        <button
          v-for="option in protectionOptions"
          :key="option.key"
          type="button"
          :class="{ 'is-active': activeKey === option.key }"
          :aria-pressed="activeKey === option.key"
          @click="showProtection(option.key)"
        >
          {{ option.label }}
        </button>
      </nav>
    </header>
    <section class="protection-preview__canvas">
      <ManifestTopologyJsonPreview
        ref="preview"
        :profile="STEP_DOWN_SUBSTATION_TOPOLOGY_PREVIEW_PROFILE"
        :fullscreen-target="previewRoot"
      />
    </section>
  </main>
</template>

<style scoped>
.protection-preview {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  block-size: 100vh;
  min-block-size: 520px;
  overflow: hidden;
  background: #03111d;
  color: #e2f7ff;
}

.protection-preview__toolbar {
  position: relative;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 18px;
  border-block-end: 1px solid rgba(103, 232, 249, 0.32);
  background: linear-gradient(90deg, #082f49, #071827);
}

.protection-preview__toolbar h1 { margin: 0; font-size: 18px; }
.protection-preview__toolbar p { margin: 4px 0 0; color: #9dd8e5; font-size: 12px; }
.protection-preview__toolbar nav { display: flex; gap: 8px; }

.protection-preview__toolbar button {
  min-block-size: 34px;
  padding: 7px 14px;
  border: 1px solid rgba(103, 232, 249, 0.4);
  border-radius: 6px;
  background: rgba(8, 47, 73, 0.78);
  color: #bff7ff;
  cursor: pointer;
}

.protection-preview__toolbar button:hover,
.protection-preview__toolbar button:focus-visible,
.protection-preview__toolbar button.is-active {
  border-color: #67e8f9;
  background: #0e7490;
  color: #fff;
}

.protection-preview__toolbar button:focus-visible { outline: 2px solid rgba(103, 232, 249, 0.45); outline-offset: 2px; }
.protection-preview__canvas { min-block-size: 0; overflow: hidden; }

@media (max-width: 720px) {
  .protection-preview__toolbar { align-items: flex-start; flex-direction: column; }
  .protection-preview__toolbar nav { inline-size: 100%; overflow-x: auto; }
}
</style>

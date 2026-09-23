<script setup lang="ts">
import { computed, ref } from 'vue'
import ManifestTopologyJsonPreview from './ManifestTopologyJsonPreview.vue'
import { WIND_TOPOLOGY_PREVIEW_PROFILE } from './wind-topology-preview-profile'

/** 风电包装层只固定业务清单，公共画布实现由所有清单式第二层拓扑共享。 */
defineProps<{ fullscreenTarget?: HTMLElement | null; suspended?: boolean }>()
const emit = defineEmits<{ readyChange: [ready: boolean] }>()

const preview = ref<InstanceType<typeof ManifestTopologyJsonPreview> | null>(null)

/** 保持正式面板既有的窄控制端口，重构不会暴露底层二维组态引擎。 */
defineExpose({
  ready: computed(() => preview.value?.ready ?? false),
  resetView: () => preview.value?.resetView(),
})
</script>

<template>
  <ManifestTopologyJsonPreview
    ref="preview"
    :profile="WIND_TOPOLOGY_PREVIEW_PROFILE"
    :fullscreen-target="fullscreenTarget"
    :suspended="suspended"
    @ready-change="emit('readyChange', $event)"
  />
</template>

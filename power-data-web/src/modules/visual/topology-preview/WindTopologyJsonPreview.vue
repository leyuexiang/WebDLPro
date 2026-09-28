<script setup lang="ts">
import { computed, ref } from 'vue'
import ManifestTopologyJsonPreview from './ManifestTopologyJsonPreview.vue'
import { WIND_TOPOLOGY_PREVIEW_PROFILE } from './wind-topology-preview-profile'
import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'

/** 风电包装层只固定业务清单，公共画布实现由所有清单式第二层拓扑共享。 */
defineProps<{ fullscreenTarget?: HTMLElement | null; suspended?: boolean }>()
const emit = defineEmits<{ readyChange: [ready: boolean] }>()

const preview = ref<InstanceType<typeof ManifestTopologyJsonPreview> | null>(null)

/** 保持正式面板既有的窄控制端口，重构不会暴露底层二维组态引擎。 */
defineExpose({
  ready: computed(() => preview.value?.ready ?? false),
  resetView: () => preview.value?.resetView(),
  // 正式面板通过这个端口在同一画布切换风机、齿轮箱和总览，不能只在独立预览页支持换源。
  setTopologyDataContext: (context: TopologyDataContext | undefined) => preview.value?.setTopologyDataContext(context),
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

<script setup lang="ts">
import { computed, ref } from 'vue'
import ManifestTopologyJsonPreview from './ManifestTopologyJsonPreview.vue'
import { STEP_DOWN_SUBSTATION_TOPOLOGY_PREVIEW_PROFILE } from './step-down-substation-topology-preview-profile'
import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'

/** 正式面板提供全屏祖先和暂停信号；独立路由省略两项即可复用同一画布。 */
defineProps<{ fullscreenTarget?: HTMLElement | null; suspended?: boolean }>()

const preview = ref<InstanceType<typeof ManifestTopologyJsonPreview> | null>(null)

/** 只转发公共面板需要的就绪和视口重置端口，不向外暴露二维组态引擎。 */
defineExpose({
  ready: computed(() => preview.value?.ready ?? false),
  resetView: () => preview.value?.resetView(),
  // 第三层切换只转发稳定数据上下文，不向面板泄露 Meta2D 实例。
  setTopologyDataContext: (context: TopologyDataContext | undefined) => preview.value?.setTopologyDataContext(context),
})
</script>

<template>
  <ManifestTopologyJsonPreview
    ref="preview"
    :profile="STEP_DOWN_SUBSTATION_TOPOLOGY_PREVIEW_PROFILE"
    :fullscreen-target="fullscreenTarget"
    :suspended="suspended"
  />
</template>

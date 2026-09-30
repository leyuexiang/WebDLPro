<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'
import ManifestTopologyJsonPreview from './ManifestTopologyJsonPreview.vue'
import {
  getBusinessSceneTopologyPreviewProfile,
  type BusinessSceneTopologySceneId,
} from './business-scene-topology'

/** 三个新业务场景只把稳定场景键传给公共画布，布局、切层和选择均由共享运行时实现。 */
const props = defineProps<{
  sceneId: BusinessSceneTopologySceneId
  fullscreenTarget?: HTMLElement | null
  suspended?: boolean
  selectedNodeIds?: readonly ProcessNodeId[]
  selectedRouteIds?: readonly RouteId[]
}>()

const emit = defineEmits<{
  selectNode: [nodeId: ProcessNodeId | undefined]
  clearSelection: []
  doubleClickNode: [nodeId: ProcessNodeId]
  readyChange: [ready: boolean]
}>()

const preview = ref<InstanceType<typeof ManifestTopologyJsonPreview> | null>(null)
const profile = computed(() => getBusinessSceneTopologyPreviewProfile(props.sceneId))

/** 正式面板窄端口保持与既有 JSON 总览一致，不向业务层暴露 Meta2D 引擎实例。 */
defineExpose({
  ready: computed(() => preview.value?.ready ?? false),
  resetView: () => preview.value?.resetView(),
  setSelection: (nodeIds: readonly ProcessNodeId[], routeIds: readonly RouteId[]) => (
    preview.value?.setSelection(nodeIds, routeIds)
  ),
  setTopologyDataContext: (context: TopologyDataContext | undefined) => (
    preview.value?.setTopologyDataContext(context)
  ),
})
</script>

<template>
  <ManifestTopologyJsonPreview
    ref="preview"
    :profile="profile"
    :fullscreen-target="props.fullscreenTarget"
    :suspended="props.suspended"
    :selected-node-ids="props.selectedNodeIds"
    :selected-route-ids="props.selectedRouteIds"
    @select-node="emit('selectNode', $event)"
    @clear-selection="emit('clearSelection')"
    @double-click-node="emit('doubleClickNode', $event)"
    @ready-change="emit('readyChange', $event)"
  />
</template>

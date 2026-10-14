<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import ManifestTopologyJsonPreview from './ManifestTopologyJsonPreview.vue'
import { WIND_TOPOLOGY_PREVIEW_PROFILE } from './wind-topology-preview-profile'
import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'

/** 风电包装层固定业务清单并透传统一选择快照，不让场景组件接触二维组态引擎。 */
const props = defineProps<{
  fullscreenTarget?: HTMLElement | null
  suspended?: boolean
  selectedNodeIds?: readonly ProcessNodeId[]
  selectedRouteIds?: readonly RouteId[]
}>()
const emit = defineEmits<{
  readyChange: [ready: boolean]
  selectNode: [nodeId: ProcessNodeId | undefined]
  clearSelection: []
  doubleClickNode: [nodeId: ProcessNodeId]
}>()

const preview = ref<InstanceType<typeof ManifestTopologyJsonPreview> | null>(null)

/** 保持正式面板既有的窄控制端口，重构不会暴露底层二维组态引擎。 */
defineExpose({
  ready: computed(() => preview.value?.ready ?? false),
  resetView: () => preview.value?.resetView(),
  /** 三维反向选择沿同一 nodeId 回放到当前 JSON 版本中的全部重复图元。 */
  setSelection: (nodeIds: readonly ProcessNodeId[], routeIds: readonly RouteId[]) => preview.value?.setSelection(nodeIds, routeIds),
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
    :selected-node-ids="props.selectedNodeIds"
    :selected-route-ids="props.selectedRouteIds"
    @select-node="emit('selectNode', $event)"
    @clear-selection="emit('clearSelection')"
    @double-click-node="emit('doubleClickNode', $event)"
    @ready-change="emit('readyChange', $event)"
  />
</template>

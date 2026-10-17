<script setup lang="ts">
import { computed, ref } from 'vue'
import ManifestTopologyJsonPreview from './ManifestTopologyJsonPreview.vue'
import { WIND_TOPOLOGY_PREVIEW_PROFILE } from './wind-topology-preview-profile'
import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'

/** 风电包装层只固定业务清单，公共画布实现由所有清单式第二层拓扑共享。 */
const props = defineProps<{
  fullscreenTarget?: HTMLElement | null
  suspended?: boolean
  selectedNodeIds?: readonly ProcessNodeId[]
  selectedRouteIds?: readonly RouteId[]
  nodeStatuses?: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>
}>()
const emit = defineEmits<{
  selectNode: [nodeId: ProcessNodeId | undefined]
  clearSelection: []
  doubleClickNode: [nodeId: ProcessNodeId]
  readyChange: [ready: boolean]
}>()

const preview = ref<InstanceType<typeof ManifestTopologyJsonPreview> | null>(null)

/** 保持正式面板既有的窄控制端口，重构不会暴露底层二维组态引擎。 */
defineExpose({
  ready: computed(() => preview.value?.ready ?? false),
  resetView: () => preview.value?.resetView(),
  // 正式面板通过这个端口在同一画布切换风机、齿轮箱和总览，不能只在独立预览页支持换源。
  setTopologyDataContext: (context: TopologyDataContext | undefined) => preview.value?.setTopologyDataContext(context),
  /** 正式面板用稳定业务编号回放三维反选，公共画布再查当前文件全部对应图元。 */
  setSelection: (nodeIds: readonly ProcessNodeId[], routeIds: readonly RouteId[]) => preview.value?.setSelection(nodeIds, routeIds),
  /** 同步正式面板的中央状态快照，供风电设备悬浮提示读取当前状态文字。 */
  setNodeStatuses: (statuses: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>) => preview.value?.setNodeStatuses(statuses),
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
    :node-statuses="props.nodeStatuses"
    @select-node="emit('selectNode', $event)"
    @clear-selection="emit('clearSelection')"
    @double-click-node="emit('doubleClickNode', $event)"
    @ready-change="emit('readyChange', $event)"
  />
</template>

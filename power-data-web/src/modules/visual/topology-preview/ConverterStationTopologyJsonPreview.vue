<script setup lang="ts">
import { computed, ref } from 'vue'
import ManifestTopologyJsonPreview from './ManifestTopologyJsonPreview.vue'
import { CONVERTER_STATION_TOPOLOGY_PREVIEW_PROFILE } from './converter-station-topology-preview-profile'
import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'

/** 正式面板提供全屏祖先和暂停信号；独立路由省略两项即可复用同一画布。 */
const props = defineProps<{ fullscreenTarget?: HTMLElement | null; suspended?: boolean; selectedNodeIds?: readonly ProcessNodeId[]; selectedRouteIds?: readonly RouteId[] }>()
const emit = defineEmits<{ selectNode: [nodeId: ProcessNodeId | undefined]; clearSelection: []; readyChange: [ready: boolean] }>()

const preview = ref<InstanceType<typeof ManifestTopologyJsonPreview> | null>(null)

/** 只转发公共面板需要的就绪和视口重置端口，不向外暴露二维组态引擎。 */
defineExpose({
  ready: computed(() => preview.value?.ready ?? false),
  resetView: () => preview.value?.resetView(),
  // 只转发已经登记的第三层上下文，未知编号由上层清单查询阶段拒绝。
  setTopologyDataContext: (context: TopologyDataContext | undefined) => preview.value?.setTopologyDataContext(context),
  setSelection: (nodeIds: readonly ProcessNodeId[], routeIds: readonly RouteId[]) => preview.value?.setSelection(nodeIds, routeIds),
})
</script>

<template>
  <ManifestTopologyJsonPreview
    ref="preview"
    :profile="CONVERTER_STATION_TOPOLOGY_PREVIEW_PROFILE"
    :fullscreen-target="fullscreenTarget"
    :suspended="suspended"
    :selected-node-ids="props.selectedNodeIds"
    :selected-route-ids="props.selectedRouteIds"
    @select-node="emit('selectNode', $event)"
    @clear-selection="emit('clearSelection')"
    @ready-change="emit('readyChange', $event)"
  />
</template>

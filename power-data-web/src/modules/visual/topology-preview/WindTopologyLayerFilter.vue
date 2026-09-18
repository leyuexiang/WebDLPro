<script setup lang="ts">
import TopologyLayerFilterRail from './TopologyLayerFilterRail.vue'
import {
  WIND_TOPOLOGY_FILTER_GROUPS,
  type WindTopologyFilterId,
} from './wind-topology-layer-filter'

defineProps<{
  selectedFilterIds: ReadonlySet<WindTopologyFilterId>
}>()

const emit = defineEmits<{
  change: [filterId: WindTopologyFilterId, checked: boolean]
}>()

/**
 * 燃煤包装层只维护强类型事件边界。公共组件负责右侧竖向样式；
 * 架构互斥和完整文件切换由画布处理，本组件不读取或过滤拓扑图元。
 */
function handleChange(filterId: WindTopologyFilterId, checked: boolean): void {
  emit('change', filterId, checked)
}
</script>

<template>
  <TopologyLayerFilterRail
    :groups="WIND_TOPOLOGY_FILTER_GROUPS"
    :selected-filter-ids="selectedFilterIds"
    @change="handleChange"
  />
</template>




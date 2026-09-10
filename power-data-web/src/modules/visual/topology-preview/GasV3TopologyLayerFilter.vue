<script setup lang="ts">
import TopologyLayerFilterRail from './TopologyLayerFilterRail.vue'
import {
  GAS_V3_TOPOLOGY_FILTER_GROUPS,
  type GasV3TopologyFilterId,
} from './gas-v3-topology-layer-filter'

defineProps<{
  selectedFilterIds: ReadonlySet<GasV3TopologyFilterId>
}>()

const emit = defineEmits<{
  change: [filterId: GasV3TopologyFilterId, checked: boolean]
}>()

/**
 * 第三版包装层只维护强类型事件边界，公共组件统一负责右侧单字宽竖向样式；
 * 架构互斥和完整数据文件切换由画布层统一处理，本组件不读取或过滤拓扑图元。
 */
function handleChange(filterId: GasV3TopologyFilterId, checked: boolean): void {
  emit('change', filterId, checked)
}
</script>

<template>
  <TopologyLayerFilterRail
    :groups="GAS_V3_TOPOLOGY_FILTER_GROUPS"
    :selected-filter-ids="selectedFilterIds"
    @change="handleChange"
  />
</template>

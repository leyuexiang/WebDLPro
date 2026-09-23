import { createApp, defineComponent, h, ref } from 'vue'
import { localProcessConfigDataset } from '@/config/process/local-process-config'
import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import TopologyCanvas from '@/modules/visual/components/TopologyCanvas.vue'

/**
 * 视觉回归只读取仓库中已经核验的24节点、23连线燃气基线，不复制节点、坐标或映射数据。
 * 正式嵌入壳仍以远程原子清单为唯一数据源；本入口仅验证通用画布修改是否正确作用于现有燃气结构。
 */
const topology = localProcessConfigDataset.topologies.find((candidate) => candidate.topologyKey === 'topology.gas-overview')

if (!topology) {
  throw new Error('燃气拓扑视觉回归无法读取已核验本地基线。')
}

const GasTopologyVisualRegression = defineComponent({
  name: 'GasTopologyVisualRegression',
  setup() {
    const selectedNodeIds = ref<readonly ProcessNodeId[]>([])
    const selectedRouteIds = ref<readonly RouteId[]>([])

    /** 单击仍走真实组件选择入口，以便同时验证触屏与键盘不会被提示层截断。 */
    function selectNode(nodeId: ProcessNodeId): void {
      selectedNodeIds.value = [nodeId]
      selectedRouteIds.value = topology.edges
        .filter((edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId)
        .map((edge) => edge.edgeId)
    }

    /** 空白点击回归入口必须同时清除节点和关联路径，模拟正式面板的声明式属性回写。 */
    function clearSelection(): void {
      selectedNodeIds.value = []
      selectedRouteIds.value = []
    }

    return () => h('main', {
      class: 'gas-topology-test-shell',
      'data-selected-node-count': String(selectedNodeIds.value.length),
      'data-selected-route-count': String(selectedRouteIds.value.length),
    }, [
      h(TopologyCanvas, {
        topology,
        selectedNodeIds: selectedNodeIds.value,
        selectedRouteIds: selectedRouteIds.value,
        onSelectNode: selectNode,
        onClearSelection: clearSelection,
        onDoubleClickNode: selectNode,
      }),
    ])
  },
})

createApp(GasTopologyVisualRegression).mount('#app')

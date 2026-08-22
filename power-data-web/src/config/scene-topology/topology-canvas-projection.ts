import { toProcessNodeId, toRouteId, toTopologyKey } from '@/config/process/identifiers'
import type { TopologyDefinition as CanvasTopologyDefinition, TopologyIconKey } from '@/config/process/types'
import type { TopologyDefinition as ManifestTopologyDefinition } from '@/config/scene-topology/types'
import { hasTopologyIconKey } from '@/services/topology/topology-icon-registry'

/**
 * 将经过原子发布校验的新拓扑清单投影为现有单画布的只读输入。
 *
 * 这不是业务映射迁移：展示层级、协议和连线证据只有在正式清单明确给出时才透传；缺失字段
 * 分别留空或标记为未分类，绝不从标题、图元键或节点位置补造旧燃气配置。画布完成迁移前，
 * 这一层把两种模型的兼容边界集中在单处。
 */
export function projectTopologyForCanvas(topology: ManifestTopologyDefinition): CanvasTopologyDefinition {
  return {
    topologyKey: toTopologyKey(String(topology.topologyId)),
    title: topology.title,
    configVersion: topology.configVersion,
    // 展示层级必须来自清单的显式值；未声明时保持 undefined，让画布使用中性布局而不猜测控制网络分层。
    layers: topology.layers?.map((layer) => ({
      layerId: layer.layerId,
      title: layer.title,
      y: layer.y,
      color: layer.color,
    })),
    nodes: topology.nodes.map((node) => ({
      nodeId: toProcessNodeId(String(node.nodeId)),
      title: node.title,
      x: node.x,
      y: node.y,
      // 节点仅可引用已随清单发布的展示层级；不存在时不尝试按坐标推断。
      layerId: node.layerId,
      // 仅复用已经登记的图元；未登记字符串强制成为中性占位，不会触发动态资源读取。
      iconKey: toCanvasIconKey(node.iconKey),
      deviceStatus: node.deviceStatus,
      metricKeys: [],
      // 只透传已经通过清单门禁的内容引用；说明节点本身不会进入旧画布模型。
      drilldown: node.drilldown ? { ...node.drilldown } : undefined,
    })),
    edges: topology.edges.map((edge) => ({
      edgeId: toRouteId(String(edge.edgeId)),
      fromNodeId: toProcessNodeId(String(edge.fromNodeId)),
      toNodeId: toProcessNodeId(String(edge.toNodeId)),
      title: edge.title,
      // 协议和证据是只读二维展示字段；缺失时才使用中性“未分类”状态。
      protocolLabel: edge.protocolLabel,
      // 资料明确给出时透传原图线色和线型；没有资料的旧拓扑继续由画布使用历史默认值。
      lineColor: edge.lineColor,
      lineStyle: edge.lineStyle,
      evidenceStatus: edge.evidenceStatus ?? 'unclassified',
      sceneRouteIds: [],
    })),
    // 重点区域只投影总览图中显式声明的节点集合；过滤视图在注册表投影阶段会主动清空。
    focusRegions: topology.focusRegions?.map((region) => ({
      regionId: region.regionId,
      anchorNodeId: toProcessNodeId(String(region.anchorNodeId)),
      nodeIds: region.nodeIds.map((nodeId) => toProcessNodeId(String(nodeId))),
      label: region.label,
    })),
  }
}

/** 将新清单的受控字符串收敛到旧画布已登记图元或中性占位，避免无审核资源请求。 */
function toCanvasIconKey(iconKey: string): TopologyIconKey {
  return hasTopologyIconKey(iconKey) ? iconKey : 'generic'
}

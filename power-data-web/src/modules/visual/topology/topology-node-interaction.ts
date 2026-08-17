import type { NodeId, SceneId, TopologyId } from '@/config/scene-topology/identifiers'
import type { TopologyDefinition } from '@/config/scene-topology/types'

/**
 * 拓扑双击向组合根提交的节点意图。
 * 该对象只保留正式清单登记的稳定标识；上下文版本、关联标识和外层信封由后续桥接层追加，
 * 因此画布组件永远不会自行构造或发送跨窗口消息。
 */
export interface TopologyNodeDoubleClickIntent {
  sceneId: SceneId
  topologyId: TopologyId
  nodeId: NodeId
}

/**
 * 从当前已激活的正式拓扑解析可上报节点双击。
 * 查询只发生在用户双击时，且仅检查同一拓扑中的显式节点声明；未声明上报或找不到节点时
 * 一律返回 undefined，绝不从标题、图元键、二维坐标或三维名称推断其他标识。
 */
export function resolveTopologyNodeDoubleClick(
  topology: TopologyDefinition,
  nodeId: NodeId,
): TopologyNodeDoubleClickIntent | undefined {
  const node = topology.nodes.find((item) => item.nodeId === nodeId)
  if (!node || node.doubleClickBehavior !== 'emit-node') return undefined

  return {
    sceneId: topology.sceneId,
    topologyId: topology.topologyId,
    nodeId,
  }
}

import type { DeviceId, NodeId, SceneId, SceneNodeId, TopologyId } from '@/config/scene-topology/identifiers'
import type { TopologyDefinition } from '@/config/scene-topology/types'

/**
 * 拓扑双击向组合根提交的设备意图。
 * 该对象只保留正式清单登记的稳定标识；上下文版本、关联标识和外层信封由后续桥接层追加，
 * 因此画布组件永远不会自行构造或发送跨窗口消息。
 */
export interface TopologyDeviceDoubleClickIntent {
  sceneId: SceneId
  topologyId: TopologyId
  nodeId: NodeId
  deviceId: DeviceId
  sceneNodeId?: SceneNodeId
}

/**
 * 从当前已激活的正式拓扑解析可上报设备双击。
 * 查询只发生在用户双击时，且仅检查同一拓扑中的显式节点声明；无设备、未声明上报或找不到节点时
 * 一律返回 undefined，绝不从标题、图元键、二维坐标或相同字符串推断设备或三维节点映射。
 */
export function resolveTopologyDeviceDoubleClick(
  topology: TopologyDefinition,
  nodeId: NodeId,
): TopologyDeviceDoubleClickIntent | undefined {
  const node = topology.nodes.find((item) => item.nodeId === nodeId)
  if (!node || node.doubleClickBehavior !== 'emit-device' || !node.deviceId) return undefined

  return {
    sceneId: topology.sceneId,
    topologyId: topology.topologyId,
    nodeId,
    deviceId: node.deviceId,
    ...(node.sceneNodeId ? { sceneNodeId: node.sceneNodeId } : {}),
  }
}

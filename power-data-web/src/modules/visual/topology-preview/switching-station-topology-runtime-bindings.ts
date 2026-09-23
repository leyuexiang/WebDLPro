import { createSubstationTopologyRuntimeBindingIndex, stationNode, type SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/**
 * 将同一业务节点在所有筛选组合中的图元编号汇聚到同一映射。
 * 筛选只改变当前画布显示的图元集合，不能改变二维节点对应的业务节点或 Unity 节点。
 */
const bindNode = (nodeId: string, sceneNodeId: string, penIds: readonly string[]): readonly SubstationTopologyRuntimeBinding[] =>
  penIds.map((penId) => ({ penId, ...stationNode(nodeId, sceneNodeId) }))

/** 开关站全部拓扑变体的测控装置、保护装置图元分别共享对应业务/三维映射。 */
export const SWITCHING_STATION_TOPOLOGY_RUNTIME_BINDINGS: readonly SubstationTopologyRuntimeBinding[] = Object.freeze([
  ...bindNode('system.switching-protection-control', 'unit.switching-protection.control', [
    // 只有拓扑里的“保护装置”图元对应 Unity 保护控制节点；“继电保护系统”不属于此映射。
    'ae39506', '41755491', '9e69d20', '6c37e48c', '6280cc7',
    'f4791f9', '73144b5e', '303a5722', '3e447129', '26a5740', '784920c4',
  ]),
  ...bindNode('system.switching-measurement-control', 'unit.switching-measurement.control', [
    // 测控装置：取消架构层或切换任意组合后仍复用同一三维测控节点。
    '398a81ed', 'ffa6b25', '18d0c', '4c264eb2', '7d0b7fde',
    '1b7da779', 'cbcec19', '6fa15c9', '6f96d55', '7459f619', 'c0830e',
  ]),
  { penId: '174032f3', ...stationNode('asset.switching-breaker', 'node.switching-breaker') },
  { penId: '19b9d', ...stationNode('asset.switching-breaker', 'node.switching-breaker') },
  { penId: '31f78f', ...stationNode('asset.switching-instrument-transformer', 'node.switching-instrument-transformer') },
  { penId: '76d94ff', ...stationNode('asset.switching-instrument-transformer', 'node.switching-instrument-transformer') },
])
export const SWITCHING_STATION_TOPOLOGY_RUNTIME_BINDING_INDEX = createSubstationTopologyRuntimeBindingIndex(SWITCHING_STATION_TOPOLOGY_RUNTIME_BINDINGS)

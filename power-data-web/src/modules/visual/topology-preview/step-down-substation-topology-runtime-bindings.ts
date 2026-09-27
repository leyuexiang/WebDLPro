import { createSubstationTopologyRuntimeBindingIndex, stationNode, type SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/**
 * 将同一业务节点在所有筛选组合中的图元编号汇聚到同一映射。
 * 筛选只改变当前画布显示的图元集合，不能改变二维节点对应的业务节点或 Unity 节点。
 */
const bindNode = (nodeId: string, sceneNodeId: string, penIds: readonly string[]): readonly SubstationTopologyRuntimeBinding[] =>
  penIds.map((penId) => ({ penId, ...stationNode(nodeId, sceneNodeId) }))

/** 降压站全部拓扑变体的测控装置、保护装置图元分别共享对应业务/三维映射。 */
export const STEP_DOWN_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS: readonly SubstationTopologyRuntimeBinding[] = Object.freeze([
  ...bindNode('system.step-down-protection-control', 'unit.step-down-protection.control', [
    // 只有拓扑里的“保护装置”图元对应 Unity 保护控制节点；“继电保护系统”不属于此映射。
    '5b87c90', '2c3ac67', '6dfae588', '61a4dc09', '4c564407',
    '74daf9c7', 'a16bf10', 'a6511c3', 'db6141b', '38653c0', 'a88dc8',
    '2c805a80', '97b3e90',
  ]),
  ...bindNode('system.step-down-measurement-control', 'unit.step-down-measurement.control', [
    // 测控装置：取消架构层或切换任意组合后仍复用同一三维测控节点。
    '54d935f', '680d2e39', '1100064a', '7e3f840b', 'c6e09d8',
    '40e39ff', '14434136', 'b00df55', '10e628dd', '4e50604', 'aa56328',
    'd5465e1', 'a032f60',
  ]),
  { penId: '244aced6', ...stationNode('asset.step-down-transformer', 'node.step-down-transformer') },
  { penId: '394405c6', ...stationNode('asset.step-down-transformer', 'node.step-down-transformer') },
  { penId: '1c9afaea', ...stationNode('asset.step-down-breaker', 'node.step-down-breaker') },
  { penId: 'cc43205', ...stationNode('asset.step-down-breaker', 'node.step-down-breaker') },
  { penId: '35598cd', ...stationNode('asset.step-down-instrument-transformer', 'node.step-down-instrument-transformer') },
  { penId: 'b54dd30', ...stationNode('asset.step-down-instrument-transformer', 'node.step-down-instrument-transformer') },
])
export const STEP_DOWN_SUBSTATION_TOPOLOGY_RUNTIME_BINDING_INDEX = createSubstationTopologyRuntimeBindingIndex(STEP_DOWN_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS)

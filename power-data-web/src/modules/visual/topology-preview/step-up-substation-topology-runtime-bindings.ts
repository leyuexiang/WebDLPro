import { createSubstationTopologyRuntimeBindingIndex, stationNode, type SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/**
 * 将同一业务节点在所有筛选组合中的图元编号汇聚到同一映射。
 * 筛选只改变当前画布显示的图元集合，不能改变二维节点对应的业务节点或 Unity 节点。
 */
const bindNode = (nodeId: string, sceneNodeId: string, penIds: readonly string[]): readonly SubstationTopologyRuntimeBinding[] =>
  penIds.map((penId) => ({ penId, ...stationNode(nodeId, sceneNodeId) }))

/** 升压站全部拓扑变体的测控装置、保护装置图元分别共享对应业务/三维映射。 */
export const STEP_UP_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS: readonly SubstationTopologyRuntimeBinding[] = Object.freeze([
  ...bindNode('system.step-up-protection-control', 'unit.step-up-protection.control', [
    // 只有拓扑里的“保护装置”图元对应 Unity 保护控制节点；“继电保护系统”不属于此映射。
    'db97cd4', '1f43d277', 'c42dd10', '74a60aff', '72b1a2ca',
    'cbce244', '4b527da8', '3d9d0fd8', '35549039', '28846a8b', 'b896e48',
    'a951f70', '5d4dd87a',
  ]),
  ...bindNode('system.step-up-measurement-control', 'unit.step-up-measurement.control', [
    // 测控装置：取消架构层或切换任意组合后仍复用同一三维测控节点。
    'fa826f6', '4c06986', '13483e14', 'db79d7b', '913edd4',
    '446d724', '066cc17', '2e2abf0d', '4182793', '3094af3', '69ccc050',
    '232c36a5', '7ddbeff5',
  ]),
  { penId: '74048c89', ...stationNode('asset.step-up-transformer', 'node.step-up-transformer') },
  { penId: '3b0bb6bd', ...stationNode('asset.step-up-transformer', 'node.step-up-transformer') },
  { penId: '460b2f3c', ...stationNode('asset.step-up-breaker', 'node.step-up-breaker') },
  { penId: 'bdb5432', ...stationNode('asset.step-up-breaker', 'node.step-up-breaker') },
  { penId: '2c20d783', ...stationNode('asset.step-up-instrument-transformer', 'node.step-up-instrument-transformer') },
  { penId: '5effb979', ...stationNode('asset.step-up-instrument-transformer', 'node.step-up-instrument-transformer') },
])
export const STEP_UP_SUBSTATION_TOPOLOGY_RUNTIME_BINDING_INDEX = createSubstationTopologyRuntimeBindingIndex(STEP_UP_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS)

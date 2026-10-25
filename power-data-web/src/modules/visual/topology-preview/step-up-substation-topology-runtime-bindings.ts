import { bindPartnerNode, createSubstationTopologyRuntimeBindingIndex, stationNode, type SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/**
 * 将同一业务节点在所有筛选组合中的图元编号汇聚到同一映射。
 * 筛选只改变当前画布显示的图元集合，不能改变二维节点对应的业务节点或 Unity 节点。
 */
const bindNode = (nodeId: string, sceneNodeId: string, penIds: readonly string[]): readonly SubstationTopologyRuntimeBinding[] =>
  penIds.map((penId) => ({ penId, ...stationNode(nodeId, sceneNodeId) }))

/** 升压站全部拓扑变体的控制层图元和设备层图元分别共享既有业务/三维映射。 */
export const STEP_UP_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS: readonly SubstationTopologyRuntimeBinding[] = Object.freeze([
  // 最新总览 JSON 的四类保护图元只向合作方提供二维状态，不声明 Unity 三维节点映射。
  ...bindPartnerNode('system.step-up-transformer-protection', ['4030a3f7', 'b896e48']),
  ...bindPartnerNode('system.step-up-busbar-protection', ['51a13e4f', '69ccc050']),
  ...bindPartnerNode('system.step-up-line-protection', ['577d774', '358597c2']),
  ...bindPartnerNode('system.step-up-capacitor-protection', ['f94f960', '80b9d96']),
  ...bindNode('system.step-up-protection-control', 'unit.step-up-protection.control', [
    // 只有拓扑里的“保护装置”图元对应 Unity 保护控制节点；“继电保护系统”不属于此映射。
    'db97cd4', '1f43d277', 'c42dd10', '74a60aff', '72b1a2ca',
    'cbce244', '4b527da8', '3d9d0fd8', '35549039',
    'a951f70', '5d4dd87a',
  ]),
  ...bindNode('system.step-up-measurement-control', 'unit.step-up-measurement.control', [
    // 测控装置：取消架构层或切换任意组合后仍复用同一三维测控节点。
    'fa826f6', '4c06986', '13483e14', 'db79d7b', '913edd4',
    '446d724', '066cc17', '2e2abf0d', '4182793',
    '232c36a5', '7ddbeff5',
  ]),
  // 设备层绑定沿用原业务节点和 Unity 节点，只替换为最新 JSON 中的设备图元编号。
  ...bindNode('asset.step-up-transformer', 'node.step-up-transformer', ['c02122e', '3b0bb6bd']),
  ...bindNode('asset.step-up-breaker', 'node.step-up-breaker', ['731b2739', 'bdb5432']),
  ...bindNode('asset.step-up-instrument-transformer', 'node.step-up-instrument-transformer', ['05f7fc1', '5effb979']),
])
export const STEP_UP_SUBSTATION_TOPOLOGY_RUNTIME_BINDING_INDEX = createSubstationTopologyRuntimeBindingIndex(STEP_UP_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS)

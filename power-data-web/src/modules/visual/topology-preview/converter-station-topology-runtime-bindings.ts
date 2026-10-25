import { bindPartnerNode, createSubstationTopologyRuntimeBindingIndex, stationNode, type SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/**
 * 将同一业务节点在所有筛选组合中的图元编号汇聚到同一映射。
 * 筛选只改变当前画布显示的图元集合，不能改变二维节点对应的业务节点或 Unity 节点。
 */
const bindNode = (nodeId: string, sceneNodeId: string, penIds: readonly string[]): readonly SubstationTopologyRuntimeBinding[] =>
  penIds.map((penId) => ({ penId, ...stationNode(nodeId, sceneNodeId) }))

/** 换流站全部拓扑变体的控制层图元和设备层图元分别共享既有业务/三维映射。 */
export const CONVERTER_STATION_TOPOLOGY_RUNTIME_BINDINGS: readonly SubstationTopologyRuntimeBinding[] = Object.freeze([
  // 最新总览 JSON 的四类保护图元只向合作方提供二维状态，不声明 Unity 三维节点映射。
  ...bindPartnerNode('system.converter-transformer-protection', ['38a26897', '7cca61b4']),
  ...bindPartnerNode('system.converter-busbar-protection', ['fdcb31', '3e577b76']),
  ...bindPartnerNode('system.converter-line-protection', ['60a47ba', '6480cfeb']),
  ...bindPartnerNode('system.converter-capacitor-protection', ['25a7b089', '47f9c06']),
  ...bindNode('system.converter-protection-control', 'unit.converter-protection.control', [
    // 只有拓扑里的“保护装置”图元对应 Unity 保护控制节点；“继电保护系统”不属于此映射。
    '1b10c19', '620b00f', 'ab5843e', '10a6c303', '56898748',
    '37d50467', '4c07da', 'e21507c', 'c5c28fd',
    '591f49d', 'db39b86',
  ]),
  ...bindNode('system.converter-measurement-control', 'unit.converter-measurement.control', [
    // 测控装置：取消架构层或切换任意组合后仍复用同一三维测控节点。
    'd9d34cd', 'f5c53', '1ecf12bf', 'a193a8', '2fcaf4',
    'ea95866', '5d212d0b', '1a2db2ec', 'a2acfa1',
    '37017063', '73df224',
  ]),
  // 设备层绑定沿用原业务节点和 Unity 节点，只替换为最新 JSON 中的设备图元编号。
  ...bindNode('asset.converter-transformer', 'node.converter-transformer', ['69bbe1e7', '95de1f8']),
  ...bindNode('asset.converter-valve', 'node.converter-valve', ['dce0bda', '7757ec27']),
  ...bindNode('asset.converter-breaker', 'node.converter-breaker', ['3033c967', '8de776f']),
  ...bindNode('asset.converter-instrument-transformer', 'node.converter-instrument-transformer', ['488082a', '23a5176']),
])
export const CONVERTER_STATION_TOPOLOGY_RUNTIME_BINDING_INDEX = createSubstationTopologyRuntimeBindingIndex(CONVERTER_STATION_TOPOLOGY_RUNTIME_BINDINGS)

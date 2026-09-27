import { createSubstationTopologyRuntimeBindingIndex, stationNode, type SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/**
 * 将同一业务节点在所有筛选组合中的图元编号汇聚到同一映射。
 * 筛选只改变当前画布显示的图元集合，不能改变二维节点对应的业务节点或 Unity 节点。
 */
const bindNode = (nodeId: string, sceneNodeId: string, penIds: readonly string[]): readonly SubstationTopologyRuntimeBinding[] =>
  penIds.map((penId) => ({ penId, ...stationNode(nodeId, sceneNodeId) }))

/** 换流站全部拓扑变体的测控装置、保护装置图元分别共享对应业务/三维映射。 */
export const CONVERTER_STATION_TOPOLOGY_RUNTIME_BINDINGS: readonly SubstationTopologyRuntimeBinding[] = Object.freeze([
  ...bindNode('system.converter-protection-control', 'unit.converter-protection.control', [
    // 只有拓扑里的“保护装置”图元对应 Unity 保护控制节点；“继电保护系统”不属于此映射。
    '1b10c19', '620b00f', 'ab5843e', '10a6c303', '56898748',
    '37d50467', '4c07da', 'e21507c', 'c5c28fd', '79d97146', '84ec315',
    '591f49d', 'db39b86',
  ]),
  ...bindNode('system.converter-measurement-control', 'unit.converter-measurement.control', [
    // 测控装置：取消架构层或切换任意组合后仍复用同一三维测控节点。
    'd9d34cd', 'f5c53', '1ecf12bf', 'a193a8', '2fcaf4',
    'ea95866', '5d212d0b', '1a2db2ec', 'a2acfa1', 'ec686db', '08c0355',
    '37017063', '73df224',
  ]),
  { penId: '6b3b68c5', ...stationNode('system.converter-valve-control', 'unit.converter-valve-control.control') },
  { penId: '2be587e9', ...stationNode('system.converter-valve-control', 'unit.converter-valve-control.control') },
  { penId: '142a4d7', ...stationNode('asset.converter-transformer', 'node.converter-transformer') },
  { penId: '3cef2d22', ...stationNode('asset.converter-transformer', 'node.converter-transformer') },
  { penId: 'dce0bda', ...stationNode('asset.converter-valve', 'node.converter-valve') },
  { penId: '7757ec27', ...stationNode('asset.converter-valve', 'node.converter-valve') },
  { penId: 'd8437c4', ...stationNode('asset.converter-breaker', 'node.converter-breaker') },
  { penId: '56d825e', ...stationNode('asset.converter-breaker', 'node.converter-breaker') },
  { penId: '2cdbfb76', ...stationNode('asset.converter-instrument-transformer', 'node.converter-instrument-transformer') },
  { penId: '04f9d7c', ...stationNode('asset.converter-instrument-transformer', 'node.converter-instrument-transformer') },
])
export const CONVERTER_STATION_TOPOLOGY_RUNTIME_BINDING_INDEX = createSubstationTopologyRuntimeBindingIndex(CONVERTER_STATION_TOPOLOGY_RUNTIME_BINDINGS)

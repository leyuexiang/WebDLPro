import { bindPartnerNode, createSubstationTopologyRuntimeBindingIndex, stationNode, type SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/**
 * 将同一业务节点在所有筛选组合中的图元编号汇聚到同一映射。
 * 筛选只改变当前画布显示的图元集合，不能改变二维节点对应的业务节点或 Unity 节点。
 */
const bindNode = (nodeId: string, sceneNodeId: string, penIds: readonly string[]): readonly SubstationTopologyRuntimeBinding[] =>
  penIds.map((penId) => ({ penId, ...stationNode(nodeId, sceneNodeId) }))

/** 开关站全部拓扑变体的控制层图元和设备层图元分别共享既有业务/三维映射。 */
export const SWITCHING_STATION_TOPOLOGY_RUNTIME_BINDINGS: readonly SubstationTopologyRuntimeBinding[] = Object.freeze([
  // 最新总览 JSON 的三类保护图元只向合作方提供二维状态，不声明 Unity 三维节点映射。
  ...bindPartnerNode('system.switching-busbar-protection', ['438a4677', '6103cbf']),
  ...bindPartnerNode('system.switching-line-protection', ['6d2f0789', '3cdc168', '262bb611']),
  ...bindPartnerNode('system.switching-capacitor-protection', ['9be06bf', '64bc9380']),
  ...bindNode('system.switching-protection-control', 'unit.switching-protection.control', [
    // 只有拓扑里的“保护装置”图元对应 Unity 保护控制节点；“继电保护系统”不属于此映射。
    'ae39506', '41755491', '9e69d20', '6c37e48c', '6280cc7',
    'f4791f9', '73144b5e', '26a5740', '784920c4',
  ]),
  ...bindNode('system.switching-measurement-control', 'unit.switching-measurement.control', [
    // 测控装置：取消架构层或切换任意组合后仍复用同一三维测控节点。
    '398a81ed', 'ffa6b25', '18d0c', '4c264eb2', '7d0b7fde',
    '1b7da779', 'cbcec19', '7459f619', 'c0830e',
  ]),
  // 设备层绑定沿用原业务节点和 Unity 节点，只替换为最新 JSON 中的设备图元编号。
  ...bindNode('asset.switching-breaker', 'node.switching-breaker', ['6350503', '2fa0a22']),
  ...bindNode('asset.switching-instrument-transformer', 'node.switching-instrument-transformer', ['a2d8316', '16529267']),
])
export const SWITCHING_STATION_TOPOLOGY_RUNTIME_BINDING_INDEX = createSubstationTopologyRuntimeBindingIndex(SWITCHING_STATION_TOPOLOGY_RUNTIME_BINDINGS)

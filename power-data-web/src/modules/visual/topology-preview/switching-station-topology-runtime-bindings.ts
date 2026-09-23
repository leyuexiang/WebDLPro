import { createSubstationTopologyRuntimeBindingIndex, stationNode, type SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/** 开关站正式整图中已核验的保护、测量、断路器和互感器图元映射。 */
export const SWITCHING_STATION_TOPOLOGY_RUNTIME_BINDINGS: readonly SubstationTopologyRuntimeBinding[] = Object.freeze([
  { penId: '6fa15c9', ...stationNode('system.switching-measurement-control', 'unit.switching-measurement.control') },
  { penId: '6f96d55', ...stationNode('system.switching-measurement-control', 'unit.switching-measurement.control') },
  { penId: '52bf1ad', ...stationNode('system.switching-protection-control', 'unit.switching-protection.control') },
  { penId: '174032f3', ...stationNode('asset.switching-breaker', 'node.switching-breaker') },
  { penId: '19b9d', ...stationNode('asset.switching-breaker', 'node.switching-breaker') },
  { penId: '31f78f', ...stationNode('asset.switching-instrument-transformer', 'node.switching-instrument-transformer') },
  { penId: '76d94ff', ...stationNode('asset.switching-instrument-transformer', 'node.switching-instrument-transformer') },
])
export const SWITCHING_STATION_TOPOLOGY_RUNTIME_BINDING_INDEX = createSubstationTopologyRuntimeBindingIndex(SWITCHING_STATION_TOPOLOGY_RUNTIME_BINDINGS)

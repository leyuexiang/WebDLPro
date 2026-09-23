import { createSubstationTopologyRuntimeBindingIndex, stationNode, type SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/** 降压站正式整图中已核验的设备图元到业务节点映射。 */
export const STEP_DOWN_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS: readonly SubstationTopologyRuntimeBinding[] = Object.freeze([
  { penId: '4e50604', ...stationNode('unit.step-down-measurement.control', 'unit.step-down-measurement.control') },
  { penId: 'aa56328', ...stationNode('unit.step-down-measurement.control', 'unit.step-down-measurement.control') },
  { penId: '1e663d0', ...stationNode('unit.step-down-protection.control', 'unit.step-down-protection.control') },
  { penId: '244aced6', ...stationNode('node.step-down-transformer', 'node.step-down-transformer') },
  { penId: '394405c6', ...stationNode('node.step-down-transformer', 'node.step-down-transformer') },
  { penId: '1c9afaea', ...stationNode('node.step-down-breaker', 'node.step-down-breaker') },
  { penId: 'cc43205', ...stationNode('node.step-down-breaker', 'node.step-down-breaker') },
  { penId: '35598cd', ...stationNode('node.step-down-instrument-transformer', 'node.step-down-instrument-transformer') },
  { penId: 'b54dd30', ...stationNode('node.step-down-instrument-transformer', 'node.step-down-instrument-transformer') },
])
export const STEP_DOWN_SUBSTATION_TOPOLOGY_RUNTIME_BINDING_INDEX = createSubstationTopologyRuntimeBindingIndex(STEP_DOWN_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS)

import { createSubstationTopologyRuntimeBindingIndex, stationNode, type SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/** 升压站正式整图中已核验的设备图元；同一设备的多个图元汇聚到同一业务节点。 */
export const STEP_UP_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS: readonly SubstationTopologyRuntimeBinding[] = Object.freeze([
  { penId: '3094af3', ...stationNode('unit.step-up-measurement.control', 'unit.step-up-measurement.control') },
  { penId: '69ccc050', ...stationNode('unit.step-up-measurement.control', 'unit.step-up-measurement.control') },
  { penId: '231062e0', ...stationNode('unit.step-up-protection.control', 'unit.step-up-protection.control') },
  { penId: '74048c89', ...stationNode('node.step-up-transformer', 'node.step-up-transformer') },
  { penId: '3b0bb6bd', ...stationNode('node.step-up-transformer', 'node.step-up-transformer') },
  { penId: '460b2f3c', ...stationNode('node.step-up-breaker', 'node.step-up-breaker') },
  { penId: 'bdb5432', ...stationNode('node.step-up-breaker', 'node.step-up-breaker') },
  { penId: '2c20d783', ...stationNode('node.step-up-instrument-transformer', 'node.step-up-instrument-transformer') },
  { penId: '5effb979', ...stationNode('node.step-up-instrument-transformer', 'node.step-up-instrument-transformer') },
])
export const STEP_UP_SUBSTATION_TOPOLOGY_RUNTIME_BINDING_INDEX = createSubstationTopologyRuntimeBindingIndex(STEP_UP_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS)

import { createSubstationTopologyRuntimeBindingIndex, stationNode, type SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/** 换流站正式整图中已核验的换流阀、变压器、断路器和测量保护图元映射。 */
export const CONVERTER_STATION_TOPOLOGY_RUNTIME_BINDINGS: readonly SubstationTopologyRuntimeBinding[] = Object.freeze([
  { penId: 'ec686db', ...stationNode('system.converter-measurement-control', 'unit.converter-measurement.control') },
  { penId: '08c0355', ...stationNode('system.converter-measurement-control', 'unit.converter-measurement.control') },
  { penId: '3ab0c8da', ...stationNode('system.converter-protection-control', 'unit.converter-protection.control') },
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

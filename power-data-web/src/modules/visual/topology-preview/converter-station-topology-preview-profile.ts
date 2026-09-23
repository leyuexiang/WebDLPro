import type { ManifestTopologyPreviewProfile } from './manifest-topology-preview-profile'
import {
  createDefaultConverterStationTopologyFilterSelection,
  formatConverterStationTopologyFilterSelection,
  resolveConverterStationTopologyVariant,
  CONVERTER_STATION_TOPOLOGY_FILTER_GROUPS,
  toggleConverterStationTopologyFilter,
  type ConverterStationTopologyFilterId,
} from './converter-station-topology-layer-filter'
import { loadConverterStationTopologyPreviewData } from './converter-station-topology-preview-data'
import { getConverterStationTopologyTooltipContent } from './converter-station-topology-tooltip'
import { CONVERTER_STATION_TOPOLOGY_RUNTIME_BINDINGS } from './converter-station-topology-runtime-bindings'
import { loadProtectionProcessDetailTopologyData } from './protection-process-detail-topology-data'

/** 换流站业务模块只提供清单能力，画布生命周期与风电共用同一实现。 */
export const CONVERTER_STATION_TOPOLOGY_PREVIEW_PROFILE: ManifestTopologyPreviewProfile = Object.freeze({
  sceneLabel: '换流站',
  defaultVariantId: 'network-business-key-process',
  filterGroups: CONVERTER_STATION_TOPOLOGY_FILTER_GROUPS,
  runtimeBindings: CONVERTER_STATION_TOPOLOGY_RUNTIME_BINDINGS,
  createDefaultSelection: () => createDefaultConverterStationTopologyFilterSelection(),
  toggleFilter: (current: ReadonlySet<string>, filterId: string, checked: boolean) => toggleConverterStationTopologyFilter(
    current as ReadonlySet<ConverterStationTopologyFilterId>,
    filterId as ConverterStationTopologyFilterId,
    checked,
  ),
  resolveVariant: (selected: ReadonlySet<string>) => resolveConverterStationTopologyVariant(
    selected as ReadonlySet<ConverterStationTopologyFilterId>,
  ),
  formatSelection: (selected: ReadonlySet<string>) => formatConverterStationTopologyFilterSelection(
    selected as ReadonlySet<ConverterStationTopologyFilterId>,
  ),
  loadData: (variantId: string, signal?: AbortSignal) => loadConverterStationTopologyPreviewData(
    variantId as never,
    signal,
  ),
  // 换流站第三层与其他变电站共用保护图文件，但上下文仍由场景清单严格限定。
  loadDataContext: loadProtectionProcessDetailTopologyData,
  // 复用保护拓扑公共加载器；上下文编号仍明确限定换流站，避免跨场景状态复用。
  getTooltipContent: getConverterStationTopologyTooltipContent,
})

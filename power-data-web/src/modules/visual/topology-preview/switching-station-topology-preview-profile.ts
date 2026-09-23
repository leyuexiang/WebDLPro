import type { ManifestTopologyPreviewProfile } from './manifest-topology-preview-profile'
import {
  createDefaultSwitchingStationTopologyFilterSelection,
  formatSwitchingStationTopologyFilterSelection,
  resolveSwitchingStationTopologyVariant,
  SWITCHING_STATION_TOPOLOGY_FILTER_GROUPS,
  toggleSwitchingStationTopologyFilter,
  type SwitchingStationTopologyFilterId,
} from './switching-station-topology-layer-filter'
import { loadSwitchingStationTopologyPreviewData } from './switching-station-topology-preview-data'
import { getSwitchingStationTopologyTooltipContent } from './switching-station-topology-tooltip'
import { SWITCHING_STATION_TOPOLOGY_RUNTIME_BINDINGS } from './switching-station-topology-runtime-bindings'
import { loadProtectionProcessDetailTopologyData } from './protection-process-detail-topology-data'

/** 开关站业务模块只提供清单能力，画布生命周期与风电共用同一实现。 */
export const SWITCHING_STATION_TOPOLOGY_PREVIEW_PROFILE: ManifestTopologyPreviewProfile = Object.freeze({
  sceneLabel: '开关站',
  defaultVariantId: 'network-business-key-process',
  filterGroups: SWITCHING_STATION_TOPOLOGY_FILTER_GROUPS,
  runtimeBindings: SWITCHING_STATION_TOPOLOGY_RUNTIME_BINDINGS,
  createDefaultSelection: () => createDefaultSwitchingStationTopologyFilterSelection(),
  toggleFilter: (current: ReadonlySet<string>, filterId: string, checked: boolean) => toggleSwitchingStationTopologyFilter(
    current as ReadonlySet<SwitchingStationTopologyFilterId>,
    filterId as SwitchingStationTopologyFilterId,
    checked,
  ),
  resolveVariant: (selected: ReadonlySet<string>) => resolveSwitchingStationTopologyVariant(
    selected as ReadonlySet<SwitchingStationTopologyFilterId>,
  ),
  formatSelection: (selected: ReadonlySet<string>) => formatSwitchingStationTopologyFilterSelection(
    selected as ReadonlySet<SwitchingStationTopologyFilterId>,
  ),
  loadData: (variantId: string, signal?: AbortSignal) => loadSwitchingStationTopologyPreviewData(
    variantId as never,
    signal,
  ),
  // 开关站第三层仅登记母线、线路保护上下文，统一走显式保护拓扑加载器。
  loadDataContext: loadProtectionProcessDetailTopologyData,
  getTooltipContent: getSwitchingStationTopologyTooltipContent,
})

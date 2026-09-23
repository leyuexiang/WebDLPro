import type { ManifestTopologyPreviewProfile } from './manifest-topology-preview-profile'
import { loadWindTopologyPreviewData } from './wind-topology-preview-data'
import { getWindTopologyTooltipContent } from './wind-topology-tooltip'
import { loadWindProcessDetailTopologyData } from './wind-process-detail-topology-data'
import {
  createDefaultWindTopologyFilterSelection,
  formatWindTopologyFilterSelection,
  resolveWindTopologyVariant,
  toggleWindTopologyFilter,
  WIND_TOPOLOGY_FILTER_GROUPS,
  type WindTopologyFilterId,
} from './wind-topology-layer-filter'

/** 风电现有清单适配到公共画布；所有业务编号仍留在风电模块内部。 */
export const WIND_TOPOLOGY_PREVIEW_PROFILE: ManifestTopologyPreviewProfile = Object.freeze({
  sceneLabel: '风电',
  defaultVariantId: 'network-business-key-process',
  filterGroups: WIND_TOPOLOGY_FILTER_GROUPS,
  createDefaultSelection: () => createDefaultWindTopologyFilterSelection(),
  toggleFilter: (current: ReadonlySet<string>, filterId: string, checked: boolean) => toggleWindTopologyFilter(
    current as ReadonlySet<WindTopologyFilterId>,
    filterId as WindTopologyFilterId,
    checked,
  ),
  resolveVariant: (selected: ReadonlySet<string>) => resolveWindTopologyVariant(
    selected as ReadonlySet<WindTopologyFilterId>,
  ),
  formatSelection: (selected: ReadonlySet<string>) => formatWindTopologyFilterSelection(
    selected as ReadonlySet<WindTopologyFilterId>,
  ),
  loadData: (variantId: string, signal?: AbortSignal) => loadWindTopologyPreviewData(variantId as never, signal),
  loadDataContext: loadWindProcessDetailTopologyData,
  getTooltipContent: getWindTopologyTooltipContent,
})

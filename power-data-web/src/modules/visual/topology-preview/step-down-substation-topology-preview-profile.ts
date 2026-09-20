import type { ManifestTopologyPreviewProfile } from './manifest-topology-preview-profile'
import {
  createDefaultStepDownSubstationTopologyFilterSelection,
  formatStepDownSubstationTopologyFilterSelection,
  resolveStepDownSubstationTopologyVariant,
  STEP_DOWN_SUBSTATION_TOPOLOGY_FILTER_GROUPS,
  toggleStepDownSubstationTopologyFilter,
  type StepDownSubstationTopologyFilterId,
} from './step-down-substation-topology-layer-filter'
import { loadStepDownSubstationTopologyPreviewData } from './step-down-substation-topology-preview-data'
import { getStepDownSubstationTopologyTooltipContent } from './step-down-substation-topology-tooltip'
import { loadProtectionProcessDetailTopologyData } from './protection-process-detail-topology-data'

/** 降压站业务模块只提供清单能力，画布生命周期与风电共用同一实现。 */
export const STEP_DOWN_SUBSTATION_TOPOLOGY_PREVIEW_PROFILE: ManifestTopologyPreviewProfile = Object.freeze({
  sceneLabel: '降压站',
  defaultVariantId: 'network-business-key-process',
  filterGroups: STEP_DOWN_SUBSTATION_TOPOLOGY_FILTER_GROUPS,
  createDefaultSelection: () => createDefaultStepDownSubstationTopologyFilterSelection(),
  toggleFilter: (current: ReadonlySet<string>, filterId: string, checked: boolean) => toggleStepDownSubstationTopologyFilter(
    current as ReadonlySet<StepDownSubstationTopologyFilterId>,
    filterId as StepDownSubstationTopologyFilterId,
    checked,
  ),
  resolveVariant: (selected: ReadonlySet<string>) => resolveStepDownSubstationTopologyVariant(
    selected as ReadonlySet<StepDownSubstationTopologyFilterId>,
  ),
  formatSelection: (selected: ReadonlySet<string>) => formatStepDownSubstationTopologyFilterSelection(
    selected as ReadonlySet<StepDownSubstationTopologyFilterId>,
  ),
  loadData: (variantId: string, signal?: AbortSignal) => loadStepDownSubstationTopologyPreviewData(
    variantId as never,
    signal,
  ),
  // 三个站类场景共用加载器和源文件缓存，逻辑状态仍由场景限定的上下文绑定隔离。
  loadDataContext: loadProtectionProcessDetailTopologyData,
  getTooltipContent: getStepDownSubstationTopologyTooltipContent,
})

import type { ManifestTopologyPreviewProfile } from './manifest-topology-preview-profile'
import {
  createDefaultStepUpSubstationTopologyFilterSelection,
  formatStepUpSubstationTopologyFilterSelection,
  resolveStepUpSubstationTopologyVariant,
  STEP_UP_SUBSTATION_TOPOLOGY_FILTER_GROUPS,
  toggleStepUpSubstationTopologyFilter,
  type StepUpSubstationTopologyFilterId,
} from './step-up-substation-topology-layer-filter'
import { loadStepUpSubstationTopologyPreviewData } from './step-up-substation-topology-preview-data'
import { getStepUpSubstationTopologyTooltipContent } from './step-up-substation-topology-tooltip'
import { STEP_UP_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS } from './step-up-substation-topology-runtime-bindings'
import { loadProtectionProcessDetailTopologyData } from './protection-process-detail-topology-data'

/** 升压站业务模块只提供清单能力，画布生命周期与风电共用同一实现。 */
export const STEP_UP_SUBSTATION_TOPOLOGY_PREVIEW_PROFILE: ManifestTopologyPreviewProfile = Object.freeze({
  sceneLabel: '升压站',
  defaultVariantId: 'network-business-key-process',
  filterGroups: STEP_UP_SUBSTATION_TOPOLOGY_FILTER_GROUPS,
  runtimeBindings: STEP_UP_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS,
  createDefaultSelection: () => createDefaultStepUpSubstationTopologyFilterSelection(),
  toggleFilter: (current: ReadonlySet<string>, filterId: string, checked: boolean) => toggleStepUpSubstationTopologyFilter(
    current as ReadonlySet<StepUpSubstationTopologyFilterId>,
    filterId as StepUpSubstationTopologyFilterId,
    checked,
  ),
  resolveVariant: (selected: ReadonlySet<string>) => resolveStepUpSubstationTopologyVariant(
    selected as ReadonlySet<StepUpSubstationTopologyFilterId>,
  ),
  formatSelection: (selected: ReadonlySet<string>) => formatStepUpSubstationTopologyFilterSelection(
    selected as ReadonlySet<StepUpSubstationTopologyFilterId>,
  ),
  loadData: (variantId: string, signal?: AbortSignal) => loadStepUpSubstationTopologyPreviewData(
    variantId as never,
    signal,
  ),
  // 第三层保护拓扑必须按显式上下文加载，禁止由页面标题或文件名推断路径。
  loadDataContext: loadProtectionProcessDetailTopologyData,
  // 第三层保护图只按显式上下文加载，不依据页面标题或源文件名推断。
  getTooltipContent: getStepUpSubstationTopologyTooltipContent,
})

import {
  STEP_DOWN_SUBSTATION_DEFAULT_TOPOLOGY_VARIANT,
  STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANT_BY_COMBINATION_KEY,
  type StepDownSubstationTopologyCombinationKey,
  type StepDownSubstationTopologyLayerId,
} from './step-down-substation-topology-variant-manifest'

export type StepDownSubstationTopologyFilterId = StepDownSubstationTopologyLayerId

/** 四层显示顺序和公共筛选轨颜色与现有燃气、燃煤拓扑保持一致。 */
export const STEP_DOWN_SUBSTATION_TOPOLOGY_FILTER_GROUPS = Object.freeze([
  { id: 'architecture', options: Object.freeze([{ id: 'architecture', label: '架构层', color: '#60a5fa' }]) },
  { id: 'network', options: Object.freeze([{ id: 'network', label: '网络层', color: '#d19a2a' }]) },
  { id: 'business', options: Object.freeze([{ id: 'business', label: '业务层', color: '#5ebd66' }]) },
  { id: 'key-process', options: Object.freeze([{ id: 'key-process', label: '关键环节层', color: '#ef5d5d' }]) },
] as const)

/** 非架构层固定排序同时用于组合键、缓存键和提示文案。 */
const CONTENT_LAYER_IDS: readonly Exclude<StepDownSubstationTopologyLayerId, 'architecture'>[] = Object.freeze([
  'network', 'business', 'key-process',
])

/** 默认打开显式登记的三层整图。 */
export function createDefaultStepDownSubstationTopologyFilterSelection(): ReadonlySet<StepDownSubstationTopologyFilterId> {
  return new Set(STEP_DOWN_SUBSTATION_DEFAULT_TOPOLOGY_VARIANT.layerIds)
}

/** 架构层和内容层互斥；三个内容层保留用户已有选择并允许命中独立组合文件。 */
export function toggleStepDownSubstationTopologyFilter(
  current: ReadonlySet<StepDownSubstationTopologyFilterId>,
  filterId: StepDownSubstationTopologyFilterId,
  checked: boolean,
): ReadonlySet<StepDownSubstationTopologyFilterId> {
  if (filterId === 'architecture') {
    return checked ? new Set<StepDownSubstationTopologyFilterId>(['architecture']) : new Set()
  }
  const next = new Set(current)
  if (checked) {
    next.delete('architecture')
    next.add(filterId)
  } else next.delete(filterId)
  return next
}

/** 只规范化合法集合，不读取图元或拼接输入文件。 */
export function createStepDownSubstationTopologyCombinationKey(
  selected: ReadonlySet<StepDownSubstationTopologyFilterId>,
): StepDownSubstationTopologyCombinationKey | undefined {
  if (selected.has('architecture')) return selected.size === 1 ? 'architecture' : undefined
  const contentLayers = CONTENT_LAYER_IDS.filter((layerId) => selected.has(layerId))
  if (contentLayers.length === 0 || contentLayers.length !== selected.size) return undefined
  return contentLayers.join('+') as StepDownSubstationTopologyCombinationKey
}

/** 精确组合只命中一份已登记整图；空集合或非法集合不会发起请求。 */
export function resolveStepDownSubstationTopologyVariant(selected: ReadonlySet<StepDownSubstationTopologyFilterId>) {
  const key = createStepDownSubstationTopologyCombinationKey(selected)
  return key ? STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANT_BY_COMBINATION_KEY.get(key) : undefined
}

/** 提示文案只展示当前语义集合，不参与版本推断。 */
export function formatStepDownSubstationTopologyFilterSelection(
  selected: ReadonlySet<StepDownSubstationTopologyFilterId>,
): string {
  const labels = STEP_DOWN_SUBSTATION_TOPOLOGY_FILTER_GROUPS.flatMap((group) => (
    group.options
      .filter((option) => selected.has(option.id as StepDownSubstationTopologyFilterId))
      .map((option) => option.label)
  ))
  return labels.length > 0 ? labels.join('＋') : '未选择层级'
}

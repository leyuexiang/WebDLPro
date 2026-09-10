import {
  COAL_DEFAULT_TOPOLOGY_VARIANT,
  COAL_TOPOLOGY_VARIANT_BY_COMBINATION_KEY,
  type CoalTopologyCombinationKey,
  type CoalTopologyLayerId,
  type CoalTopologyVariantManifestEntry,
} from './coal-topology-variant-manifest'

export type CoalTopologyFilterId = CoalTopologyLayerId

export interface CoalTopologyFilterOption {
  readonly id: CoalTopologyFilterId
  readonly label: string
  readonly color: string
}

export interface CoalTopologyFilterGroup {
  readonly id: string
  readonly options: readonly CoalTopologyFilterOption[]
}

/** 四层顺序与产品定义一致；公共筛选轨只负责显示和转发事件。 */
export const COAL_TOPOLOGY_FILTER_GROUPS = Object.freeze([
  { id: 'architecture', options: Object.freeze([{ id: 'architecture', label: '架构层', color: '#60a5fa' }]) },
  { id: 'network', options: Object.freeze([{ id: 'network', label: '网络层', color: '#d19a2a' }]) },
  { id: 'business', options: Object.freeze([{ id: 'business', label: '业务层', color: '#5ebd66' }]) },
  { id: 'key-process', options: Object.freeze([{ id: 'key-process', label: '关键环节层', color: '#ef5d5d' }]) },
] as const satisfies readonly CoalTopologyFilterGroup[])

/** 非架构层固定顺序同时用于文件清单、缓存键与提示文案。 */
const CONTENT_LAYER_IDS: readonly Exclude<CoalTopologyLayerId, 'architecture'>[] = Object.freeze([
  'network', 'business', 'key-process',
])

/** 默认打开显式提供的燃煤三层整图；架构层不再充当全选开关。 */
export function createDefaultCoalTopologyFilterSelection(): ReadonlySet<CoalTopologyFilterId> {
  return new Set(COAL_DEFAULT_TOPOLOGY_VARIANT.layerIds)
}

/** 勾选架构层清空其余层；勾选任一其余层清空架构层，非架构层允许组合。 */
export function toggleCoalTopologyFilter(
  current: ReadonlySet<CoalTopologyFilterId>,
  filterId: CoalTopologyFilterId,
  checked: boolean,
): ReadonlySet<CoalTopologyFilterId> {
  if (filterId === 'architecture') {
    return checked ? new Set<CoalTopologyFilterId>(['architecture']) : new Set<CoalTopologyFilterId>()
  }
  const next = new Set(current)
  if (checked) {
    next.delete('architecture')
    next.add(filterId)
  } else next.delete(filterId)
  return next
}

/** 只把合法集合转换为已登记组合键，禁止运行时合并或逐图元显隐。 */
export function createCoalTopologyCombinationKey(
  selected: ReadonlySet<CoalTopologyFilterId>,
): CoalTopologyCombinationKey | undefined {
  if (selected.has('architecture')) return selected.size === 1 ? 'architecture' : undefined
  const selectedContentLayers = CONTENT_LAYER_IDS.filter((layerId) => selected.has(layerId))
  if (selectedContentLayers.length !== selected.size || selectedContentLayers.length === 0) return undefined
  return selectedContentLayers.join('+') as CoalTopologyCombinationKey
}

/** 组合必须精确命中一份已登记输入文件，未命中时由画布保留当前内容并提示。 */
export function resolveCoalTopologyVariant(
  selected: ReadonlySet<CoalTopologyFilterId>,
): CoalTopologyVariantManifestEntry | undefined {
  const key = createCoalTopologyCombinationKey(selected)
  return key ? COAL_TOPOLOGY_VARIANT_BY_COMBINATION_KEY.get(key) : undefined
}

/** 生成非阻塞提示文案，不参与图元识别或文件推断。 */
export function formatCoalTopologyFilterSelection(selected: ReadonlySet<CoalTopologyFilterId>): string {
  const labels = COAL_TOPOLOGY_FILTER_GROUPS.flatMap((group) => (
    group.options.filter((option) => selected.has(option.id)).map((option) => option.label)
  ))
  return labels.length > 0 ? labels.join('＋') : '未选择层级'
}

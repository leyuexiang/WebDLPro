import {
  GAS_V3_DEFAULT_TOPOLOGY_VARIANT,
  GAS_V3_TOPOLOGY_VARIANT_BY_COMBINATION_KEY,
  type GasV3TopologyCombinationKey,
  type GasV3TopologyLayerId,
  type GasV3TopologyVariantManifestEntry,
} from './gas-v3-topology-variant-manifest'

export type GasV3TopologyFilterId = GasV3TopologyLayerId

export interface GasV3TopologyFilterOption {
  readonly id: GasV3TopologyFilterId
  readonly label: string
  readonly color: string
}

export interface GasV3TopologyFilterGroup {
  readonly id: string
  readonly options: readonly GasV3TopologyFilterOption[]
}

/** 四层筛选顺序与产品定义保持一致；公共竖向筛选轨只负责显示和转发勾选事件。 */
export const GAS_V3_TOPOLOGY_FILTER_GROUPS = Object.freeze([
  { id: 'architecture', options: Object.freeze([{ id: 'architecture', label: '架构层', color: '#60a5fa' }]) },
  { id: 'network', options: Object.freeze([{ id: 'network', label: '网络层', color: '#d19a2a' }]) },
  { id: 'business', options: Object.freeze([{ id: 'business', label: '业务层', color: '#5ebd66' }]) },
  { id: 'key-process', options: Object.freeze([{ id: 'key-process', label: '关键环节层', color: '#ef5d5d' }]) },
] as const satisfies readonly GasV3TopologyFilterGroup[])

/** 非架构层的固定组合顺序同时用于文件清单、缓存键和缺失输入提示。 */
const CONTENT_LAYER_IDS: readonly Exclude<GasV3TopologyLayerId, 'architecture'>[] = Object.freeze([
  'network', 'business', 'key-process',
])

/** 默认直接打开显式提供的燃气第三版整图，不再把架构层当作其余层的聚合开关。 */
export function createDefaultGasV3TopologyFilterSelection(): ReadonlySet<GasV3TopologyFilterId> {
  return new Set(GAS_V3_DEFAULT_TOPOLOGY_VARIANT.layerIds)
}

/**
 * 更新单个层级勾选：架构层被选中时清空其余层；任一其余层被选中时清空架构层。
 * 非架构层之间允许任意组合，函数只操作最多四项集合，不读取或修改画布图元。
 */
export function toggleGasV3TopologyFilter(
  current: ReadonlySet<GasV3TopologyFilterId>,
  filterId: GasV3TopologyFilterId,
  checked: boolean,
): ReadonlySet<GasV3TopologyFilterId> {
  if (filterId === 'architecture') {
    return checked ? new Set<GasV3TopologyFilterId>(['architecture']) : new Set<GasV3TopologyFilterId>()
  }

  const next = new Set(current)
  if (checked) {
    next.delete('architecture')
    next.add(filterId)
  } else {
    next.delete(filterId)
  }
  return next
}

/**
 * 将合法勾选集合规范化为清单组合键。空集合、架构层与其他层并存等无效状态返回空值，
 * 防止调用方对不存在的组合发起网络请求或在运行时拼接多个文件。
 */
export function createGasV3TopologyCombinationKey(
  selected: ReadonlySet<GasV3TopologyFilterId>,
): GasV3TopologyCombinationKey | undefined {
  if (selected.has('architecture')) return selected.size === 1 ? 'architecture' : undefined
  const selectedContentLayers = CONTENT_LAYER_IDS.filter((layerId) => selected.has(layerId))
  if (selectedContentLayers.length !== selected.size || selectedContentLayers.length === 0) return undefined
  return selectedContentLayers.join('+') as GasV3TopologyCombinationKey
}

/** 组合必须精确命中一份已登记输入文件；缺失组合由画布组件保留当前数据并提示。 */
export function resolveGasV3TopologyVariant(
  selected: ReadonlySet<GasV3TopologyFilterId>,
): GasV3TopologyVariantManifestEntry | undefined {
  const combinationKey = createGasV3TopologyCombinationKey(selected)
  return combinationKey ? GAS_V3_TOPOLOGY_VARIANT_BY_COMBINATION_KEY.get(combinationKey) : undefined
}

/** 用于非阻塞提示的中文层级名称，不参与文件或图元识别。 */
export function formatGasV3TopologyFilterSelection(selected: ReadonlySet<GasV3TopologyFilterId>): string {
  const labels = GAS_V3_TOPOLOGY_FILTER_GROUPS.flatMap((group) => (
    group.options.filter((option) => selected.has(option.id)).map((option) => option.label)
  ))
  return labels.length > 0 ? labels.join('＋') : '未选择层级'
}

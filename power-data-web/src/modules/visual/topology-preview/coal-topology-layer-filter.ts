import type { Pen } from '@meta2d/core'

/**
 * 新版燃煤拓扑的筛选编号。
 *
 * “架构层”是全部内容的快捷开关，其余编号对应用户可单独勾选的内容范围。编号不使用中文标题，
 * 从而避免数据文字换行、空格或后续文案调整造成筛选状态漂移。
 */
export type CoalTopologyFilterId =
  | 'architecture'
  | 'network'
  | 'physical'
  | 'business'

export interface CoalTopologyFilterOption {
  readonly id: CoalTopologyFilterId
  readonly label: string
  readonly color: string
}

export interface CoalTopologyFilterGroup {
  readonly id: string
  readonly label: string
  readonly options: readonly CoalTopologyFilterOption[]
}

/** 某个图元需要同时满足的筛选层；未声明时沿用所属层任一开启即可显示。 */
export interface CoalTopologyVisibilityRule {
  readonly tags: readonly CoalTopologyFilterId[]
  readonly requiredFilterIds?: readonly CoalTopologyFilterId[]
}

/** 筛选栏按设计稿顺序展示；每组最终只渲染一个顶层复选框。 */
export const COAL_TOPOLOGY_FILTER_GROUPS = [
  {
    id: 'architecture',
    label: '架构层',
    options: Object.freeze([
      { id: 'architecture', label: '架构层', color: '#60a5fa' },
    ]),
  },
  {
    id: 'network',
    label: '网络层',
    options: Object.freeze([
      { id: 'network', label: '网络层', color: '#d19a2a' },
    ]),
  },
  {
    id: 'physical',
    label: '物理层',
    options: Object.freeze([
      { id: 'physical', label: '物理层', color: '#ef5d5d' },
    ]),
  },
  {
    id: 'business',
    label: '业务层',
    options: Object.freeze([
      { id: 'business', label: '业务层', color: '#5ebd66' },
    ]),
  },
] as const satisfies readonly CoalTopologyFilterGroup[]

/** 四个顶层复选框的固定顺序，用于状态初始化和显隐判断。 */
export const COAL_TOPOLOGY_CONTENT_FILTER_IDS: readonly CoalTopologyFilterId[] = Object.freeze(
  ['architecture', 'network', 'physical', 'business'],
)

/** 新图纸初始状态与参考筛选栏一致：四个顶层内容全部可见。 */
export function createDefaultCoalTopologyFilterSelection(): ReadonlySet<CoalTopologyFilterId> {
  return new Set<CoalTopologyFilterId>(COAL_TOPOLOGY_CONTENT_FILTER_IDS)
}

/**
 * 处理一次复选框变化。
 *
 * 架构层是全选状态：开启时恢复全部内容，关闭时清空全部内容；三个内容层独立切换，
 * 只有三层全部开启时架构层才保持勾选。
 */
export function toggleCoalTopologyFilter(
  current: ReadonlySet<CoalTopologyFilterId>,
  filterId: CoalTopologyFilterId,
  checked: boolean,
): ReadonlySet<CoalTopologyFilterId> {
  if (filterId === 'architecture') {
    return checked
      ? createDefaultCoalTopologyFilterSelection()
      : new Set<CoalTopologyFilterId>()
  }

  const next = new Set<CoalTopologyFilterId>(current)
  // 内容层发生变化后，架构层只能由“三层全选”推导，不能继续沿用旧的全选标记。
  next.delete('architecture')
  if (checked) next.add(filterId)
  else next.delete(filterId)
  if (COAL_TOPOLOGY_CONTENT_FILTER_IDS
    .filter((id) => id !== 'architecture')
    .every((id) => next.has(id))) next.add('architecture')
  return next
}

interface PenBounds {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

interface SectionRule {
  readonly filterId: CoalTopologyFilterId
  readonly sectionPenId: string
}

/** 过滤浮点坐标计算产生的微小误差，避免相邻背景区被误判为相互重叠。 */
const BOUNDS_EPSILON = 1e-6

/** 架构层只负责承载拓扑分区边界和分组框，不与网络、物理、业务内容混用。 */
const ARCHITECTURE_PEN_IDS: ReadonlySet<string> = new Set([
  'a3ccee3', 'ba3df5b', '193eacbe', '2ce9ba7c', '5381c5cc', '596a1783', '8a9dd95',
  '13be209', 'ddae04', '68cd2dfd', '791b3a5c', '27cf5098', '92cd305',
])

/**
 * 监控层下沿到现场控制与保护区上沿的两条过渡线只属于网络层。
 * 若把它们同时归入物理层，关闭网络层而保留物理层时会出现残留连线。
 */
const NETWORK_ONLY_TRANSITION_LINE_IDS: ReadonlySet<string> = new Set([
  // 监控层下方两根连接线。
  '2ada69ed', '6195d78f',
  // 监控层至现场控制与保护区上方两根连接线。
  '0ef2e0c', '41a65fbd',
  // 监控层设备连接到现场控制站群的折线路径；虽然几何范围跨过物理区，业务归属仍只有网络层。
  '5892355', 'e4e27bf', '46e9684e', 'dd1fb6d',
  '7319d27', '10086fb5', '787eed69', '341872ef', 'bf14b0d', '10d4f903',
  '48baeb52', '5924088b', '1156474', '19417610', '7f50fc9', '57b894da', '29184f85',
])

/**
 * 现场控制与保护区到现场设备的竖向连接只属于物理层。
 * 这些连线几何上跨过两个外框，不能直接按外框交集生成“网络层或物理层”的宽松规则。
 */
const PHYSICAL_ONLY_CONNECTION_LINE_IDS: ReadonlySet<string> = new Set([
  '6fb4ba37', 'a103092', '34d8eaec', '65d3121c', '3724818e', '3ad6d36b', '357185f8',
])

/** 现场设备到工艺流程的竖向连线要求物理层和业务层同时开启。 */
const PHYSICAL_AND_BUSINESS_CONNECTION_LINE_IDS: ReadonlySet<string> = new Set([
  '227fd09', '062b8c', '5974e358', 'f780e90', 'c0dbf23', '5aeb38d8', '10ee7def',
])

/**
 * 工艺流程内部虚线只属于业务层。
 * 物理层关闭时，业务流程关系仍应保留，不能把虚线错误地当成现场设备连接。
 */
const BUSINESS_ONLY_CONNECTION_LINE_IDS: ReadonlySet<string> = new Set([
  '68f8be1a', '5adb1fe0', '17fb54b1', '3b822732', '2b25106',
  '4a12dcf1', '3c451bed', 'adec629', '34da6b95',
])

/**
 * 外层区域由 JSON（数据交换格式）中的固定图元编号登记，不按标题、坐标或图片地址猜测节点。
 * 网络层包含企业办公网、工业非军事区、监控层和现场控制与保护区；物理层包含现场控制与保护区、现场设备。
 */
const SECTION_RULES: readonly SectionRule[] = Object.freeze([
  { filterId: 'network', sectionPenId: 'ba3df5b' },
  { filterId: 'network', sectionPenId: '193eacbe' },
  { filterId: 'network', sectionPenId: '2ce9ba7c' },
  { filterId: 'network', sectionPenId: '5381c5cc' },
  { filterId: 'physical', sectionPenId: '5381c5cc' },
  { filterId: 'physical', sectionPenId: '596a1783' },
  { filterId: 'business', sectionPenId: '8a9dd95' },
])

function readPenBounds(pen: Pen): PenBounds | undefined {
  if (![pen.x, pen.y, pen.width, pen.height].every((value) => typeof value === 'number' && Number.isFinite(value))) return undefined
  return {
    top: pen.y!,
    bottom: pen.y! + pen.height!,
    left: pen.x!,
    right: pen.x! + pen.width!,
  }
}

/**
 * 判断两个图元边界是否有实际交集。
 * 对零宽或零高连线使用端点包含判断，保证横向/纵向连线仍能归属到对应区域。
 */
function boundsOverlap(first: PenBounds, second: PenBounds): boolean {
  const horizontal = first.left === first.right || second.left === second.right
    ? first.left >= second.left - BOUNDS_EPSILON && first.left <= second.right + BOUNDS_EPSILON
      || second.left >= first.left - BOUNDS_EPSILON && second.left <= first.right + BOUNDS_EPSILON
    : first.left < second.right - BOUNDS_EPSILON && second.left < first.right - BOUNDS_EPSILON
  const vertical = first.top === first.bottom || second.top === second.bottom
    ? first.top >= second.top - BOUNDS_EPSILON && first.top <= second.bottom + BOUNDS_EPSILON
      || second.top >= first.top - BOUNDS_EPSILON && second.top <= first.bottom + BOUNDS_EPSILON
    : first.top < second.bottom - BOUNDS_EPSILON && second.top < first.bottom - BOUNDS_EPSILON
  return horizontal && vertical
}

/**
 * 为每个原始图元生成不可变层级标签。
 *
 * 组合逻辑只运行一次：外层框按登记规则绑定，框内节点和连线按几何交集继承区域；状态点、
 * 选择和显隐热路径后续都只读取 Map（映射表），不会重复扫描标题或重新遍历整份 JSON。
 */
export function createCoalTopologyLayerBindingIndex(pens: readonly Pen[]): ReadonlyMap<string, readonly CoalTopologyFilterId[]> {
  const penById = new Map(pens.filter((pen) => Boolean(pen.id)).map((pen) => [pen.id, pen]))
  const sectionBounds = SECTION_RULES.flatMap((rule) => {
    const pen = penById.get(rule.sectionPenId)
    const bounds = pen ? readPenBounds(pen) : undefined
    return bounds ? [{ rule, bounds }] : []
  })
  const tagsByPenId = new Map<string, readonly CoalTopologyFilterId[]>()

  for (const pen of pens) {
    if (!pen.id) continue
    const penBounds = readPenBounds(pen)
    if (!penBounds) {
      tagsByPenId.set(pen.id, Object.freeze([]))
      continue
    }

    const tags = new Set<CoalTopologyFilterId>()
    if (ARCHITECTURE_PEN_IDS.has(pen.id)) tags.add('architecture')
    for (const section of sectionBounds) {
      if (pen.id === section.rule.sectionPenId || boundsOverlap(penBounds, section.bounds)) {
        tags.add(section.rule.filterId)
      }
    }
    if (NETWORK_ONLY_TRANSITION_LINE_IDS.has(pen.id)) {
      tags.clear()
      tags.add('network')
    } else if (PHYSICAL_ONLY_CONNECTION_LINE_IDS.has(pen.id)) {
      tags.clear()
      tags.add('physical')
    } else if (PHYSICAL_AND_BUSINESS_CONNECTION_LINE_IDS.has(pen.id)) {
      tags.clear()
      tags.add('physical')
      tags.add('business')
    } else if (BUSINESS_ONLY_CONNECTION_LINE_IDS.has(pen.id)) {
      tags.clear()
      tags.add('business')
    }
    tagsByPenId.set(pen.id, Object.freeze([...tags]))
  }

  return tagsByPenId
}

/**
 * 创建带组合条件的显隐规则索引。
 *
 * 复用层级索引中的普通标签，同时只为少量跨层连线追加 requiredFilterIds（必选层集合），
 * 避免在每次复选框变化时重新按坐标扫描全部图元。返回值按图元编号常数时间读取。
 */
export function createCoalTopologyVisibilityRuleIndex(
  pens: readonly Pen[],
  tagsByPenId: ReadonlyMap<string, readonly CoalTopologyFilterId[]> = createCoalTopologyLayerBindingIndex(pens),
): ReadonlyMap<string, CoalTopologyVisibilityRule> {
  const rules = new Map<string, CoalTopologyVisibilityRule>()
  for (const pen of pens) {
    if (!pen.id) continue
    const tags = tagsByPenId.get(pen.id) ?? []
    const requiredFilterIds = PHYSICAL_AND_BUSINESS_CONNECTION_LINE_IDS.has(pen.id)
      ? ['physical', 'business'] as const
      : PHYSICAL_ONLY_CONNECTION_LINE_IDS.has(pen.id)
        ? ['physical'] as const
        : NETWORK_ONLY_TRANSITION_LINE_IDS.has(pen.id)
          ? ['network'] as const
          : BUSINESS_ONLY_CONNECTION_LINE_IDS.has(pen.id)
            ? ['business'] as const
          : undefined
    rules.set(pen.id, { tags, requiredFilterIds })
  }
  return rules
}

/** 依据当前筛选状态判断单个图元是否可见；任一所属顶层范围开启即可显示。 */
export function isCoalTopologyPenVisible(
  penId: string,
  tagsByPenId: ReadonlyMap<string, readonly CoalTopologyFilterId[]>,
  selected: ReadonlySet<CoalTopologyFilterId>,
  visibilityRules?: ReadonlyMap<string, CoalTopologyVisibilityRule>,
): boolean {
  if (selected.has('architecture')) return true
  const rule = visibilityRules?.get(penId)
  if (rule?.requiredFilterIds) return rule.requiredFilterIds.every((filterId) => selected.has(filterId))
  return (rule?.tags ?? tagsByPenId.get(penId) ?? []).some((tag) => tag !== 'architecture' && selected.has(tag))
}

/** 初次打开和筛选切换共用同一纯函数，避免画布状态与 JSON 的 visible 字段出现两套规则。 */
export function applyCoalTopologyLayerVisibility(
  pens: Pen[],
  tagsByPenId: ReadonlyMap<string, readonly CoalTopologyFilterId[]>,
  selected: ReadonlySet<CoalTopologyFilterId>,
  visibilityRules?: ReadonlyMap<string, CoalTopologyVisibilityRule>,
): void {
  for (const pen of pens) {
    if (pen.id) pen.visible = isCoalTopologyPenVisible(pen.id, tagsByPenId, selected, visibilityRules)
  }
}


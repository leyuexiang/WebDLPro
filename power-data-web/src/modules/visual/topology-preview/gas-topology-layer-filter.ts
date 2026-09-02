import type { Pen } from '@meta2d/core'

/**
 * 新版燃气拓扑的筛选编号。
 *
 * “架构层”是全部内容的快捷开关，其余编号对应用户可单独勾选的内容范围。编号不使用中文标题，
 * 从而避免数据文字换行、空格或后续文案调整造成筛选状态漂移。
 */
export type GasTopologyFilterId =
  | 'architecture'
  | 'network'
  | 'physical'
  | 'business'

export interface GasTopologyFilterOption {
  readonly id: GasTopologyFilterId
  readonly label: string
  readonly color: string
}

export interface GasTopologyFilterGroup {
  readonly id: string
  readonly label: string
  readonly options: readonly GasTopologyFilterOption[]
}

/** 某个图元需要同时满足的筛选层；未声明时沿用所属层任一开启即可显示。 */
export interface GasTopologyVisibilityRule {
  readonly tags: readonly GasTopologyFilterId[]
  readonly requiredFilterIds?: readonly GasTopologyFilterId[]
}

/** 筛选栏按设计稿顺序展示；每组最终只渲染一个顶层复选框。 */
export const GAS_TOPOLOGY_FILTER_GROUPS = [
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
] as const satisfies readonly GasTopologyFilterGroup[]

/** 四个顶层复选框的固定顺序，用于状态初始化和显隐判断。 */
export const GAS_TOPOLOGY_CONTENT_FILTER_IDS: readonly GasTopologyFilterId[] = Object.freeze(
  ['architecture', 'network', 'physical', 'business'],
)

/** 新图纸初始状态与参考筛选栏一致：四个顶层内容全部可见。 */
export function createDefaultGasTopologyFilterSelection(): ReadonlySet<GasTopologyFilterId> {
  return new Set<GasTopologyFilterId>(GAS_TOPOLOGY_CONTENT_FILTER_IDS)
}

/**
 * 处理一次复选框变化。
 *
 * 架构层是全选状态：开启时恢复全部内容，关闭时清空全部内容；三个内容层独立切换，
 * 只有三层全部开启时架构层才保持勾选。
 */
export function toggleGasTopologyFilter(
  current: ReadonlySet<GasTopologyFilterId>,
  filterId: GasTopologyFilterId,
  checked: boolean,
): ReadonlySet<GasTopologyFilterId> {
  if (filterId === 'architecture') {
    return checked
      ? createDefaultGasTopologyFilterSelection()
      : new Set<GasTopologyFilterId>()
  }

  const next = new Set<GasTopologyFilterId>(current)
  // 内容层发生变化后，架构层只能由“三层全选”推导，不能继续沿用旧的全选标记。
  next.delete('architecture')
  if (checked) next.add(filterId)
  else next.delete(filterId)
  if (GAS_TOPOLOGY_CONTENT_FILTER_IDS
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
  readonly filterId: GasTopologyFilterId
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
 * 新图纸把七组监控设备组合为父子图元，子图元坐标相对父级保存，不能再用顶层绝对坐标判层。
 * 这里按新 JSON 中的稳定编号显式登记组合框和监控层接线占位框；子图元通过 parentId（父图元标识）
 * 继承网络层，避免关闭网络层后相对坐标图元残留，也避免把组合框底沿误判到物理层。
 */
const NETWORK_ONLY_PEN_IDS: ReadonlySet<string> = new Set([
  // 七个控制系统监控组合框。
  '3a026d', '273947ed', '55f6286e', '77b88b', 'ab259f2', 'b8941a3', 'b042dc4',
  // 组合框到现场控制系统之间的七个接线占位框。
  '4646926d', '7cf5df6', '4d272a46', '4631dbb', '2a398ae1', '194fe68c', '3854e04',
])

/**
 * 监控层下沿到现场控制与保护区上沿的两条过渡线只属于网络层。
 * 若把它们同时归入物理层，关闭网络层而保留物理层时会出现残留连线。
 */
const NETWORK_ONLY_TRANSITION_LINE_IDS: ReadonlySet<string> = new Set([
  // 企业办公网、工业非军事区和监控层之间的六条已连接线路。
  'fab3076', '60b2f0', '2019bf53', '25fe462d', '889b6c', '3885b84',
  // 七组监控设备到现场控制系统的连接；端点关系直接取自新版 JSON 的 connectedLines（已连接线路）字段。
  '3635ba34', '1128aba', '8a7eebc', '31f33786', '88b5b81', '6237dffb', '6a5459ac',
])

/**
 * 现场控制与保护区到现场设备的竖向连接只属于物理层。
 * 这些连线几何上跨过两个外框，不能直接按外框交集生成“网络层或物理层”的宽松规则。
 */
const PHYSICAL_ONLY_CONNECTION_LINE_IDS: ReadonlySet<string> = new Set([
  '94e9b9d', '9addaf9', '45596ac', '1ee8f2a4', '1e0b49c', '3694e0d', '8607cc2',
])

/** 现场设备到工艺流程的竖向连线要求物理层和业务层同时开启。 */
const PHYSICAL_AND_BUSINESS_CONNECTION_LINE_IDS: ReadonlySet<string> = new Set([
  'f31902e', 'b48e07', '7cd76c36', 'a05ca33', '66a796a0', '1ccc413', '252e23c9',
])

/**
 * 工艺流程内部虚线只属于业务层。
 * 物理层关闭时，业务流程关系仍应保留，不能把虚线错误地当成现场设备连接。
 */
const BUSINESS_ONLY_CONNECTION_LINE_IDS: ReadonlySet<string> = new Set([
  'e6b42b6', '155dd3b2', '3631b1b0', '717bbe9', '389c38d', '81006f9', '56df857',
  '87ded9', '17edac60',
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
export function createGasTopologyLayerBindingIndex(pens: readonly Pen[]): ReadonlyMap<string, readonly GasTopologyFilterId[]> {
  const penById = new Map(pens.filter((pen) => Boolean(pen.id)).map((pen) => [pen.id, pen]))
  const sectionBounds = SECTION_RULES.flatMap((rule) => {
    const pen = penById.get(rule.sectionPenId)
    const bounds = pen ? readPenBounds(pen) : undefined
    return bounds ? [{ rule, bounds }] : []
  })
  const tagsByPenId = new Map<string, readonly GasTopologyFilterId[]>()

  for (const pen of pens) {
    if (!pen.id) continue
    const penBounds = readPenBounds(pen)
    if (!penBounds) {
      tagsByPenId.set(pen.id, Object.freeze([]))
      continue
    }

    const tags = new Set<GasTopologyFilterId>()
    if (ARCHITECTURE_PEN_IDS.has(pen.id)) tags.add('architecture')
    for (const section of sectionBounds) {
      if (pen.id === section.rule.sectionPenId || boundsOverlap(penBounds, section.bounds)) {
        tags.add(section.rule.filterId)
      }
    }
    if (NETWORK_ONLY_PEN_IDS.has(pen.id) || (pen.parentId && NETWORK_ONLY_PEN_IDS.has(pen.parentId))) {
      tags.clear()
      tags.add('network')
    } else if (NETWORK_ONLY_TRANSITION_LINE_IDS.has(pen.id)) {
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
export function createGasTopologyVisibilityRuleIndex(
  pens: readonly Pen[],
  tagsByPenId: ReadonlyMap<string, readonly GasTopologyFilterId[]> = createGasTopologyLayerBindingIndex(pens),
): ReadonlyMap<string, GasTopologyVisibilityRule> {
  const rules = new Map<string, GasTopologyVisibilityRule>()
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
export function isGasTopologyPenVisible(
  penId: string,
  tagsByPenId: ReadonlyMap<string, readonly GasTopologyFilterId[]>,
  selected: ReadonlySet<GasTopologyFilterId>,
  visibilityRules?: ReadonlyMap<string, GasTopologyVisibilityRule>,
): boolean {
  if (selected.has('architecture')) return true
  const rule = visibilityRules?.get(penId)
  if (rule?.requiredFilterIds) return rule.requiredFilterIds.every((filterId) => selected.has(filterId))
  return (rule?.tags ?? tagsByPenId.get(penId) ?? []).some((tag) => tag !== 'architecture' && selected.has(tag))
}

/** 初次打开和筛选切换共用同一纯函数，避免画布状态与 JSON 的 visible 字段出现两套规则。 */
export function applyGasTopologyLayerVisibility(
  pens: Pen[],
  tagsByPenId: ReadonlyMap<string, readonly GasTopologyFilterId[]>,
  selected: ReadonlySet<GasTopologyFilterId>,
  visibilityRules?: ReadonlyMap<string, GasTopologyVisibilityRule>,
): void {
  for (const pen of pens) {
    if (pen.id) pen.visible = isGasTopologyPenVisible(pen.id, tagsByPenId, selected, visibilityRules)
  }
}

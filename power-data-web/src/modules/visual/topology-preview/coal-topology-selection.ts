import type { LockState, Pen } from '@meta2d/core'

/** 对应组态引擎的“禁止编辑”：图元仍可命中和选中，但不能移动、缩放或修改。 */
export const COAL_TOPOLOGY_SELECTABLE_LOCK = 1 as LockState

/** 对应组态引擎的“完全禁用”：图元直接跳过鼠标命中，因此背景不会出现悬停或选中框。 */
export const COAL_TOPOLOGY_BACKGROUND_LOCK = 10 as LockState

const PROCESS_SECTION_TITLE = '工艺流程'
const BOUNDS_EPSILON = 0.001

/** 同时完成运行时校验和类型收窄，防止损坏的数据文件参与坐标计算。 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 判断矩形是否为最底部工艺流程中的业务节点。
 * 不能只按 rectangle 类型放行，因为外层分区框和六个彩色分组框也都是矩形；这里同时约束：
 * 1. 必须位于“工艺流程”外层区域内部；2. 必须有业务文字；3. 宽高必须明显小于外层区域。
 */
function isBottomProcessNode(pen: Pen, processSection: Pen | undefined): boolean {
  if (!processSection || pen === processSection || pen.name !== 'rectangle' || !pen.text?.trim()) return false

  if (!isFiniteNumber(pen.y)
    || !isFiniteNumber(pen.width)
    || !isFiniteNumber(pen.height)
    || !isFiniteNumber(processSection.y)
    || !isFiniteNumber(processSection.width)
    || !isFiniteNumber(processSection.height)) return false

  const processBottom = processSection.y + processSection.height
  const penBottom = pen.y + pen.height
  return pen.y >= processSection.y
    && penBottom <= processBottom + BOUNDS_EPSILON
    && pen.width < processSection.width / 2
    && pen.height < processSection.height / 2
}

/**
 * 应用燃煤拓扑的命中规则，并返回允许选中的图元编号集合，便于测试和后续交互扩展。
 * 可选对象仅包括带图片的设备图元，以及图三所示的底部工艺流程小矩形；连线、分区标题和分组背景全部禁用命中。
 */
export function applyCoalTopologySelectionPolicy(pens: Pen[]): ReadonlySet<string> {
  const processSection = pens.find((pen) =>
    pen.name === 'rectangle'
    && pen.text?.trim() === PROCESS_SECTION_TITLE,
  )
  const selectableIds = new Set<string>()

  for (const pen of pens) {
    const selectable = Boolean(pen.image?.trim()) || isBottomProcessNode(pen, processSection)
    pen.locked = selectable ? COAL_TOPOLOGY_SELECTABLE_LOCK : COAL_TOPOLOGY_BACKGROUND_LOCK
    if (selectable && pen.id) selectableIds.add(pen.id)
  }

  return selectableIds
}


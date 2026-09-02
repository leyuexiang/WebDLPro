import type { Pen } from '@meta2d/core'

/** 选中图元与关联连线共用的高亮色，深色拓扑背景下保持足够对比度。 */
export const GAS_TOPOLOGY_SELECTION_COLOR = '#38bdf8'

/** 高亮连线的源数据线宽下限；不改变虚线、箭头、锚点和连接关系。 */
export const GAS_TOPOLOGY_SELECTION_LINE_WIDTH = 3

/**
 * 一次构建“端点图元编号 → 有效连线编号”索引。
 *
 * connectedLines（已连接线路）来自组态数据的明确连接关系；先用真实 line（连线）图元编号过滤，
 * 可自动排除源文件中指向已删除连线的历史残留项。点击和三维反向选择的热路径随后只读取映射表，
 * 不按文字、坐标或图元顺序猜测，也不重复扫描整份拓扑数据。
 */
export function createGasTopologyConnectedLineIndex(
  pens: readonly Pen[],
): ReadonlyMap<string, readonly string[]> {
  const validLineIds = new Set(
    pens
      .filter((pen) => pen.name === 'line' && Boolean(pen.id))
      .map((pen) => pen.id),
  )
  const lineIdsByPenId = new Map<string, readonly string[]>()

  for (const pen of pens) {
    if (!pen.id || !pen.connectedLines?.length) continue
    const validConnectedLineIds = [...new Set(
      pen.connectedLines
        .map((connection) => connection.lineId)
        .filter((lineId): lineId is string => Boolean(lineId && validLineIds.has(lineId))),
    )]
    if (validConnectedLineIds.length > 0) {
      lineIdsByPenId.set(pen.id, Object.freeze(validConnectedLineIds))
    }
  }

  return lineIdsByPenId
}

/** 合并一个或多个选中图元的直接关联连线，集合天然去重，适配一个业务节点对应多个视觉图元。 */
export function resolveGasTopologyConnectedLineIds(
  selectedPenIds: readonly string[],
  connectedLineIndex: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  const connectedLineIds = new Set<string>()
  for (const penId of selectedPenIds) {
    for (const lineId of connectedLineIndex.get(penId) ?? []) connectedLineIds.add(lineId)
  }
  return connectedLineIds
}

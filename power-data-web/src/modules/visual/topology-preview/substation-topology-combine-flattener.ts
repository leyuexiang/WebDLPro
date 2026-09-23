import type { Pen } from '@meta2d/core'

interface PenBounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/**
 * 展开站类拓扑文件中的所有组合图元，使筛选结果里的设备和工艺节点都能独立命中。
 * 组合的直接子图元使用父组合比例坐标，因此必须从外到内换算成画布坐标，再删除组合和父子引用。
 * 图元、子图元索引各扫描一次，避免对每个组合重复遍历整份图，整体复杂度保持 O(n)。
 */
export function flattenSubstationTopologyCombines(pens: Pen[], sceneVariantLabel: string): number {
  const combineById = new Map<string, Pen>()
  const childrenByParentId = new Map<string, Pen[]>()
  for (const pen of pens) {
    if (pen.name === 'combine' && pen.id) combineById.set(pen.id, pen)
    if (pen.parentId) {
      const children = childrenByParentId.get(pen.parentId)
      if (children) children.push(pen)
      else childrenByParentId.set(pen.parentId, [pen])
    }
  }
  if (combineById.size === 0) return 0

  const expandedCombineIds = new Set<string>()
  const expandCombine = (combine: Pen): void => {
    if (!combine.id || expandedCombineIds.has(combine.id)) {
      throw new Error(`${sceneVariantLabel}拓扑组合层级循环或编号无效：${combine.id ?? '未知图元'}。`)
    }
    const bounds = readPenBounds(combine, sceneVariantLabel)
    expandedCombineIds.add(combine.id)

    for (const child of childrenByParentId.get(combine.id) ?? []) {
      const childBounds = readPenBounds(child, sceneVariantLabel)
      child.x = bounds.x + childBounds.x * bounds.width
      child.y = bounds.y + childBounds.y * bounds.height
      child.width = childBounds.width * bounds.width
      child.height = childBounds.height * bounds.height
      // 组合被移除后，子图元必须脱离父级，否则画布仍可能把点击提升到其他图元。
      child.parentId = undefined
      if (child.name === 'combine') expandCombine(child)
    }
  }

  // 在展开任何节点前固定根列表；处理过程中 parentId 会被清除，不能据变更后的关系再次展开子组合。
  const rootCombines = [...combineById.values()].filter(
    (combine) => !combine.parentId || !combineById.has(combine.parentId),
  )
  for (const combine of rootCombines) expandCombine(combine)
  if (expandedCombineIds.size !== combineById.size) {
    const unvisitedId = [...combineById.keys()].find((id) => !expandedCombineIds.has(id))
    throw new Error(`${sceneVariantLabel}拓扑组合层级无法展开：${unvisitedId ?? '未知组合'}。`)
  }

  let writeIndex = 0
  for (const pen of pens) {
    if (pen.name !== 'combine') pens[writeIndex++] = pen
  }
  pens.length = writeIndex
  return combineById.size
}

/** 组合和子图元都必须有有限几何数据，异常源文件不能把无效坐标扩散到整张画布。 */
function readPenBounds(pen: Pen, sceneVariantLabel: string): PenBounds {
  const { x, y, width, height } = pen
  if (![x, y, width, height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error(`${sceneVariantLabel}拓扑组合坐标无效：${pen.id ?? '未知图元'}。`)
  }
  return { x: x!, y: y!, width: width!, height: height! }
}

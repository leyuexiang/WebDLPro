import type { LockState, Pen } from '@meta2d/core'
import { getStepDownSubstationTopologyResourceManifest } from './step-down-substation-topology-manifest'
import type { StepDownSubstationTopologyVariantId } from './step-down-substation-topology-variant-manifest'

/** 允许只读命中和选择，但禁止拖动、缩放或编辑源图元。 */
export const STEP_DOWN_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK = 1 as LockState
/** 背景、连线、分组和文字完全禁用命中，避免大面积背景截获设备点击。 */
export const STEP_DOWN_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK = 10 as LockState

/**
 * 移除三层完整图中覆盖全图的顶层 combine（组合图元）。
 *
 * 该源文件唯独把 90 个主体图元放在一个大组合内，Meta2D 点击任意子图元时会激活整组。
 * 加载时将所有直接子图元的比例坐标换算成世界坐标，然后删除该顶层组合。这个变换不改变
 * 图元顺序、视觉位置、连线端点和更深层组合；后续锁定策略仍会使背景、区域框和线段不可命中。
 */
export function removeStepDownSubstationFullTopologyRootCombine(
  pens: Pen[],
  variantId: StepDownSubstationTopologyVariantId,
): void {
  if (variantId !== 'network-business-key-process') return
  const rootIndex = pens.findIndex((pen) => pen.name === 'combine' && !pen.parentId)
  const root = pens[rootIndex]
  if (rootIndex < 0 || !root?.id) throw new Error('降压站三层完整图缺少顶层组合图元。')
  if (![root.x, root.y, root.width, root.height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error(`降压站三层完整图顶层组合几何数据无效：${root.id}`)
  }

  for (const pen of pens) {
    if (pen.parentId !== root.id) continue
    if (![pen.x, pen.y, pen.width, pen.height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`降压站三层完整图子图元几何数据无效：${pen.id ?? '未知图元'}`)
    }
    pen.x = root.x! + pen.x! * root.width!
    pen.y = root.y! + pen.y! * root.height!
    pen.width = pen.width! * root.width!
    pen.height = pen.height! * root.height!
    pen.parentId = undefined
  }
  pens.splice(rootIndex, 1)
}

/**
 * 只按逐文件显式清单开放图片设备；未提供业务编号的矩形保持不可选。
 * 热路径只做集合查询，不会按标题、坐标、图片地址或数组位置重新分类。
 */
export function applyStepDownSubstationTopologySelectionPolicy(
  pens: Pen[],
  variantId: StepDownSubstationTopologyVariantId,
): ReadonlySet<string> {
  const manifest = getStepDownSubstationTopologyResourceManifest(variantId)
  const selectableIds = new Set<string>()
  for (const pen of pens) {
    const selectable = Boolean(pen.id && (
      manifest.devicePenIds.has(pen.id) || manifest.processNodePenIds.has(pen.id)
    ))
    pen.locked = selectable
      ? STEP_DOWN_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK
      : STEP_DOWN_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK
    if (selectable && pen.id) selectableIds.add(pen.id)
  }
  return selectableIds
}

import type { LockState, Pen } from '@meta2d/core'
import { getCoalTopologyResourceManifest } from './coal-topology-manifest'
import type { CoalTopologyVariantId } from './coal-topology-variant-manifest'

/** 对应二维组态引擎（Meta2D）的“禁止编辑”：允许命中和选择，但不允许移动或缩放。 */
export const COAL_TOPOLOGY_SELECTABLE_LOCK = 1 as LockState

/** 对应二维组态引擎（Meta2D）的“完全禁用”：背景、分组框、文字和连线均跳过鼠标命中。 */
export const COAL_TOPOLOGY_BACKGROUND_LOCK = 10 as LockState

/**
 * 应用目标文件的显式选择清单。只有登记设备和工艺矩形可选择；热路径只做集合查询，
 * 不会把“带图片”直接等同于设备，也不会按标题、尺寸、位置或文件顺序重新分类。
 */
export function applyCoalTopologySelectionPolicy(
  pens: Pen[],
  variantId: CoalTopologyVariantId = 'network-business-key-process',
): ReadonlySet<string> {
  const manifest = getCoalTopologyResourceManifest(variantId)
  const selectableIds = new Set<string>()
  for (const pen of pens) {
    const selectable = Boolean(pen.id && (
      manifest.devicePenIds.has(pen.id) || manifest.processNodePenIds.has(pen.id)
    ))
    pen.locked = selectable ? COAL_TOPOLOGY_SELECTABLE_LOCK : COAL_TOPOLOGY_BACKGROUND_LOCK
    if (selectable && pen.id) selectableIds.add(pen.id)
  }
  return selectableIds
}

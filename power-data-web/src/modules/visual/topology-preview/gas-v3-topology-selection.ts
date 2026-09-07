import type { LockState, Pen } from '@meta2d/core'
import { getGasV3TopologyResourceManifest } from './gas-v3-topology-manifest'
import type { GasV3TopologyVariantId } from './gas-v3-topology-variant-manifest'

/** 对应 Meta2D（二维组态引擎）的“禁止编辑”：允许命中和选中，但不允许移动或缩放。 */
export const GAS_V3_TOPOLOGY_SELECTABLE_LOCK = 1 as LockState

/** 对应 Meta2D 的“完全禁用”：区域背景、文字背景、组合框和连线均跳过鼠标命中。 */
export const GAS_V3_TOPOLOGY_BACKGROUND_LOCK = 10 as LockState

/**
 * 应用指定文件的显式选择清单。图片类型不直接等于设备，区域文字背景会被可靠排除；
 * 每份输入文件使用独立图元编号，热路径只做常数时间集合查询，不按标题、尺寸或坐标重复分类。
 */
export function applyGasV3TopologySelectionPolicy(
  pens: Pen[],
  variantId: GasV3TopologyVariantId = 'network-business-key-process',
): ReadonlySet<string> {
  const manifest = getGasV3TopologyResourceManifest(variantId)
  const selectableIds = new Set<string>()
  for (const pen of pens) {
    const selectable = Boolean(pen.id && (
      manifest.devicePenIds.has(pen.id) || manifest.processNodePenIds.has(pen.id)
    ))
    pen.locked = selectable ? GAS_V3_TOPOLOGY_SELECTABLE_LOCK : GAS_V3_TOPOLOGY_BACKGROUND_LOCK
    if (selectable && pen.id) selectableIds.add(pen.id)
  }
  return selectableIds
}

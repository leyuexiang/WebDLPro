import type { LockState, Pen } from '@meta2d/core'
import { getStepUpSubstationTopologyResourceManifest } from './step-up-substation-topology-manifest'
import type { StepUpSubstationTopologyVariantId } from './step-up-substation-topology-variant-manifest'

/** 允许只读命中和选择，但禁止拖动、缩放或编辑源图元。 */
export const STEP_UP_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK = 1 as LockState
/** 背景、连线、分组和文字完全禁用命中，避免大面积背景截获设备点击。 */
export const STEP_UP_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK = 10 as LockState

/**
 * 只按逐文件显式清单开放图片设备和工艺节点；其他矩形、标题、背景与连线保持不可选。
 *
 * 八份升压站源文件已逐一审计：存在的父子关系仅属于局部标题和背景组合，没有可选设备或
 * 工艺节点被覆盖全图的组合包裹。因此必须保留这些局部分组，不能照搬降压站完整图的展平规则。
 * 对应回归测试会保证所有可选图元始终没有父组合，避免点击设备时上溯为整组选择。
 * 热路径只做集合查询，不会按标题、坐标、图片地址或数组位置重新分类。
 */
export function applyStepUpSubstationTopologySelectionPolicy(
  pens: Pen[],
  variantId: StepUpSubstationTopologyVariantId,
): ReadonlySet<string> {
  const manifest = getStepUpSubstationTopologyResourceManifest(variantId)
  const selectableIds = new Set<string>()
  for (const pen of pens) {
    const selectable = Boolean(pen.id && (
      manifest.devicePenIds.has(pen.id) || manifest.processNodePenIds.has(pen.id)
    ))
    pen.locked = selectable
      ? STEP_UP_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK
      : STEP_UP_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK
    if (selectable && pen.id) selectableIds.add(pen.id)
  }
  return selectableIds
}

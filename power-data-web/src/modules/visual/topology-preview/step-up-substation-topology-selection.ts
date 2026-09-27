import type { LockState, Pen } from '@meta2d/core'
import { getStepUpSubstationTopologyResourceManifest } from './step-up-substation-topology-manifest'
import type { StepUpSubstationTopologyVariantId } from './step-up-substation-topology-variant-manifest'
import { getSubstationTopologySelectablePenIds } from './substation-topology-node-selection'

/** 允许只读命中和选择，但禁止拖动、缩放或编辑源图元。 */
export const STEP_UP_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK = 1 as LockState
/** 背景、连线、分组和文字完全禁用命中，避免大面积背景截获设备点击。 */
export const STEP_UP_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK = 10 as LockState

/**
 * 逐文件开放所有设备和工艺节点；其他矩形、标题、背景与连线保持不可选。
 *
 * 加载阶段会先拆除全部组合并换算父子坐标，因此可选节点直接命中自身，不会上溯为组合选择。
 * 热路径只做集合查询，不会按标题、坐标、图片地址或数组位置重新分类。
 */
export function applyStepUpSubstationTopologySelectionPolicy(
  pens: Pen[],
  variantId: StepUpSubstationTopologyVariantId,
): ReadonlySet<string> {
  const manifest = getStepUpSubstationTopologyResourceManifest(variantId)
  const selectableIds = getSubstationTopologySelectablePenIds(pens, manifest)
  for (const pen of pens) {
    const selectable = Boolean(pen.id && selectableIds.has(pen.id))
    pen.locked = selectable
      ? STEP_UP_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK
      : STEP_UP_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK
  }
  return selectableIds
}

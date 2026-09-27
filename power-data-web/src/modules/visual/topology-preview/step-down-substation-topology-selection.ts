import type { LockState, Pen } from '@meta2d/core'
import { getStepDownSubstationTopologyResourceManifest } from './step-down-substation-topology-manifest'
import type { StepDownSubstationTopologyVariantId } from './step-down-substation-topology-variant-manifest'
import { getSubstationTopologySelectablePenIds } from './substation-topology-node-selection'

/** 允许只读命中和选择，但禁止拖动、缩放或编辑源图元。 */
export const STEP_DOWN_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK = 1 as LockState
/** 背景、连线、分组和文字完全禁用命中，避免大面积背景截获设备点击。 */
export const STEP_DOWN_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK = 10 as LockState

/**
 * 逐文件开放所有设备和工艺节点；没有三维绑定的节点仍可在二维拓扑中独立选择。
 * 热路径只做集合查询，不会按标题、坐标、图片地址或数组位置重新分类。
 */
export function applyStepDownSubstationTopologySelectionPolicy(
  pens: Pen[],
  variantId: StepDownSubstationTopologyVariantId,
): ReadonlySet<string> {
  const manifest = getStepDownSubstationTopologyResourceManifest(variantId)
  const selectableIds = getSubstationTopologySelectablePenIds(pens, manifest)
  for (const pen of pens) {
    const selectable = Boolean(pen.id && selectableIds.has(pen.id))
    pen.locked = selectable
      ? STEP_DOWN_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK
      : STEP_DOWN_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK
  }
  return selectableIds
}

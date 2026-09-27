import type { LockState, Pen } from '@meta2d/core'
import { getConverterStationTopologyResourceManifest } from './converter-station-topology-manifest'
import type { ConverterStationTopologyVariantId } from './converter-station-topology-variant-manifest'
import { getSubstationTopologySelectablePenIds } from './substation-topology-node-selection'

/** 允许只读命中和选择，但禁止拖动、缩放或编辑源图元。 */
export const CONVERTER_STATION_TOPOLOGY_SELECTABLE_LOCK = 1 as LockState
/** 背景、连线、分组和文字完全禁用命中，避免大面积背景截获设备点击。 */
export const CONVERTER_STATION_TOPOLOGY_BACKGROUND_LOCK = 10 as LockState

/**
 * 逐文件开放所有设备和工艺节点；其余矩形、标题、背景与连线保持不可选。
 * 热路径只做集合查询，不会按标题、坐标、图片地址或数组位置重新分类。
 */
export function applyConverterStationTopologySelectionPolicy(
  pens: Pen[],
  variantId: ConverterStationTopologyVariantId,
): ReadonlySet<string> {
  const manifest = getConverterStationTopologyResourceManifest(variantId)
  const selectableIds = getSubstationTopologySelectablePenIds(pens, manifest)
  for (const pen of pens) {
    const selectable = Boolean(pen.id && selectableIds.has(pen.id))
    pen.locked = selectable
      ? CONVERTER_STATION_TOPOLOGY_SELECTABLE_LOCK
      : CONVERTER_STATION_TOPOLOGY_BACKGROUND_LOCK
  }
  return selectableIds
}

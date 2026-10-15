import type { Pen } from '@meta2d/core'
import { CONVERTER_STATION_TOPOLOGY_SELECTABLE_LOCK } from './converter-station-topology-selection'

export interface ConverterStationTopologyTooltipContent {
  readonly penId: string
  readonly title: string
  readonly status: string
}

/** 只移除源数据为画布排版加入的换行和重复空格，保留设备名称原意。 */
function normalizeTooltipTitle(text: string | undefined): string {
  return text?.replace(/\r?\n/g, '').replace(/[ \t]+/g, ' ').trim() ?? ''
}

/**
 * 只有显式登记且带图的设备显示提示。源包未提供四态资源和实时绑定，
 * 因此明确标注预览默认态，禁止把静态动画冒充外部正常状态快照。
 */
export function getConverterStationTopologyTooltipContent(
  pen: Pen,
): ConverterStationTopologyTooltipContent | undefined {
  if (pen.locked !== CONVERTER_STATION_TOPOLOGY_SELECTABLE_LOCK || !pen.id || !pen.image?.trim()) return undefined
  const title = normalizeTooltipTitle(pen.text)
  return title ? { penId: pen.id, title, status: '正常（预览默认态）' } : undefined
}

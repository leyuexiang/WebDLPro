import type { Pen } from '@meta2d/core'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { GAS_V3_TOPOLOGY_STATUS_PRESENTATION } from './gas-v3-topology-runtime-bindings'
import { GAS_V3_TOPOLOGY_SELECTABLE_LOCK } from './gas-v3-topology-selection'

export interface GasV3TopologyTooltipContent {
  penId: string
  title: string
  status: string
}

/**
 * 将画布换行文字还原为悬浮标题。只移除换行与重复空格，
 * 保留中文、数字和缩写之间的有效空格，避免改变源数据语义。
 */
function normalizeTooltipTitle(text: string | undefined): string {
  return text
    ?.replace(/\r?\n/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim() ?? ''
}

/**
 * 只为第三版选择策略已登记且带图片的设备生成提示；区域背景、连线和工艺矩形均直接跳过。
 * 独立预览默认正常态，正式运行时由外层状态快照覆盖，图片与中文状态共享同一状态来源。
 */
export function getGasV3TopologyTooltipContent(
  pen: Pen,
  deviceStatus: TopologyDeviceStatus = 'normal',
): GasV3TopologyTooltipContent | undefined {
  if (pen.locked !== GAS_V3_TOPOLOGY_SELECTABLE_LOCK || !pen.id || !pen.image?.trim()) return undefined

  const title = normalizeTooltipTitle(pen.text)
  return title
    ? { penId: pen.id, title, status: GAS_V3_TOPOLOGY_STATUS_PRESENTATION[deviceStatus].label }
    : undefined
}

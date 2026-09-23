import type { Pen } from '@meta2d/core'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { COAL_TOPOLOGY_STATUS_PRESENTATION } from './coal-topology-runtime-bindings'
import { COAL_TOPOLOGY_SELECTABLE_LOCK } from './coal-topology-selection'

export interface CoalTopologyTooltipContent {
  penId: string
  title: string
  status: string
}

/**
 * 将数据中用于画布换行的文本还原为悬浮卡片标题。
 * 只移除换行和重复空格，保留英文缩写前后的有效空格，避免标题与原始数据语义不一致。
 */
function normalizeTooltipTitle(text: string | undefined): string {
  return text
    ?.replace(/\r?\n/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim() ?? ''
}

/**
 * 只为选择策略已经放行且带图片的设备图元创建提示内容。
 * 底部工艺矩形虽然允许选中，但仅表达流程关系，不属于设备，因此与背景、分组框和连线一样不显示提示。
 * 独立预览没有状态输入时沿用正常态；正式运行组件会传入外层协议下发的四态快照。
 */
export function getCoalTopologyTooltipContent(
  pen: Pen,
  deviceStatus: TopologyDeviceStatus = 'normal',
): CoalTopologyTooltipContent | undefined {
  if (pen.locked !== COAL_TOPOLOGY_SELECTABLE_LOCK || !pen.id || !pen.image?.trim()) return undefined

  const title = normalizeTooltipTitle(pen.text)
  return title ? { penId: pen.id, title, status: COAL_TOPOLOGY_STATUS_PRESENTATION[deviceStatus].label } : undefined
}


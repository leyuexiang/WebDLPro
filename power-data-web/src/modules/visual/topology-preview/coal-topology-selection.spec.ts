import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import {
  applyCoalTopologySelectionPolicy,
  COAL_TOPOLOGY_BACKGROUND_LOCK,
  COAL_TOPOLOGY_SELECTABLE_LOCK,
} from './coal-topology-selection'

/** 直接读取当前预览使用的真实数据，避免测试样例与后续拓扑文件更新脱节。 */
function loadTopologyFixture(): Meta2dData {
  const topologyUrl = new URL('../../../../public/topology/coal-json-preview/topology.json', import.meta.url)
  return JSON.parse(readFileSync(topologyUrl, 'utf8')) as Meta2dData
}

describe('燃煤拓扑选择规则', () => {
  it('只允许设备图元和底部工艺流程小矩形进入选中态', () => {
    const data = loadTopologyFixture()

    const selectableIds = applyCoalTopologySelectionPolicy(data.pens)
    const selectablePens = data.pens.filter((pen) => pen.locked !== COAL_TOPOLOGY_BACKGROUND_LOCK)
    const selectableImages = selectablePens.filter((pen) => Boolean(pen.image))
    const selectableProcessRectangles = selectablePens.filter((pen) => pen.name === 'rectangle')

    // 最新燃煤数据包含 104 个图元：36 个设备图片、11 个工艺流程小矩形可选，另外 57 个背景与连线禁用命中。
    expect(data.name).toBe('燃煤')
    expect(data.pens).toHaveLength(104)
    expect(selectableIds.size).toBe(47)
    expect(selectablePens).toHaveLength(47)
    expect(selectableImages).toHaveLength(36)
    expect(selectableProcessRectangles).toHaveLength(11)
    expect(data.pens.find((pen) => pen.text?.trim() === '企业办公网')?.locked).toBe(COAL_TOPOLOGY_BACKGROUND_LOCK)
    expect(data.pens.find((pen) => pen.text?.trim() === '主控监控')?.locked).toBe(COAL_TOPOLOGY_BACKGROUND_LOCK)
    expect(data.pens.find((pen) => pen.text?.trim() === '固体原煤')?.locked).toBe(COAL_TOPOLOGY_SELECTABLE_LOCK)
    expect(data.pens.filter((pen) => pen.name === 'line')).toHaveLength(44)
    expect(data.pens.filter((pen) => pen.name === 'line').every((pen) => pen.locked === COAL_TOPOLOGY_BACKGROUND_LOCK)).toBe(true)
  })
})


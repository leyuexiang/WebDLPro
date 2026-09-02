import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import { applyGasTopologySelectionPolicy } from './gas-topology-selection'
import { getGasTopologyTooltipContent } from './gas-topology-tooltip'

/** 使用预览页当前真实数据验证提示范围，防止新版数据增加背景图元后被错误纳入悬浮提示。 */
function loadTopologyFixture(): Meta2dData {
  const topologyUrl = new URL('../../../../public/topology/gas-json-preview/topology.json', import.meta.url)
  return JSON.parse(readFileSync(topologyUrl, 'utf8')) as Meta2dData
}

describe('燃气拓扑悬浮提示', () => {
  it('只为设备生成原拓扑格式的标题与状态，工艺矩形不显示提示', () => {
    const data = loadTopologyFixture()
    applyGasTopologySelectionPolicy(data.pens)

    const tooltipContents = data.pens.flatMap((pen) => {
      const content = getGasTopologyTooltipContent(pen)
      return content ? [content] : []
    })

    expect(tooltipContents).toHaveLength(54)
    expect(tooltipContents.find((content) => content.title === '燃气轮机')).toMatchObject({ status: '正常' })
    expect(tooltipContents.find((content) => content.title === '余热锅炉(HRSG) 产生过热蒸汽')).toBeUndefined()
    expect(tooltipContents.some((content) => content.title === '企业办公网')).toBe(false)
    expect(data.pens.filter((pen) => pen.name === 'line').every((pen) => getGasTopologyTooltipContent(pen) === undefined)).toBe(true)
  })

  it('按运行时四态生成与原拓扑一致的中文状态', () => {
    const data = loadTopologyFixture()
    applyGasTopologySelectionPolicy(data.pens)
    const gasTurbine = data.pens.find((pen) => pen.id === 'efdfac7')

    expect(gasTurbine).toBeDefined()
    expect(getGasTopologyTooltipContent(gasTurbine!, 'alarm')?.status).toBe('告警')
    expect(getGasTopologyTooltipContent(gasTurbine!, 'fault')?.status).toBe('故障')
    expect(getGasTopologyTooltipContent(gasTurbine!, 'offline')?.status).toBe('离线')
  })
})

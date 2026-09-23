import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import { applyCoalTopologySelectionPolicy } from './coal-topology-selection'
import { getCoalTopologyTooltipContent } from './coal-topology-tooltip'

/** 使用当前默认组合文件验证提示范围，避免顶层旧副本掩盖版本清单中的真实数据。 */
function loadTopologyFixture(): Meta2dData {
  const topologyUrl = new URL(
    '../../../../public/topology/coal-json-preview/variants/network-business-key-process/topology.json',
    import.meta.url,
  )
  return JSON.parse(readFileSync(topologyUrl, 'utf8')) as Meta2dData
}

describe('燃煤拓扑悬浮提示', () => {
  it('只为设备生成原拓扑格式的标题与状态，工艺矩形不显示提示', () => {
    const data = loadTopologyFixture()
    applyCoalTopologySelectionPolicy(data.pens)

    const tooltipContents = data.pens.flatMap((pen) => {
      const content = getCoalTopologyTooltipContent(pen)
      return content ? [content] : []
    })

    expect(tooltipContents).toHaveLength(50)
    expect(tooltipContents.find((content) => content.title === '锅炉')).toMatchObject({ status: '正常' })
    expect(tooltipContents.find((content) => content.title === '炉膛燃烧')).toBeUndefined()
    expect(tooltipContents.some((content) => content.title === '企业办公网')).toBe(false)
    expect(data.pens.filter((pen) => pen.name === 'line').every((pen) => getCoalTopologyTooltipContent(pen) === undefined)).toBe(true)
  })

  it('按运行时四态生成与原拓扑一致的中文状态', () => {
    const data = loadTopologyFixture()
    applyCoalTopologySelectionPolicy(data.pens)
    const coalMill = data.pens.find((pen) => pen.id === '4d87c9a3')

    expect(coalMill).toBeDefined()
    expect(getCoalTopologyTooltipContent(coalMill!, 'alarm')?.status).toBe('告警')
    expect(getCoalTopologyTooltipContent(coalMill!, 'fault')?.status).toBe('故障')
    expect(getCoalTopologyTooltipContent(coalMill!, 'offline')?.status).toBe('离线')
  })
})


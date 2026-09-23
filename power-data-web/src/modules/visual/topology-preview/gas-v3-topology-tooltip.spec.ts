import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import { GAS_V3_TOPOLOGY_VARIANTS } from './gas-v3-topology-variant-manifest'
import { applyGasV3TopologySelectionPolicy } from './gas-v3-topology-selection'
import { getGasV3TopologyTooltipContent } from './gas-v3-topology-tooltip'

const topologyRoot = resolve(process.cwd(), 'public/topology/gas-v3-json-preview')

function loadTopologyFixture(variantPath: string): Meta2dData {
  return JSON.parse(readFileSync(resolve(topologyRoot, variantPath), 'utf8')) as Meta2dData
}

describe('燃气拓扑悬浮提示', () => {
  it('每份输入只为显式登记设备生成提示，区域标题和连线永不生成提示', () => {
    // 网络＋业务改用纠正后的燃气输入，只为其中 37 个设备图元生成提示。
    const expectedDeviceCounts = [28, 37, 0, 14, 37, 44, 14, 44]
    for (const [index, variant] of GAS_V3_TOPOLOGY_VARIANTS.entries()) {
      const data = loadTopologyFixture(variant.topologyPath)
      applyGasV3TopologySelectionPolicy(data.pens, variant.id)
      const tooltipContents = data.pens.flatMap((pen) => {
        const content = getGasV3TopologyTooltipContent(pen)
        return content ? [content] : []
      })
      expect(tooltipContents).toHaveLength(expectedDeviceCounts[index])
      expect(tooltipContents.some((content) => content.title === '企业办公网')).toBe(false)
      expect(data.pens.filter((pen) => pen.name === 'line')
        .every((pen) => getGasV3TopologyTooltipContent(pen) === undefined)).toBe(true)
    }
  })

  it('提示文字与四态协议保持一致', () => {
    const full = GAS_V3_TOPOLOGY_VARIANTS.find((variant) => variant.id === 'network-business-key-process')!
    const data = loadTopologyFixture(full.topologyPath)
    applyGasV3TopologySelectionPolicy(data.pens, full.id)
    const gasTurbine = data.pens.find((pen) => pen.id === '868df1f')
    expect(gasTurbine).toBeDefined()
    expect(getGasV3TopologyTooltipContent(gasTurbine!, 'alarm')?.status).toBe('告警')
    expect(getGasV3TopologyTooltipContent(gasTurbine!, 'fault')?.status).toBe('故障')
    expect(getGasV3TopologyTooltipContent(gasTurbine!, 'offline')?.status).toBe('离线')
  })
})

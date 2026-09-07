import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import { getGasV3TopologyResourceManifest } from './gas-v3-topology-manifest'
import { GAS_V3_TOPOLOGY_VARIANTS } from './gas-v3-topology-variant-manifest'
import {
  applyGasV3TopologySelectionPolicy,
  GAS_V3_TOPOLOGY_BACKGROUND_LOCK,
  GAS_V3_TOPOLOGY_SELECTABLE_LOCK,
} from './gas-v3-topology-selection'

const topologyRoot = resolve(process.cwd(), 'public/topology/gas-v3-json-preview')

function readVariant(topologyPath: string): Meta2dData {
  return JSON.parse(readFileSync(resolve(topologyRoot, topologyPath), 'utf8')) as Meta2dData
}

describe('燃气拓扑逐文件图元选择策略', () => {
  it('每份文件只放行已登记设备和工艺矩形，不按图片、标题或坐标猜测', () => {
    for (const variant of GAS_V3_TOPOLOGY_VARIANTS) {
      const data = readVariant(variant.topologyPath)
      const manifest = getGasV3TopologyResourceManifest(variant.id)
      const selectableIds = applyGasV3TopologySelectionPolicy(data.pens, variant.id)
      expect(selectableIds.size).toBe(manifest.devicePenIds.size + manifest.processNodePenIds.size)
      expect(data.pens.filter((pen) => pen.locked === GAS_V3_TOPOLOGY_SELECTABLE_LOCK))
        .toHaveLength(selectableIds.size)
      expect(data.pens.filter((pen) => pen.name === 'line')
        .every((pen) => pen.locked === GAS_V3_TOPOLOGY_BACKGROUND_LOCK)).toBe(true)
      for (const penId of manifest.titleBackgroundPenIds) {
        expect(data.pens.find((pen) => pen.id === penId)?.locked).toBe(GAS_V3_TOPOLOGY_BACKGROUND_LOCK)
      }
    }
  })

  it('业务单层只允许工艺矩形选中，不把区域标题背景伪装成设备', () => {
    const business = GAS_V3_TOPOLOGY_VARIANTS.find((variant) => variant.id === 'business')!
    const data = readVariant(business.topologyPath)
    const selectableIds = applyGasV3TopologySelectionPolicy(data.pens, business.id)
    expect(selectableIds.size).toBe(11)
    expect(data.pens.filter((pen) => pen.image && pen.locked === GAS_V3_TOPOLOGY_SELECTABLE_LOCK)).toHaveLength(0)
  })
})

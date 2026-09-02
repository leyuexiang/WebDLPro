import { readFile } from 'node:fs/promises'
import type { Meta2dData } from '@meta2d/core'
import { describe, expect, it } from 'vitest'
import {
  createGasTopologyRuntimeBindingIndex,
  GAS_TOPOLOGY_RUNTIME_BINDINGS,
} from './gas-topology-runtime-bindings'

const topologyUrl = new URL('../../../../public/topology/gas-json-preview/topology.json', import.meta.url)

describe('新版燃气拓扑运行时绑定', () => {
  it('只绑定当前图纸中真实存在的图片图元，并允许同一正式节点同步多个视觉图元', async () => {
    const data = JSON.parse(await readFile(topologyUrl, 'utf8')) as Meta2dData
    const imagePenIds = new Set(data.pens.filter((pen) => pen.image).map((pen) => pen.id))
    const bindingPenIds = GAS_TOPOLOGY_RUNTIME_BINDINGS.map((binding) => binding.penId)

    expect(new Set(bindingPenIds).size).toBe(bindingPenIds.length)
    expect(bindingPenIds.every((penId) => imagePenIds.has(penId))).toBe(true)

    const index = createGasTopologyRuntimeBindingIndex()
    expect(index.penIdsByNodeId.get('inlet-duct' as never)).toEqual(['efdfac7', '75426ac5'])
    expect(index.penIdsByNodeId.get('hrsg' as never)).toEqual(['369a5871', '1c78393'])
    expect(index.penIdsByNodeId.get('steam-turbine' as never)).toEqual(['ed5e92c', '533cd1cf'])
    expect(index.penIdsByNodeId.get('historian-data-server' as never)).toEqual([
      '45518ad8', '19742cc7', '335edd99', '63cffbbf', '54cf46d9', 'f16e288', '3459bcf4',
    ])
    expect(index.penIdsByNodeId.get('plant-engineering-station' as never)).toEqual([
      '45cf2261', '4e4b985a', 'fd434d7', '5711e3e4', '420c522d', '3fe42fc', '5f3c5f1c',
    ])
    expect(index.penIdsByNodeId.get('operator-station' as never)).toEqual([
      '162b8a', '3650f7f5', '3fdbe5f9', '26eb7936', 'ee99dba', '43f27ae8', 'ea88a62',
    ])
  })
})

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getProcessDetailTopologyDataContext, PROCESS_DETAIL_TOPOLOGY_DATA_CONTEXTS } from './process-detail-topology-contexts'

describe('第三层关键环节拓扑数据上下文', () => {
  it('逐份锁定参考 JSON 的散列和图元数量，并保留组合父子结构', () => {
    const root = resolve(process.cwd(), 'public/topology')
    // 显式标注三元组类型，避免 Map 的联合推断把路径、数量收窄为 string | number，
    // 同时让测试在读取参考文件时保留可检查的文件路径、图元数量和散列字段。
    const expected = new Map<string, readonly [string, number, string]>([
      ['process-detail.gas-power.gas-turbine', ['process-detail/gas-power/gas-turbine/topology.json', 32, '30652c2a8a2b5bf0af76c70501baa94e2ece57edb57fd35d164486546103b9ba']],
      ['process-detail.coal-power.steam-turbine', ['process-detail/coal-power/steam-turbine/topology.json', 45, '5c7262f198f4b4443d863d07a8b39f5bd0d9d841cb03d820b5535c736c78a79c']],
      ['process-detail.solar-power.inverter', ['process-detail/solar-power/inverter/topology.json', 19, '6391b1212c07664721cbccfea4bb9d5f7ef06487655b08fbf09d4b09e9018686']],
    ])

    for (const context of PROCESS_DETAIL_TOPOLOGY_DATA_CONTEXTS.filter((item) => expected.has(item.contextId))) {
      const item = expected.get(context.contextId)!
      const file = resolve(root, item[0])
      const bytes = readFileSync(file)
      const data = JSON.parse(bytes.toString('utf8')) as { pens: readonly { id?: string; parentId?: string }[] }
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(item[2])
      expect(data.pens).toHaveLength(item[1])
      expect(new Set(data.pens.map((pen) => pen.id)).size).toBe(data.pens.length)
      if (context.contextId.endsWith('steam-turbine')) {
        expect(data.pens.some((pen) => pen.parentId === 'dc728ff')).toBe(true)
      }
    }
  })

  it('只按稳定关键环节标识返回显式图元绑定', () => {
    expect(getProcessDetailTopologyDataContext('process-detail.gas-power.gas-turbine')?.bindings).toEqual([
      { penId: '14d76d6', nodeId: 'asset.gas-turbine' },
      { penId: '35d969bb', nodeId: 'asset.gas-turbine' },
      { penId: '621bf39b', nodeId: 'asset.gas-hrsg' },
    ])
    expect(getProcessDetailTopologyDataContext('process-detail.coal-power.steam-turbine')?.bindings).toEqual([
      { penId: '429749ea', nodeId: 'asset.coal-steam-turbine' },
      { penId: '8be4fc2', nodeId: 'asset.coal-boiler' },
      { penId: '9533a1f', nodeId: 'asset.coal-generator' },
    ])
    expect(getProcessDetailTopologyDataContext('process-detail.solar-power.inverter')).toEqual(expect.objectContaining({
      renderer: 'solar',
      topologyPath: 'process-detail/solar-power/inverter/topology.json',
      bindings: [
        { penId: 'df25e45', nodeId: 'system.solar-inverter-control' },
        { penId: '2cf7b170', nodeId: 'asset.solar-inverter' },
      ],
    }))
    expect(getProcessDetailTopologyDataContext('process-detail.unknown')).toBeUndefined()
  })
})

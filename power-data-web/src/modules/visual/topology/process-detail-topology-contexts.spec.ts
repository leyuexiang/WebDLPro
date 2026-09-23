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
      ['process-detail.step-down-substation.transformer-protection', ['process-detail/protection/transformer-protection/topology.json', 37, 'cebf00fc7b375ff7bff26e29da3d722edc378f825d75813f384825b9a24f5431']],
      ['process-detail.step-down-substation.busbar-protection', ['process-detail/protection/busbar-protection/topology.json', 35, '0b6ed18b48c7039cf3f0079642f1b9d2197c9a2890fd5a28d50839eca7161eb4']],
      ['process-detail.step-down-substation.line-protection', ['process-detail/protection/line-protection/topology.json', 34, 'e635617e600c787442823d0887c79bc581bbb244a63a9dc1c51d732be6b2c08c']],
      ['process-detail.wind-power.wind-turbine', ['process-detail/wind-power/wind-turbine/topology.json', 40, '246826daf501f12ca1ff88b28179976bf2bcff8837ce50767ba0e7c17fb9525c']],
      ['process-detail.wind-power.gearbox', ['process-detail/wind-power/gearbox/topology.json', 15, 'bb6ed25e5f473e9276ac9370aaea19fa825ec49467f331e913d4ecd05ed4185a']],
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

  it('四个站类场景共用三份源文件，但十一个上下文和图元绑定完全独立', () => {
    const protectionContexts = PROCESS_DETAIL_TOPOLOGY_DATA_CONTEXTS.filter((context) => context.contextId.includes('substation') || context.contextId.includes('converter-station') || context.contextId.includes('switching-station'))
    expect(protectionContexts).toHaveLength(11)
    expect(new Set(protectionContexts.map((context) => context.contextId)).size).toBe(11)
    expect(new Set(protectionContexts.map((context) => context.topologyPath)).size).toBe(3)

    // 同一站点的不同保护图允许复用同一正式业务节点；唯一性约束落在“上下文 + 图元”组合上。
    const bindingKeys = protectionContexts.flatMap((context) => context.bindings.map((binding) => `${context.contextId}:${binding.penId}`))
    expect(new Set(bindingKeys).size).toBe(bindingKeys.length)
    for (const context of protectionContexts) {
      expect(context.bindings.every((binding) => binding.nodeId && binding.sceneNodeId)).toBe(true)
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

  it('保护图元按源图可见设备语义绑定到站类二维节点和三维节点', () => {
    const context = getProcessDetailTopologyDataContext('process-detail.step-up-substation.transformer-protection')!
    expect(context.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        penId: '13641187',
        nodeId: 'system.step-up-measurement-control',
        sceneNodeId: 'unit.step-up-measurement.control',
      }),
      expect.objectContaining({
        penId: '2afc53b',
        nodeId: 'asset.step-up-transformer',
        sceneNodeId: 'node.step-up-transformer',
      }),
    ]))
    for (const contextItem of PROCESS_DETAIL_TOPOLOGY_DATA_CONTEXTS.filter((item) => item.renderer === 'manifest-json')) {
      expect(contextItem.bindings.every((binding) => binding.nodeId && binding.sceneNodeId)).toBe(true)
    }
  })

})

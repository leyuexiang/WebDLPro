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
      ['process-detail.solar-power.inverter', ['process-detail/solar-power/inverter/topology.json', 18, '392c1bee67b66723fe0fb06f438637a34c85a763f6da72596309740cac2a2e88']],
      ['process-detail.step-down-substation.transformer-protection', ['process-detail/protection/transformer-protection/topology.json', 45, 'f212e9bc772af3ee832707337d8ad852a515d8431806396899718959f056b4cf']],
      ['process-detail.step-down-substation.busbar-protection', ['process-detail/protection/busbar-protection/topology.json', 30, 'c161e398a4a2ca6ae14a1fc08c2942ba02c89cb38e38aedf05e70d46ff75d648']],
      ['process-detail.step-down-substation.line-protection', ['process-detail/protection/line-protection/topology.json', 39, 'f4edf30234dc7dd90b1bda72576adbe7a1a8e32dea6c41b95b37aa62c6cadc3b']],
      ['process-detail.wind-power.wind-turbine', ['process-detail/wind-power/wind-turbine/topology.json', 35, '41c4f6eb12126401c67207b85683ce4c2dea786af69b457c84d36b8c6184ef4c']],
      ['process-detail.wind-power.gearbox', ['process-detail/wind-power/gearbox/topology.json', 20, '1f3de2f9cb1f4e7ea86daa836c9c5f189fa059c5bf33c7d9d49866e66512c9fc']],
      ['process-detail.wind-power.yaw-system', ['process-detail/wind-power/yaw-system/topology.json', 15, '86767c78df1d0ea12ed8b34e3ed8834caa0ba27d13a0dbd6e2011ac175d7dddd']],
    ])

    // 从应有清单出发逐项检查，避免上下文整体漏登记时被 filter 静默跳过。
    for (const [contextId, item] of expected) {
      const context = getProcessDetailTopologyDataContext(contextId)
      expect(context).toBeDefined()
      if (!context) continue
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
      expect(context.bindings.filter((binding) => binding.nodeId.includes('-protection-breaker'))
        .every((binding) => binding.sceneNodeId === undefined)).toBe(true)
      expect(context.bindings.filter((binding) => !binding.nodeId.includes('-protection-breaker'))
        .every((binding) => binding.nodeId && binding.sceneNodeId)).toBe(true)
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
        penId: '4d08c079',
        nodeId: 'system.step-up-protection-control',
        sceneNodeId: 'unit.step-up-protection.control',
      }),
      expect.objectContaining({
        penId: '2afc53b',
        nodeId: 'asset.step-up-transformer',
        sceneNodeId: 'node.step-up-transformer',
      }),
    ]))
    expect(context.bindings.filter((binding) => binding.nodeId === 'system.step-up-protection-control')).toHaveLength(6)
    expect(context.bindings.some((binding) => binding.penId === '13641187')).toBe(false)
    for (const contextItem of PROCESS_DETAIL_TOPOLOGY_DATA_CONTEXTS.filter((item) => item.contextId.includes('substation') || item.contextId.includes('converter-station') || item.contextId.includes('switching-station'))) {
      const breakerBindings = contextItem.bindings.filter((binding) => binding.nodeId.includes('-protection-breaker'))
      expect(breakerBindings).toHaveLength(1)
      expect(breakerBindings[0]?.sceneNodeId).toBeUndefined()
      expect(contextItem.bindings.filter((binding) => !binding.nodeId.includes('-protection-breaker'))
        .every((binding) => binding.sceneNodeId !== undefined)).toBe(true)
    }
  })

  it('母线保护最新图元仍沿用断路器业务绑定并按保护装置语义登记', () => {
    const context = getProcessDetailTopologyDataContext('process-detail.step-up-substation.busbar-protection')!
    expect(context.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ penId: '9ca0194', nodeId: 'asset.step-up-busbar-protection-breaker' }),
      expect.objectContaining({ penId: '369ffe7d', nodeId: 'asset.step-up-instrument-transformer', sceneNodeId: 'node.step-up-instrument-transformer' }),
    ]))
    expect(context.bindings.filter((binding) => binding.nodeId === 'system.step-up-protection-control')).toHaveLength(2)
  })

  it('线路保护最新图元保留断路器绑定并覆盖五个保护装置图元', () => {
    const context = getProcessDetailTopologyDataContext('process-detail.step-up-substation.line-protection')!
    expect(context.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ penId: '740db66c', nodeId: 'asset.step-up-line-protection-breaker' }),
      expect.objectContaining({ penId: '7a69ba60', nodeId: 'asset.step-up-instrument-transformer', sceneNodeId: 'node.step-up-instrument-transformer' }),
    ]))
    expect(context.bindings.filter((binding) => binding.nodeId === 'system.step-up-protection-control')).toHaveLength(5)
  })

  it('风电第三层五个合作方状态节点分别绑定对应图元且不声明 Unity 节点', () => {
    const topologyRoot = resolve(process.cwd(), 'public/topology')
    const expectedBindings = new Map<string, readonly { penId: string; nodeId: string }[]>([
      ['process-detail.wind-power.wind-turbine', [
        { penId: '4e8f84e0', nodeId: 'asset.wind-turbine-yaw-system' },
        { penId: 'ff8e8e2', nodeId: 'asset.wind-turbine-yaw-system' },
        { penId: 'e1cb52b', nodeId: 'asset.wind-turbine-yaw-system' },
        { penId: 'f6eb29d', nodeId: 'asset.wind-turbine-yaw-system' },
        { penId: '4af3bcb7', nodeId: 'asset.wind-turbine-yaw-system' },
        { penId: '2167a855', nodeId: 'asset.wind-turbine-drivetrain-system' },
        { penId: '49b8df2', nodeId: 'asset.wind-turbine-drivetrain-system' },
        { penId: '7e83956', nodeId: 'asset.wind-turbine-drivetrain-system' },
        { penId: '76259d', nodeId: 'asset.wind-turbine-drivetrain-system' },
        { penId: 'a0a7e97', nodeId: 'asset.wind-turbine-drivetrain-system' },
      ]],
      ['process-detail.wind-power.gearbox', [
        { penId: '310a9d42', nodeId: 'asset.wind-gearbox-cooling-fan' },
        { penId: 'a7d5ad8', nodeId: 'asset.wind-gearbox-lubrication-unit' },
      ]],
      ['process-detail.wind-power.yaw-system', [
        { penId: '5221dc0', nodeId: 'asset.wind-yaw-angle-sensor' },
      ]],
    ])
    const titleByNodeId = new Map([
      ['asset.wind-gearbox-cooling-fan', '散热风扇'],
      ['asset.wind-gearbox-lubrication-unit', '润滑油装置'],
      ['asset.wind-yaw-angle-sensor', '角度传感器'],
    ])
    const titleByPenId = new Map([
      ['4e8f84e0', '制动器'], ['ff8e8e2', '电机'], ['e1cb52b', '减速机'], ['f6eb29d', '液压站'], ['4af3bcb7', '角度传感器'],
      ['2167a855', '主轴'], ['49b8df2', '联轴器'], ['7e83956', '齿轮箱'], ['76259d', '发电机'], ['a0a7e97', '刹车盘'],
    ])

    for (const [contextId, bindings] of expectedBindings) {
      const context = getProcessDetailTopologyDataContext(contextId)
      expect(context?.bindings).toEqual(bindings)
      expect(context?.bindings.every((binding) => binding.sceneNodeId === undefined)).toBe(true)
      if (!context) continue
      const source = JSON.parse(readFileSync(resolve(topologyRoot, context.topologyPath), 'utf8')) as { pens: readonly { id?: string; text?: string }[] }
      for (const binding of bindings) {
        const penText = source.pens.find((pen) => pen.id === binding.penId)?.text ?? ''
        const expectedTitle = titleByPenId.get(binding.penId) ?? titleByNodeId.get(binding.nodeId)
        expect(penText.replace(/\s+/g, '')).toContain(expectedTitle)
      }
    }
  })

})

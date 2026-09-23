import { describe, expect, it } from 'vitest'
import {
  createDefaultGasV3TopologyFilterSelection,
  createGasV3TopologyCombinationKey,
  resolveGasV3TopologyVariant,
  toggleGasV3TopologyFilter,
} from './gas-v3-topology-layer-filter'

describe('燃气拓扑独立文件筛选', () => {
  it('默认打开网络、业务、关键环节三层对应的完整输入文件', () => {
    const selected = createDefaultGasV3TopologyFilterSelection()
    expect([...selected]).toEqual(['network', 'business', 'key-process'])
    expect(createGasV3TopologyCombinationKey(selected)).toBe('network+business+key-process')
    expect(resolveGasV3TopologyVariant(selected)?.id).toBe('network-business-key-process')
  })

  it('勾选架构层会取消全部其他层', () => {
    const selected = toggleGasV3TopologyFilter(
      new Set(['network', 'business', 'key-process'] as const),
      'architecture',
      true,
    )
    expect(selected).toEqual(new Set(['architecture']))
    expect(resolveGasV3TopologyVariant(selected)?.id).toBe('architecture')
  })

  it('勾选任一其他层会取消架构层且不影响其他内容层组合', () => {
    let selected = toggleGasV3TopologyFilter(new Set(['architecture'] as const), 'network', true)
    expect(selected).toEqual(new Set(['network']))
    selected = toggleGasV3TopologyFilter(selected, 'key-process', true)
    expect(selected).toEqual(new Set(['network', 'key-process']))
    expect(resolveGasV3TopologyVariant(selected)?.id).toBe('network-key-process')
  })

  it('组合键与勾选顺序无关，且网络加业务精确解析到补充输入文件', () => {
    const selected = new Set(['business', 'network'] as const)
    expect(createGasV3TopologyCombinationKey(selected)).toBe('network+business')
    expect(resolveGasV3TopologyVariant(selected)?.id).toBe('network-business')
    expect(resolveGasV3TopologyVariant(selected)?.topologyPath)
      .toBe('variants/network-business/topology.json')
  })

  it('空集合和架构层混选均不生成请求组合键', () => {
    expect(createGasV3TopologyCombinationKey(new Set())).toBeUndefined()
    expect(createGasV3TopologyCombinationKey(new Set(['architecture', 'network']))).toBeUndefined()
  })
})

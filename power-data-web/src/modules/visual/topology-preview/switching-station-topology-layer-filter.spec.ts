import { describe, expect, it } from 'vitest'
import {
  createDefaultSwitchingStationTopologyFilterSelection,
  createSwitchingStationTopologyCombinationKey,
  resolveSwitchingStationTopologyVariant,
  toggleSwitchingStationTopologyFilter,
} from './switching-station-topology-layer-filter'

describe('开关站拓扑完整文件筛选', () => {
  it('默认精确打开网络、业务、关键环节三层输入', () => {
    const selected = createDefaultSwitchingStationTopologyFilterSelection()
    expect([...selected]).toEqual(['network', 'business', 'key-process'])
    expect(createSwitchingStationTopologyCombinationKey(selected)).toBe('network+business+key-process')
    expect(resolveSwitchingStationTopologyVariant(selected)?.id).toBe('network-business-key-process')
  })

  it('架构层与其他层互斥，内容层之间保留组合', () => {
    const architecture = toggleSwitchingStationTopologyFilter(
      new Set(['network', 'business', 'key-process']),
      'architecture',
      true,
    )
    expect(architecture).toEqual(new Set(['architecture']))
    const network = toggleSwitchingStationTopologyFilter(architecture, 'network', true)
    const combined = toggleSwitchingStationTopologyFilter(network, 'key-process', true)
    expect(combined).toEqual(new Set(['network', 'key-process']))
    expect(resolveSwitchingStationTopologyVariant(combined)?.id).toBe('network-key-process')
  })

  it('组合键与勾选顺序无关，八份输入均可精确解析', () => {
    const expected = new Map([
      ['architecture', 'architecture'],
      ['network', 'network'],
      ['business', 'business'],
      ['key-process', 'key-process'],
      ['network+business', 'network-business'],
      ['network+key-process', 'network-key-process'],
      ['business+key-process', 'business-key-process'],
      ['network+business+key-process', 'network-business-key-process'],
    ])
    for (const [key, id] of expected) {
      const selected = new Set(key.split('+')) as ReadonlySet<'architecture' | 'network' | 'business' | 'key-process'>
      expect(createSwitchingStationTopologyCombinationKey(selected)).toBe(key)
      expect(resolveSwitchingStationTopologyVariant(selected)?.id).toBe(id)
    }
    expect(createSwitchingStationTopologyCombinationKey(new Set())).toBeUndefined()
    expect(createSwitchingStationTopologyCombinationKey(new Set(['architecture', 'network']))).toBeUndefined()
  })
})

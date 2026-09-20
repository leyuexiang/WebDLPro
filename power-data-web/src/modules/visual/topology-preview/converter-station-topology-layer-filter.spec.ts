import { describe, expect, it } from 'vitest'
import {
  createDefaultConverterStationTopologyFilterSelection,
  createConverterStationTopologyCombinationKey,
  resolveConverterStationTopologyVariant,
  toggleConverterStationTopologyFilter,
} from './converter-station-topology-layer-filter'

describe('换流站拓扑完整文件筛选', () => {
  it('默认精确打开网络、业务、关键环节三层输入', () => {
    const selected = createDefaultConverterStationTopologyFilterSelection()
    expect([...selected]).toEqual(['network', 'business', 'key-process'])
    expect(createConverterStationTopologyCombinationKey(selected)).toBe('network+business+key-process')
    expect(resolveConverterStationTopologyVariant(selected)?.id).toBe('network-business-key-process')
  })

  it('架构层与其他层互斥，内容层之间保留组合', () => {
    const architecture = toggleConverterStationTopologyFilter(
      new Set(['network', 'business', 'key-process']),
      'architecture',
      true,
    )
    expect(architecture).toEqual(new Set(['architecture']))
    const network = toggleConverterStationTopologyFilter(architecture, 'network', true)
    const combined = toggleConverterStationTopologyFilter(network, 'key-process', true)
    expect(combined).toEqual(new Set(['network', 'key-process']))
    expect(resolveConverterStationTopologyVariant(combined)?.id).toBe('network-key-process')
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
      expect(createConverterStationTopologyCombinationKey(selected)).toBe(key)
      expect(resolveConverterStationTopologyVariant(selected)?.id).toBe(id)
    }
    expect(createConverterStationTopologyCombinationKey(new Set())).toBeUndefined()
    expect(createConverterStationTopologyCombinationKey(new Set(['architecture', 'network']))).toBeUndefined()
  })
})

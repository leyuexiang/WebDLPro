import { describe, expect, it } from 'vitest'
import {
  createDefaultStepDownSubstationTopologyFilterSelection,
  createStepDownSubstationTopologyCombinationKey,
  resolveStepDownSubstationTopologyVariant,
  toggleStepDownSubstationTopologyFilter,
} from './step-down-substation-topology-layer-filter'

describe('降压站拓扑完整文件筛选', () => {
  it('默认精确打开网络、业务、关键环节三层输入', () => {
    const selected = createDefaultStepDownSubstationTopologyFilterSelection()
    expect([...selected]).toEqual(['network', 'business', 'key-process'])
    expect(createStepDownSubstationTopologyCombinationKey(selected)).toBe('network+business+key-process')
    expect(resolveStepDownSubstationTopologyVariant(selected)?.id).toBe('network-business-key-process')
  })

  it('架构层与其他层互斥，内容层之间保留组合', () => {
    const architecture = toggleStepDownSubstationTopologyFilter(
      new Set(['network', 'business', 'key-process']),
      'architecture',
      true,
    )
    expect(architecture).toEqual(new Set(['architecture']))
    const network = toggleStepDownSubstationTopologyFilter(architecture, 'network', true)
    const combined = toggleStepDownSubstationTopologyFilter(network, 'key-process', true)
    expect(combined).toEqual(new Set(['network', 'key-process']))
    expect(resolveStepDownSubstationTopologyVariant(combined)?.id).toBe('network-key-process')
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
      expect(createStepDownSubstationTopologyCombinationKey(selected)).toBe(key)
      expect(resolveStepDownSubstationTopologyVariant(selected)?.id).toBe(id)
    }
    expect(createStepDownSubstationTopologyCombinationKey(new Set())).toBeUndefined()
    expect(createStepDownSubstationTopologyCombinationKey(new Set(['architecture', 'network']))).toBeUndefined()
  })
})

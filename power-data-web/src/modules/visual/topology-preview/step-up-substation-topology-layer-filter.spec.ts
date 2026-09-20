import { describe, expect, it } from 'vitest'
import {
  createDefaultStepUpSubstationTopologyFilterSelection,
  createStepUpSubstationTopologyCombinationKey,
  resolveStepUpSubstationTopologyVariant,
  toggleStepUpSubstationTopologyFilter,
} from './step-up-substation-topology-layer-filter'

describe('升压站拓扑完整文件筛选', () => {
  it('默认精确打开网络、业务、关键环节三层输入', () => {
    const selected = createDefaultStepUpSubstationTopologyFilterSelection()
    expect([...selected]).toEqual(['network', 'business', 'key-process'])
    expect(createStepUpSubstationTopologyCombinationKey(selected)).toBe('network+business+key-process')
    expect(resolveStepUpSubstationTopologyVariant(selected)?.id).toBe('network-business-key-process')
  })

  it('架构层与其他层互斥，内容层之间保留组合', () => {
    const architecture = toggleStepUpSubstationTopologyFilter(
      new Set(['network', 'business', 'key-process']),
      'architecture',
      true,
    )
    expect(architecture).toEqual(new Set(['architecture']))
    const network = toggleStepUpSubstationTopologyFilter(architecture, 'network', true)
    const combined = toggleStepUpSubstationTopologyFilter(network, 'key-process', true)
    expect(combined).toEqual(new Set(['network', 'key-process']))
    expect(resolveStepUpSubstationTopologyVariant(combined)?.id).toBe('network-key-process')
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
      expect(createStepUpSubstationTopologyCombinationKey(selected)).toBe(key)
      expect(resolveStepUpSubstationTopologyVariant(selected)?.id).toBe(id)
    }
    expect(createStepUpSubstationTopologyCombinationKey(new Set())).toBeUndefined()
    expect(createStepUpSubstationTopologyCombinationKey(new Set(['architecture', 'network']))).toBeUndefined()
  })
})

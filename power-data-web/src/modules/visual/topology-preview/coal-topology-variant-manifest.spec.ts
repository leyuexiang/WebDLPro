import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import { COAL_TOPOLOGY_VARIANTS } from './coal-topology-variant-manifest'

const topologyRoot = resolve(process.cwd(), 'public/topology/coal-json-preview')

describe('燃煤拓扑版本清单', () => {
  it('八个组合各自指向一份散列和图元数匹配的独立文件', () => {
    expect(COAL_TOPOLOGY_VARIANTS).toHaveLength(8)
    const paths = new Set<string>()
    const keys = new Set<string>()
    for (const variant of COAL_TOPOLOGY_VARIANTS) {
      expect(paths.has(variant.topologyPath)).toBe(false)
      expect(keys.has(variant.combinationKey)).toBe(false)
      paths.add(variant.topologyPath)
      keys.add(variant.combinationKey)

      const file = resolve(topologyRoot, variant.topologyPath)
      expect(existsSync(file)).toBe(true)
      const bytes = readFileSync(file)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(variant.sourceSha256)
      const data = JSON.parse(bytes.toString('utf8')) as Meta2dData
      expect(data.pens).toHaveLength(variant.expectedPenCount)
    }
  })

  it('架构层始终独立，且只有燃煤整图是默认文件', () => {
    const architecture = COAL_TOPOLOGY_VARIANTS.find((variant) => variant.id === 'architecture')
    expect(architecture?.layerIds).toEqual(['architecture'])
    expect(COAL_TOPOLOGY_VARIANTS
      .filter((variant) => variant.id !== 'architecture')
      .every((variant) => !(variant.layerIds as readonly string[]).includes('architecture'))).toBe(true)
    expect(COAL_TOPOLOGY_VARIANTS.filter((variant) => 'isDefault' in variant)).toHaveLength(1)
  })

  it('仅将非工业军事区的企业级防火墙改为工业防火墙，企业办公网保持原文字', () => {
    // 每份含防火墙的燃煤输入都按稳定图元编号逐项核对，避免用数组顺序误改企业办公网。
    const expected = new Map([
      ['architecture', ['5e97c875', '611ca56']],
      ['network', ['0317f07', '304a751']],
      ['network-business', ['1005511', '040a992']],
      ['network-key-process', ['6097ecf', '4757ff3c']],
      ['network-business-key-process', ['508798a0', '927cfac']],
    ])
    for (const variant of COAL_TOPOLOGY_VARIANTS) {
      const [industrialPenId, enterprisePenId] = expected.get(variant.id) ?? []
      if (!industrialPenId || !enterprisePenId) continue
      const data = JSON.parse(readFileSync(resolve(topologyRoot, variant.topologyPath), 'utf8')) as Meta2dData
      const industrialText = data.pens.find((pen) => pen.id === industrialPenId)?.text
      const enterpriseText = data.pens.find((pen) => pen.id === enterprisePenId)?.text
      expect(industrialText).toContain('工业防火墙')
      expect(industrialText).not.toContain('企业级防火墙')
      expect(enterpriseText).toContain('企业级防火墙')
      expect(enterpriseText).not.toContain('工业防火墙')
    }
  })
})


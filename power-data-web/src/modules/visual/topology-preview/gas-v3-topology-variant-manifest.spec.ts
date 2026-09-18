import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import { GAS_V3_TOPOLOGY_VARIANTS } from './gas-v3-topology-variant-manifest'

const topologyRoot = resolve(process.cwd(), 'public/topology/gas-v3-json-preview')

describe('燃气拓扑版本清单', () => {
  it('八个组合各自指向一份散列和图元数匹配的独立文件', () => {
    expect(GAS_V3_TOPOLOGY_VARIANTS).toHaveLength(8)
    const paths = new Set<string>()
    const keys = new Set<string>()
    for (const variant of GAS_V3_TOPOLOGY_VARIANTS) {
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

  it('架构层始终独立，且只有燃气第三版整图是默认文件', () => {
    const architecture = GAS_V3_TOPOLOGY_VARIANTS.find((variant) => variant.id === 'architecture')
    expect(architecture?.layerIds).toEqual(['architecture'])
    expect(GAS_V3_TOPOLOGY_VARIANTS
      .filter((variant) => variant.id !== 'architecture')
      .every((variant) => !(variant.layerIds as readonly string[]).includes('architecture'))).toBe(true)
    expect(GAS_V3_TOPOLOGY_VARIANTS.filter((variant) => 'isDefault' in variant)).toHaveLength(1)
  })

  it('仅将非工业军事区的企业级防火墙改为工业防火墙，企业办公网保持原文字', () => {
    // 每份含防火墙的燃气输入都按稳定图元编号逐项核对，避免用数组顺序误改企业办公网。
    const expected = new Map([
      ['architecture', ['20d61a7d', '551a4c0f']],
      ['network', ['19b421ad', '85e8b44']],
      ['network-business', ['2a17843f', '13b84357']],
      ['network-key-process', ['3afc0cd0', '195812b']],
      ['network-business-key-process', ['567de6f7', '9b794e1']],
    ])
    for (const variant of GAS_V3_TOPOLOGY_VARIANTS) {
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

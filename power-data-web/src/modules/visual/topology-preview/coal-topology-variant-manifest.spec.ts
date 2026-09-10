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
})


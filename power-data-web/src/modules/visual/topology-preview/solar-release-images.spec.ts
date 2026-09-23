import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSolarTopologyPreviewDataCacheForTests, loadSolarTopologyPreviewData } from './solar-topology-preview-data'
import { SOLAR_TOPOLOGY_VARIANT_BY_ID } from './solar-topology-variant-manifest'
import { TOPOLOGY_SHARED_ASSET_ALIASES, getTopologySharedPublicAssetUrl } from './topology-shared-assets'
import { WIND_TOPOLOGY_VARIANT_BY_ID } from './wind-topology-variant-manifest'
import { clearWindTopologyPreviewDataCacheForTests, loadWindTopologyPreviewData } from './wind-topology-preview-data'

/** 使用发布时的相对基址和真实源数据，复现独立预览正常、嵌入壳图片地址错误的差异。 */
afterEach(() => {
  clearSolarTopologyPreviewDataCacheForTests()
  clearWindTopologyPreviewDataCacheForTests()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('光伏发布图片地址', () => {
  it('公共别名只合并字节完全相同的资源，且适配子目录部署', () => {
    for (const [source, target] of Object.entries(TOPOLOGY_SHARED_ASSET_ALIASES)) {
      const digest = (path: string) => createHash('sha256').update(readFileSync(resolve('public/topology/shared', path))).digest('hex')
      expect(digest(source)).toBe(digest(target))
      expect(getTopologySharedPublicAssetUrl(source, '/power/', undefined)).toBe(`/power/topology/shared/${target}`)
    }
  })
  for (const variant of SOLAR_TOPOLOGY_VARIANT_BY_ID.values()) {
    it(`${variant.id} 的每个源图片均保留并指向壳内公共资源`, async () => {
      vi.stubEnv('BASE_URL', './')
      vi.stubGlobal('document', { querySelector: () => ({ src: 'http://example.test/shell/assets/index.js' }) })
      const source = JSON.parse(readFileSync(resolve('public/topology/solar-json-preview', variant.topologyPath), 'utf8'))
      // 第三层来源仍保留压缩包原始云端路径；用快照验证加载器没有把部署地址写回缓存或源对象。
      const sourceImageByPenId = new Map(source.pens.map((pen: { id?: string; image?: string }) => [pen.id, pen.image]))
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(source))))
      const loaded = await loadSolarTopologyPreviewData(variant.id)
      const sourceImages = source.pens.filter((pen: { image?: string }) => Boolean(pen.image))
      const loadedImages = loaded.pens.filter((pen) => Boolean(pen.image))
      expect(loadedImages).toHaveLength(sourceImages.length)
      expect(loadedImages.length).toBeGreaterThan(0)
      for (const pen of loadedImages) {
        const url = new URL(pen.image!, 'http://example.test')
        expect(url.pathname).toMatch(/^\/shell\/topology\/shared\//)
        expect(existsSync(resolve('public', decodeURIComponent(url.pathname.slice('/shell/'.length))))).toBe(true)
      }
      // 加载器不得把本次部署地址写回源数据，后续切层仍从隔离副本生成地址。
      expect(new Map(source.pens.map((pen: { id?: string; image?: string }) => [pen.id, pen.image]))).toEqual(sourceImageByPenId)
    })
  }
})

describe('风电同源公共资源', () => {
  for (const variant of WIND_TOPOLOGY_VARIANT_BY_ID.values()) {
    it(`${variant.id} 全部图元复用壳内公共资源`, async () => {
      vi.stubEnv('BASE_URL', './')
      vi.stubGlobal('document', { querySelector: () => ({ src: 'http://example.test/shell/assets/index.js' }) })
      const source = JSON.parse(readFileSync(resolve('public/topology/wind-json-preview', variant.topologyPath), 'utf8'))
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(source))))
      const loaded = await loadWindTopologyPreviewData(variant.id)
      expect(loaded.pens.filter((pen) => pen.image)).toHaveLength(source.pens.filter((pen: { image?: string }) => pen.image).length)
      for (const pen of loaded.pens) {
        if (!pen.image) continue
        const path = new URL(pen.image).pathname
        expect(path).toMatch(/^\/shell\/topology\/shared\//)
        expect(existsSync(resolve('public', decodeURIComponent(path.slice('/shell/'.length))))).toBe(true)
      }
    })
  }
})

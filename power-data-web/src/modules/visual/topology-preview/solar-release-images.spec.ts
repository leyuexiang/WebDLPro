import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Pen } from '@meta2d/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSolarTopologyPreviewDataCacheForTests, loadSolarTopologyPreviewData } from './solar-topology-preview-data'
import { SOLAR_TOPOLOGY_VARIANT_BY_ID } from './solar-topology-variant-manifest'
import { TOPOLOGY_SHARED_ASSET_ALIASES, getTopologySharedPublicAssetUrl } from './topology-shared-assets'
import { getWindTopologyResourceManifest } from './wind-topology-manifest'
import {
  applyWindTopologySelectionPolicy,
  WIND_TOPOLOGY_BACKGROUND_LOCK,
  WIND_TOPOLOGY_SELECTABLE_LOCK,
} from './wind-topology-selection'
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
  it('旧资源键均映射到存在的新公共图标，且适配子目录部署', () => {
    for (const [source, target] of Object.entries(TOPOLOGY_SHARED_ASSET_ALIASES)) {
      expect(source).toMatch(/^assets\//)
      expect(existsSync(resolve('public/topology/shared', target))).toBe(true)
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
      const sourceBytes = readFileSync(resolve('public/topology/wind-json-preview', variant.topologyPath))
      // 仅对本次更新的完整组合校验原始字节散列，避免把历史版本登记差异混入本次改动。
      if (variant.id === 'network-business-key-process') {
        expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(variant.sourceSha256)
      }
      const source = JSON.parse(sourceBytes.toString('utf8'))
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

  it('三层组合中的设备和六个工艺步骤可独立选择，背景与连线不可命中', () => {
    const variant = WIND_TOPOLOGY_VARIANT_BY_ID.get('network-business-key-process')!
    const source = JSON.parse(readFileSync(resolve('public/topology/wind-json-preview', variant.topologyPath), 'utf8')) as { pens: Pen[] }
    const pens: Pen[] = structuredClone(source.pens)
    const manifest = getWindTopologyResourceManifest(variant.id)
    const selectablePenIds = applyWindTopologySelectionPolicy(pens, variant.id)
    const penById = new Map<string, Pen>(pens.map((pen) => [pen.id!, pen]))

    // 每个已映射的设备图标均可独立选择；层级标题底图仍只作装饰。
    for (const penId of manifest.devicePenIds) {
      expect(selectablePenIds.has(penId)).toBe(true)
      expect(penById.get(penId)?.locked).toBe(WIND_TOPOLOGY_SELECTABLE_LOCK)
    }
    for (const penId of manifest.titleBackgroundPenIds) {
      expect(penById.get(penId)?.locked).toBe(WIND_TOPOLOGY_BACKGROUND_LOCK)
    }
    // 当前输入中的六个底部步骤保留二维选中；所有线路始终禁用命中。
    for (const penId of manifest.processNodePenIds) {
      expect(selectablePenIds.has(penId)).toBe(true)
      expect(penById.get(penId)?.locked).toBe(WIND_TOPOLOGY_SELECTABLE_LOCK)
    }
    for (const pen of pens.filter((item: Pen) => item.name === 'line')) {
      expect(pen.locked).toBe(WIND_TOPOLOGY_BACKGROUND_LOCK)
    }
  })
})

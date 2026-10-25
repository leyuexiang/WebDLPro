import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Meta2dData } from '@meta2d/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE,
  clearBusinessSceneTopologyPreviewDataCacheForTests,
  loadBusinessSceneTopologyPreviewData,
  type BusinessSceneTopologyVariantId,
} from './business-scene-topology'

const originalFetch = globalThis.fetch

afterEach(() => {
  clearBusinessSceneTopologyPreviewDataCacheForTests()
  globalThis.fetch = originalFetch
})

describe('配电站拓扑源文件缓存版本', () => {
  it('请求带源版本的默认拓扑，避开旧地址缓存中的额外图元', async () => {
    const variant = BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE.distribution.find((item) => item.isDefault)!
    const sourcePath = resolve(
      process.cwd(),
      'public/topology/distribution-json-preview',
      variant.topologyPath,
    )
    const sourceData = JSON.parse(readFileSync(sourcePath, 'utf8')) as Meta2dData

    // 复现旧地址缓存差异：无版本地址返回额外图元，版本化地址返回最新源文件。
    const staleCachedData: Meta2dData = {
      ...sourceData,
      pens: [
        ...sourceData.pens,
        ...Array.from({ length: 13 }, (_, index) => ({
          ...sourceData.pens[0]!,
          id: `stale-cache-${index}`,
        })),
      ],
    }
    const requestedUrls: string[] = []
    globalThis.fetch = vi.fn(async (input) => {
      const requestedUrl = String(input)
      requestedUrls.push(requestedUrl)
      const responseData = requestedUrl.includes(`?v=${variant.sourceSha256}`)
        ? sourceData
        : staleCachedData
      return new Response(JSON.stringify(responseData), { status: 200 })
    }) as typeof fetch

    const data = await loadBusinessSceneTopologyPreviewData('distribution', variant.id as BusinessSceneTopologyVariantId)

    expect(sourceData.pens).toHaveLength(91)
    expect(variant.expectedPenCount).toBe(91)
    expect(requestedUrls).toHaveLength(1)
    expect(requestedUrls[0]).toContain(`?v=${variant.sourceSha256}`)
    expect(data.pens).toHaveLength(91)
  })

  it('调度中心通过版本化地址加载完整三层文件，并仅把空组合容器从运行时移除', async () => {
    const variant = BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE.dispatch.find((item) => item.isDefault)!
    const sourcePath = resolve(
      process.cwd(),
      'public/topology/dispatch-json-preview',
      variant.topologyPath,
    )
    const sourceData = JSON.parse(readFileSync(sourcePath, 'utf8')) as Meta2dData
    const requestedUrls: string[] = []
    globalThis.fetch = vi.fn(async (input) => {
      requestedUrls.push(String(input))
      return new Response(JSON.stringify(sourceData), { status: 200 })
    }) as typeof fetch

    const data = await loadBusinessSceneTopologyPreviewData('dispatch', variant.id as BusinessSceneTopologyVariantId)

    expect(variant.expectedPenCount).toBe(90)
    expect(data.pens).toHaveLength(89)
    expect(data.pens.some((pen) => pen.id === 'a15a085')).toBe(false)
    expect(requestedUrls).toHaveLength(1)
    expect(requestedUrls[0]).toContain(`?v=${variant.sourceSha256}`)
    expect(data.pens.filter((pen) => pen.image).every((pen) => pen.image?.startsWith('/topology/shared/'))).toBe(true)
  })
})

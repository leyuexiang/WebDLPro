import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Meta2dData } from '@meta2d/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WIND_DEFAULT_TOPOLOGY_VARIANT,
  WIND_TOPOLOGY_VARIANTS,
} from './wind-topology-variant-manifest'
import {
  clearWindTopologyPreviewDataCacheForTests,
  loadWindTopologyPreviewData,
} from './wind-topology-preview-data'

const topologyRoot = resolve(process.cwd(), 'public/topology/wind-json-preview')
const originalFetch = globalThis.fetch

afterEach(() => {
  clearWindTopologyPreviewDataCacheForTests()
  globalThis.fetch = originalFetch
})

describe('风电默认组合拓扑来源版本', () => {
  it.each(WIND_TOPOLOGY_VARIANTS)('$id 的图元数量与源文件散列均和登记值一致', (variant) => {
    const sourceBytes = readFileSync(resolve(topologyRoot, variant.topologyPath))
    const sourceData = JSON.parse(sourceBytes.toString('utf8')) as Meta2dData

    expect(sourceData.pens).toHaveLength(variant.expectedPenCount)
    expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(variant.sourceSha256)
  })

  it('以附件 JSON 的 114 个图元和散列为准，避免固定地址命中旧的 128 图元缓存', async () => {
    const sourceBytes = readFileSync(resolve(topologyRoot, WIND_DEFAULT_TOPOLOGY_VARIANT.topologyPath))
    const sourceData = JSON.parse(sourceBytes.toString('utf8')) as Meta2dData
    const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex')

    // 该夹具精确复现同事报告：旧地址缓存返回 128 个图元，而本次附件源文件为 114 个。
    const staleCachedData: Meta2dData = {
      ...sourceData,
      pens: [
        ...sourceData.pens,
        ...Array.from({ length: 14 }, (_, index) => ({
          ...sourceData.pens[0]!,
          id: `stale-cache-${index}`,
        })),
      ],
    }
    const requestedUrls: string[] = []
    globalThis.fetch = vi.fn(async (input) => {
      const requestedUrl = String(input)
      requestedUrls.push(requestedUrl)
      const responseData = requestedUrl.includes(`?v=${WIND_DEFAULT_TOPOLOGY_VARIANT.sourceSha256}`)
        ? sourceData
        : staleCachedData
      return new Response(JSON.stringify(responseData), { status: 200 })
    }) as typeof fetch

    const data = await loadWindTopologyPreviewData(WIND_DEFAULT_TOPOLOGY_VARIANT.id)

    expect(sourceSha256).toBe(WIND_DEFAULT_TOPOLOGY_VARIANT.sourceSha256)
    expect(sourceData.pens).toHaveLength(114)
    expect(WIND_DEFAULT_TOPOLOGY_VARIANT.expectedPenCount).toBe(sourceData.pens.length)
    expect(requestedUrls).toHaveLength(1)
    expect(requestedUrls[0]).toContain(`?v=${sourceSha256}`)
    expect(data.pens).toHaveLength(114)
  })
})

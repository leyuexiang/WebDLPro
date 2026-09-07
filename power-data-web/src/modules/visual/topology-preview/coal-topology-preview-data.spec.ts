import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import { getCoalTopologyResourceManifest } from './coal-topology-manifest'
import { COAL_TOPOLOGY_VARIANTS } from './coal-topology-variant-manifest'
import {
  clearCoalTopologyPreviewDataCacheForTests,
  getCoalTopologyPreviewIconPath,
  loadCoalTopologyPreviewData,
} from './coal-topology-preview-data'

const topologyRoot = resolve(process.cwd(), 'public/topology/coal-json-preview')
const originalFetch = globalThis.fetch

/** 根据请求地址返回清单中的本地文件，测试不依赖开发服务器或外部图片服务。 */
function installTopologyFetch(): void {
  globalThis.fetch = vi.fn(async (input) => {
    const url = String(input)
    const variant = COAL_TOPOLOGY_VARIANTS.find((entry) => url.endsWith(entry.topologyPath))
    if (!variant) return new Response('', { status: 404 })
    return new Response(readFileSync(resolve(topologyRoot, variant.topologyPath), 'utf8'), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

afterEach(() => {
  clearCoalTopologyPreviewDataCacheForTests()
  globalThis.fetch = originalFetch
})

describe('燃煤拓扑独立数据与公共资源', () => {
  it('八份文件分别保留源图元和倍率，并禁用模拟及网络数据配置', async () => {
    installTopologyFetch()
    for (const variant of COAL_TOPOLOGY_VARIANTS) {
      const source = JSON.parse(readFileSync(resolve(topologyRoot, variant.topologyPath), 'utf8')) as Meta2dData
      const data = await loadCoalTopologyPreviewData(variant.id)
      expect(data.pens).toHaveLength(variant.expectedPenCount)
      expect(data.scale).toBe(source.scale)
      expect(data.background).toBe(source.background)
      expect(data.width).toBeUndefined()
      expect(data.height).toBeUndefined()
      expect((data as Meta2dData & { enableMock?: boolean }).enableMock).toBe(false)
      expect(data.networks).toEqual([])
      expect(data.dataPoints).toEqual([])
    }
  })

  it('每份文件只使用公共设备图标和公共区域标题背景', async () => {
    installTopologyFetch()
    // 八份燃煤文件的设备数来自逐文件显式清单，区域标题背景不计入设备。
    const expectedDeviceCounts = [30, 42, 0, 16, 42, 50, 16, 50]
    for (const [index, variant] of COAL_TOPOLOGY_VARIANTS.entries()) {
      const data = await loadCoalTopologyPreviewData(variant.id)
      const manifest = getCoalTopologyResourceManifest(variant.id)
      expect(manifest.devicePenIds.size).toBe(expectedDeviceCounts[index])
      expect(manifest.titleBackgroundPenIds.size).toBe(6)
      for (const penId of manifest.devicePenIds) {
        const relativePath = getCoalTopologyPreviewIconPath(variant.id, penId)
        expect(relativePath).toMatch(/^icons\/normal\/[a-z0-9_]+\.webp$/)
        expect(existsSync(resolve(process.cwd(), 'public/topology/shared', relativePath!))).toBe(true)
        expect(data.pens.find((pen) => pen.id === penId)?.image).toContain(`/topology/shared/${relativePath}`)
      }
      for (const penId of manifest.titleBackgroundPenIds) {
        expect(data.pens.find((pen) => pen.id === penId)?.image)
          .toContain('/topology/shared/background/flow-light-3.png')
      }
    }
  })

  it('缓存返回独立深拷贝，重新切回不会继承状态或几何修改', async () => {
    installTopologyFetch()
    const first = await loadCoalTopologyPreviewData('architecture')
    const sourceX = first.pens[0]!.x
    first.pens[0]!.x = 987654
    first.pens.find((pen) => pen.id === '611ca56')!.image = '污染地址'

    const second = await loadCoalTopologyPreviewData('architecture')
    expect(second.pens[0]!.x).toBe(sourceX)
    expect(second.pens.find((pen) => pen.id === '611ca56')?.image).not.toBe('污染地址')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('状态切换只改变公共四态目录', () => {
    expect(getCoalTopologyPreviewIconPath('network', '44ac4f2f', 'normal')).toBe('icons/normal/router.webp')
    expect(getCoalTopologyPreviewIconPath('network', '44ac4f2f', 'alarm')).toBe('icons/alarm/router.webp')
    expect(existsSync(resolve(process.cwd(), 'public/topology/shared/icons/alarm/router.webp'))).toBe(true)
  })
})

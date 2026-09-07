import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import { getGasV3TopologyResourceManifest } from './gas-v3-topology-manifest'
import { GAS_V3_TOPOLOGY_VARIANTS } from './gas-v3-topology-variant-manifest'
import {
  clearGasV3TopologyPreviewDataCacheForTests,
  getGasV3TopologyPreviewIconPath,
  loadGasV3TopologyPreviewData,
} from './gas-v3-topology-preview-data'

const topologyRoot = resolve(process.cwd(), 'public/topology/gas-v3-json-preview')
const originalFetch = globalThis.fetch

/** 根据请求地址返回清单中的本地文件，测试不依赖开发服务器或外部图片服务。 */
function installTopologyFetch(): void {
  globalThis.fetch = vi.fn(async (input) => {
    const url = String(input)
    const variant = GAS_V3_TOPOLOGY_VARIANTS.find((entry) => url.endsWith(entry.topologyPath))
    if (!variant) return new Response('', { status: 404 })
    return new Response(readFileSync(resolve(topologyRoot, variant.topologyPath), 'utf8'), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

afterEach(() => {
  clearGasV3TopologyPreviewDataCacheForTests()
  globalThis.fetch = originalFetch
})

describe('燃气拓扑独立数据与公共资源', () => {
  it('八份文件分别保留源图元和倍率，并禁用模拟及网络数据配置', async () => {
    installTopologyFetch()
    for (const variant of GAS_V3_TOPOLOGY_VARIANTS) {
      const source = JSON.parse(readFileSync(resolve(topologyRoot, variant.topologyPath), 'utf8')) as Meta2dData
      const data = await loadGasV3TopologyPreviewData(variant.id)
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
    // 纠正后的网络＋业务文件含 37 台设备，与 6 个区域标题背景分别校验。
    const expectedDeviceCounts = [28, 37, 0, 14, 37, 44, 14, 44]
    for (const [index, variant] of GAS_V3_TOPOLOGY_VARIANTS.entries()) {
      const data = await loadGasV3TopologyPreviewData(variant.id)
      const manifest = getGasV3TopologyResourceManifest(variant.id)
      expect(manifest.devicePenIds.size).toBe(expectedDeviceCounts[index])
      expect(manifest.titleBackgroundPenIds.size).toBe(6)
      for (const penId of manifest.devicePenIds) {
        const relativePath = getGasV3TopologyPreviewIconPath(variant.id, penId)
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
    const first = await loadGasV3TopologyPreviewData('architecture')
    const sourceX = first.pens[0]!.x
    first.pens[0]!.x = 987654
    first.pens.find((pen) => pen.id === '551a4c0f')!.image = '污染地址'

    const second = await loadGasV3TopologyPreviewData('architecture')
    expect(second.pens[0]!.x).toBe(sourceX)
    expect(second.pens.find((pen) => pen.id === '551a4c0f')?.image).not.toBe('污染地址')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('状态切换只改变公共四态目录', () => {
    expect(getGasV3TopologyPreviewIconPath('network', 'b89be1c', 'normal')).toBe('icons/normal/router.webp')
    expect(getGasV3TopologyPreviewIconPath('network', 'b89be1c', 'alarm')).toBe('icons/alarm/router.webp')
    expect(existsSync(resolve(process.cwd(), 'public/topology/shared/icons/alarm/router.webp'))).toBe(true)
  })
})

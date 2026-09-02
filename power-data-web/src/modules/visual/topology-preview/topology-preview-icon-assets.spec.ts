import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  getCoalTopologyPreviewIconPath,
  loadCoalTopologyPreviewData,
} from './coal-topology-preview-data'
import {
  getGasTopologyPreviewIconPath,
  loadGasTopologyPreviewData,
} from './gas-topology-preview-data'
import { GAS_TOPOLOGY_RUNTIME_BINDINGS } from './gas-topology-runtime-bindings'
import type { TopologyDeviceStatus } from '@/config/process/types'

const DEVICE_STATUSES: readonly TopologyDeviceStatus[] = ['normal', 'alarm', 'fault', 'offline']

/** 读取新版 JSON 的图片图元，验证每个图元都被显式替换为本地 WebP 动图。 */
function readImagePenIds(relativePath: string): string[] {
  const data = JSON.parse(readFileSync(resolve(process.cwd(), relativePath), 'utf8')) as {
    pens?: Array<{ id?: string; image?: string }>
  }
  return (data.pens ?? [])
    .filter((pen) => Boolean(pen.id && pen.image))
    .map((pen) => pen.id as string)
}

/** 用同源文件响应模拟 fetch，避免测试依赖开发服务器或网络资源。 */
function createJsonFetch(relativePath: string): typeof fetch {
  const body = readFileSync(resolve(process.cwd(), relativePath), 'utf8')
  return vi.fn().mockResolvedValue(new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch
}

describe('新版拓扑动态图标素材契约', () => {
  it('燃气全部图片图元使用本地 WebP 动图且文件存在', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = createJsonFetch('public/topology/gas-json-preview/topology.json')
    try {
      const data = await loadGasTopologyPreviewData()
      const imagePenIds = readImagePenIds('public/topology/gas-json-preview/topology.json')
      expect(imagePenIds.length).toBeGreaterThan(0)
      for (const penId of imagePenIds) {
        const relativePath = getGasTopologyPreviewIconPath(penId)
        expect(relativePath).toMatch(/^icons\/normal\/[a-z0-9_]+\.webp$/)
        expect(existsSync(resolve(process.cwd(), 'public/topology/gas-json-preview', relativePath as string))).toBe(true)
        expect(data.pens.find((pen) => pen.id === penId)?.image).toContain(`/topology/gas-json-preview/${relativePath}`)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('燃气运行时绑定图元的四态动图均使用精确映射且文件存在', () => {
    for (const { penId } of GAS_TOPOLOGY_RUNTIME_BINDINGS) {
      const statePaths = DEVICE_STATUSES.map((status) => getGasTopologyPreviewIconPath(penId, status))
      expect(new Set(statePaths).size).toBe(DEVICE_STATUSES.length)
      for (const [index, relativePath] of statePaths.entries()) {
        expect(relativePath).toMatch(new RegExp(`^icons/${DEVICE_STATUSES[index]}/[a-z0-9_]+\\.webp$`))
        expect(existsSync(resolve(process.cwd(), 'public/topology/gas-json-preview', relativePath as string))).toBe(true)
      }
    }
  })

  it('燃煤全部图片图元使用本地 WebP 动图且文件存在', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = createJsonFetch('public/topology/coal-json-preview/topology.json')
    try {
      const data = await loadCoalTopologyPreviewData()
      const imagePenIds = readImagePenIds('public/topology/coal-json-preview/topology.json')
      expect(imagePenIds.length).toBeGreaterThan(0)
      for (const penId of imagePenIds) {
        const relativePath = getCoalTopologyPreviewIconPath(penId)
        expect(relativePath).toMatch(/^icons\/normal\/[a-z0-9_]+\.webp$/)
        expect(existsSync(resolve(process.cwd(), 'public/topology/coal-json-preview', relativePath as string))).toBe(true)
        expect(data.pens.find((pen) => pen.id === penId)?.image).toContain(`/topology/coal-json-preview/${relativePath}`)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Meta2dData } from '@meta2d/core'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearCoalTopologyPreviewDataCacheForTests,
  COAL_TOPOLOGY_BACKGROUND_PEN_IDS,
  getCoalTopologyPreviewIconPath,
  loadCoalTopologyPreviewData,
} from './coal-topology-preview-data'
import {
  GAS_V3_DEVICE_PEN_IDS,
  getGasV3TopologyPreviewIconPath,
} from './gas-v3-topology-preview-data'
import { getTopologySharedPublicAssetUrl } from './topology-shared-assets'

const sharedRoot = resolve(process.cwd(), 'public/topology/shared')
const coalTopologyFile = resolve(
  process.cwd(),
  'public/topology/coal-json-preview/variants/network-business-key-process/topology.json',
)
const originalFetch = globalThis.fetch
const statuses: readonly TopologyDeviceStatus[] = ['normal', 'alarm', 'fault', 'offline']

/** 用本地燃煤 V2 源文件模拟响应，验证加载器不会依赖开发服务器或外部地址。 */
function installCoalTopologyFetch(): void {
  const body = readFileSync(coalTopologyFile, 'utf8')
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch
}

afterEach(() => {
  clearCoalTopologyPreviewDataCacheForTests()
  globalThis.fetch = originalFetch
})

describe('拓扑公共设备图标', () => {
  it('相对发布和子目录部署都生成不绑定拓扑版本的地址', () => {
    expect(getTopologySharedPublicAssetUrl(
      'icons/normal/firewall.webp',
      '.',
      'http://127.0.0.1:5578/shell/assets/index.js',
    )).toBe('http://127.0.0.1:5578/shell/topology/shared/icons/normal/firewall.webp')
    expect(getTopologySharedPublicAssetUrl('icons/normal/firewall.webp', '/power/', undefined))
      .toBe('/power/topology/shared/icons/normal/firewall.webp')
  })

  it('燃气第三版全部设备图标都来自公共目录', () => {
    for (const penId of GAS_V3_DEVICE_PEN_IDS) {
      for (const status of statuses) {
        const relativePath = getGasV3TopologyPreviewIconPath('network-business-key-process', penId, status)
        expect(relativePath).toBeTruthy()
        expect(existsSync(resolve(sharedRoot, relativePath!))).toBe(true)
      }
    }
  })

  it('燃煤全部图片图元都引用公共目录中的受控图标', () => {
    const data = JSON.parse(readFileSync(coalTopologyFile, 'utf8')) as Meta2dData
    const imagePens = data.pens.filter((pen) => Boolean(pen.image?.trim())
      && !COAL_TOPOLOGY_BACKGROUND_PEN_IDS.has(pen.id ?? ''))

    for (const pen of imagePens) {
      for (const status of statuses) {
        const relativePath = pen.id
          ? getCoalTopologyPreviewIconPath('network-business-key-process', pen.id, status)
          : undefined
        expect(relativePath).toBeTruthy()
        expect(existsSync(resolve(sharedRoot, relativePath!))).toBe(true)
      }
    }
  })

  it('公共目录完整包含29类设备的四种状态且没有额外格式', () => {
    for (const status of statuses) {
      const files = readdirSync(resolve(sharedRoot, 'icons', status))
      expect(files).toHaveLength(29)
      expect(files.every((file) => file.endsWith('.webp'))).toBe(true)
    }
  })

  it('拓扑版本目录不再保存图片资源副本', () => {
    expect(existsSync(resolve(process.cwd(), 'public/topology/gas-v3-json-preview/icons'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'public/topology/coal-json-preview/icons'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'public/topology/gas-v3-json-preview/background'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'public/topology/coal-json-preview/gifs'))).toBe(false)
  })

  it('公共装饰资源不绑定具体拓扑版本', () => {
    expect(existsSync(resolve(sharedRoot, 'background/flow-light-3.png'))).toBe(true)
  })

  it('燃煤 V2 加载后所有图片图元都指向公共资源', async () => {
    installCoalTopologyFetch()
    const data = await loadCoalTopologyPreviewData()
    expect(data.pens.filter((pen) => pen.image?.includes('/topology/coal-json-preview/'))).toHaveLength(0)
    expect(data.pens.filter((pen) => pen.image?.includes('/topology/shared/'))).toHaveLength(56)
  })
})

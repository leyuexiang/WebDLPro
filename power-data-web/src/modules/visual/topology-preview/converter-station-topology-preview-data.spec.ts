import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import { getConverterStationTopologyResourceManifest } from './converter-station-topology-manifest'
import {
  clearConverterStationTopologyPreviewDataCacheForTests,
  loadConverterStationTopologyPreviewData,
} from './converter-station-topology-preview-data'
import {
  CONVERTER_STATION_TOPOLOGY_BACKGROUND_LOCK,
  CONVERTER_STATION_TOPOLOGY_SELECTABLE_LOCK,
} from './converter-station-topology-selection'
import { CONVERTER_STATION_TOPOLOGY_VARIANTS } from './converter-station-topology-variant-manifest'
import { getSubstationTopologySelectablePenIds } from './substation-topology-node-selection'

const topologyRoot = resolve(process.cwd(), 'public/topology/converter-station-json-preview')
const originalFetch = globalThis.fetch

/** 测试只读取已导入本地文件，不依赖开发服务器或源压缩包路径。 */
function installTopologyFetch(): void {
  globalThis.fetch = vi.fn(async (input) => {
    const variant = CONVERTER_STATION_TOPOLOGY_VARIANTS.find((entry) => String(input).endsWith(entry.topologyPath))
    if (!variant) return new Response('', { status: 404 })
    return new Response(readFileSync(resolve(topologyRoot, variant.topologyPath), 'utf8'), { status: 200 })
  }) as typeof fetch
}

afterEach(() => {
  clearConverterStationTopologyPreviewDataCacheForTests()
  globalThis.fetch = originalFetch
})

describe('换流站拓扑独立数据与公共资源', () => {
  it('八份文件分别保留源布局并禁用模拟、联网和初始化脚本', async () => {
    installTopologyFetch()
    for (const variant of CONVERTER_STATION_TOPOLOGY_VARIANTS) {
      const source = JSON.parse(readFileSync(resolve(topologyRoot, variant.topologyPath), 'utf8')) as Meta2dData
      const data = await loadConverterStationTopologyPreviewData(variant.id)
      const sourceCombineCount = source.pens.filter((pen) => pen.name === 'combine').length
      expect(data.pens).toHaveLength(variant.expectedPenCount - sourceCombineCount)
      expect(data.pens.some((pen) => pen.name === 'combine')).toBe(false)
      expect(data.pens.every((pen) => !pen.parentId)).toBe(true)
      expect(data.scale).toBe(source.scale)
      expect(data.background).toBe(source.background)
      expect(data.width).toBeUndefined()
      expect(data.height).toBeUndefined()
      expect((data as Meta2dData & { enableMock?: boolean }).enableMock).toBe(false)
      expect(data.networks).toEqual([])
      expect(data.dataPoints).toEqual([])
    }
  })

  it('全部图片均映射到公共目录，设备可只读选择且背景与连线不可命中', async () => {
    installTopologyFetch()
    for (const variant of CONVERTER_STATION_TOPOLOGY_VARIANTS) {
      const data = await loadConverterStationTopologyPreviewData(variant.id)
      const manifest = getConverterStationTopologyResourceManifest(variant.id)
      for (const pen of data.pens.filter((item) => item.image)) {
        expect(pen.image).toContain('/topology/shared/')
      }
      for (const [penId, path] of manifest.staticImagePathByPenId) {
        expect(existsSync(resolve(process.cwd(), 'public/topology/shared', path))).toBe(true)
        expect(data.pens.find((pen) => pen.id === penId)?.locked).toBe(CONVERTER_STATION_TOPOLOGY_SELECTABLE_LOCK)
      }
      for (const penId of manifest.processNodePenIds) {
        expect(data.pens.find((pen) => pen.id === penId)?.locked).toBe(CONVERTER_STATION_TOPOLOGY_SELECTABLE_LOCK)
      }
      expect(data.pens.filter((pen) => pen.name === 'line')
        .every((pen) => pen.locked === CONVERTER_STATION_TOPOLOGY_BACKGROUND_LOCK)).toBe(true)
      for (const penId of manifest.titleBackgroundPenIds) {
        expect(data.pens.find((pen) => pen.id === penId)?.locked).toBe(CONVERTER_STATION_TOPOLOGY_BACKGROUND_LOCK)
      }
    }
  })

  it('三层完整图移除顶层组合并保持所有子图元世界坐标', async () => {
    installTopologyFetch()
    const variantId = 'network-business-key-process'
    const variant = CONVERTER_STATION_TOPOLOGY_VARIANTS.find((entry) => entry.id === variantId)!
    const source = JSON.parse(readFileSync(resolve(topologyRoot, variant.topologyPath), 'utf8')) as Meta2dData
    const data = await loadConverterStationTopologyPreviewData(variantId)
    const loadedById = new Map(data.pens.map((pen) => [pen.id, pen]))
    const sourceRoot = source.pens.find((pen) => pen.name === 'combine' && !pen.parentId)!

    expect(loadedById.has(sourceRoot.id!)).toBe(false)
    for (const sourcePen of source.pens.filter((pen) => pen.parentId === sourceRoot.id && pen.name !== 'combine')) {
      const loadedPen = loadedById.get(sourcePen.id!)!
      // 完整图的直接子图元包含设备、连线、背景和嵌套标题组，展平后均不得改变视觉位置。
      expect(loadedPen.parentId).toBeUndefined()
      expect(loadedPen.x).toBeCloseTo(sourceRoot.x! + sourcePen.x! * sourceRoot.width!)
      expect(loadedPen.y).toBeCloseTo(sourceRoot.y! + sourcePen.y! * sourceRoot.height!)
      expect(loadedPen.width).toBeCloseTo(sourcePen.width! * sourceRoot.width!)
      expect(loadedPen.height).toBeCloseTo(sourcePen.height! * sourceRoot.height!)
    }

    const manifest = getConverterStationTopologyResourceManifest(variantId)
    const selectableIds = getSubstationTopologySelectablePenIds(data.pens, manifest)
    const backgroundPens = data.pens.filter((pen) => !selectableIds.has(pen.id!))
    expect(backgroundPens.every((pen) => pen.locked === CONVERTER_STATION_TOPOLOGY_BACKGROUND_LOCK)).toBe(true)
  })

  it('缓存返回深拷贝，重新切回不继承临时几何和图片修改', async () => {
    installTopologyFetch()
    const first = await loadConverterStationTopologyPreviewData('architecture')
    const sourceX = first.pens[0]!.x
    first.pens[0]!.x = 987654
    first.pens.find((pen) => pen.id === '747d22ee')!.image = '污染地址'

    const second = await loadConverterStationTopologyPreviewData('architecture')
    expect(second.pens[0]!.x).toBe(sourceX)
    expect(second.pens.find((pen) => pen.id === '747d22ee')?.image).not.toBe('污染地址')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})

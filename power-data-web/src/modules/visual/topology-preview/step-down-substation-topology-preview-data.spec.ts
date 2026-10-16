import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import { getStepDownSubstationTopologyResourceManifest } from './step-down-substation-topology-manifest'
import {
  clearStepDownSubstationTopologyPreviewDataCacheForTests,
  loadStepDownSubstationTopologyPreviewData,
} from './step-down-substation-topology-preview-data'
import {
  STEP_DOWN_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK,
  STEP_DOWN_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK,
} from './step-down-substation-topology-selection'
import { STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANTS } from './step-down-substation-topology-variant-manifest'
import { getSubstationTopologySelectablePenIds } from './substation-topology-node-selection'

const topologyRoot = resolve(process.cwd(), 'public/topology/step-down-substation-json-preview')
const originalFetch = globalThis.fetch

/** 测试只读取已导入本地文件，不依赖开发服务器或源压缩包路径。 */
function installTopologyFetch(): void {
  globalThis.fetch = vi.fn(async (input) => {
    const variant = STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANTS.find((entry) => String(input).endsWith(entry.topologyPath))
    if (!variant) return new Response('', { status: 404 })
    return new Response(readFileSync(resolve(topologyRoot, variant.topologyPath), 'utf8'), { status: 200 })
  }) as typeof fetch
}

afterEach(() => {
  clearStepDownSubstationTopologyPreviewDataCacheForTests()
  globalThis.fetch = originalFetch
})

describe('降压站拓扑独立数据与公共资源', () => {
  it('八份文件分别保留源布局并禁用模拟、联网和初始化脚本', async () => {
    installTopologyFetch()
    for (const variant of STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANTS) {
      const source = JSON.parse(readFileSync(resolve(topologyRoot, variant.topologyPath), 'utf8')) as Meta2dData
      const data = await loadStepDownSubstationTopologyPreviewData(variant.id)
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
    for (const variant of STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANTS) {
      const data = await loadStepDownSubstationTopologyPreviewData(variant.id)
      const manifest = getStepDownSubstationTopologyResourceManifest(variant.id)
      for (const pen of data.pens.filter((item) => item.image)) {
        expect(pen.image).toContain('/topology/shared/')
      }
      for (const [penId, path] of manifest.staticImagePathByPenId) {
        expect(existsSync(resolve(process.cwd(), 'public/topology/shared', path))).toBe(true)
        expect(data.pens.find((pen) => pen.id === penId)?.locked).toBe(STEP_DOWN_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK)
      }
      for (const penId of manifest.processNodePenIds) {
        expect(data.pens.find((pen) => pen.id === penId)?.locked).toBe(STEP_DOWN_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK)
      }
      expect(data.pens.filter((pen) => pen.name === 'line')
        .every((pen) => pen.locked === STEP_DOWN_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK)).toBe(true)
      for (const penId of manifest.titleBackgroundPenIds) {
        expect(data.pens.find((pen) => pen.id === penId)?.locked).toBe(STEP_DOWN_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK)
      }
    }
  })

  it('三层完整图移除顶层组合或保留平铺源图坐标', async () => {
    installTopologyFetch()
    const variantId = 'network-business-key-process'
    const variant = STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANTS.find((entry) => entry.id === variantId)!
    const source = JSON.parse(readFileSync(resolve(topologyRoot, variant.topologyPath), 'utf8')) as Meta2dData
    const data = await loadStepDownSubstationTopologyPreviewData(variantId)
    const loadedById = new Map(data.pens.map((pen) => [pen.id, pen]))
    const sourceRoot = source.pens.find((pen) => pen.name === 'combine' && !pen.parentId)

    if (sourceRoot) {
      expect(loadedById.has(sourceRoot.id!)).toBe(false)
      for (const sourcePen of source.pens.filter((pen) => pen.parentId === sourceRoot.id && pen.name !== 'combine')) {
        const loadedPen = loadedById.get(sourcePen.id!)!
        // 旧版组合源图展平后，直接子图元的视觉位置必须与组合坐标换算结果一致。
        expect(loadedPen.parentId).toBeUndefined()
        expect(loadedPen.x).toBeCloseTo(sourceRoot.x! + sourcePen.x! * sourceRoot.width!)
        expect(loadedPen.y).toBeCloseTo(sourceRoot.y! + sourcePen.y! * sourceRoot.height!)
        expect(loadedPen.width).toBeCloseTo(sourcePen.width! * sourceRoot.width!)
        expect(loadedPen.height).toBeCloseTo(sourcePen.height! * sourceRoot.height!)
      }
    } else {
      // 最新三层参考图已是平铺世界坐标，资源本地化和选择策略不得改动图元位置或顺序。
      expect(data.pens.map((pen) => pen.id)).toEqual(source.pens.map((pen) => pen.id))
      for (const sourcePen of source.pens) {
        const loadedPen = loadedById.get(sourcePen.id!)!
        expect(loadedPen.parentId).toBeUndefined()
        expect(loadedPen.x).toBe(sourcePen.x)
        expect(loadedPen.y).toBe(sourcePen.y)
        expect(loadedPen.width).toBe(sourcePen.width)
        expect(loadedPen.height).toBe(sourcePen.height)
      }
    }

    const manifest = getStepDownSubstationTopologyResourceManifest(variantId)
    const selectableIds = getSubstationTopologySelectablePenIds(data.pens, manifest)
    const backgroundPens = data.pens.filter((pen) => !selectableIds.has(pen.id!))
    expect(backgroundPens.every((pen) => pen.locked === STEP_DOWN_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK)).toBe(true)
  })

  it('缓存返回深拷贝，重新切回不继承临时几何和图片修改', async () => {
    installTopologyFetch()
    const first = await loadStepDownSubstationTopologyPreviewData('architecture')
    const sourceX = first.pens[0]!.x
    first.pens[0]!.x = 987654
    first.pens.find((pen) => pen.id === 'cbf50ce')!.image = '污染地址'

    const second = await loadStepDownSubstationTopologyPreviewData('architecture')
    expect(second.pens[0]!.x).toBe(sourceX)
    expect(second.pens.find((pen) => pen.id === 'cbf50ce')?.image).not.toBe('污染地址')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})

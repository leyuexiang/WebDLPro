import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import { getStepUpSubstationTopologyResourceManifest } from './step-up-substation-topology-manifest'
import {
  clearStepUpSubstationTopologyPreviewDataCacheForTests,
  loadStepUpSubstationTopologyPreviewData,
} from './step-up-substation-topology-preview-data'
import {
  STEP_UP_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK,
  STEP_UP_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK,
} from './step-up-substation-topology-selection'
import { STEP_UP_SUBSTATION_TOPOLOGY_VARIANTS } from './step-up-substation-topology-variant-manifest'

const topologyRoot = resolve(process.cwd(), 'public/topology/step-up-substation-json-preview')
const originalFetch = globalThis.fetch

/** 测试只读取已导入本地文件，不依赖开发服务器或源压缩包路径。 */
function installTopologyFetch(): void {
  globalThis.fetch = vi.fn(async (input) => {
    const variant = STEP_UP_SUBSTATION_TOPOLOGY_VARIANTS.find((entry) => String(input).endsWith(entry.topologyPath))
    if (!variant) return new Response('', { status: 404 })
    return new Response(readFileSync(resolve(topologyRoot, variant.topologyPath), 'utf8'), { status: 200 })
  }) as typeof fetch
}

afterEach(() => {
  clearStepUpSubstationTopologyPreviewDataCacheForTests()
  globalThis.fetch = originalFetch
})

describe('升压站拓扑独立数据与公共资源', () => {
  it('八份文件分别保留源布局并禁用模拟、联网和初始化脚本', async () => {
    installTopologyFetch()
    for (const variant of STEP_UP_SUBSTATION_TOPOLOGY_VARIANTS) {
      const source = JSON.parse(readFileSync(resolve(topologyRoot, variant.topologyPath), 'utf8')) as Meta2dData
      const data = await loadStepUpSubstationTopologyPreviewData(variant.id)
      // 升压站只有局部标题/背景组合，不存在需要展平的全图选择组合，运行时应完整保留源图元。
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

  it('全部图片均映射到公共目录，设备可只读选择且背景与连线不可命中', async () => {
    installTopologyFetch()
    for (const variant of STEP_UP_SUBSTATION_TOPOLOGY_VARIANTS) {
      const data = await loadStepUpSubstationTopologyPreviewData(variant.id)
      const manifest = getStepUpSubstationTopologyResourceManifest(variant.id)
      for (const pen of data.pens.filter((item) => item.image)) {
        expect(pen.image).toContain('/topology/shared/')
      }
      for (const [penId, path] of manifest.staticImagePathByPenId) {
        expect(existsSync(resolve(process.cwd(), 'public/topology/shared', path))).toBe(true)
        expect(data.pens.find((pen) => pen.id === penId)?.locked).toBe(STEP_UP_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK)
      }
      for (const penId of manifest.processNodePenIds) {
        expect(data.pens.find((pen) => pen.id === penId)?.locked).toBe(STEP_UP_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK)
      }
      expect(data.pens.filter((pen) => pen.name === 'line')
        .every((pen) => pen.locked === STEP_UP_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK)).toBe(true)
      for (const penId of manifest.titleBackgroundPenIds) {
        expect(data.pens.find((pen) => pen.id === penId)?.locked).toBe(STEP_UP_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK)
      }
    }
  })

  it('所有变体的设备与工艺节点均可独立选择，父组合只包含不可命中的局部背景', async () => {
    installTopologyFetch()
    for (const variant of STEP_UP_SUBSTATION_TOPOLOGY_VARIANTS) {
      const data = await loadStepUpSubstationTopologyPreviewData(variant.id)
      const manifest = getStepUpSubstationTopologyResourceManifest(variant.id)
      const selectableIds = new Set([...manifest.devicePenIds, ...manifest.processNodePenIds])
      const pensById = new Map(data.pens.map((pen) => [pen.id, pen]))

      for (const penId of selectableIds) {
        const pen = pensById.get(penId)
        expect(pen, `${variant.id}/${penId} 必须存在`).toBeDefined()
        // 可选图元不得挂在任何组合下，否则 Meta2D 会把点击上溯为组合选择。
        expect(pen?.parentId, `${variant.id}/${penId} 不得存在选择父组合`).toBeFalsy()
        expect(pen?.locked).toBe(STEP_UP_SUBSTATION_TOPOLOGY_SELECTABLE_LOCK)
      }

      const parentedPens = data.pens.filter((pen) => pen.parentId)
      expect(parentedPens.every((pen) => pen.locked === STEP_UP_SUBSTATION_TOPOLOGY_BACKGROUND_LOCK)).toBe(true)
      for (const parent of data.pens.filter((pen) => pen.name === 'combine')) {
        // 即使源文件 children 留有历史编号，组合也不得直接声明任何可选图元为子项。
        const childIds = new Set(parent.children ?? [])
        expect([...selectableIds].some((penId) => childIds.has(penId))).toBe(false)
      }
    }
  })

  it('缓存返回深拷贝，重新切回不继承临时几何和图片修改', async () => {
    installTopologyFetch()
    const first = await loadStepUpSubstationTopologyPreviewData('architecture')
    const sourceX = first.pens[0]!.x
    first.pens[0]!.x = 987654
    first.pens.find((pen) => pen.id === '773f9223')!.image = '污染地址'

    const second = await loadStepUpSubstationTopologyPreviewData('architecture')
    expect(second.pens[0]!.x).toBe(sourceX)
    expect(second.pens.find((pen) => pen.id === '773f9223')?.image).not.toBe('污染地址')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})

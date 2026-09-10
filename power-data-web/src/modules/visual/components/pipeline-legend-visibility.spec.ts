import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  OVERVIEW_SCENE_ID,
  SCENE_IDS,
  toProcessDetailId,
  toTopologyId,
} from '@/config/scene-topology/identifiers'
import type { VisualizationStableContext } from '@/modules/visual/orchestration/visualization.store'
import { shouldShowPipelineLegend } from './pipeline-legend-visibility'

/** 构造每个业务场景的稳定第二层上下文，避免测试只覆盖当前燃气、燃煤两个样例。 */
function createBusinessContext(sceneId: (typeof SCENE_IDS)[number]): VisualizationStableContext {
  return {
    sceneId,
    topologyId: toTopologyId(`topology.${sceneId}.overview`),
    actionId: null,
    contextRevision: 1,
  }
}

describe('第二层管线图例显示规则', () => {
  it.each(SCENE_IDS)('%s 第二层稳定场景显示图例', (sceneId) => {
    expect(shouldShowPipelineLegend('ready', createBusinessContext(sceneId))).toBe(true)
  })

  it('第一层沙盘和第三层关键环节不显示图例', () => {
    const overviewContext: VisualizationStableContext = {
      sceneId: OVERVIEW_SCENE_ID,
      actionId: null,
      contextRevision: 1,
    }
    const processDetailContext: VisualizationStableContext = {
      sceneId: SCENE_IDS[0]!,
      processDetailId: toProcessDetailId('process-detail.test'),
      actionId: null,
      contextRevision: 1,
    }

    expect(shouldShowPipelineLegend('ready', overviewContext)).toBe(false)
    expect(shouldShowPipelineLegend('ready', processDetailContext)).toBe(false)
  })

  it.each(['idle', 'preparing', 'switching', 'error', 'released'] as const)('%s 阶段不透出旧图例', (status) => {
    expect(shouldShowPipelineLegend(status, createBusinessContext(SCENE_IDS[0]!))).toBe(false)
  })

  it('发布资源保持用户提供的横向透明图片尺寸', () => {
    const image = readFileSync(resolve(process.cwd(), 'src/assets/pipeline-legend-horizontal.png'))
    // PNG（便携式网络图形）宽高固定写在 IHDR（图像头数据块）的第 16 与 20 字节，直接读取可避免引入图片解析依赖。
    expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(image.readUInt32BE(16)).toBe(500)
    expect(image.readUInt32BE(20)).toBe(60)
  })
})

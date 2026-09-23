import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createConfiguredPowerScenesManifest } from '../scripts/build-gas-power-smoke-release.mjs'
import {
  getProcessDetailTopologyDataContext,
  PROCESS_DETAIL_TOPOLOGY_DATA_CONTEXTS,
} from '../src/modules/visual/topology/process-detail-topology-contexts'

const SUBSTATION_SCENE_IDS = [
  'step-up-substation',
  'step-down-substation',
  'converter-station',
  'switching-station',
] as const

/**
 * 变电第三层发布门禁：同时核对发布清单、源 JSON、图元绑定和三维节点绑定。
 * 这里故意不按标题、数组位置或文件名推断映射，避免拓扑图改版后悄悄丢失联动。
 */
describe('变电第三层拓扑双向联动发布门禁', () => {
  it('四类站点必须发布完整的 11 个第三层上下文', async () => {
    const manifest = await createConfiguredPowerScenesManifest('substation-topology-linkage-release-gate')
    const processDetails = manifest.processDetails.filter((detail) => SUBSTATION_SCENE_IDS.includes(detail.sceneId as typeof SUBSTATION_SCENE_IDS[number]))

    expect(processDetails).toHaveLength(11)
    expect(new Set(processDetails.map((detail) => detail.topologyDataContextId)).size).toBe(11)
    for (const detail of processDetails) {
      expect(getProcessDetailTopologyDataContext(detail.topologyDataContextId)).toBeDefined()
    }

    // 发布动作必须覆盖每一个第三层关键环节，不能只登记上下文而漏掉公开入口。
    for (const detail of processDetails) {
      expect(manifest.actions).toContainEqual(expect.objectContaining({
        targetSceneId: detail.sceneId,
        targetViewMode: 'process-detail',
        processDetailId: detail.processDetailId,
        unityAction: expect.objectContaining({
          type: 'enterProcessDetail',
          processDetailId: detail.processDetailId,
        }),
      }))
    }
  })

  it('每个第三层上下文的源 JSON、图元编号和显式三维映射必须一致', () => {
    const contextKeys = new Set<string>()
    for (const context of PROCESS_DETAIL_TOPOLOGY_DATA_CONTEXTS.filter((item) => item.contextId.includes('substation') || item.contextId.includes('station'))) {
      contextKeys.add(context.contextId)
      const sourcePath = resolve(process.cwd(), 'public/topology', context.topologyPath)
      const source = readFileSync(sourcePath)
      const topology = JSON.parse(source.toString('utf8')) as { pens?: Array<{ id?: string }> }
      const penIds = new Set((topology.pens ?? []).map((pen) => pen.id).filter((id): id is string => Boolean(id)))

      expect(createHash('sha256').update(source).digest('hex')).toBe(context.sourceSha256)
      expect(topology.pens).toHaveLength(context.expectedPenCount)
      expect(context.bindings.length).toBeGreaterThan(0)
      expect(new Set(context.bindings.map((binding) => binding.penId)).size).toBe(context.bindings.length)
      for (const binding of context.bindings) {
        expect(penIds.has(binding.penId)).toBe(true)
        expect(binding.nodeId).toBeTruthy()
        expect(binding.sceneNodeId).toBeTruthy()
      }
    }

    expect(contextKeys).toHaveLength(11)
  })

  it('公共拓扑画布和四个站点包装器必须保留双向选中接口', () => {
    const sourceFiles = [
      'src/modules/visual/topology-preview/ManifestTopologyJsonPreview.vue',
      'src/modules/visual/topology-preview/StepUpSubstationTopologyJsonPreview.vue',
      'src/modules/visual/topology-preview/StepDownSubstationTopologyJsonPreview.vue',
      'src/modules/visual/topology-preview/ConverterStationTopologyJsonPreview.vue',
      'src/modules/visual/topology-preview/SwitchingStationTopologyJsonPreview.vue',
      'src/modules/visual/components/TopologyPanel.vue',
    ]
    for (const relativePath of sourceFiles) {
      const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8')
      expect(source).toContain('selectedNodeIds')
      expect(source).toContain('selectNode')
      expect(source).toContain('clearSelection')
    }

    const canvasSource = readFileSync(resolve(process.cwd(), sourceFiles[0]), 'utf8')
    // 拓扑点击和三维反向选择必须共用同一套显式映射及视觉更新入口。
    expect(canvasSource).toContain('nodeIdByPenId')
    expect(canvasSource).toContain('applyRuntimeSelection')
    expect(canvasSource).toContain('applySelectionVisual')
    expect(canvasSource).toContain('sceneNodeId')
  })
})

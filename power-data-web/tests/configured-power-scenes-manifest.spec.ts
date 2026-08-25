import { describe, expect, it } from 'vitest'
import { toSceneId, toSceneNodeId } from '../src/config/scene-topology/identifiers'
import { TopologyRegistry } from '../src/config/scene-topology/topology-registry'
import { validateSceneTopologyManifest } from '../src/config/scene-topology/validator'
import { createConfiguredPowerScenesManifest } from '../scripts/build-gas-power-smoke-release.mjs'
import { coalPowerEdgeColors } from '../scripts/coal-power-topology.mjs'

/** 两个场景只允许使用资料和 Unity 属性面板已经核验的六对映射，测试不得按名称自动扩充。 */
const verifiedMappings = Object.freeze([
  Object.freeze({ sceneId: 'gas-power', nodeId: 'inlet-duct', sceneNodeId: 'gas-turbine' }),
  Object.freeze({ sceneId: 'gas-power', nodeId: 'hrsg', sceneNodeId: 'hrsg' }),
  Object.freeze({ sceneId: 'gas-power', nodeId: 'steam-turbine', sceneNodeId: 'steam-turbine' }),
  Object.freeze({ sceneId: 'coal-power', nodeId: 'system.boiler-dcs', sceneNodeId: 'node.coal-boiler' }),
  Object.freeze({ sceneId: 'coal-power', nodeId: 'system.steam-turbine-dcs', sceneNodeId: 'node.coal-steam-turbine' }),
  Object.freeze({ sceneId: 'coal-power', nodeId: 'system.generator-excitation-controller', sceneNodeId: 'node.coal-generator' }),
])

describe('燃气与燃煤联合场景清单', () => {
  it('在同一原子清单中装配两场景真实拓扑、动作和三维映射', async () => {
    const manifest = await createConfiguredPowerScenesManifest('dual-selection-contract', 'coal-power')

    expect(validateSceneTopologyManifest(manifest)).toEqual([])
    expect(manifest.unityRuntimeKey).toBe('coal-plant-release')
    expect(manifest.topologies.filter((topology) => topology.sceneId === 'gas-power')).toHaveLength(4)
    expect(manifest.topologies.filter((topology) => topology.sceneId === 'coal-power')).toHaveLength(4)
    expect(manifest.actions.filter((action) => action.targetSceneId === 'gas-power')).toHaveLength(4)
    expect(manifest.actions.filter((action) => action.targetSceneId === 'coal-power')).toHaveLength(4)

    const gasOverview = manifest.topologies.find((topology) => topology.topologyId === 'topology.gas-power.overview')
    const coalOverview = manifest.topologies.find((topology) => topology.topologyId === 'topology.coal-power.overview')
    expect([gasOverview?.nodes.length, gasOverview?.edges.length]).toEqual([23, 22])
    expect([coalOverview?.nodes.length, coalOverview?.edges.length]).toEqual([27, 27])
  })

  it('燃气总览逐条复用燃煤的灰蓝绿橙连线分类和虚线规则', async () => {
    const manifest = await createConfiguredPowerScenesManifest('gas-edge-style-contract')
    const gasOverview = manifest.topologies.find((topology) => topology.topologyId === 'topology.gas-power.overview')
    const edgesById = new Map(gasOverview?.edges.map((edge) => [edge.edgeId, edge]))
    const expectedColors = [
      ...Array.from({ length: 2 }, () => coalPowerEdgeColors.gray),
      ...Array.from({ length: 7 }, () => coalPowerEdgeColors.blue),
      ...Array.from({ length: 6 }, () => coalPowerEdgeColors.green),
      ...Array.from({ length: 7 }, () => coalPowerEdgeColors.orange),
    ]
    const expectedStyles = [
      ...Array.from({ length: 14 }, () => 'solid'),
      'dashed',
      ...Array.from({ length: 7 }, () => 'solid'),
    ]

    expect(gasOverview?.edges).toHaveLength(22)
    expect(gasOverview?.edges.map((edge) => edge.lineColor)).toEqual(expectedColors)
    expect(gasOverview?.edges.map((edge) => edge.lineStyle)).toEqual(expectedStyles)
    expect(edgesById.get('route.dcs-core-to-sil')).toEqual(expect.objectContaining({
      lineColor: coalPowerEdgeColors.green,
      lineStyle: 'dashed',
    }))
  })

  it('六对显式映射均可常数时间反查且不会产生额外猜测映射', async () => {
    const manifest = await createConfiguredPowerScenesManifest('dual-selection-reverse-index')
    const result = TopologyRegistry.create(manifest)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    for (const mapping of verifiedMappings) {
      expect(result.registry.getNodeIdForSceneNode(
        toSceneId(mapping.sceneId),
        toSceneNodeId(mapping.sceneNodeId),
      )).toBe(mapping.nodeId)
    }

    const publishedMappedNodes = manifest.topologies
      .filter((topology) => topology.filter === undefined && (topology.sceneId === 'gas-power' || topology.sceneId === 'coal-power'))
      .flatMap((topology) => topology.nodes.filter((node) => node.sceneNodeId !== undefined))
    expect(publishedMappedNodes).toHaveLength(verifiedMappings.length)
  })

  it('初始场景只改变运行时入口别名而不裁剪另一场景内容', async () => {
    const [gasInitial, coalInitial] = await Promise.all([
      createConfiguredPowerScenesManifest('dual-selection-initial-gas', 'gas-power'),
      createConfiguredPowerScenesManifest('dual-selection-initial-coal', 'coal-power'),
    ])

    expect(gasInitial.unityRuntimeKey).toBe('gas-plant-release')
    expect(coalInitial.unityRuntimeKey).toBe('coal-plant-release')
    for (const manifest of [gasInitial, coalInitial]) {
      expect(manifest.scenes.find((scene) => scene.sceneId === 'gas-power')?.topologyIds).toHaveLength(4)
      expect(manifest.scenes.find((scene) => scene.sceneId === 'coal-power')?.topologyIds).toHaveLength(4)
    }
  })
})

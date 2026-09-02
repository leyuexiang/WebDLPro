import { describe, expect, it } from 'vitest'
import {
  createCoalPowerManifest,
  createConfiguredPowerScenesManifest,
  createGasOnlyManifest,
} from '../scripts/build-gas-power-smoke-release.mjs'
import { TopologyRegistry } from '../src/config/scene-topology/topology-registry'
import { validateSceneTopologyManifest } from '../src/config/scene-topology/validator'

/**
 * 本文件保留原测试文件名，避免外部测试脚本失效；但契约已由“下钻可用”调整为“下钻彻底不发布”。
 * 不能仅靠页面不显示入口，因为清单中的历史下钻内容仍可能被注册表或外部消息直接访问。
 */
describe('燃气与燃煤拓扑无下钻发布契约', () => {
  it('两个专项清单只发布总览，且不携带下钻内容或节点下钻引用', async () => {
    const [gasManifest, coalManifest] = await Promise.all([
      createGasOnlyManifest('no-drilldown-gas-contract'),
      createCoalPowerManifest('no-drilldown-coal-contract'),
    ])

    for (const [manifest, overviewTopologyId, expectedActionIds] of [
      [gasManifest, 'topology.gas-power.overview', ['action.gas-power.overview', 'action.gas-power.gas-turbine']],
      [coalManifest, 'topology.coal-power.overview', ['action.coal-power.overview']],
    ] as const) {
      /** 空数组明确表达能力已下线，并让注册表与外部消费者保持一致。 */
      expect(manifest.drilldowns).toEqual([])
      const sceneId = overviewTopologyId.startsWith('topology.gas-power') ? 'gas-power' : 'coal-power'
      const targetTopologies = manifest.topologies.filter((topology) => topology.sceneId === sceneId)
      expect(targetTopologies).toHaveLength(1)
      expect(targetTopologies[0]?.topologyId).toBe(overviewTopologyId)
      expect(targetTopologies[0]?.filter).toBeUndefined()
      expect(targetTopologies[0]?.nodes.every((node) => node.drilldown === undefined)).toBe(true)
      expect(manifest.actions.map((action) => action.actionId)).toEqual(expectedActionIds)
      expect(validateSceneTopologyManifest(manifest)).toEqual([])
    }
  })

  it('联合清单不再注册历史下钻键，也不发布流程子图及相关动作', async () => {
    const manifest = await createConfiguredPowerScenesManifest('no-drilldown-registry-contract')
    const result = TopologyRegistry.create(manifest)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    expect(manifest.drilldowns).toEqual([])
    expect(manifest.topologies
      .filter((topology) => topology.sceneId === 'gas-power' || topology.sceneId === 'coal-power')
      .map((topology) => topology.topologyId)).toEqual([
      'topology.gas-power.overview',
      'topology.coal-power.overview',
    ])
    expect(manifest.topologies.every((topology) => topology.filter === undefined)).toBe(true)
    expect(manifest.actions.map((action) => action.actionId)).toEqual([
      'action.gas-power.overview',
      'action.gas-power.gas-turbine',
      'action.coal-power.overview',
    ])

    // 历史键只能返回缺失，不能为了兼容旧页面保留隐藏说明内容。
    expect(result.registry.getDrilldownContent('gas.mark-vie', manifest.manifestVersion).status).toBe('missing')
    expect(result.registry.getDrilldownContent('coal.boiler-dcs', manifest.manifestVersion).status).toBe('missing')

    /**
     * 逐个检查正式拓扑、动作和 Unity 流程步骤集合，避免用字符串搜索误把合法的 sceneNodeId
     * 或业务连线标识当成历史流程入口。
     */
    expect(manifest.scenes
      .filter((scene) => scene.sceneId === 'gas-power' || scene.sceneId === 'coal-power')
      .flatMap((scene) => scene.topologyIds))
      .not.toContainEqual(expect.stringMatching(/gas-turbine|hrsg|steam-turbine|combustion|water-steam-cycle|power-output/))
    expect(manifest.actions.filter((action) => action.targetViewMode === 'business').map((action) => action.targetTopologyId))
      .not.toContainEqual(expect.stringMatching(/gas-turbine|hrsg|steam-turbine|combustion|water-steam-cycle|power-output/))
    expect(manifest.unitySceneMappings.flatMap((mapping) => mapping.processSteps.map((step) => step.stepId)))
      .not.toContainEqual(expect.stringMatching(/gas-turbine|hrsg|steam-turbine|combustion|water-steam-cycle|power-output/))
  })
})

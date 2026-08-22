import { describe, expect, it } from 'vitest'
import {
  createCoalPowerManifest,
  createConfiguredPowerScenesManifest,
  createGasOnlyManifest,
} from '../scripts/build-gas-power-smoke-release.mjs'
import { toNodeId, toTopologyId } from '../src/config/scene-topology/identifiers'
import { TopologyRegistry } from '../src/config/scene-topology/topology-registry'
import { validateSceneTopologyManifest } from '../src/config/scene-topology/validator'

const expectedGasContents = {
  'gas.mark-vie': ['inlet-duct', 2],
  'gas.hrsg-dcs': ['hrsg', 1],
  'gas.steam-turbine': ['steam-turbine', 1],
  'gas.generator-excitation': ['generator', 1],
  'gas.auxiliary-plc': ['auxiliary-plc', 1],
  'gas.safety-sil': ['grid-output', 1],
} as const

const expectedCoalContents = {
  'coal.boiler-dcs': ['system.boiler-dcs', 3],
  'coal.steam-turbine-dcs': ['system.steam-turbine-dcs', 1],
  'coal.generator-excitation': ['system.generator-excitation-controller', 1],
  'coal.desulfurization-plc': ['system.desulfurization-plc', 1],
  'coal.denitrification-plc': ['system.denitrification-plc', 1],
  'coal.coal-ash-plc': ['system.coal-handling-ash-plc', 1],
  'coal.sis': ['system.sis-safety-controller', 1],
} as const

/** 下钻契约直接核对发布器产出的正式清单，避免测试夹具和燃气/燃煤业务源分叉。 */
describe('燃气与燃煤拓扑下钻发布契约', () => {
  it('登记十三个入口和十六条真实分支，单分支只声明三个语义节点', async () => {
    const [gasManifest, coalManifest] = await Promise.all([
      createGasOnlyManifest('drilldown-gas-contract'),
      createCoalPowerManifest('drilldown-coal-contract'),
    ])

    for (const [manifest, sceneId, expected] of [
      [gasManifest, 'gas-power', expectedGasContents],
      [coalManifest, 'coal-power', expectedCoalContents],
    ] as const) {
      const contents = manifest.drilldowns ?? []
      expect(contents.map((content) => content.contentKey)).toEqual(Object.keys(expected))
      const overview = manifest.topologies.find((topology) => topology.sceneId === sceneId && topology.topologyId.endsWith('.overview'))
      const referenceByNodeId = new Map(overview?.nodes.flatMap((node) => node.drilldown
        ? [[node.nodeId, node.drilldown.contentKey] as const]
        : []))

      for (const [contentKey, [sourceNodeId, branchCount]] of Object.entries(expected)) {
        const content = contents.find((candidate) => candidate.contentKey === contentKey)
        expect(content?.sourceNodeId).toBe(sourceNodeId)
        expect(content?.nodes.filter((node) => node.kind === 'logic')).toHaveLength(branchCount)
        expect(content?.nodes.filter((node) => node.kind === 'boundary')).toHaveLength(branchCount)
        expect(content?.edges).toHaveLength(branchCount * 2)
        expect(referenceByNodeId.get(sourceNodeId)).toBe(contentKey)
        if (branchCount === 1) {
          expect(content?.nodes).toHaveLength(3)
          expect(content?.duplicateSingleBranch).toBe(true)
        } else {
          expect(content?.duplicateSingleBranch).toBeUndefined()
        }
      }

      expect(validateSceneTopologyManifest(manifest)).toEqual([])
    }

    // 资料明确没有为电除尘器建立现场节点关系，正式内容不得靠名称或下钻节点清单补造它。
    expect(JSON.stringify([...(gasManifest.drilldowns ?? []), ...(coalManifest.drilldowns ?? [])])).not.toContain('电除尘器')
  })

  it('关键环节投影复用总览的同一内容键，说明节点不进入正式拓扑和三维映射', async () => {
    const manifest = await createConfiguredPowerScenesManifest('drilldown-registry-contract')
    const result = TopologyRegistry.create(manifest)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    const gasOverview = result.registry.getTopology(toTopologyId('topology.gas-power.overview'))
    const gasFlow = result.registry.getTopology(toTopologyId('topology.gas-power.gas-turbine'))
    const coalOverview = result.registry.getTopology(toTopologyId('topology.coal-power.overview'))
    const coalFlow = result.registry.getTopology(toTopologyId('topology.coal-power.combustion'))
    expect(gasFlow?.nodes.find((node) => node.nodeId === 'inlet-duct')?.drilldown)
      .toEqual(gasOverview?.nodes.find((node) => node.nodeId === 'inlet-duct')?.drilldown)
    expect(coalFlow?.nodes.find((node) => node.nodeId === 'system.boiler-dcs')?.drilldown)
      .toEqual(coalOverview?.nodes.find((node) => node.nodeId === 'system.boiler-dcs')?.drilldown)

    const lookup = result.registry.getDrilldownContent('gas.mark-vie', manifest.manifestVersion)
    expect(lookup.status).toBe('ready')
    expect(result.registry.getDrilldownContent('gas.mark-vie', 'outdated-version').status).toBe('version-mismatch')
    expect(result.registry.getDrilldownContent('gas.unknown', manifest.manifestVersion).status).toBe('missing')
    // 固定九场景总览加上燃气、燃煤各三个关键环节，共十五张正式可切换拓扑；说明内容不增加该数量。
    expect(manifest.topologies).toHaveLength(15)
    expect(manifest.actions).toHaveLength(8)

    const formalNodeIds = new Set(manifest.topologies.flatMap((topology) => topology.nodes.map((node) => String(node.nodeId))))
    const sceneNodeIds = new Set(manifest.unitySceneMappings.flatMap((mapping) => mapping.sceneNodeIds.map(String)))
    for (const content of manifest.drilldowns ?? []) {
      for (const node of content.nodes) {
        expect(formalNodeIds.has(node.id)).toBe(false)
        expect(sceneNodeIds.has(node.id)).toBe(false)
        expect(node).not.toHaveProperty('deviceStatus')
        expect(node).not.toHaveProperty('sceneNodeId')
      }
      expect(result.registry.getNodeStateProjection(toNodeId(content.nodes[0]!.id))).toBeUndefined()
    }
  })

  it('拒绝旧版本、断裂连线、多个来源节点和说明节点业务字段泄漏', async () => {
    const manifest = await createGasOnlyManifest('drilldown-invalid-contract')

    const oldVersion = structuredClone(manifest)
    oldVersion.drilldowns[0].version = 'old-version'
    expect(validateSceneTopologyManifest(oldVersion).map((issue) => issue.code)).toContain('drilldown.version')

    const brokenEdge = structuredClone(manifest)
    brokenEdge.drilldowns[0].edges[0].toId = 'logic.missing'
    expect(validateSceneTopologyManifest(brokenEdge).map((issue) => issue.code)).toContain('drilldown.edge-node-reference')

    const multipleSources = structuredClone(manifest)
    multipleSources.drilldowns[0].nodes[1].kind = 'source'
    expect(validateSceneTopologyManifest(multipleSources).map((issue) => issue.code)).toContain('drilldown.source-count')

    const leakedBusinessField = structuredClone(manifest)
    ;(leakedBusinessField.drilldowns[0].nodes[1] as Record<string, unknown>).deviceStatus = 'normal'
    expect(validateSceneTopologyManifest(leakedBusinessField).map((issue) => issue.code)).toContain('drilldown.node-business-field')

    const missingContent = structuredClone(manifest)
    missingContent.drilldowns.splice(0, 1)
    expect(validateSceneTopologyManifest(missingContent).map((issue) => issue.code)).toContain('drilldown.content-missing')
  })
})

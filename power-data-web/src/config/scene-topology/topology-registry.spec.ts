import { describe, expect, it } from 'vitest'
import { SCENE_IDS, toSceneId, toTopologyId } from '@/config/scene-topology/identifiers'
import { TopologyRegistry } from '@/config/scene-topology/topology-registry'

/** 生成九场景最小有效清单；拓扑关系均为测试数据，不代表任何生产设备或 Unity 映射。 */
function createManifest(): unknown {
  const version = 'test-version-01'
  const scenes = SCENE_IDS.map((sceneId) => ({
    sceneId,
    title: `${sceneId}测试场景`,
    unitySceneKey: `unity-${sceneId}`,
    defaultTopologyId: `${sceneId}.overview`,
    topologyIds: [`${sceneId}.overview`],
    supportedActionIds: [],
    sceneMappingVersion: version,
    resourceVersion: version,
    switchStrategy: 'unload-first',
  }))
  const gasScene = scenes.find((scene) => scene.sceneId === 'gas-power')
  gasScene?.topologyIds.push('gas-power.detail')

  return {
    manifestVersion: version,
    unityBuildId: 'test-unity-build',
    unityRuntimeKey: 'test-unity-runtime',
    scenes,
    topologies: [
      ...SCENE_IDS.map((sceneId) => ({
        topologyId: `${sceneId}.overview`,
        sceneId,
        title: `${sceneId}总览拓扑`,
        configVersion: version,
        nodes: [],
        edges: [],
      })),
      {
        topologyId: 'gas-power.detail',
        sceneId: 'gas-power',
        title: '燃气测试明细拓扑',
        configVersion: version,
        nodes: [],
        edges: [],
      },
    ],
    actions: [],
    deviceMappings: [],
    unitySceneMappings: SCENE_IDS.map((sceneId) => ({
      sceneId,
      mappingVersion: version,
      processSteps: [],
      sceneNodeIds: [],
      routeIds: [],
    })),
  }
}

describe('多拓扑注册表', () => {
  it('按场景登记默认拓扑和多套可切换拓扑', () => {
    const result = TopologyRegistry.create(createManifest())

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.registry.getDefaultTopology(toSceneId('gas-power'))?.topologyId).toBe(toTopologyId('gas-power.overview'))
    expect(result.registry.listTopologiesForScene(toSceneId('gas-power')).map((topology) => topology.topologyId)).toEqual([
      toTopologyId('gas-power.overview'),
      toTopologyId('gas-power.detail'),
    ])
  })

  it('拒绝跨场景拓扑查询，不按标题或标识前缀猜测归属', () => {
    const result = TopologyRegistry.create(createManifest())

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.registry.getTopologyForScene(toSceneId('wind-power'), toTopologyId('gas-power.detail'))).toBeUndefined()
  })

  it('清单缺失固定场景时不创建任何注册表', () => {
    const manifest = createManifest() as { scenes: unknown[] }
    manifest.scenes.pop()

    const result = TopologyRegistry.create(manifest)
    expect(result.status).toBe('invalid')
  })
})

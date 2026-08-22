import { describe, expect, it } from 'vitest'
import { SCENE_IDS, toNodeId, toSceneId, toTopologyId } from '@/config/scene-topology/identifiers'
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
    unitySceneMappings: SCENE_IDS.map((sceneId) => ({
      sceneId,
      mappingVersion: version,
      processSteps: [],
      sceneNodeIds: [],
      routeIds: [],
    })),
  }
}

/**
 * 构造一张总图及其流程过滤视图，用于证明子图只保存筛选与排布，而不复制节点、连线或三维关联事实。
 * 所有标识均为测试专用稳定键，不代表燃气正式资料。
 */
function createManifestWithFilteredTopology(): unknown {
  const manifest = createManifest() as {
    topologies: Array<Record<string, unknown>>
    unitySceneMappings: Array<{ sceneId: string; sceneNodeIds: string[] }>
  }
  const overview = manifest.topologies.find((topology) => topology.topologyId === 'gas-power.overview')
  const detail = manifest.topologies.find((topology) => topology.topologyId === 'gas-power.detail')
  if (!overview || !detail) throw new Error('测试清单必须包含燃气总图和流程图。')

  overview.nodes = [
    // 注册表测试只验证过滤投影；源节点仍遵守新的全节点设备绑定发布契约。
    { nodeId: 'dcs-core', title: '测试核心节点', sceneNodeId: 'scene-node.dcs-core', iconKey: 'core-switch', x: 20, y: 40, deviceStatus: 'offline', doubleClickBehavior: 'emit-node' },
    { nodeId: 'gas-controller', title: '测试流程控制器', iconKey: 'plc', x: 50, y: 70, deviceStatus: 'offline', doubleClickBehavior: 'emit-node' },
    { nodeId: 'gas-field', title: '测试现场设备', iconKey: 'instrument', x: 80, y: 94, deviceStatus: 'offline', doubleClickBehavior: 'emit-node' },
  ]
  overview.edges = [
    { edgeId: 'route.dcs-to-controller', fromNodeId: 'dcs-core', toNodeId: 'gas-controller', title: '测试控制链路' },
    { edgeId: 'route.controller-to-field', fromNodeId: 'gas-controller', toNodeId: 'gas-field', title: '测试现场链路' },
  ]
  overview.focusRegions = [{
    regionId: 'focus.registry-test',
    anchorNodeId: 'dcs-core',
    nodeIds: ['dcs-core'],
    label: '测试重点区域',
  }]
  const gasMapping = manifest.unitySceneMappings.find((mapping) => mapping.sceneId === 'gas-power')
  if (gasMapping) gasMapping.sceneNodeIds = ['scene-node.dcs-core']
  detail.nodes = []
  detail.edges = []
  detail.filter = {
    sourceTopologyId: 'gas-power.overview',
    visibleNodeIds: ['dcs-core', 'gas-controller', 'gas-field'],
    visibleEdgeIds: ['route.dcs-to-controller', 'route.controller-to-field'],
    nodeLayoutOverrides: [
      { nodeId: 'dcs-core', x: 50, y: 20 },
      { nodeId: 'gas-controller', x: 50, y: 60 },
      { nodeId: 'gas-field', x: 50, y: 94 },
    ],
  }
  return manifest
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

  it('一次投影总图生成流程视图，并只覆盖显式声明的二维坐标', () => {
    const result = TopologyRegistry.create(createManifestWithFilteredTopology())

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const detail = result.registry.getTopology(toTopologyId('gas-power.detail'))
    expect(detail?.nodes.map((node) => node.nodeId)).toEqual(['dcs-core', 'gas-controller', 'gas-field'])
    expect(detail?.edges.map((edge) => edge.edgeId)).toEqual(['route.dcs-to-controller', 'route.controller-to-field'])
    expect(detail?.nodes.find((node) => node.nodeId === 'gas-controller')).toMatchObject({
      title: '测试流程控制器',
      x: 50,
      y: 60,
    })
    expect(result.registry.getTopologyNode(toTopologyId('gas-power.detail'), toNodeId('gas-controller'))?.title).toBe('测试流程控制器')
    expect(result.registry.getTopology(toTopologyId('gas-power.overview'))?.focusRegions).toHaveLength(1)
    expect(result.registry.getTopology(toTopologyId('gas-power.detail'))?.focusRegions).toBeUndefined()
  })

  it('清单缺失固定场景时不创建任何注册表', () => {
    const manifest = createManifest() as { scenes: unknown[] }
    manifest.scenes.pop()

    const result = TopologyRegistry.create(manifest)
    expect(result.status).toBe('invalid')
  })
})

import { describe, expect, it } from 'vitest'
import { createCoalPowerManifest, createHostPage } from '../scripts/build-gas-power-smoke-release.mjs'
import { coalPowerEdgeColors } from '../scripts/coal-power-topology.mjs'
import { createLocalProcessConfigLoader } from '../src/config/process/local-process-config'
import { createRuntimeRegistry } from '../src/config/process/runtime-registry'
import { validateSceneTopologyManifest } from '../src/config/scene-topology/validator'

/**
 * 燃煤拓扑契约测试直接读取发布生成器的同一份来源数据，避免测试夹具与实际清单各维护一套节点。
 * 数量断言只能发现部分错误，因此这里同时锁定节点、连线和三维映射的完整稳定标识集合。
 */
describe('燃煤发电拓扑发布契约', () => {
  const overviewNodeIds = [
    'system.fuel-management', 'system.enterprise-core-switch', 'system.enterprise-firewall',
    'system.pi-historian', 'system.dmz-industrial-firewall', 'endpoint.remote-maintenance-gateway',
    'system.unit-operator-station', 'system.monitor-core-switch-primary', 'system.monitor-core-switch-standby',
    'system.auxiliary-operator-station', 'system.sis-performance-station', 'system.boiler-dcs',
    'system.steam-turbine-dcs', 'system.generator-excitation-controller', 'system.desulfurization-plc',
    'system.denitrification-plc', 'system.coal-handling-ash-plc', 'system.sis-safety-controller',
    'asset.coal-mill-actuator', 'asset.induced-draft-fan-vfd', 'asset.furnace-pressure-transmitter',
    'asset.steam-turbine-valve-actuator', 'asset.generator-protection-device',
    'asset.desulfurization-circulation-pump', 'asset.denitrification-ammonia-valve',
    'asset.coal-belt-controller', 'asset.esd-emergency-actuator',
  ] as const

  const overviewEdgeIds = [
    'route.coal.enterprise-core-to-fuel-management', 'route.coal.enterprise-core-to-firewall',
    'route.coal.enterprise-firewall-to-dmz', 'route.coal.historian-to-monitor-primary',
    'route.coal.dmz-to-monitor-primary', 'route.coal.dmz-to-monitor-standby',
    'route.coal.monitor-primary-to-remote-maintenance', 'route.coal.monitor-primary-to-operator',
    'route.coal.monitor-primary-to-sis-performance', 'route.coal.monitor-primary-to-standby',
    'route.coal.monitor-standby-to-auxiliary-operator', 'route.coal.monitor-primary-to-boiler-dcs',
    'route.coal.monitor-primary-to-steam-turbine-dcs', 'route.coal.monitor-primary-to-generator-excitation',
    'route.coal.monitor-standby-to-desulfurization', 'route.coal.monitor-standby-to-denitrification',
    'route.coal.monitor-standby-to-coal-handling', 'route.coal.monitor-standby-to-sis',
    'route.coal.boiler-dcs-to-coal-mill', 'route.coal.boiler-dcs-to-fan-vfd',
    'route.coal.boiler-dcs-to-furnace-pressure', 'route.coal.steam-turbine-dcs-to-valve',
    'route.coal.generator-excitation-to-protection', 'route.coal.desulfurization-to-pump',
    'route.coal.denitrification-to-ammonia-valve', 'route.coal.coal-handling-to-belt-controller',
    'route.coal.sis-to-esd',
  ] as const

  const expectedFlows = {
    'topology.coal-power.combustion': {
      nodes: [
        'system.unit-operator-station', 'system.monitor-core-switch-primary', 'system.monitor-core-switch-standby',
        'system.auxiliary-operator-station', 'system.sis-performance-station', 'system.boiler-dcs',
        'system.sis-safety-controller', 'asset.coal-mill-actuator', 'asset.induced-draft-fan-vfd',
        'asset.furnace-pressure-transmitter', 'asset.esd-emergency-actuator',
      ],
      edges: [
        'route.coal.monitor-primary-to-operator', 'route.coal.monitor-primary-to-sis-performance',
        'route.coal.monitor-primary-to-standby', 'route.coal.monitor-standby-to-auxiliary-operator',
        'route.coal.monitor-primary-to-boiler-dcs', 'route.coal.monitor-standby-to-sis',
        'route.coal.boiler-dcs-to-coal-mill', 'route.coal.boiler-dcs-to-fan-vfd',
        'route.coal.boiler-dcs-to-furnace-pressure', 'route.coal.sis-to-esd',
      ],
    },
    'topology.coal-power.water-steam-cycle': {
      nodes: [
        'system.unit-operator-station', 'system.monitor-core-switch-primary', 'system.monitor-core-switch-standby',
        'system.auxiliary-operator-station', 'system.sis-performance-station', 'system.steam-turbine-dcs',
        'system.sis-safety-controller', 'asset.steam-turbine-valve-actuator', 'asset.esd-emergency-actuator',
      ],
      edges: [
        'route.coal.monitor-primary-to-operator', 'route.coal.monitor-primary-to-sis-performance',
        'route.coal.monitor-primary-to-standby', 'route.coal.monitor-standby-to-auxiliary-operator',
        'route.coal.monitor-primary-to-steam-turbine-dcs', 'route.coal.monitor-standby-to-sis',
        'route.coal.steam-turbine-dcs-to-valve', 'route.coal.sis-to-esd',
      ],
    },
    'topology.coal-power.power-output': {
      nodes: [
        'system.unit-operator-station', 'system.monitor-core-switch-primary', 'system.monitor-core-switch-standby',
        'system.auxiliary-operator-station', 'system.sis-performance-station', 'system.steam-turbine-dcs',
        'system.generator-excitation-controller', 'system.sis-safety-controller', 'asset.steam-turbine-valve-actuator',
        'asset.generator-protection-device', 'asset.esd-emergency-actuator',
      ],
      edges: [
        'route.coal.monitor-primary-to-operator', 'route.coal.monitor-primary-to-sis-performance',
        'route.coal.monitor-primary-to-standby', 'route.coal.monitor-standby-to-auxiliary-operator',
        'route.coal.monitor-primary-to-steam-turbine-dcs', 'route.coal.monitor-primary-to-generator-excitation',
        'route.coal.monitor-standby-to-sis', 'route.coal.steam-turbine-dcs-to-valve',
        'route.coal.generator-excitation-to-protection', 'route.coal.sis-to-esd',
      ],
    },
  } as const

  it('发布燃煤总图的 27 个节点和 27 条已核验连线', async () => {
    const manifest = await createCoalPowerManifest('overview-contract-test')
    const overview = manifest.topologies.find((topology) => topology.topologyId === 'topology.coal-power.overview')

    expect(overview?.nodes.map((node) => node.nodeId)).toEqual(overviewNodeIds)
    expect(overview?.edges.map((edge) => edge.edgeId)).toEqual(overviewEdgeIds)
    expect(overview?.nodes).toHaveLength(27)
    expect(overview?.edges).toHaveLength(27)
    expect(overview?.nodes.every((node) => node.deviceStatus === 'offline' && node.doubleClickBehavior === 'emit-node')).toBe(true)
    expect(overview?.edges.every((edge) => edge.evidenceStatus === 'verified')).toBe(true)
    expect(new Set(overview?.nodes.map((node) => node.nodeId))).toHaveLength(27)
  })

  it('保留资料第二节的连线颜色、实虚线和协议标签', async () => {
    const manifest = await createCoalPowerManifest('edge-style-contract-test')
    const overview = manifest.topologies.find((topology) => topology.topologyId === 'topology.coal-power.overview')
    const edgesById = new Map(overview?.edges.map((edge) => [edge.edgeId, edge]))

    expect(overview?.edges.every((edge) => edge.lineStyle === 'solid' || edge.lineStyle === 'dashed')).toBe(true)
    expect(edgesById.get('route.coal.enterprise-core-to-fuel-management')).toEqual(expect.objectContaining({
      lineColor: coalPowerEdgeColors.gray,
      lineStyle: 'solid',
    }))
    expect(edgesById.get('route.coal.enterprise-firewall-to-dmz')).toEqual(expect.objectContaining({
      lineColor: coalPowerEdgeColors.blue,
      lineStyle: 'solid',
      protocolLabel: '状态检测防火墙',
    }))
    expect(edgesById.get('route.coal.monitor-primary-to-standby')).toEqual(expect.objectContaining({
      lineColor: coalPowerEdgeColors.blue,
      lineStyle: 'dashed',
      protocolLabel: '虚拟路由冗余协议（VRRP）冗余',
    }))
    expect(edgesById.get('route.coal.monitor-standby-to-sis')).toEqual(expect.objectContaining({
      lineColor: coalPowerEdgeColors.green,
      lineStyle: 'dashed',
      protocolLabel: '只读数据上传',
    }))
    expect(edgesById.get('route.coal.boiler-dcs-to-coal-mill')).toEqual(expect.objectContaining({
      lineColor: coalPowerEdgeColors.orange,
      lineStyle: 'solid',
    }))
  })

  it('三个关键流程只引用总图，并严格复用资料的节点和连线集合', async () => {
    const manifest = await createCoalPowerManifest('flow-contract-test')
    const overview = manifest.topologies.find((topology) => topology.topologyId === 'topology.coal-power.overview')
    const overviewPositions = new Map(overview?.nodes.map((node) => [node.nodeId, { x: node.x, y: node.y }]))

    for (const [topologyId, expected] of Object.entries(expectedFlows)) {
      const flow = manifest.topologies.find((topology) => topology.topologyId === topologyId)
      expect(flow?.filter?.sourceTopologyId).toBe('topology.coal-power.overview')
      expect(flow?.nodes).toEqual([])
      expect(flow?.edges).toEqual([])
      expect(flow?.filter?.visibleNodeIds).toEqual(expected.nodes)
      expect(flow?.filter?.visibleEdgeIds).toEqual(expected.edges)
      expect(flow?.filter?.allowedOrphanNodeIds).toBeUndefined()
      expect(flow?.filter?.nodeLayoutOverrides).toHaveLength(expected.nodes.length)
      for (const override of flow?.filter?.nodeLayoutOverrides ?? []) {
        expect({ x: override.x, y: override.y }).toEqual(overviewPositions.get(override.nodeId))
      }
    }
  })

  it('只登记 Unity 已确认的三个三维节点，不写入平台设备字段', async () => {
    const manifest = await createCoalPowerManifest('mapping-contract-test')
    const overview = manifest.topologies.find((topology) => topology.topologyId === 'topology.coal-power.overview')
    const mappedNodes = overview?.nodes
      .filter((node) => node.sceneNodeId !== undefined)
      .map((node) => ({ nodeId: node.nodeId, sceneNodeId: node.sceneNodeId }))

    expect(mappedNodes).toEqual([
      { nodeId: 'system.boiler-dcs', sceneNodeId: 'node.coal-boiler' },
      { nodeId: 'system.steam-turbine-dcs', sceneNodeId: 'node.coal-steam-turbine' },
      { nodeId: 'system.generator-excitation-controller', sceneNodeId: 'node.coal-generator' },
    ])
    expect(overview?.nodes.every((node) => !Object.prototype.hasOwnProperty.call(node, 'deviceId'))).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(manifest, 'deviceMappings')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(manifest, 'platformBindingCount')).toBe(false)
    expect(validateSceneTopologyManifest(manifest)).toEqual([])
  })

  it('四个动作、四个 Unity 流程步骤和场景入口保持一致', async () => {
    const manifest = await createCoalPowerManifest('action-contract-test')
    const coalScene = manifest.scenes.find((scene) => scene.sceneId === 'coal-power')
    const coalMapping = manifest.unitySceneMappings.find((mapping) => mapping.sceneId === 'coal-power')

    expect(coalScene?.defaultTopologyId).toBe('topology.coal-power.overview')
    expect(coalScene?.topologyIds).toEqual([
      'topology.coal-power.overview', 'topology.coal-power.combustion',
      'topology.coal-power.water-steam-cycle', 'topology.coal-power.power-output',
    ])
    expect(coalScene?.supportedActionIds).toEqual([
      'action.coal-power.overview', 'action.coal-power.combustion',
      'action.coal-power.water-steam-cycle', 'action.coal-power.power-output',
    ])
    expect(coalMapping?.sceneNodeIds).toEqual(['node.coal-boiler', 'node.coal-steam-turbine', 'node.coal-generator'])
    expect(coalMapping?.processSteps).toEqual([
      { processId: 'coal-power-generation', stepId: 'overview' },
      { processId: 'coal-power-generation', stepId: 'combustion' },
      { processId: 'coal-power-generation', stepId: 'water-steam-cycle' },
      { processId: 'coal-power-generation', stepId: 'power-output' },
    ])
    expect(coalMapping?.routeIds).toEqual([])

    expect(manifest.actions).toHaveLength(4)
    expect(manifest.actions.map((action) => action.actionId)).toEqual(coalScene?.supportedActionIds)
    expect(manifest.actions.every((action) => (
      action.targetSceneId === 'coal-power' &&
      action.failurePolicy === 'keep-current-context' &&
      action.unityAction.type === 'enterProcessStep' &&
      action.unityAction.processId === 'coal-power-generation' &&
      action.unityAction.defaultUnitId === 'all' &&
      action.unityAction.isolate === true
    ))).toBe(true)
    // 燃煤清单必须声明燃煤专用网页入口键，避免 Unity 已切到燃煤而握手元数据仍显示燃气。
    expect(manifest.unityRuntimeKey).toBe('coal-plant-release')
  })

  it('燃煤总览通过专用运行时登记申请同一个 Unity 单实例', () => {
    const registry = createRuntimeRegistry({
      status: 'ready',
      configuration: {
        parentOrigin: 'https://platform.example.test',
        unityParentOrigin: 'https://visual.example.test',
        unityEntryUrl: 'https://unity.example.test/index.html',
        unityChildOrigin: 'https://unity.example.test',
        manifestUrl: 'https://visual.example.test/scene-topology-manifest.json',
        minimumViewportWidth: 600,
        minimumViewportHeight: 600,
        addressMode: 'fixed-origin',
      },
      issues: [],
    })
    const loader = createLocalProcessConfigLoader(registry)
    const coalResult = loader.load('coal-overview')
    const gasResult = loader.load('gas-overview')

    expect(registry.list().map((runtime) => runtime.runtimeKey)).toEqual([
      'gas-plant-release',
      'coal-plant-release',
    ])
    expect(coalResult).toMatchObject({
      status: 'ready',
      effectiveRuntimeMode: 'webgl',
      issues: [],
      bundle: {
        page: { processPageId: 'coal-overview', runtimeKey: 'coal-plant-release' },
        runtime: { runtimeKey: 'coal-plant-release', resourceBudget: { maxConcurrentInstances: 1 } },
      },
    })
    // 本地兼容原子配置不得复制远程 27 节点拓扑或三维映射，防止形成第二份绑定事实。
    expect(coalResult.bundle?.topology.nodes).toEqual([])
    expect(coalResult.bundle?.sceneMapping.mappedNodeIds).toEqual([])
    // 两个入口复用同一构建地址和摘要，切换业务场景不应下载或创建第二个 Unity 播放器。
    expect(coalResult.bundle?.runtime?.entryUrl).toBe(gasResult.bundle?.runtime?.entryUrl)
    expect(coalResult.bundle?.runtime?.resourceDigest).toBe(gasResult.bundle?.runtime?.resourceDigest)
  })

  it('燃煤根入口固定向嵌入壳传递燃煤场景与总览拓扑', () => {
    const localPage = createHostPage('coal-local-entry-contract', 'local-test', 'coal-power')
    const partnerPage = createHostPage('coal-partner-entry-contract', 'partner-integration', 'coal-power')

    expect(localPage).toContain("sceneId: 'coal-power'")
    expect(localPage).toContain("topologyId: 'topology.coal-power.overview'")
    expect(localPage).toContain("shellUrl.searchParams.set('sceneId', 'coal-power')")
    expect(localPage).toContain("shellUrl.searchParams.set('topologyId', 'topology.coal-power.overview')")
    // 合作方带自有桥接参数时仍由发布包覆盖场景键，不能因查询字符串存在而回退到燃气基线。
    expect(partnerPage).toContain("shellUrl.searchParams.set('sceneId', 'coal-power')")
    expect(partnerPage).toContain("shellUrl.searchParams.set('topologyId', 'topology.coal-power.overview')")
  })
})

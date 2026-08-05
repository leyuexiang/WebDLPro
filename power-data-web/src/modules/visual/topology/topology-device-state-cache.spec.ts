import { describe, expect, it, vi } from 'vitest'
import { SCENE_IDS, toDeviceId, toNodeId, toSceneId, toSceneNodeId, toTopologyId, toUnityRuntimeKey, toUnitySceneKey } from '@/config/scene-topology/identifiers'
import { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import { TopologyDeviceStateCache } from '@/modules/visual/topology/topology-device-state-cache'

/**
 * 生成带一个跨两张燃气拓扑映射的完整测试清单。
 * 此数据只验证状态缓存边界，不代表任何真实设备、场景、对象或资源命名。
 */
function createRegistry(): TopologyRegistry {
  const version = 'device-state-test.1'
  const deviceId = toDeviceId('device.gas-turbine')
  const nodeId = toNodeId('node.gas-turbine')
  const sceneNodeId = toSceneNodeId('scene-node.gas-turbine')
  const gasOverviewTopologyId = toTopologyId('topology.gas-power.overview')
  const gasDetailTopologyId = toTopologyId('topology.gas-power.detail')
  const scenes = SCENE_IDS.map((sceneId) => ({
    sceneId,
    title: `测试场景-${sceneId}`,
    unitySceneKey: toUnitySceneKey(`scene.${sceneId}`),
    defaultTopologyId: sceneId === 'gas-power' ? gasOverviewTopologyId : toTopologyId(`topology.${sceneId}.overview`),
    topologyIds: sceneId === 'gas-power' ? [gasOverviewTopologyId, gasDetailTopologyId] : [toTopologyId(`topology.${sceneId}.overview`)],
    supportedActionIds: [],
    sceneMappingVersion: `mapping.${sceneId}.1`,
    resourceVersion: `resource.${sceneId}.1`,
    switchStrategy: 'unload-first' as const,
  }))
  const gasNode = { nodeId, title: '燃气测试节点', deviceId, sceneNodeId, iconKey: 'generic-device', x: 50, y: 50, deviceStatus: 'offline' as const, doubleClickBehavior: 'none' as const }
  const result = TopologyRegistry.create({
    manifestVersion: version,
    unityBuildId: 'device-state-test-build',
    unityRuntimeKey: toUnityRuntimeKey('device-state-test-runtime'),
    scenes,
    topologies: [
      ...SCENE_IDS.filter((sceneId) => sceneId !== 'gas-power').map((sceneId) => ({ topologyId: toTopologyId(`topology.${sceneId}.overview`), sceneId, title: `测试拓扑-${sceneId}`, configVersion: version, nodes: [], edges: [] })),
      { topologyId: gasOverviewTopologyId, sceneId: toSceneId('gas-power'), title: '燃气总览', configVersion: version, nodes: [gasNode], edges: [] },
      { topologyId: gasDetailTopologyId, sceneId: toSceneId('gas-power'), title: '燃气明细', configVersion: version, nodes: [gasNode], edges: [] },
    ],
    actions: [],
    deviceMappings: [{
      deviceId,
      sceneId: toSceneId('gas-power'),
      topologyNodeRefs: [{ topologyId: gasOverviewTopologyId, nodeId }, { topologyId: gasDetailTopologyId, nodeId }],
      sceneNodeId,
      configVersion: version,
    }],
    unitySceneMappings: SCENE_IDS.map((sceneId) => ({ sceneId, mappingVersion: `mapping.${sceneId}.1`, processSteps: [], sceneNodeIds: sceneId === 'gas-power' ? [sceneNodeId] : [], routeIds: [] })),
  })
  if (result.status !== 'ready') throw new Error('设备状态测试清单必须通过注册表校验。')
  return result.registry
}

describe('拓扑设备状态有限缓存', () => {
  it('按设备合并、丢弃过期状态、将非法状态归一为离线，并维护当前二维与三维显式映射', () => {
    const cache = new TopologyDeviceStateCache(createRegistry(), { maximumTopologySnapshots: 1, maximumSceneSnapshots: 1 })
    const deviceId = toDeviceId('device.gas-turbine')
    const nodeId = toNodeId('node.gas-turbine')
    const sceneNodeId = toSceneNodeId('scene-node.gas-turbine')
    const overviewTopologyId = toTopologyId('topology.gas-power.overview')
    const detailTopologyId = toTopologyId('topology.gas-power.detail')
    cache.setActiveContext(toSceneId('gas-power'), overviewTopologyId)

    const first = cache.apply({
      sourceRevision: 1,
      items: [
        { deviceId, deviceStatus: 'alarm', statusUpdatedAt: '2026-08-05T00:00:00.000Z' },
        { deviceId, deviceStatus: 'fault', statusUpdatedAt: '2026-08-05T00:00:00.000Z' },
      ],
    })

    expect(first.acceptedDeviceIds).toEqual([deviceId])
    expect(first.activeTopologyNodeStatuses).toEqual(new Map([[nodeId, 'fault']]))
    expect(first.activeSceneNodeStatuses).toEqual(new Map([[sceneNodeId, 'fault']]))
    // 明细拓扑因容量限制被淘汰后，模拟真实切换为活动图再按需恢复；当前可见图永远优先于非活动快照。
    cache.setActiveContext(toSceneId('gas-power'), detailTopologyId)
    expect(cache.getTopologyNodeStatuses(detailTopologyId)).toEqual(new Map([[nodeId, 'fault']]))

    const outdated = cache.apply({
      sourceRevision: 1,
      items: [{ deviceId, deviceStatus: 'alarm', statusUpdatedAt: '2026-08-04T23:59:59.000Z' }],
    })
    expect(outdated.outdatedDeviceIds).toEqual([deviceId])
    expect(outdated.activeTopologyNodeStatuses).toEqual(new Map([[nodeId, 'fault']]))

    const normalized = cache.apply({
      sourceRevision: 2,
      items: [{ deviceId, deviceStatus: 'unexpected-status', statusUpdatedAt: '2026-08-05T00:00:01.000Z' }],
    })
    // 二维节点的发布基线已经是离线，因此覆盖快照为空；三维映射仍收到明确离线状态，不会保留旧故障色。
    expect(normalized.activeTopologyNodeStatuses).toEqual(new Map())
    expect(normalized.activeSceneNodeStatuses).toEqual(new Map([[sceneNodeId, 'offline']]))
  })

  it('无映射和无效时间不创建缓存，也不根据设备名称猜测二维或三维目标', () => {
    const cache = new TopologyDeviceStateCache(createRegistry())
    cache.setActiveContext(toSceneId('gas-power'), toTopologyId('topology.gas-power.overview'))
    const result = cache.apply({
      items: [
        { deviceId: toDeviceId('device.unmapped'), deviceStatus: 'alarm', statusUpdatedAt: '2026-08-05T00:00:00.000Z' },
        { deviceId: toDeviceId('device.gas-turbine'), deviceStatus: 'alarm', statusUpdatedAt: 'not-a-time' },
      ],
    })

    expect(result.unmappedDeviceIds).toEqual([toDeviceId('device.unmapped')])
    expect(result.invalidTimestampDeviceIds).toEqual([toDeviceId('device.gas-turbine')])
    expect(result.activeTopologyNodeStatuses).toEqual(new Map())
    expect(result.activeSceneNodeStatuses).toEqual(new Map())
  })

  it('基线状态保留受限空快照，重复读取不会重新扫描设备映射', () => {
    const registry = createRegistry()
    const cache = new TopologyDeviceStateCache(registry, { maximumTopologySnapshots: 1, maximumSceneSnapshots: 1 })
    const deviceId = toDeviceId('device.gas-turbine')
    cache.setActiveContext(toSceneId('gas-power'), toTopologyId('topology.gas-power.overview'))

    // 离线正好是测试拓扑的发布基线：二维覆盖应为空，但空快照仍需作为已水合标记存在。
    cache.apply({
      sourceRevision: 1,
      items: [{ deviceId, deviceStatus: 'offline', statusUpdatedAt: '2026-08-05T00:00:00.000Z' }],
    })
    const getDeviceMapping = vi.spyOn(registry, 'getDeviceMapping')

    expect(cache.getActiveTopologyNodeStatuses()).toEqual(new Map())
    expect(cache.getActiveTopologyNodeStatuses()).toEqual(new Map())
    // 命中空快照后不应为每次读取重新遍历设备缓存并查询映射；高频状态流保持常数时间读取。
    expect(getDeviceMapping).not.toHaveBeenCalled()
  })
})

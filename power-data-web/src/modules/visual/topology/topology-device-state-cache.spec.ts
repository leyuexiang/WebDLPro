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
  const standbyDeviceId = toDeviceId('device.gas-turbine-standby')
  const standbyNodeId = toNodeId('node.gas-turbine-standby')
  const standbySceneNodeId = toSceneNodeId('scene-node.gas-turbine-standby')
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
  // 第二个显式映射设备只用于验证容量淘汰；测试仍不依据名称、坐标或 Unity 层级推断关联。
  const standbyGasNode = { nodeId: standbyNodeId, title: '燃气备用测试节点', deviceId: standbyDeviceId, sceneNodeId: standbySceneNodeId, iconKey: 'generic-device', x: 70, y: 50, deviceStatus: 'offline' as const, doubleClickBehavior: 'none' as const }
  const result = TopologyRegistry.create({
    manifestVersion: version,
    unityBuildId: 'device-state-test-build',
    unityRuntimeKey: toUnityRuntimeKey('device-state-test-runtime'),
    scenes,
    topologies: [
      ...SCENE_IDS.filter((sceneId) => sceneId !== 'gas-power').map((sceneId) => ({ topologyId: toTopologyId(`topology.${sceneId}.overview`), sceneId, title: `测试拓扑-${sceneId}`, configVersion: version, nodes: [], edges: [] })),
      { topologyId: gasOverviewTopologyId, sceneId: toSceneId('gas-power'), title: '燃气总览', configVersion: version, nodes: [gasNode, standbyGasNode], edges: [] },
      { topologyId: gasDetailTopologyId, sceneId: toSceneId('gas-power'), title: '燃气明细', configVersion: version, nodes: [gasNode, standbyGasNode], edges: [] },
    ],
    actions: [],
    deviceMappings: [{
      deviceId,
      sceneId: toSceneId('gas-power'),
      topologyNodeRefs: [{ topologyId: gasOverviewTopologyId, nodeId }, { topologyId: gasDetailTopologyId, nodeId }],
      sceneNodeId,
      configVersion: version,
    }, {
      deviceId: standbyDeviceId,
      sceneId: toSceneId('gas-power'),
      topologyNodeRefs: [{ topologyId: gasOverviewTopologyId, nodeId: standbyNodeId }, { topologyId: gasDetailTopologyId, nodeId: standbyNodeId }],
      sceneNodeId: standbySceneNodeId,
      configVersion: version,
    }],
    unitySceneMappings: SCENE_IDS.map((sceneId) => ({ sceneId, mappingVersion: `mapping.${sceneId}.1`, processSteps: [], sceneNodeIds: sceneId === 'gas-power' ? [sceneNodeId, standbySceneNodeId] : [], routeIds: [] })),
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
    // 任务-038只消费本批新增的三维节点增量；同批同设备保留最后状态并输出规范化来源时间。
    expect(first.activeSceneNodeStateUpdates).toEqual(new Map([[sceneNodeId, {
      visualState: 'fault',
      statusUpdatedAt: '2026-08-05T00:00:00.000Z',
      sourceRevision: 1,
    }]]))
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
    expect(result.activeSceneNodeStateUpdates).toEqual(new Map())
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

  it('四态按更新时间递增覆盖，同一时间戳只接受更高来源修订号', () => {
    const cache = new TopologyDeviceStateCache(createRegistry())
    const deviceId = toDeviceId('device.gas-turbine')
    const nodeId = toNodeId('node.gas-turbine')
    const sceneNodeId = toSceneNodeId('scene-node.gas-turbine')
    cache.setActiveContext(toSceneId('gas-power'), toTopologyId('topology.gas-power.overview'))

    const states = ['normal', 'alarm', 'fault', 'offline'] as const
    states.forEach((deviceStatus, index) => {
      const result = cache.apply({
        sourceRevision: index + 1,
        items: [{ deviceId, deviceStatus, statusUpdatedAt: `2026-08-05T00:00:0${index}.000Z` }],
      })

      expect(result.acceptedDeviceIds).toEqual([deviceId])
      expect(result.activeSceneNodeStatuses).toEqual(new Map([[sceneNodeId, deviceStatus]]))
      expect(result.activeTopologyNodeStatuses).toEqual(deviceStatus === 'offline' ? new Map() : new Map([[nodeId, deviceStatus]]))
    })

    const repeatedTimestamp = '2026-08-05T00:00:03.000Z'
    const lowerRevision = cache.apply({
      sourceRevision: 3,
      items: [{ deviceId, deviceStatus: 'alarm', statusUpdatedAt: repeatedTimestamp }],
    })
    const sameRevision = cache.apply({
      sourceRevision: 4,
      items: [{ deviceId, deviceStatus: 'alarm', statusUpdatedAt: repeatedTimestamp }],
    })
    const higherRevision = cache.apply({
      sourceRevision: 5,
      items: [{ deviceId, deviceStatus: 'alarm', statusUpdatedAt: repeatedTimestamp }],
    })

    expect(lowerRevision.outdatedDeviceIds).toEqual([deviceId])
    expect(sameRevision.outdatedDeviceIds).toEqual([deviceId])
    expect(higherRevision.acceptedDeviceIds).toEqual([deviceId])
    expect(higherRevision.activeTopologyNodeStatuses).toEqual(new Map([[nodeId, 'alarm']]))
    // 相同业务时间下只有来源修订号能证明这是新状态；三维增量必须保留该因果信息，不能只更新二维快照。
    expect(higherRevision.activeSceneNodeStateUpdates).toEqual(new Map([[sceneNodeId, {
      visualState: 'alarm',
      statusUpdatedAt: repeatedTimestamp,
      sourceRevision: 5,
    }]]))
  })

  it('设备容量淘汰同步清除二维与三维旧覆盖，释放后不保留活动上下文或状态', () => {
    const cache = new TopologyDeviceStateCache(createRegistry(), { maximumDeviceStates: 1 })
    const firstDeviceId = toDeviceId('device.gas-turbine')
    const secondDeviceId = toDeviceId('device.gas-turbine-standby')
    const secondNodeId = toNodeId('node.gas-turbine-standby')
    const secondSceneNodeId = toSceneNodeId('scene-node.gas-turbine-standby')
    cache.setActiveContext(toSceneId('gas-power'), toTopologyId('topology.gas-power.overview'))

    cache.apply({
      sourceRevision: 1,
      items: [{ deviceId: firstDeviceId, deviceStatus: 'alarm', statusUpdatedAt: '2026-08-05T00:00:00.000Z' }],
    })
    const afterEviction = cache.apply({
      sourceRevision: 2,
      items: [{ deviceId: secondDeviceId, deviceStatus: 'fault', statusUpdatedAt: '2026-08-05T00:00:01.000Z' }],
    })

    // 容量为一时，较旧设备必须从两个投影同时消失，不能留下无法再进行时间比较的陈旧颜色。
    expect(afterEviction.activeTopologyNodeStatuses).toEqual(new Map([[secondNodeId, 'fault']]))
    expect(afterEviction.activeSceneNodeStatuses).toEqual(new Map([[secondSceneNodeId, 'fault']]))

    cache.dispose()
    expect(cache.getActiveTopologyNodeStatuses()).toEqual(new Map())
    expect(cache.getActiveSceneNodeStatuses()).toEqual(new Map())
  })
})

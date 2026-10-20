import { describe, expect, it } from 'vitest'
import { SCENE_IDS, toCameraPoseId, toNodeId, toProcessDetailId, toProcessDetailResourceId, toProcessId, toRouteId, toSceneId, toSceneNodeId, toStepId, toTopologyId, toUnityRuntimeKey, toUnitySceneKey } from '@/config/scene-topology/identifiers'
import { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import { TopologyDeviceStateCache } from '@/modules/visual/topology/topology-device-state-cache'

const version = 'node-state-cache.1'
const gasSceneId = toSceneId('gas-power')
const windSceneId = toSceneId('wind-power')
const gasOverviewId = toTopologyId('topology.gas-power.overview')
const gasDetailId = toTopologyId('topology.gas-power.detail')
const windOverviewId = toTopologyId('topology.wind-power.overview')
const primaryNodeId = toNodeId('node.gas.primary')
const standbyNodeId = toNodeId('node.gas.standby')
const windNodeId = toNodeId('node.wind.primary')
const unknownNodeId = toNodeId('node.unknown')
const primarySceneNodeId = toSceneNodeId('scene-node.gas.primary')
const standbySceneNodeId = toSceneNodeId('scene-node.gas.standby')
const windSceneNodeId = toSceneNodeId('scene-node.wind.primary')
const windYawProcessDetailId = toProcessDetailId('process-detail.wind-power.yaw-system')
const windGearboxProcessDetailId = toProcessDetailId('process-detail.wind-power.gearbox')
const windAngleSensorNodeId = toNodeId('asset.wind-yaw-angle-sensor')
const windLubricationNodeId = toNodeId('asset.wind-gearbox-lubrication-unit')

/**
 * 注册表只保存 nodeId 到二维/三维目标的静态关系。
 * 明细图使用过滤视图复用总图节点，证明同一个节点状态可以投影到多张拓扑而不复制绑定事实。
 */
function createRegistry(): TopologyRegistry {
  const scenes = SCENE_IDS.map((sceneId) => ({
    sceneId,
    title: `测试场景-${sceneId}`,
    unitySceneKey: toUnitySceneKey(`scene.${sceneId}`),
    defaultTopologyId: sceneId === gasSceneId ? gasOverviewId : sceneId === windSceneId ? windOverviewId : toTopologyId(`topology.${sceneId}.overview`),
    topologyIds: sceneId === gasSceneId ? [gasOverviewId, gasDetailId] : [sceneId === windSceneId ? windOverviewId : toTopologyId(`topology.${sceneId}.overview`)],
    supportedActionIds: [],
    sceneMappingVersion: `${version}.${sceneId}`,
    resourceVersion: `${version}.${sceneId}`,
    switchStrategy: 'unload-first' as const,
  }))
  const node = (nodeId: ReturnType<typeof toNodeId>, title: string, sceneNodeId: ReturnType<typeof toSceneNodeId>, deviceStatus: 'normal' | 'offline') => ({
    nodeId,
    title,
    sceneNodeId,
    iconKey: 'generic-device',
    x: 50,
    y: 50,
    deviceStatus,
    doubleClickBehavior: 'emit-node' as const,
  })
  const gasNodes = [node(primaryNodeId, '燃气主节点', primarySceneNodeId, 'offline'), node(standbyNodeId, '燃气备用节点', standbySceneNodeId, 'offline')]
  const topologies = [
    ...SCENE_IDS.filter((sceneId) => sceneId !== gasSceneId && sceneId !== windSceneId).map((sceneId) => ({
      topologyId: toTopologyId(`topology.${sceneId}.overview`), sceneId, title: `测试拓扑-${sceneId}`, configVersion: version, nodes: [], edges: [],
    })),
    { topologyId: gasOverviewId, sceneId: gasSceneId, title: '燃气总览', configVersion: version, nodes: gasNodes, edges: [{ edgeId: toRouteId('route.gas.primary-standby'), fromNodeId: primaryNodeId, toNodeId: standbyNodeId, title: '备用关系' }] },
    { topologyId: gasDetailId, sceneId: gasSceneId, title: '燃气明细', configVersion: version, nodes: [], edges: [], filter: { sourceTopologyId: gasOverviewId, visibleNodeIds: [primaryNodeId, standbyNodeId], visibleEdgeIds: [toRouteId('route.gas.primary-standby')], nodeLayoutOverrides: [{ nodeId: primaryNodeId, x: 30, y: 50 }, { nodeId: standbyNodeId, x: 70, y: 50 }] } },
    { topologyId: windOverviewId, sceneId: windSceneId, title: '风电总览', configVersion: version, nodes: [node(windNodeId, '风电节点', windSceneNodeId, 'offline')], edges: [] },
  ]
  const result = TopologyRegistry.create({
    manifestVersion: version,
    unityBuildId: 'node-state-cache-build',
    unityRuntimeKey: toUnityRuntimeKey('node-state-cache-runtime'),
    scenes,
    topologies,
    actions: [],
    processDetails: [
      {
        sceneId: windSceneId,
        processId: toProcessId('wind-power-generation'),
        stepId: toStepId('yaw-system'),
        processDetailId: windYawProcessDetailId,
        resourceId: toProcessDetailResourceId('process-detail-resource.wind-power.yaw-system'),
        cameraPoseId: toCameraPoseId('camera-pose.wind-power.yaw-system'),
        stateNodeId: windSceneNodeId,
        topologyDataContextId: 'process-detail.wind-power.yaw-system',
        topologyNodes: [{ nodeId: windAngleSensorNodeId, title: '角度传感器' }],
      },
      {
        sceneId: windSceneId,
        processId: toProcessId('wind-power-generation'),
        stepId: toStepId('gearbox'),
        processDetailId: windGearboxProcessDetailId,
        resourceId: toProcessDetailResourceId('process-detail-resource.wind-power.gearbox'),
        cameraPoseId: toCameraPoseId('camera-pose.wind-power.gearbox'),
        stateNodeId: windSceneNodeId,
        topologyDataContextId: 'process-detail.wind-power.gearbox',
        topologyNodes: [{ nodeId: windLubricationNodeId, title: '润滑油装置' }],
      },
    ],
    unitySceneMappings: scenes.map((scene) => ({ sceneId: scene.sceneId, mappingVersion: scene.sceneMappingVersion, sceneNodeIds: scene.sceneId === gasSceneId ? [primarySceneNodeId, standbySceneNodeId] : scene.sceneId === windSceneId ? [windSceneNodeId] : [], routeIds: [] })),
  })
  if (result.status !== 'ready') throw new Error(`节点状态缓存夹具无效：${result.issues.map((issue) => issue.code).join(',')}`)
  return result.registry
}

describe('拓扑节点状态完整快照缓存', () => {
  it('后到完整快照替换旧表，缺失节点恢复二维基线并清除三维目标', () => {
    const cache = new TopologyDeviceStateCache(createRegistry())
    cache.setActiveContext(gasSceneId, gasOverviewId)
    const first = cache.apply({ sourceRevision: 100, items: [
      { nodeId: primaryNodeId, deviceStatus: 'alarm', statusUpdatedAt: '2026-08-11T12:00:00.000+08:00' },
      { nodeId: standbyNodeId, deviceStatus: 'fault', statusUpdatedAt: '2026-08-11T12:00:01.000+08:00' },
    ] })
    expect(first.activeTopologyNodeStatuses).toEqual(new Map([[primaryNodeId, 'alarm'], [standbyNodeId, 'fault']]))
    const second = cache.apply({ sourceRevision: 1, items: [{ nodeId: primaryNodeId, deviceStatus: 'normal', statusUpdatedAt: '2026-08-10T08:00:00.000+08:00' }] })
    expect(second.committed).toBe(true)
    expect(second.restoredNodeIds).toEqual([standbyNodeId])
    // 正常态就是二维拓扑的隐式基线，缓存清除告警覆盖后应返回空表而非重复写入正常覆盖值。
    expect(second.activeTopologyNodeStatuses).toEqual(new Map())
    expect(second.activeSceneNodeStatuses).toEqual(new Map([[primarySceneNodeId, 'normal']]))
    expect(second.clearedActiveSceneNodeIds).toEqual([standbySceneNodeId])
  })

  it('按 nodeId 忽略未知状态项，并以同一批次最后一项覆盖重复节点', () => {
    const cache = new TopologyDeviceStateCache(createRegistry())
    cache.setActiveContext(gasSceneId, gasOverviewId)
    const result = cache.apply({ sourceRevision: 2, items: [
      { nodeId: primaryNodeId, deviceStatus: 'alarm', statusUpdatedAt: '2026-08-11T12:00:00.000+08:00' },
      { nodeId: primaryNodeId, deviceStatus: 'fault', statusUpdatedAt: '2026-08-11T12:00:01.000+08:00' },
      { nodeId: unknownNodeId, deviceStatus: 'normal', statusUpdatedAt: '2026-08-11T12:00:02.000+08:00' },
    ] })
    expect(result.acceptedNodeIds).toEqual([primaryNodeId])
    expect(result.unmappedNodeIds).toEqual([unknownNodeId])
    expect(result.activeTopologyNodeStatuses).toEqual(new Map([[primaryNodeId, 'fault']]))
  })

  it('过滤拓扑读取同一 nodeId 的二维状态，场景投影读取 sceneNodeId 状态', () => {
    const cache = new TopologyDeviceStateCache(createRegistry())
    cache.apply({ sourceRevision: 3, items: [{ nodeId: primaryNodeId, deviceStatus: 'alarm', statusUpdatedAt: '2026-08-11T12:00:00.000+08:00' }] })
    expect(cache.getTopologyNodeStatuses(gasDetailId)).toEqual(new Map([[primaryNodeId, 'alarm']]))
    expect(cache.getSceneNodeStatuses(gasSceneId)).toEqual(new Map([[primarySceneNodeId, 'alarm']]))
  })

  it('只将当前关键环节的专属节点状态投影到第三层二维画布且不生成 Unity 状态', () => {
    const registry = createRegistry()
    const angleProjection = registry.getNodeStateProjection(windAngleSensorNodeId)
    expect(angleProjection).toMatchObject({
      sceneId: windSceneId,
      topologyTargets: [],
      sceneNodeIds: [],
      processDetailId: windYawProcessDetailId,
    })

    const cache = new TopologyDeviceStateCache(registry)
    cache.setActiveContext(windSceneId, windOverviewId, windSceneNodeId, windYawProcessDetailId)
    const snapshot = cache.apply({ sourceRevision: 4, items: [
      { nodeId: windNodeId, deviceStatus: 'alarm', statusUpdatedAt: '2026-08-11T12:00:00.000+08:00' },
      { nodeId: windAngleSensorNodeId, deviceStatus: 'fault', statusUpdatedAt: '2026-08-11T12:00:01.000+08:00' },
      { nodeId: windLubricationNodeId, deviceStatus: 'offline', statusUpdatedAt: '2026-08-11T12:00:02.000+08:00' },
    ] })
    expect(snapshot.activeTopologyNodeStatuses).toEqual(new Map([
      [windNodeId, 'alarm'],
      [windAngleSensorNodeId, 'fault'],
    ]))
    expect(snapshot.activeSceneNodeStatuses).toEqual(new Map([[windSceneNodeId, 'alarm']]))
    expect(cache.getTopologyNodeStatuses(windOverviewId)).toEqual(new Map([[windNodeId, 'alarm']]))

    cache.setActiveContext(windSceneId, windOverviewId, windSceneNodeId, windGearboxProcessDetailId)
    expect(cache.getActiveTopologyNodeStatuses()).toEqual(new Map([
      [windNodeId, 'alarm'],
      [windLubricationNodeId, 'offline'],
    ]))
    expect(cache.getActiveSceneNodeStatuses()).toEqual(new Map([[windSceneNodeId, 'alarm']]))
  })

  it('容量超限和释放不会交换权威表', () => {
    const cache = new TopologyDeviceStateCache(createRegistry(), { maximumDeviceStates: 1 })
    const rejected = cache.apply({ sourceRevision: 1, items: [
      { nodeId: primaryNodeId, deviceStatus: 'alarm', statusUpdatedAt: '2026-08-11T12:00:00.000+08:00' },
      { nodeId: standbyNodeId, deviceStatus: 'fault', statusUpdatedAt: '2026-08-11T12:00:01.000+08:00' },
    ] })
    expect(rejected).toMatchObject({ committed: false, capacityExceeded: true, snapshotSequence: 0 })
    cache.dispose()
    expect(cache.apply({ sourceRevision: 2, items: [{ nodeId: primaryNodeId, deviceStatus: 'normal', statusUpdatedAt: '2026-08-11T12:00:02.000+08:00' }] })).toMatchObject({ committed: false, capacityExceeded: false })
  })
})

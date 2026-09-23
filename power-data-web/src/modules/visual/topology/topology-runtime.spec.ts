import { describe, expect, it, vi } from 'vitest'
import { SCENE_IDS, toNodeId, toSceneId, toSceneNodeId, toTopologyId, toTransitionId } from '@/config/scene-topology/identifiers'
import { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import { TopologyRuntime, type TopologyCanvasPort } from '@/modules/visual/topology/topology-runtime'

/** 生成九场景注册表测试数据；只验证运行时边界，不声明任何真实设备或三维资源映射。 */
function createRegistry(): TopologyRegistry {
  const version = 'test-version-01'
  const gasNodeId = toNodeId('node.gas-turbine')
  const gasSceneNodeId = toSceneNodeId('scene-node.gas-turbine')
  const passiveNodeId = toNodeId('node.gas-passive-controller')
  const passiveSceneNodeId = toSceneNodeId('scene-node.gas-passive-controller')
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
  scenes.find((scene) => scene.sceneId === 'gas-power')?.topologyIds.push('gas-power.detail')
  const result = TopologyRegistry.create({
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
        nodes: sceneId === 'gas-power'
          ? [
              { nodeId: gasNodeId, title: '燃气测试节点', sceneNodeId: gasSceneNodeId, iconKey: 'generic-device', x: 38, y: 50, deviceStatus: 'offline' as const, doubleClickBehavior: 'emit-node' as const },
              // 第二个节点仍登记三维对象，验证用户选择和聚焦不依赖平台内部真实设备绑定。
              // 所有来源节点都已有 nodeId 并发布 emit-node 许可；平台是否绑定真实设备不进入我方清单。
              { nodeId: passiveNodeId, title: '燃气备用控制器', sceneNodeId: passiveSceneNodeId, iconKey: 'generic-device', x: 62, y: 50, deviceStatus: 'offline' as const, doubleClickBehavior: 'emit-node' as const },
            ]
          : [],
        edges: [],
      })),
      { topologyId: 'gas-power.detail', sceneId: 'gas-power', title: '燃气测试明细拓扑', configVersion: version, nodes: [], edges: [] },
    ],
    actions: [],
    unitySceneMappings: SCENE_IDS.map((sceneId) => ({ sceneId, mappingVersion: version, processSteps: [], sceneNodeIds: sceneId === 'gas-power' ? [gasSceneNodeId, passiveSceneNodeId] : [], routeIds: [] })),
  })
  if (result.status !== 'ready') throw new Error('测试清单必须通过注册表校验。')
  return result.registry
}

/** 伪画布只记录受控调用次数，证明 prepare 不会创建或替换画布。 */
function createCanvas(): TopologyCanvasPort & { setTopology: ReturnType<typeof vi.fn>; setSelection: ReturnType<typeof vi.fn>; setNodeStatuses: ReturnType<typeof vi.fn>; getViewState: ReturnType<typeof vi.fn>; restoreViewState: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } {
  return {
    setTopology: vi.fn(),
    setSelection: vi.fn(),
    setNodeStatuses: vi.fn(),
    getViewState: vi.fn(),
    restoreViewState: vi.fn(),
    dispose: vi.fn(),
  } as unknown as TopologyCanvasPort & { setTopology: ReturnType<typeof vi.fn>; setSelection: ReturnType<typeof vi.fn>; setNodeStatuses: ReturnType<typeof vi.fn>; getViewState: ReturnType<typeof vi.fn>; restoreViewState: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }
}

describe('单画布多拓扑运行时', () => {
  it('准备阶段不操作画布，当前事务激活才替换活动拓扑', () => {
    const canvas = createCanvas()
    const runtime = new TopologyRuntime(createRegistry(), canvas)
    const transitionId = toTransitionId('transition-01')
    const prepared = runtime.prepare(toSceneId('gas-power'), toTopologyId('gas-power.detail'), transitionId)

    expect(canvas.setTopology).not.toHaveBeenCalled()
    expect(prepared).toBeDefined()
    expect(runtime.activate(prepared!, transitionId)).toBe(true)
    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    expect(runtime.getActiveTopology()?.topologyId).toBe(toTopologyId('gas-power.detail'))
  })

  it('旧事务或跨场景准备结果不能激活并覆盖当前画布', () => {
    const canvas = createCanvas()
    const runtime = new TopologyRuntime(createRegistry(), canvas)
    const prepared = runtime.prepare(toSceneId('gas-power'), toTopologyId('gas-power.detail'), toTransitionId('transition-old'))
    const crossScene = runtime.prepare(toSceneId('wind-power'), toTopologyId('gas-power.detail'), toTransitionId('transition-new'))

    expect(runtime.activate(prepared!, toTransitionId('transition-new'))).toBe(false)
    expect(crossScene).toBeUndefined()
    expect(canvas.setTopology).not.toHaveBeenCalled()
  })

  it('选择只更新当前画布，释放后清理并禁止后续调用', () => {
    const canvas = createCanvas()
    const runtime = new TopologyRuntime(createRegistry(), canvas)
    const transitionId = toTransitionId('transition-01')
    const prepared = runtime.prepare(toSceneId('gas-power'), toTopologyId('gas-power.overview'), transitionId)
    runtime.activate(prepared!, transitionId)
    runtime.setSelection([], [])
    runtime.dispose()
    runtime.setSelection([], [])
    runtime.dispose()

    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    expect(canvas.setSelection).toHaveBeenCalledTimes(2)
    expect(canvas.dispose).toHaveBeenCalledTimes(1)
  })

  it('多次拓扑切换始终复用同一画布端口，重复释放不会留下第二个实例', () => {
    const canvas = createCanvas()
    const runtime = new TopologyRuntime(createRegistry(), canvas)
    const sceneId = toSceneId('gas-power')
    const topologyIds = [toTopologyId('gas-power.overview'), toTopologyId('gas-power.detail')]

    /*
     * 每一轮都生成新的受控事务标识，模拟用户在同场景总览与明细拓扑之间连续切换。
     * 测试只传入一个 canvas（画布）端口；若运行时错误创建隐藏画布，无法通过该端口调用序列完成验证。
     */
    for (let switchRound = 0; switchRound < 6; switchRound += 1) {
      const transitionId = toTransitionId(`transition-switch-${switchRound}`)
      const topologyId = topologyIds[switchRound % topologyIds.length]!
      const prepared = runtime.prepare(sceneId, topologyId, transitionId)

      expect(prepared).toBeDefined()
      expect(runtime.activate(prepared!, transitionId)).toBe(true)
    }

    expect(canvas.setTopology).toHaveBeenCalledTimes(6)
    expect(runtime.getActiveTopology()?.topologyId).toBe(toTopologyId('gas-power.detail'))

    runtime.dispose()
    runtime.dispose()

    expect(canvas.dispose).toHaveBeenCalledTimes(1)
  })

  it('切换拓扑后恢复原图的缩放、平移和稳定选择', () => {
    const canvas = createCanvas()
    const runtime = new TopologyRuntime(createRegistry(), canvas)
    const sceneId = toSceneId('gas-power')
    const overviewId = toTopologyId('gas-power.overview')
    const detailId = toTopologyId('gas-power.detail')
    const selectedNodeId = toNodeId('node.gas-turbine')

    const overview = runtime.prepare(sceneId, overviewId, toTransitionId('transition-overview'))
    expect(runtime.activate(overview!, toTransitionId('transition-overview'))).toBe(true)
    runtime.setSelection([selectedNodeId], [])
    // 模拟用户在唯一画布内缩放、平移；切图前运行时必须读取真实视口，而不能回退默认值。
    canvas.getViewState.mockReturnValue({ zoom: 1.6, offsetX: 42, offsetY: -18 })

    const detail = runtime.prepare(sceneId, detailId, toTransitionId('transition-detail'))
    expect(runtime.activate(detail!, toTransitionId('transition-detail'))).toBe(true)
    canvas.getViewState.mockReturnValue({ zoom: 1, offsetX: 0, offsetY: 0 })

    const restoredOverview = runtime.prepare(sceneId, overviewId, toTransitionId('transition-restore-overview'))
    expect(runtime.activate(restoredOverview!, toTransitionId('transition-restore-overview'))).toBe(true)
    expect(canvas.restoreViewState).toHaveBeenLastCalledWith({
      zoom: 1.6,
      offsetX: 42,
      offsetY: -18,
      selectedNodeIds: [selectedNodeId],
      selectedRouteIds: [],
    })
  })

  it('设备完整快照只更新当前画布状态，保留选择、缩放与拓扑定义', () => {
    const canvas = createCanvas()
    const runtime = new TopologyRuntime(createRegistry(), canvas)
    const transitionId = toTransitionId('transition-status')
    const prepared = runtime.prepare(toSceneId('gas-power'), toTopologyId('gas-power.overview'), transitionId)
    runtime.activate(prepared!, transitionId)
    runtime.setSelection([toNodeId('node.gas-turbine')], [])
    const topologyCallsBefore = canvas.setTopology.mock.calls.length
    const selectionCallsBefore = canvas.setSelection.mock.calls.length
    const restoreCallsBefore = canvas.restoreViewState.mock.calls.length

    const result = runtime.applyDeviceStates({
      sourceRevision: 1,
      items: [{ nodeId: toNodeId('node.gas-turbine'), deviceStatus: 'alarm', statusUpdatedAt: '2026-08-05T00:00:00.000Z' }],
    })

    expect(result.acceptedNodeIds).toEqual([toNodeId('node.gas-turbine')])
    expect(result.activeTopologyNodeStatuses).toEqual(new Map([[toNodeId('node.gas-turbine'), 'alarm']]))
    expect(result.activeSceneNodeStatuses).toEqual(new Map([[toSceneNodeId('scene-node.gas-turbine'), 'alarm']]))
    expect(canvas.setNodeStatuses).toHaveBeenLastCalledWith(new Map([[toNodeId('node.gas-turbine'), 'alarm']]))
    expect(canvas.setTopology).toHaveBeenCalledTimes(topologyCallsBefore)
    expect(canvas.setSelection).toHaveBeenCalledTimes(selectionCallsBefore)
    expect(canvas.restoreViewState).toHaveBeenCalledTimes(restoreCallsBefore)
  })

  it('二维画布写入失败时不提交候选权威快照，恢复后重试才整体生效', () => {
    const canvas = createCanvas()
    const runtime = new TopologyRuntime(createRegistry(), canvas)
    const transitionId = toTransitionId('transition-atomic-status')
    const prepared = runtime.prepare(toSceneId('gas-power'), toTopologyId('gas-power.overview'), transitionId)
    expect(runtime.activate(prepared!, transitionId)).toBe(true)

    runtime.applyDeviceStates({
      sourceRevision: 1,
      items: [{ nodeId: toNodeId('node.gas-turbine'), deviceStatus: 'alarm', statusUpdatedAt: '2026-08-05T00:00:00.000Z' }],
    })
    expect(runtime.getActiveSceneNodeStatuses()).toEqual(new Map([[toSceneNodeId('scene-node.gas-turbine'), 'alarm']]))

    const topologyCallsBeforeFailure = canvas.setTopology.mock.calls.length
    const selectionCallsBeforeFailure = canvas.setSelection.mock.calls.length
    canvas.setNodeStatuses.mockImplementationOnce(() => {
      throw new Error('模拟画布状态写入失败')
    })

    expect(() => runtime.applyDeviceStates({
      sourceRevision: 2,
      items: [{ nodeId: toNodeId('node.gas-turbine'), deviceStatus: 'fault', statusUpdatedAt: '2026-08-05T00:00:01.000Z' }],
    })).toThrow('模拟画布状态写入失败')

    // 失败只影响本次状态写入；权威快照、拓扑定义和选择均继续保持上一份已提交结果。
    expect(runtime.getActiveSceneNodeStatuses()).toEqual(new Map([[toSceneNodeId('scene-node.gas-turbine'), 'alarm']]))
    expect(canvas.setTopology).toHaveBeenCalledTimes(topologyCallsBeforeFailure)
    expect(canvas.setSelection).toHaveBeenCalledTimes(selectionCallsBeforeFailure)

    const retried = runtime.applyDeviceStates({
      sourceRevision: 2,
      items: [{ nodeId: toNodeId('node.gas-turbine'), deviceStatus: 'fault', statusUpdatedAt: '2026-08-05T00:00:01.000Z' }],
    })
    expect(retried.committed).toBe(true)
    expect(runtime.getActiveSceneNodeStatuses()).toEqual(new Map([[toSceneNodeId('scene-node.gas-turbine'), 'fault']]))
  })

  it('完整快照切换到同场景子图后立即重投影，无需平台再次推送状态', () => {
    const canvas = createCanvas()
    const runtime = new TopologyRuntime(createRegistry(), canvas)
    const sceneId = toSceneId('gas-power')
    const overviewId = toTopologyId('gas-power.overview')
    const detailId = toTopologyId('gas-power.detail')
    const overview = runtime.prepare(sceneId, overviewId, toTransitionId('transition-reproject-overview'))

    expect(runtime.activate(overview!, toTransitionId('transition-reproject-overview'))).toBe(true)
    runtime.applyDeviceStates({
      sourceRevision: 7,
      items: [{ nodeId: toNodeId('node.gas-turbine'), deviceStatus: 'alarm', statusUpdatedAt: '2026-08-14T09:00:00.000+08:00' }],
    })
    expect(canvas.setNodeStatuses).toHaveBeenLastCalledWith(new Map([[toNodeId('node.gas-turbine'), 'alarm']]))

    const detail = runtime.prepare(sceneId, detailId, toTransitionId('transition-reproject-detail'))
    expect(runtime.activate(detail!, toTransitionId('transition-reproject-detail'))).toBe(true)
    // 明细图没有该设备二维节点，但同一份权威快照仍须即时投影到当前场景的三维节点。
    expect(canvas.setNodeStatuses).toHaveBeenLastCalledWith(new Map())
    expect(runtime.getActiveSceneNodeStateSnapshot()).toEqual({
      snapshotSequence: 1,
      updates: new Map([[toSceneNodeId('scene-node.gas-turbine'), {
        visualState: 'alarm',
        statusUpdatedAt: '2026-08-14T09:00:00.000+08:00',
        sourceRevision: 7,
      }]]),
    })
  })

  it('派生状态缓存被淘汰后切回总览从权威快照重建，缺失设备恢复配置基线', () => {
    const canvas = createCanvas()
    const runtime = new TopologyRuntime(createRegistry(), canvas, 8, 8, 500, 1)
    const sceneId = toSceneId('gas-power')
    const overviewId = toTopologyId('gas-power.overview')
    const detailId = toTopologyId('gas-power.detail')
    const overview = runtime.prepare(sceneId, overviewId, toTransitionId('transition-evict-overview'))

    expect(runtime.activate(overview!, toTransitionId('transition-evict-overview'))).toBe(true)
    runtime.applyDeviceStates({
      sourceRevision: 11,
      items: [{ nodeId: toNodeId('node.gas-turbine'), deviceStatus: 'fault', statusUpdatedAt: '2026-08-14T09:01:00.000+08:00' }],
    })
    const detail = runtime.prepare(sceneId, detailId, toTransitionId('transition-evict-detail'))
    expect(runtime.activate(detail!, toTransitionId('transition-evict-detail'))).toBe(true)
    // 第二份完整快照不含旧设备，权威表替换后所有被淘汰或未淘汰的派生表都必须回到清单基线。
    runtime.applyDeviceStates({ sourceRevision: 12, items: [] })

    const restoredOverview = runtime.prepare(sceneId, overviewId, toTransitionId('transition-evict-restore-overview'))
    expect(runtime.activate(restoredOverview!, toTransitionId('transition-evict-restore-overview'))).toBe(true)
    expect(canvas.setNodeStatuses).toHaveBeenLastCalledWith(new Map())
    expect(runtime.getActiveSceneNodeStatuses()).toEqual(new Map())
  })

  it('首次激活写入状态失败时不保留候选场景状态上下文', () => {
    const canvas = createCanvas()
    canvas.setNodeStatuses.mockImplementationOnce(() => {
      throw new Error('首次状态绘制失败')
    })
    const runtime = new TopologyRuntime(createRegistry(), canvas)
    const prepared = runtime.prepare(toSceneId('gas-power'), toTopologyId('gas-power.overview'), toTransitionId('transition-first-activate-failed'))

    expect(runtime.activate(prepared!, toTransitionId('transition-first-activate-failed'))).toBe(false)
    // 失败前尚未提交完整设备快照，仍必须显式证明候选场景不会被当作活动三维上下文暴露。
    expect(runtime.getActiveTopology()).toBeUndefined()
    expect(runtime.getActiveSceneNodeStatuses()).toEqual(new Map())
    expect(runtime.getActiveSceneNodeStateSnapshot()).toEqual({ snapshotSequence: 0, updates: new Map() })
  })
})

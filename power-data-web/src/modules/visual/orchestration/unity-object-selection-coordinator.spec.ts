import { describe, expect, it, vi } from 'vitest'
import { SCENE_IDS, toNodeId, toSceneActivationId, toSceneId, toSceneNodeId, toTopologyId, toUnityRuntimeKey, toUnitySceneKey } from '@/config/scene-topology/identifiers'
import { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import type { SceneTopologyManifest } from '@/config/scene-topology/types'
import { UnityObjectSelectionCoordinator } from '@/modules/visual/orchestration/unity-object-selection-coordinator'
import type { VisualizationCoordinatorFacade } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import type { VisualizationCoordinatorSnapshot } from '@/modules/visual/orchestration/visualization-coordinator'
import type { TopologyRuntime } from '@/modules/visual/topology/topology-runtime'

const manifestVersion = 'unity-selection-test.1'
const sceneId = toSceneId('gas-power')
const topologyId = toTopologyId('topology.gas-power.overview')
const nodeId = toNodeId('node.gas-turbine')
const sceneNodeId = toSceneNodeId('scene-node.gas-turbine')
const sceneActivationId = toSceneActivationId('scene-activation.gas-1')

/** 构造仅含一条明确燃气映射的九场景测试清单，其他八个场景保持显式空态，不伪造业务设备。 */
function createRegistry(mappingTopologyId: typeof topologyId = topologyId) {
  const hasAdditionalGasTopology = mappingTopologyId !== topologyId
  const manifest: SceneTopologyManifest = {
    manifestVersion,
    unityBuildId: 'unity-selection-test-build',
    unityRuntimeKey: toUnityRuntimeKey('unity-selection-test-runtime'),
    scenes: SCENE_IDS.map((candidateSceneId) => ({
      sceneId: candidateSceneId,
      title: `测试场景-${candidateSceneId}`,
      unitySceneKey: toUnitySceneKey(`scene.${candidateSceneId}`),
      defaultTopologyId: toTopologyId(`topology.${candidateSceneId}.overview`),
      topologyIds: candidateSceneId === sceneId && hasAdditionalGasTopology
        ? [toTopologyId(`topology.${candidateSceneId}.overview`), mappingTopologyId]
        : [toTopologyId(`topology.${candidateSceneId}.overview`)],
      supportedActionIds: [],
      sceneMappingVersion: manifestVersion,
      resourceVersion: manifestVersion,
      switchStrategy: 'unload-first',
    })),
    topologies: [
      ...SCENE_IDS.map((candidateSceneId) => ({
        topologyId: toTopologyId(`topology.${candidateSceneId}.overview`),
        sceneId: candidateSceneId,
        title: `测试拓扑-${candidateSceneId}`,
        configVersion: manifestVersion,
        // 明细图映射用例让默认图保持无节点，验证注册表不会根据标题猜测当前拓扑。
        nodes: candidateSceneId === sceneId && !hasAdditionalGasTopology
          ? [{ nodeId, title: '测试燃气轮机', sceneNodeId, iconKey: 'generic-device', x: 50, y: 50, deviceStatus: 'normal' as const, doubleClickBehavior: 'emit-node' as const }]
          : [],
        edges: [],
      })),
      ...(hasAdditionalGasTopology ? [{
        topologyId: mappingTopologyId,
        sceneId,
        title: '测试燃气明细拓扑',
        configVersion: manifestVersion,
        nodes: [{ nodeId, title: '测试燃气轮机', sceneNodeId, iconKey: 'generic-device', x: 50, y: 50, deviceStatus: 'normal' as const, doubleClickBehavior: 'emit-node' as const }],
        edges: [],
      }] : []),
    ],
    actions: [],
    unitySceneMappings: SCENE_IDS.map((candidateSceneId) => ({
      sceneId: candidateSceneId,
      mappingVersion: manifestVersion,
      processSteps: [],
      sceneNodeIds: candidateSceneId === sceneId ? [sceneNodeId] : [],
      routeIds: [],
    })),
  }
  const result = TopologyRegistry.create(manifest)
  if (result.status !== 'ready') throw new Error('任务-037测试清单应通过发布校验。')
  return result.registry
}

/** 固定稳定上下文，测试只观察协调器的领域命令，不创建 Pinia（状态管理库）或浏览器对象。 */
function createFacade(overrides: Partial<VisualizationCoordinatorSnapshot> = {}): VisualizationCoordinatorFacade & { submit: ReturnType<typeof vi.fn> } {
  const snapshot: VisualizationCoordinatorSnapshot = {
    stableContext: { sceneId, topologyId, actionId: null, contextRevision: 7 },
    sceneActivationId,
    activeTransitionId: null,
    targetSceneId: null,
    targetTopologyId: null,
    targetActionId: null,
    runtimeStatus: 'ready',
    unityStatus: 'ready',
    topologyStatus: 'ready',
    selectedNodeIds: [],
    selectedRouteIds: [],
    selectedSceneNodeId: null,
    selectionSource: 'system',
    latestDiagnostic: null,
    ...overrides,
  }
  return {
    getSnapshot: () => ({ ...snapshot, stableContext: snapshot.stableContext ? { ...snapshot.stableContext } : null }),
    submit: vi.fn().mockReturnValue({ status: 'accepted', contextRevision: 7 }),
  }
}

/** 当前活动拓扑替身只开放任务-037需要的读取和选择增量接口，避免测试依赖 Canvas（画布）实现。 */
function createTopologyRuntime(activeTopologyId: typeof topologyId = topologyId, includeNode = true): TopologyRuntime & { setSelection: ReturnType<typeof vi.fn> } {
  return {
    getActiveTopology: vi.fn().mockReturnValue({
      sceneId,
      topologyId: activeTopologyId,
      topology: {
        topologyId: activeTopologyId,
        sceneId,
        title: '测试拓扑',
        configVersion: manifestVersion,
        nodes: activeTopologyId === topologyId && includeNode
          ? [{ nodeId, title: '测试燃气轮机', sceneNodeId, iconKey: 'generic-device', x: 50, y: 50, deviceStatus: 'normal', doubleClickBehavior: 'emit-node' }]
          : [],
        edges: [],
      },
    }),
    setSelection: vi.fn(),
  } as unknown as TopologyRuntime & { setSelection: ReturnType<typeof vi.fn> }
}

/** Unity 选择夹具只携带协议已验证的三维节点标识和关联标识，不传对象名称、层级或坐标。 */
function createUnitySelection(
  messageId: string,
  selectedSceneNodeId: string = String(sceneNodeId),
  selectedSceneActivationId: string = String(sceneActivationId),
) {
  return {
    messageId,
    payload: {
      sceneId: String(sceneId),
      sceneNodeId: selectedSceneNodeId,
      sceneActivationId: selectedSceneActivationId,
    },
  }
}

describe('Unity 三维反向选择协调器', () => {
  it('按当前场景与拓扑的显式映射同步二维选择并构造外层事件载荷，不回发聚焦命令', () => {
    const facade = createFacade()
    const runtime = createTopologyRuntime()
    const coordinator = new UnityObjectSelectionCoordinator(createRegistry(), runtime, facade, { now: () => 0 })

    const selected = coordinator.resolve(createUnitySelection('unity-object-select-01'))

    expect(selected).toEqual({
      sceneId,
      sceneNodeId,
      nodeId,
      topologyId,
      contextRevision: 7,
      correlationId: 'unity-selection-1',
    })
    expect(facade.submit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'selection.replace', source: 'unity', nodeIds: [nodeId], sceneNodeId,
    }))
    expect(runtime.setSelection).toHaveBeenCalledWith([nodeId], [])
  })

  it('三维节点不在当前清单映射时只记录受限诊断，不选择同名二维节点或上报外层事件', () => {
    const facade = createFacade()
    const runtime = createTopologyRuntime()
    const coordinator = new UnityObjectSelectionCoordinator(createRegistry(), runtime, facade, { now: () => 0 })

    const selected = coordinator.resolve(createUnitySelection('unity-object-select-unmapped', 'scene-node.unknown'))

    expect(selected).toBeUndefined()
    expect(runtime.setSelection).not.toHaveBeenCalled()
    expect(facade.submit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'diagnostic.record', diagnostic: expect.objectContaining({ code: 'unity.selection.mapping.missing', correlationId: 'unity-selection-1' }),
    }))
  })

  it('同一无映射内层消息只记录一次诊断，重放不能制造诊断洪泛或在后续状态中重试', () => {
    const facade = createFacade()
    const runtime = createTopologyRuntime()
    const coordinator = new UnityObjectSelectionCoordinator(createRegistry(), runtime, facade, { now: () => 0 })
    const unmappedSelection = createUnitySelection('unity-object-select-unmapped-duplicate', 'scene-node.unknown')

    expect(coordinator.resolve(unmappedSelection)).toBeUndefined()
    expect(coordinator.resolve(unmappedSelection)).toBeUndefined()
    expect(runtime.setSelection).not.toHaveBeenCalled()
    expect(facade.submit).toHaveBeenCalledTimes(1)
    expect(facade.submit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'diagnostic.record', diagnostic: expect.objectContaining({ code: 'unity.selection.mapping.missing' }),
    }))
  })

  it('场景切换后的迟到对象选择不能借用新稳定上下文解析同名三维节点', () => {
    const facade = createFacade()
    const runtime = createTopologyRuntime()
    const coordinator = new UnityObjectSelectionCoordinator(createRegistry(), runtime, facade, { now: () => 0 })

    const selected = coordinator.resolve({
      messageId: 'unity-object-select-stale-scene',
      payload: { sceneId: 'wind-power', sceneNodeId: String(sceneNodeId), sceneActivationId: String(sceneActivationId) },
    })

    expect(selected).toBeUndefined()
    expect(runtime.setSelection).not.toHaveBeenCalled()
    expect(facade.submit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'diagnostic.record', diagnostic: expect.objectContaining({ code: 'unity.selection.scene.mismatch' }),
    }))
  })

  it('同名场景往返后的旧物理实例选择必须被阻断，当前实例的新选择仍可同步二维节点', () => {
    const secondGasActivationId = toSceneActivationId('scene-activation.gas-2')
    const facade = createFacade({ sceneActivationId: secondGasActivationId })
    const runtime = createTopologyRuntime()
    const coordinator = new UnityObjectSelectionCoordinator(createRegistry(), runtime, facade, { now: () => 0 })

    // 此消息来自燃气第一次激活实例。场景名称和节点均相同，只有实例标识能证明它已过期。
    expect(coordinator.resolve(createUnitySelection('unity-object-select-aba-old'))).toBeUndefined()
    expect(runtime.setSelection).not.toHaveBeenCalled()
    expect(facade.submit).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'diagnostic.record', diagnostic: expect.objectContaining({ code: 'unity.selection.activation.mismatch' }),
    }))

    const selected = coordinator.resolve(createUnitySelection(
      'unity-object-select-aba-current',
      String(sceneNodeId),
      String(secondGasActivationId),
    ))
    expect(selected).toMatchObject({ nodeId })
    expect(runtime.setSelection).toHaveBeenCalledWith([nodeId], [])
  })

  it('同一 Unity 关联标识只同步一次，浏览器重放不会制造重复二维选择或外层事件', () => {
    const facade = createFacade()
    const runtime = createTopologyRuntime()
    const coordinator = new UnityObjectSelectionCoordinator(createRegistry(), runtime, facade)
    const selection = createUnitySelection('unity-object-select-duplicate')

    expect(coordinator.resolve(selection)).toBeDefined()
    expect(coordinator.resolve(selection)).toBeUndefined()
    expect(runtime.setSelection).toHaveBeenCalledTimes(1)
    expect(facade.submit).toHaveBeenCalledTimes(1)
  })

  it('设备映射未引用当前拓扑时保留诊断，不回退选择默认拓扑或标题相同节点', () => {
    const facade = createFacade()
    const runtime = createTopologyRuntime(topologyId, false)
    const coordinator = new UnityObjectSelectionCoordinator(createRegistry(toTopologyId('topology.gas-power.detail')), runtime, facade, { now: () => 0 })

    const selected = coordinator.resolve(createUnitySelection('unity-object-select-other-topology'))

    expect(selected).toBeUndefined()
    expect(runtime.setSelection).not.toHaveBeenCalled()
    expect(facade.submit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'diagnostic.record', diagnostic: expect.objectContaining({ code: 'unity.selection.current-topology.missing' }),
    }))
  })
})

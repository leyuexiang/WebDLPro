import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  SCENE_IDS,
  toActionId,
  toSceneId,
  toTopologyId,
  toTransitionId,
  toUnityRuntimeKey,
  toUnitySceneKey,
} from '@/config/scene-topology/identifiers'
import { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import type { SceneTopologyManifest } from '@/config/scene-topology/types'
import { createVisualizationCoordinatorFacade } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import { VisualizationCoordinator } from '@/modules/visual/orchestration/visualization-coordinator'
import { useVisualizationStore } from '@/modules/visual/orchestration/visualization.store'
import { TopologyRuntime, type TopologyCanvasPort } from '@/modules/visual/topology/topology-runtime'
import { ViewOpenTransactionHandler, type ViewOpenUnityPort } from '@/modules/visual/orchestration/view-open-transaction-handler'
import { WorkflowTriggerTransactionHandler } from '@/modules/visual/orchestration/workflow-trigger-transaction-handler'

const manifestVersion = 'view-open-test.1'
const gasOverviewTopologyId = toTopologyId('topology.gas.overview')
const gasDetailTopologyId = toTopologyId('topology.gas.detail')
const windOverviewTopologyId = toTopologyId('topology.wind.overview')
const solarOverviewTopologyId = toTopologyId('topology.solar-power.overview')
const windOpenActionId = toActionId('action.wind.open')
const windResetActionId = toActionId('action.wind.reset')

/** 构造九场景原子清单夹具；节点为空，只验证事务顺序和跨引用，不声明真实设备、模型或业务映射。 */
function createManifest(): SceneTopologyManifest {
  const scenes = SCENE_IDS.map((sceneId) => {
    const topologyIds = sceneId === 'gas-power'
      ? [gasOverviewTopologyId, gasDetailTopologyId]
      : [sceneId === 'wind-power' ? windOverviewTopologyId : toTopologyId(`topology.${sceneId}.overview`)]

    return {
      sceneId,
      title: `测试场景-${sceneId}`,
      unitySceneKey: toUnitySceneKey(`scene.${sceneId}`),
      defaultTopologyId: topologyIds[0]!,
      topologyIds,
      supportedActionIds: sceneId === 'wind-power' ? [windOpenActionId, windResetActionId] : [],
      sceneMappingVersion: `mapping.${sceneId}.1`,
      resourceVersion: `resource.${sceneId}.1`,
      switchStrategy: 'unload-first' as const,
    }
  })

  return {
    manifestVersion,
    unityBuildId: 'view-open-build.1',
    unityRuntimeKey: toUnityRuntimeKey('view-open-runtime'),
    scenes,
    topologies: scenes.flatMap((scene) => scene.topologyIds.map((topologyId) => ({
      topologyId,
      sceneId: scene.sceneId,
      title: `测试拓扑-${topologyId}`,
      configVersion: manifestVersion,
      nodes: [],
      edges: [],
    }))),
    actions: [
      {
        actionId: windOpenActionId,
        title: '风电总览动作',
        targetSceneId: toSceneId('wind-power'),
        targetTopologyId: windOverviewTopologyId,
        allowedParameters: [],
        unityAction: { type: 'none' },
        failurePolicy: 'keep-current-context',
        configVersion: manifestVersion,
      },
      {
        actionId: windResetActionId,
        title: '风电重置动作',
        targetSceneId: toSceneId('wind-power'),
        targetTopologyId: windOverviewTopologyId,
        allowedParameters: ['unit-id'],
        // resetScene（重置场景）不引用设备、流程或路径，适合验证可选动作的通用事务顺序。
        unityAction: { type: 'resetScene' },
        failurePolicy: 'keep-current-context',
        configVersion: manifestVersion,
      },
    ],
    deviceMappings: [],
    unitySceneMappings: scenes.map((scene) => ({
      sceneId: scene.sceneId,
      mappingVersion: scene.sceneMappingVersion,
      processSteps: [],
      sceneNodeIds: [],
      routeIds: [],
    })),
  }
}

function createCanvas(): TopologyCanvasPort {
  return {
    setTopology: vi.fn(),
    setSelection: vi.fn(),
    // 状态覆盖独立于原子切换事务；替身保留该端口，确保任务-029扩展不会让旧切换回归绕过类型边界。
    setNodeStatuses: vi.fn(),
    restoreViewState: vi.fn(),
    dispose: vi.fn(),
  }
}

function createUnityPort(): ViewOpenUnityPort {
  return {
    switchScene: vi.fn().mockResolvedValue({ success: true }),
    executeAction: vi.fn().mockResolvedValue({ success: true }),
  }
}

function createHandler(unity = createUnityPort(), manifest: SceneTopologyManifest = createManifest()): {
  handler: ViewOpenTransactionHandler
  registry: TopologyRegistry
  facade: ReturnType<typeof createVisualizationCoordinatorFacade>
  canvas: TopologyCanvasPort
  unity: ViewOpenUnityPort
  store: ReturnType<typeof useVisualizationStore>
  topologyRuntime: TopologyRuntime
} {
  const registryResult = TopologyRegistry.create(manifest)
  if (registryResult.status !== 'ready') throw new Error('事务测试清单必须通过原子校验。')

  const canvas = createCanvas()
  const topologyRuntime = new TopologyRuntime(registryResult.registry, canvas)
  const store = useVisualizationStore()
  const facade = createVisualizationCoordinatorFacade(new VisualizationCoordinator(store))
  const transitionIds = [
    toTransitionId('transition.view-open.1'),
    toTransitionId('transition.view-open.2'),
    toTransitionId('transition.view-open.3'),
  ]
  const handler = new ViewOpenTransactionHandler(
    registryResult.registry,
    topologyRuntime,
    unity,
    facade,
    () => transitionIds.shift() ?? toTransitionId('transition.view-open.fallback'),
  )
  return { handler, registry: registryResult.registry, facade, canvas, unity, store, topologyRuntime }
}

function createViewOpen(sceneId = toSceneId('gas-power'), topologyId = gasOverviewTopologyId, actionId: typeof windOpenActionId | null = null) {
  return {
    type: 'view.open' as const,
    correlationId: 'host-view-open-test',
    payload: { sceneId, topologyId, actionId },
  }
}

beforeEach(() => setActivePinia(createPinia()))

describe('view.open 原子切换事务', () => {
  it('拓扑预解析失败时不切换 Unity、不激活画布，也不创建不稳定上下文', async () => {
    const { handler, canvas, unity, store, topologyRuntime } = createHandler()
    // 使用已登记拓扑后释放运行时，证明失败来自 prepare，而不是场景、拓扑交叉引用的预校验。
    topologyRuntime.dispose()
    const result = await handler.submit(createViewOpen())

    expect(result).toMatchObject({ success: false, status: 'failed', error: { code: 'topology.prepare.failed' } })
    expect(unity.switchScene).not.toHaveBeenCalled()
    expect(canvas.setTopology).not.toHaveBeenCalled()
    expect(store.stableContext).toBeNull()
  })

  it('场景、拓扑与可选动作关系通过校验后，只在全部阶段就绪时提交一次稳定上下文', async () => {
    const { handler, canvas, unity, store } = createHandler()
    const result = await handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId, windResetActionId))

    expect(result).toEqual({ success: true, status: 'completed', transitionId: toTransitionId('transition.view-open.1'), contextRevision: 1 })
    expect(unity.switchScene).toHaveBeenCalledWith(toSceneId('wind-power'), 'mapping.wind-power.1', toTransitionId('transition.view-open.1'))
    expect(unity.executeAction).toHaveBeenCalledWith({ type: 'resetScene' }, windResetActionId, toTransitionId('transition.view-open.1'))
    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('wind-power'), topologyId: windOverviewTopologyId, actionId: windResetActionId, contextRevision: 1 })
  })

  it('同场景切换只激活新拓扑，不重复切换 Unity 业务场景', async () => {
    const { handler, unity, store } = createHandler()
    await handler.submit(createViewOpen())
    const result = await handler.submit(createViewOpen(toSceneId('gas-power'), gasDetailTopologyId))

    expect(result).toMatchObject({ success: true, transitionId: toTransitionId('transition.view-open.2'), contextRevision: 2 })
    expect(unity.switchScene).toHaveBeenCalledTimes(1)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('gas-power'), topologyId: gasDetailTopologyId, actionId: null, contextRevision: 2 })
  })

  it('动作目标与请求场景或拓扑不一致时，在 Unity 切换前结构化拒绝', async () => {
    const { handler, unity } = createHandler()
    const result = await handler.submit(createViewOpen(toSceneId('gas-power'), gasOverviewTopologyId, windOpenActionId))

    expect(result).toMatchObject({ success: false, error: { code: 'action.context.mismatch' } })
    expect(unity.switchScene).not.toHaveBeenCalled()
  })

  it('Unity 切换失败时恢复上一个稳定上下文，且不激活新拓扑', async () => {
    const unity = createUnityPort()
    const { handler, canvas, store } = createHandler(unity)
    await handler.submit(createViewOpen())
    vi.mocked(unity.switchScene).mockResolvedValueOnce({ success: false, errorCode: 'scene.switch.failed' })
    const result = await handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))

    expect(result).toMatchObject({ success: false, error: { code: 'scene.switch.failed' } })
    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('gas-power'), topologyId: gasOverviewTopologyId, actionId: null, contextRevision: 1 })
    expect(store.runtimeStatus).toBe('ready')
  })

  it('新事务完成后，旧场景切换回调只能返回已取代，不能覆盖最后稳定上下文', async () => {
    const unity = createUnityPort()
    let resolveFirstSwitch: ((result: { success: boolean }) => void) | undefined
    vi.mocked(unity.switchScene)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstSwitch = resolve }))
      .mockResolvedValueOnce({ success: true })
    const { handler, canvas, store } = createHandler(unity)

    const first = handler.submit(createViewOpen(toSceneId('gas-power'), gasOverviewTopologyId))
    // 首次请求停在 Unity 切换阶段；第二次请求创建新事务并先完成稳定提交。
    const second = await handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))
    resolveFirstSwitch?.({ success: true })
    const firstResult = await first

    expect(second).toMatchObject({ success: true, transitionId: toTransitionId('transition.view-open.2'), contextRevision: 1 })
    expect(firstResult).toMatchObject({ success: false, status: 'superseded', transitionId: toTransitionId('transition.view-open.1') })
    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('wind-power'), topologyId: windOverviewTopologyId, actionId: null, contextRevision: 1 })
  })

  it('连续三个切换只允许最后一个事务激活画布并提交稳定上下文', async () => {
    const unity = createUnityPort()
    let resolveFirstSwitch: ((result: { success: boolean }) => void) | undefined
    let resolveSecondSwitch: ((result: { success: boolean }) => void) | undefined
    vi.mocked(unity.switchScene)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstSwitch = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecondSwitch = resolve }))
      .mockResolvedValueOnce({ success: true })
    const { handler, canvas, store } = createHandler(unity)

    const first = handler.submit(createViewOpen(toSceneId('gas-power'), gasOverviewTopologyId))
    const second = handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))
    const third = await handler.submit(createViewOpen(toSceneId('solar-power'), solarOverviewTopologyId))
    resolveSecondSwitch?.({ success: true })
    resolveFirstSwitch?.({ success: true })

    await expect(first).resolves.toMatchObject({ success: false, status: 'superseded', transitionId: toTransitionId('transition.view-open.1') })
    await expect(second).resolves.toMatchObject({ success: false, status: 'superseded', transitionId: toTransitionId('transition.view-open.2') })
    expect(third).toMatchObject({ success: true, status: 'completed', transitionId: toTransitionId('transition.view-open.3'), contextRevision: 1 })
    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('solar-power'), topologyId: solarOverviewTopologyId, actionId: null, contextRevision: 1 })
  })

  it('目标动作失败后回切三维与单画布，再恢复上一稳定上下文', async () => {
    const unity = createUnityPort()
    vi.mocked(unity.switchScene)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
    vi.mocked(unity.executeAction).mockResolvedValueOnce({ success: false, errorCode: 'action.execute.failed' })
    const { handler, canvas, store } = createHandler(unity)

    await handler.submit(createViewOpen())
    const result = await handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId, windResetActionId))

    expect(result).toMatchObject({ success: false, status: 'failed', error: { code: 'action.execute.failed', recoverable: true } })
    expect(unity.switchScene).toHaveBeenLastCalledWith(toSceneId('gas-power'), 'mapping.gas-power.1', toTransitionId('transition.view-open.2'))
    expect(canvas.setTopology).toHaveBeenCalledTimes(2)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('gas-power'), topologyId: gasOverviewTopologyId, actionId: null, contextRevision: 1 })
    expect(store.runtimeStatus).toBe('ready')
  })

  it('动作阶段被新事务取代后，迟到动作结果不能覆盖最后一个场景与拓扑', async () => {
    const unity = createUnityPort()
    let resolveDelayedAction: ((result: { success: boolean }) => void) | undefined
    vi.mocked(unity.executeAction).mockImplementationOnce(() => new Promise((resolve) => { resolveDelayedAction = resolve }))
    const { handler, canvas, store } = createHandler(unity)

    await handler.submit(createViewOpen())
    const actionTransition = handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId, windResetActionId))
    // 第二个事务已进入动作等待后，第三个事务获得唯一提交权并完整激活。
    await Promise.resolve()
    const finalTransition = await handler.submit(createViewOpen(toSceneId('solar-power'), solarOverviewTopologyId))
    resolveDelayedAction?.({ success: true })

    await expect(actionTransition).resolves.toMatchObject({ success: false, status: 'superseded', transitionId: toTransitionId('transition.view-open.2') })
    expect(finalTransition).toMatchObject({ success: true, transitionId: toTransitionId('transition.view-open.3'), contextRevision: 2 })
    expect(canvas.setTopology).toHaveBeenCalledTimes(2)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('solar-power'), topologyId: solarOverviewTopologyId, actionId: null, contextRevision: 2 })
  })

  it('物理回退失败时清空稳定上下文并进入明确错误态', async () => {
    const unity = createUnityPort()
    vi.mocked(unity.switchScene)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, errorCode: 'scene.switch.failed' })
    vi.mocked(unity.executeAction).mockResolvedValueOnce({ success: false, errorCode: 'action.execute.failed' })
    const { handler, store } = createHandler(unity)

    await handler.submit(createViewOpen())
    const result = await handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId, windResetActionId))

    expect(result).toMatchObject({ success: false, status: 'failed', error: { code: 'action.execute.failed', recoverable: false } })
    expect(store.stableContext).toBeNull()
    expect(store.runtimeStatus).toBe('error')
    expect(store.unityStatus).toBe('failed')
    expect(store.topologyStatus).toBe('failed')
  })

  it('同场景流程触发复用原子事务，不切换或释放 Unity，并提交动作映射拓扑', async () => {
    const { handler, registry, facade, unity, store } = createHandler()
    const workflow = new WorkflowTriggerTransactionHandler(registry, handler, facade)
    await handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))

    const result = await workflow.submit({
      type: 'workflow.trigger',
      correlationId: 'workflow-trigger-same-scene',
      payload: { actionId: windResetActionId, expectedContextRevision: 1 },
    })

    expect(result).toMatchObject({ success: true, status: 'completed', contextRevision: 2 })
    expect(unity.switchScene).toHaveBeenCalledTimes(1)
    expect(unity.executeAction).toHaveBeenLastCalledWith({ type: 'resetScene' }, windResetActionId, toTransitionId('transition.view-open.2'))
    expect(store.stableContext).toEqual({ sceneId: toSceneId('wind-power'), topologyId: windOverviewTopologyId, actionId: windResetActionId, contextRevision: 2 })
  })

  it('跨场景流程动作先切换目标场景、等待就绪并执行动作，最后才提交目标拓扑', async () => {
    const { handler, registry, facade, unity, canvas, store } = createHandler()
    const workflow = new WorkflowTriggerTransactionHandler(registry, handler, facade, 'cross-scene')
    await handler.submit(createViewOpen(toSceneId('gas-power'), gasOverviewTopologyId))

    const result = await workflow.submit({
      type: 'workflow.trigger',
      correlationId: 'workflow-trigger-cross-scene',
      payload: { actionId: windResetActionId, expectedContextRevision: 1 },
    })

    expect(result).toMatchObject({ success: true, status: 'completed', contextRevision: 2 })
    expect(unity.switchScene).toHaveBeenLastCalledWith(toSceneId('wind-power'), 'mapping.wind-power.1', toTransitionId('transition.view-open.2'))
    expect(unity.executeAction).toHaveBeenLastCalledWith({ type: 'resetScene' }, windResetActionId, toTransitionId('transition.view-open.2'))
    expect(vi.mocked(unity.switchScene).mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(unity.executeAction).mock.invocationCallOrder[0]!)
    expect(canvas.setTopology).toHaveBeenCalledTimes(2)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('wind-power'), topologyId: windOverviewTopologyId, actionId: windResetActionId, contextRevision: 2 })
  })

  it('同场景动作失败默认保持上一稳定上下文，不激活或提交新拓扑', async () => {
    const unity = createUnityPort()
    vi.mocked(unity.executeAction).mockResolvedValueOnce({ success: false, errorCode: 'action.execute.failed' })
    const { handler, registry, facade, canvas, store } = createHandler(unity)
    const workflow = new WorkflowTriggerTransactionHandler(registry, handler, facade)
    await handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))

    const result = await workflow.submit({
      type: 'workflow.trigger',
      correlationId: 'workflow-trigger-failed',
      payload: { actionId: windResetActionId },
    })

    expect(result).toMatchObject({ success: false, status: 'failed', error: { code: 'action.execute.failed' } })
    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('wind-power'), topologyId: windOverviewTopologyId, actionId: null, contextRevision: 1 })
    expect(store.runtimeStatus).toBe('ready')
  })

  it('清单显式允许带警告提交时，同场景动作失败仍可激活映射拓扑并保留受控诊断', async () => {
    const unity = createUnityPort()
    vi.mocked(unity.executeAction).mockResolvedValueOnce({ success: false, errorCode: 'action.execute.failed' })
    const manifest = createManifest()
    const warningManifest: SceneTopologyManifest = {
      ...manifest,
      actions: manifest.actions.map((action) => action.actionId === windResetActionId
        ? { ...action, failurePolicy: 'commit-view-with-warning' as const }
        : action),
    }
    const { handler, registry, facade, canvas, store } = createHandler(unity, warningManifest)
    const workflow = new WorkflowTriggerTransactionHandler(registry, handler, facade)
    await handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))

    const result = await workflow.submit({
      type: 'workflow.trigger',
      correlationId: 'workflow-trigger-warning',
      payload: { actionId: windResetActionId },
    })

    expect(result).toMatchObject({ success: true, status: 'completed', contextRevision: 2 })
    expect(canvas.setTopology).toHaveBeenCalledTimes(2)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('wind-power'), topologyId: windOverviewTopologyId, actionId: windResetActionId, contextRevision: 2 })
    expect(store.latestDiagnostic?.code).toBe('action.execute.failed')
  })

  it('流程参数缺少显式 Unity 字段映射时拒绝，不会静默忽略参数或调用动作端口', async () => {
    const { handler, registry, facade, unity } = createHandler()
    const workflow = new WorkflowTriggerTransactionHandler(registry, handler, facade)
    await handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))

    const result = await workflow.submit({
      type: 'workflow.trigger',
      correlationId: 'workflow-trigger-parameter',
      payload: { actionId: windResetActionId, parameters: { 'unit-id': 'unit-01' } },
    })

    expect(result).toMatchObject({ success: false, error: { code: 'action.execute.failed' } })
    expect(unity.executeAction).not.toHaveBeenCalled()
  })
})

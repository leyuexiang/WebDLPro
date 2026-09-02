import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  OVERVIEW_SCENE_ID,
  SCENE_IDS,
  toActionId,
  toSceneActivationId,
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
import { getVisualizationTransitionOverlayState } from '@/modules/visual/orchestration/visualization-transition-overlay'
import { useVisualizationStore } from '@/modules/visual/orchestration/visualization.store'
import { TopologyRuntime, type TopologyCanvasPort } from '@/modules/visual/topology/topology-runtime'
import { ViewOpenTransactionHandler, type ViewOpenUnityPort } from '@/modules/visual/orchestration/view-open-transaction-handler'
import { WorkflowTriggerTransactionHandler } from '@/modules/visual/orchestration/workflow-trigger-transaction-handler'

const manifestVersion = 'view-open-test.1'
const gasOverviewTopologyId = toTopologyId('topology.gas.overview')
const gasDetailTopologyId = toTopologyId('topology.gas.detail')
const windOverviewTopologyId = toTopologyId('topology.wind.overview')
const windDetailTopologyId = toTopologyId('topology.wind.detail')
const solarOverviewTopologyId = toTopologyId('topology.solar-power.overview')
const windOpenActionId = toActionId('action.wind.open')
const windResetActionId = toActionId('action.wind.reset')

/** 构造九场景原子清单夹具；节点为空，只验证事务顺序和跨引用，不声明真实设备、模型或业务映射。 */
function createManifest(): SceneTopologyManifest {
  const scenes = SCENE_IDS.map((sceneId) => {
    const topologyIds = sceneId === 'gas-power'
      ? [gasOverviewTopologyId, gasDetailTopologyId]
      : [sceneId === 'wind-power'
        ? windOverviewTopologyId
        : toTopologyId(`topology.${sceneId}.overview`)]

    if (sceneId === 'wind-power') topologyIds.push(windDetailTopologyId)

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
        targetViewMode: 'business',
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
        targetViewMode: 'business',
        targetTopologyId: windDetailTopologyId,
        allowedParameters: ['unit-id'],
        // resetScene（重置场景）不引用设备、流程或路径，适合验证可选动作的通用事务顺序。
        unityAction: { type: 'resetScene' },
        failurePolicy: 'keep-current-context',
        configVersion: manifestVersion,
      },
    ],
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
    // 原子切换会在替换拓扑前读取唯一画布的视口；默认 undefined 表示测试未模拟用户缩放或平移，运行时应回退缓存或默认视图。
    getViewState: vi.fn().mockReturnValue(undefined),
    restoreViewState: vi.fn(),
    dispose: vi.fn(),
  }
}

/** 每次模拟真实 Unity 场景提交都提供独立实例标识；动作回执不使用该工厂。 */
function createSceneSwitchSuccess(activationId = 'scene-activation.test'): { success: true; sceneActivationId: ReturnType<typeof toSceneActivationId> } {
  return { success: true, sceneActivationId: toSceneActivationId(activationId) }
}

function createUnityPort(): ViewOpenUnityPort {
  return {
    // 默认结果用调用方事务生成不同测试实例，避免把多个物理场景提交错误压成同一个选择上下文。
    switchScene: vi.fn().mockImplementation((_sceneId, _mappingVersion, transitionId) => Promise.resolve(
      createSceneSwitchSuccess(`scene-activation.${String(transitionId)}`),
    )),
    executeAction: vi.fn().mockResolvedValue({ success: true }),
  }
}

function createHandler(
  unity = createUnityPort(),
  manifest: SceneTopologyManifest = createManifest(),
  onPhysicalRuntimeRecovered: (sceneActivationId?: ReturnType<typeof toSceneActivationId>) => void = () => undefined,
): {
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
    'mapping.runtime.test.1',
    () => transitionIds.shift() ?? toTransitionId('transition.view-open.fallback'),
    onPhysicalRuntimeRecovered,
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
    expect(store.activeTransitionId).toBeNull()
    expect(store.runtimeStatus).toBe('idle')
    expect(store.contextRevision).toBe(0)
  })

  it('场景、拓扑与可选动作关系通过校验后，只在全部阶段就绪时提交一次稳定上下文', async () => {
    const { handler, canvas, unity, store } = createHandler()
    const result = await handler.submit(createViewOpen(toSceneId('wind-power'), windDetailTopologyId, windResetActionId))

    expect(result).toEqual({ success: true, status: 'completed', transitionId: toTransitionId('transition.view-open.1'), contextRevision: 1 })
    expect(unity.switchScene).toHaveBeenCalledWith(toSceneId('wind-power'), 'mapping.wind-power.1', toTransitionId('transition.view-open.1'))
    expect(unity.executeAction).toHaveBeenCalledWith({ type: 'resetScene' }, windResetActionId, toTransitionId('transition.view-open.1'))
    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    // 直接锁定原始验收顺序：Unity 场景成功后才执行动作，动作完成后才允许唯一画布激活目标拓扑。
    expect(vi.mocked(unity.switchScene).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(unity.executeAction).mock.invocationCallOrder[0]!)
    expect(vi.mocked(unity.executeAction).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(canvas.setTopology).mock.invocationCallOrder[0]!)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('wind-power'), topologyId: windDetailTopologyId, actionId: windResetActionId, contextRevision: 1 })
    expect(store.sceneActivationId).toEqual(toSceneActivationId('scene-activation.transition.view-open.1'))
    expect(store.contextRevision).toBe(1)
  })

  it('跨场景事务等待 Unity 时由同一协调器快照持续显示统一遮罩，提交后立即解除', async () => {
    const unity = createUnityPort()
    let resolveSwitch: ((result: { success: boolean }) => void) | undefined
    vi.mocked(unity.switchScene).mockImplementationOnce(() => new Promise((resolve) => { resolveSwitch = resolve }))
    const { handler, facade, canvas, store } = createHandler(unity)

    const pending = handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))

    /*
     * 遮罩模型必须直接消费本次活动事务快照。等待 Unity 时不提前激活拓扑或递增版本，
     * 从而保证页面只能看到上一稳定视图或统一遮罩，不能操作“新场景 + 旧拓扑”等混合状态。
     */
    expect(getVisualizationTransitionOverlayState(facade.getSnapshot())).toEqual({
      visible: true,
    })
    // switchScene 的 Promise 代表连接器已等待同一 requestId 的最终 sceneChanged，尚未结算前不得提前下发动作。
    expect(unity.executeAction).not.toHaveBeenCalled()
    expect(canvas.setTopology).not.toHaveBeenCalled()
    expect(store.stableContext).toBeNull()
    expect(store.contextRevision).toBe(0)

    resolveSwitch?.(createSceneSwitchSuccess('scene-activation.waiting'))
    await expect(pending).resolves.toMatchObject({ success: true, status: 'completed', contextRevision: 1 })

    expect(getVisualizationTransitionOverlayState(facade.getSnapshot())).toEqual({ visible: false })
    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    expect(store.contextRevision).toBe(1)
  })

  it('跨场景动作尚未完成时持续阻断交互，不激活目标拓扑或提交新稳定上下文', async () => {
    const unity = createUnityPort()
    let resolveAction: ((result: { success: boolean }) => void) | undefined
    vi.mocked(unity.executeAction).mockImplementationOnce(() => new Promise((resolve) => { resolveAction = resolve }))
    const { handler, facade, canvas, store } = createHandler(unity)
    await handler.submit(createViewOpen(toSceneId('gas-power'), gasOverviewTopologyId))

    const pending = handler.submit(createViewOpen(toSceneId('wind-power'), windDetailTopologyId, windResetActionId))
    // 让已成功的 switchScene 推进到动作等待点；此时物理 Unity 已是目标场景，但稳定上下文仍必须保留燃气。
    await Promise.resolve()

    expect(unity.executeAction).toHaveBeenCalledWith({ type: 'resetScene' }, windResetActionId, toTransitionId('transition.view-open.2'))
    expect(getVisualizationTransitionOverlayState(facade.getSnapshot()).visible).toBe(true)
    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('gas-power'), topologyId: gasOverviewTopologyId, actionId: null, contextRevision: 1 })
    expect(store.contextRevision).toBe(1)

    resolveAction?.({ success: true })
    await expect(pending).resolves.toMatchObject({ success: true, status: 'completed', contextRevision: 2 })
    expect(canvas.setTopology).toHaveBeenCalledTimes(2)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('wind-power'), topologyId: windDetailTopologyId, actionId: windResetActionId, contextRevision: 2 })
  })

  it('业务场景切入平台总览后停用单画布并省略稳定拓扑，再由业务命令复用画布恢复', async () => {
    const { handler, unity, canvas, store, topologyRuntime } = createHandler()
    await handler.submit(createViewOpen())
    topologyRuntime.setSelection([], [])
    const overviewResult = await handler.submit({
      type: 'view.open',
      correlationId: 'host-view-open-overview',
      payload: { sceneId: OVERVIEW_SCENE_ID },
    })

    expect(overviewResult).toMatchObject({ success: true, status: 'completed', contextRevision: 2 })
    expect(unity.switchScene).toHaveBeenLastCalledWith(OVERVIEW_SCENE_ID, 'mapping.runtime.test.1', toTransitionId('transition.view-open.2'))
    expect(topologyRuntime.getActiveTopology()).toBeUndefined()
    expect(store.stableContext).toEqual({ sceneId: OVERVIEW_SCENE_ID, actionId: null, contextRevision: 2 })
    expect(store.topologyStatus).toBe('idle')
    expect(store.selectedNodeIds).toEqual([])
    expect(canvas.dispose).not.toHaveBeenCalled()

    const businessResult = await handler.submit(createViewOpen(toSceneId('gas-power'), gasDetailTopologyId))
    expect(businessResult).toMatchObject({ success: true, status: 'completed', contextRevision: 3 })
    expect(topologyRuntime.getActiveTopology()?.topologyId).toBe(gasDetailTopologyId)
    expect(canvas.dispose).not.toHaveBeenCalled()
  })

  it('同场景切换只激活新拓扑，不重复切换 Unity 业务场景', async () => {
    const { handler, unity, store } = createHandler()
    await handler.submit(createViewOpen())
    const result = await handler.submit(createViewOpen(toSceneId('gas-power'), gasDetailTopologyId))

    expect(result).toMatchObject({ success: true, transitionId: toTransitionId('transition.view-open.2'), contextRevision: 2 })
    expect(unity.switchScene).toHaveBeenCalledTimes(1)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('gas-power'), topologyId: gasDetailTopologyId, actionId: null, contextRevision: 2 })
    // 明细拓扑复用同一个物理燃气场景；若这里改写实例标识，先前的真实 Unity 选择会被误判为迟到。
    expect(store.sceneActivationId).toEqual(toSceneActivationId('scene-activation.transition.view-open.1'))
  })

  it('动作目标与请求场景或拓扑不一致时，在 Unity 切换前结构化拒绝', async () => {
    const { handler, unity } = createHandler()
    const result = await handler.submit(createViewOpen(toSceneId('gas-power'), gasOverviewTopologyId, windOpenActionId))

    expect(result).toMatchObject({ success: false, error: { code: 'action.context.mismatch' } })
    expect(unity.switchScene).not.toHaveBeenCalled()
  })

  it('Unity 切换失败时恢复上一个稳定上下文，且不激活新拓扑', async () => {
    const unity = createUnityPort()
    const onPhysicalRuntimeRecovered = vi.fn()
    const { handler, canvas, store } = createHandler(unity, createManifest(), onPhysicalRuntimeRecovered)
    await handler.submit(createViewOpen())
    const initialSceneActivationId = store.sceneActivationId
    vi.mocked(unity.switchScene).mockResolvedValueOnce({
      success: false,
      errorCode: 'scene.switch.failed',
      // Unity 已在同一失败事务内部恢复燃气场景，因此该标识属于新的物理实例而不是失败目标场景。
      sceneActivationId: toSceneActivationId('scene-activation.gas-restored'),
    })
    const result = await handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))

    expect(result).toMatchObject({ success: false, error: { code: 'scene.switch.failed' } })
    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('gas-power'), topologyId: gasOverviewTopologyId, actionId: null, contextRevision: 1 })
    expect(store.runtimeStatus).toBe('ready')
    expect(store.sceneActivationId).not.toEqual(initialSceneActivationId)
    expect(store.sceneActivationId).toEqual(toSceneActivationId('scene-activation.gas-restored'))
    // Unity 在失败内部重新创建了燃气实例；恢复回调只重放权威快照，不改变二维稳定上下文或外层失败结果。
    expect(onPhysicalRuntimeRecovered).toHaveBeenCalledWith(toSceneActivationId('scene-activation.gas-restored'))
  })

  it('恢复快照回调抛错时仍保持已恢复的二维稳定上下文和外层失败语义', async () => {
    const unity = createUnityPort()
    const onPhysicalRuntimeRecovered = vi.fn(() => {
      throw new Error('模拟内部三维重投影端口异常')
    })
    const { handler, canvas, store } = createHandler(unity, createManifest(), onPhysicalRuntimeRecovered)
    await handler.submit(createViewOpen())
    vi.mocked(unity.switchScene).mockResolvedValueOnce({
      success: false,
      errorCode: 'scene.switch.failed',
      sceneActivationId: toSceneActivationId('scene-activation.gas-restored-callback-error'),
    })

    const result = await handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))

    expect(result).toMatchObject({ success: false, status: 'failed', error: { code: 'scene.switch.failed', recoverable: true } })
    expect(onPhysicalRuntimeRecovered).toHaveBeenCalledTimes(1)
    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('gas-power'), topologyId: gasOverviewTopologyId, actionId: null, contextRevision: 1 })
    expect(store.sceneActivationId).toEqual(toSceneActivationId('scene-activation.gas-restored-callback-error'))
  })

  it('新事务完成后，旧场景切换回调只能返回已取代，不能覆盖最后稳定上下文', async () => {
    const unity = createUnityPort()
    let resolveFirstSwitch: ((result: { success: boolean }) => void) | undefined
    vi.mocked(unity.switchScene)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstSwitch = resolve }))
      .mockResolvedValueOnce(createSceneSwitchSuccess('scene-activation.second'))
    const { handler, canvas, store } = createHandler(unity)

    const first = handler.submit(createViewOpen(toSceneId('gas-power'), gasOverviewTopologyId))
    // 首次请求停在 Unity 切换阶段；第二次请求创建新事务并先完成稳定提交。
    const second = await handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))
    resolveFirstSwitch?.(createSceneSwitchSuccess('scene-activation.first'))
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
      .mockResolvedValueOnce(createSceneSwitchSuccess('scene-activation.second'))
    const { handler, canvas, store } = createHandler(unity)

    const first = handler.submit(createViewOpen(toSceneId('gas-power'), gasOverviewTopologyId))
    const second = handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))
    const third = await handler.submit(createViewOpen(toSceneId('solar-power'), solarOverviewTopologyId))
    resolveSecondSwitch?.(createSceneSwitchSuccess('scene-activation.second'))
    resolveFirstSwitch?.(createSceneSwitchSuccess('scene-activation.first'))

    await expect(first).resolves.toMatchObject({ success: false, status: 'superseded', transitionId: toTransitionId('transition.view-open.1') })
    await expect(second).resolves.toMatchObject({ success: false, status: 'superseded', transitionId: toTransitionId('transition.view-open.2') })
    expect(third).toMatchObject({ success: true, status: 'completed', transitionId: toTransitionId('transition.view-open.3'), contextRevision: 1 })
    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('solar-power'), topologyId: solarOverviewTopologyId, actionId: null, contextRevision: 1 })
  })

  it('外层超时后未发送新命令时，迟到的目标场景成功只能触发补偿恢复，不能提交旧目标', async () => {
    const unity = createUnityPort()
    let resolveLateTargetSwitch: ((result: { success: boolean }) => void) | undefined
    const onPhysicalRuntimeRecovered = vi.fn()
    const { handler, canvas, store } = createHandler(unity, createManifest(), onPhysicalRuntimeRecovered)

    await handler.submit(createViewOpen())
    vi.mocked(unity.switchScene).mockImplementationOnce(() => new Promise((resolve) => { resolveLateTargetSwitch = resolve }))
    const timedOutTransition = handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))
    await Promise.resolve()
    handler.cancelTimedOutCommand('host-view-open-test')
    // 补偿切换使用新事务标识，先把旧 Unity 请求废弃，再回到燃气稳定场景。
    await Promise.resolve()
    await Promise.resolve()

    expect(unity.switchScene).toHaveBeenCalledTimes(3)
    expect(unity.switchScene).toHaveBeenLastCalledWith(
      toSceneId('gas-power'),
      'mapping.gas-power.1',
      toTransitionId('transition.view-open.3'),
      true,
    )
    expect(store.stableContext).toEqual({ sceneId: toSceneId('gas-power'), topologyId: gasOverviewTopologyId, actionId: null, contextRevision: 1 })
    expect(store.runtimeStatus).toBe('ready')
    expect(canvas.setTopology).toHaveBeenCalledTimes(2)
    expect(store.recentTransitionSummaries.slice(-2)).toEqual([
      expect.objectContaining({ transitionId: toTransitionId('transition.view-open.2'), outcome: 'superseded' }),
      expect.objectContaining({ transitionId: toTransitionId('transition.view-open.3'), outcome: 'recovered', diagnosticCode: 'command.timeout' }),
    ])
    expect(onPhysicalRuntimeRecovered).toHaveBeenCalledWith(toSceneActivationId('scene-activation.transition.view-open.3'))

    resolveLateTargetSwitch?.(createSceneSwitchSuccess('scene-activation.late-target'))
    await expect(timedOutTransition).resolves.toMatchObject({ success: false, status: 'superseded', transitionId: toTransitionId('transition.view-open.2') })
    // 超时后的迟到 sceneChanged（场景完成）绝不能激活风电拓扑、递增版本或覆盖补偿后的燃气上下文。
    expect(canvas.setTopology).toHaveBeenCalledTimes(2)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('gas-power'), topologyId: gasOverviewTopologyId, actionId: null, contextRevision: 1 })
  })

  it('目标场景已就绪但动作迟到超时时，必须补偿回切并保持上一稳定上下文', async () => {
    const unity = createUnityPort()
    let resolveLateAction: ((result: { success: boolean }) => void) | undefined
    vi.mocked(unity.executeAction).mockImplementationOnce(() => new Promise((resolve) => { resolveLateAction = resolve }))
    const onPhysicalRuntimeRecovered = vi.fn()
    const { handler, canvas, store } = createHandler(unity, createManifest(), onPhysicalRuntimeRecovered)

    await handler.submit(createViewOpen())
    const timedOutTransition = handler.submit(createViewOpen(toSceneId('wind-power'), windDetailTopologyId, windResetActionId))
    await Promise.resolve()
    expect(unity.executeAction).toHaveBeenCalledTimes(1)

    handler.cancelTimedOutCommand('host-view-open-test')
    await Promise.resolve()
    await Promise.resolve()

    // 初始燃气、目标风电、超时补偿燃气各一次；补偿不重放任何旧动作，也不提交新上下文版本。
    expect(unity.switchScene).toHaveBeenCalledTimes(3)
    expect(unity.switchScene).toHaveBeenLastCalledWith(
      toSceneId('gas-power'),
      'mapping.gas-power.1',
      toTransitionId('transition.view-open.3'),
      true,
    )
    expect(unity.executeAction).toHaveBeenCalledTimes(1)
    expect(canvas.setTopology).toHaveBeenCalledTimes(2)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('gas-power'), topologyId: gasOverviewTopologyId, actionId: null, contextRevision: 1 })
    expect(onPhysicalRuntimeRecovered).toHaveBeenCalledWith(toSceneActivationId('scene-activation.transition.view-open.3'))

    resolveLateAction?.({ success: true })
    await expect(timedOutTransition).resolves.toMatchObject({ success: false, status: 'superseded', transitionId: toTransitionId('transition.view-open.2') })
    expect(canvas.setTopology).toHaveBeenCalledTimes(2)
    expect(store.contextRevision).toBe(1)
  })

  it('超时补偿尚未完成时进入新请求，旧补偿与旧目标的迟到结果均不能反向覆盖新场景', async () => {
    const unity = createUnityPort()
    let resolveLateTargetSwitch: ((result: { success: boolean }) => void) | undefined
    let resolveLateRecoverySwitch: ((result: { success: boolean }) => void) | undefined
    const { handler, canvas, store } = createHandler(unity)

    await handler.submit(createViewOpen())
    vi.mocked(unity.switchScene)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveLateTargetSwitch = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveLateRecoverySwitch = resolve }))
    const timedOutTransition = handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))
    await Promise.resolve()
    handler.cancelTimedOutCommand('host-view-open-test')
    await Promise.resolve()
    const latestTransition = await handler.submit(createViewOpen(toSceneId('solar-power'), solarOverviewTopologyId))

    resolveLateRecoverySwitch?.(createSceneSwitchSuccess('scene-activation.recovery'))
    resolveLateTargetSwitch?.(createSceneSwitchSuccess('scene-activation.late-target'))
    await expect(timedOutTransition).resolves.toMatchObject({ success: false, status: 'superseded', transitionId: toTransitionId('transition.view-open.2') })

    expect(latestTransition).toMatchObject({ success: true, status: 'completed', contextRevision: 2 })
    expect(canvas.setTopology).toHaveBeenCalledTimes(2)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('solar-power'), topologyId: solarOverviewTopologyId, actionId: null, contextRevision: 2 })
  })

  it('目标动作失败后回切三维与单画布，再恢复上一稳定上下文', async () => {
    const unity = createUnityPort()
    vi.mocked(unity.switchScene)
      .mockResolvedValueOnce(createSceneSwitchSuccess('scene-activation.initial'))
      .mockResolvedValueOnce(createSceneSwitchSuccess('scene-activation.target'))
      .mockResolvedValueOnce(createSceneSwitchSuccess('scene-activation.recovery'))
    vi.mocked(unity.executeAction).mockResolvedValueOnce({ success: false, errorCode: 'action.execute.failed' })
    const onPhysicalRuntimeRecovered = vi.fn()
    const { handler, canvas, store } = createHandler(unity, createManifest(), onPhysicalRuntimeRecovered)

    await handler.submit(createViewOpen())
    const result = await handler.submit(createViewOpen(toSceneId('wind-power'), windDetailTopologyId, windResetActionId))

    expect(result).toMatchObject({ success: false, status: 'failed', error: { code: 'action.execute.failed', recoverable: true } })
    expect(unity.switchScene).toHaveBeenLastCalledWith(toSceneId('gas-power'), 'mapping.gas-power.1', toTransitionId('transition.view-open.2'))
    expect(canvas.setTopology).toHaveBeenCalledTimes(2)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('gas-power'), topologyId: gasOverviewTopologyId, actionId: null, contextRevision: 1 })
    expect(store.runtimeStatus).toBe('ready')
    expect(onPhysicalRuntimeRecovered).toHaveBeenCalledWith(toSceneActivationId('scene-activation.recovery'))
  })

  it('动作阶段被新事务取代后，迟到动作结果不能覆盖最后一个场景与拓扑', async () => {
    const unity = createUnityPort()
    let resolveDelayedAction: ((result: { success: boolean }) => void) | undefined
    vi.mocked(unity.executeAction).mockImplementationOnce(() => new Promise((resolve) => { resolveDelayedAction = resolve }))
    const { handler, canvas, store } = createHandler(unity)

    await handler.submit(createViewOpen())
    const actionTransition = handler.submit(createViewOpen(toSceneId('wind-power'), windDetailTopologyId, windResetActionId))
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
      .mockResolvedValueOnce(createSceneSwitchSuccess('scene-activation.initial'))
      .mockResolvedValueOnce(createSceneSwitchSuccess('scene-activation.target'))
      .mockResolvedValueOnce({ success: false, errorCode: 'scene.switch.failed' })
    vi.mocked(unity.executeAction).mockResolvedValueOnce({ success: false, errorCode: 'action.execute.failed' })
    const { handler, store } = createHandler(unity)

    await handler.submit(createViewOpen())
    const result = await handler.submit(createViewOpen(toSceneId('wind-power'), windDetailTopologyId, windResetActionId))

    expect(result).toMatchObject({ success: false, status: 'failed', error: { code: 'action.execute.failed', recoverable: false } })
    expect(store.stableContext).toBeNull()
    expect(store.runtimeStatus).toBe('error')
    expect(store.unityStatus).toBe('failed')
    expect(store.topologyStatus).toBe('failed')
  })

  it('同场景流程触发复用原子事务，不切换或释放 Unity，并提交动作映射明细拓扑', async () => {
    const { handler, registry, facade, unity, canvas, store } = createHandler()
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
    // 同场景总览→明细必须先完成受控动作，才激活另一张映射拓扑；不会新增 Unity 场景切换。
    expect(canvas.setTopology).toHaveBeenCalledTimes(2)
    expect(vi.mocked(unity.executeAction).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(canvas.setTopology).mock.invocationCallOrder[1]!)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('wind-power'), topologyId: windDetailTopologyId, actionId: windResetActionId, contextRevision: 2 })
  })

  it('同场景的无 Unity 动作映射不发送切场景或动作命令，仍只提交一次映射上下文', async () => {
    const { handler, registry, facade, unity, canvas, store } = createHandler()
    const workflow = new WorkflowTriggerTransactionHandler(registry, handler, facade)
    await handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))

    const result = await workflow.submit({
      type: 'workflow.trigger',
      correlationId: 'workflow-trigger-no-unity-action',
      payload: { actionId: windOpenActionId, expectedContextRevision: 1 },
    })

    /*
     * `none` 是清单明确声明的可选动作，不是遗漏动作。处理器仍需经过同一原子提交，
     * 但不得为此重建 Unity 场景、发送空命令或重复下载运行包。
     */
    expect(result).toMatchObject({ success: true, status: 'completed', contextRevision: 2 })
    expect(unity.switchScene).toHaveBeenCalledTimes(1)
    expect(unity.executeAction).not.toHaveBeenCalled()
    expect(canvas.setTopology).toHaveBeenCalledTimes(2)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('wind-power'), topologyId: windOverviewTopologyId, actionId: windOpenActionId, contextRevision: 2 })
  })

  it('同场景流程动作携带过期上下文版本时，不执行 Unity 动作或激活新拓扑', async () => {
    const { handler, registry, facade, unity, canvas, store } = createHandler()
    const workflow = new WorkflowTriggerTransactionHandler(registry, handler, facade)
    await handler.submit(createViewOpen(toSceneId('wind-power'), windOverviewTopologyId))

    const result = await workflow.submit({
      type: 'workflow.trigger',
      correlationId: 'workflow-trigger-stale-revision',
      payload: { actionId: windResetActionId, expectedContextRevision: 0 },
    })

    // 版本冲突在原子事务开始阶段受控拒绝，稳定上下文、唯一画布和 Unity 业务场景均保持上一次状态。
    expect(result).toMatchObject({ success: false, status: 'failed', error: { code: 'context.revision.conflict' } })
    expect(unity.switchScene).toHaveBeenCalledTimes(1)
    expect(unity.executeAction).not.toHaveBeenCalled()
    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('wind-power'), topologyId: windOverviewTopologyId, actionId: null, contextRevision: 1 })
  })

  it('同场景处理器拒绝跨场景动作，保持当前稳定视图并交由任务-035路径处理', async () => {
    const { handler, registry, facade, unity, canvas, store } = createHandler()
    const workflow = new WorkflowTriggerTransactionHandler(registry, handler, facade)
    await handler.submit(createViewOpen(toSceneId('gas-power'), gasOverviewTopologyId))

    const result = await workflow.submit({
      type: 'workflow.trigger',
      correlationId: 'workflow-trigger-cross-scene-rejected',
      payload: { actionId: windResetActionId },
    })

    expect(result).toMatchObject({ success: false, status: 'failed', error: { code: 'action.context.mismatch' } })
    expect(unity.switchScene).toHaveBeenCalledTimes(1)
    expect(unity.executeAction).not.toHaveBeenCalled()
    expect(canvas.setTopology).toHaveBeenCalledTimes(1)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('gas-power'), topologyId: gasOverviewTopologyId, actionId: null, contextRevision: 1 })
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
    expect(store.stableContext).toEqual({ sceneId: toSceneId('wind-power'), topologyId: windDetailTopologyId, actionId: windResetActionId, contextRevision: 2 })
  })

  it('跨场景非关键动作明确允许警告提交时，保留目标场景并在动作终态失败后激活映射拓扑', async () => {
    const unity = createUnityPort()
    vi.mocked(unity.executeAction).mockResolvedValueOnce({ success: false, errorCode: 'action.execute.failed' })
    const manifest = createManifest()
    const warningManifest: SceneTopologyManifest = {
      ...manifest,
      // 此夹具仅验证失败策略，不代表任何正式风电流程或参数映射。
      actions: manifest.actions.map((action) => action.actionId === windResetActionId && action.targetViewMode === 'business'
        ? { ...action, failurePolicy: 'commit-view-with-warning' as const }
        : action),
    }
    const { handler, registry, facade, canvas, store } = createHandler(unity, warningManifest)
    const workflow = new WorkflowTriggerTransactionHandler(registry, handler, facade, 'cross-scene')
    await handler.submit(createViewOpen(toSceneId('gas-power'), gasOverviewTopologyId))

    const result = await workflow.submit({
      type: 'workflow.trigger',
      correlationId: 'workflow-trigger-cross-scene-warning',
      payload: { actionId: windResetActionId, expectedContextRevision: 1 },
    })

    expect(result).toMatchObject({ success: true, status: 'completed', contextRevision: 2 })
    // 初始燃气、目标风电各一次；警告策略不应把已确认的目标场景回切成旧场景。
    expect(unity.switchScene).toHaveBeenCalledTimes(2)
    expect(canvas.setTopology).toHaveBeenCalledTimes(2)
    expect(store.stableContext).toEqual({ sceneId: toSceneId('wind-power'), topologyId: windDetailTopologyId, actionId: windResetActionId, contextRevision: 2 })
    expect(store.latestDiagnostic?.code).toBe('action.execute.failed')
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
      actions: manifest.actions.map((action) => action.actionId === windResetActionId && action.targetViewMode === 'business'
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
    expect(store.stableContext).toEqual({ sceneId: toSceneId('wind-power'), topologyId: windDetailTopologyId, actionId: windResetActionId, contextRevision: 2 })
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

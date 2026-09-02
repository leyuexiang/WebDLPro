import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  SCENE_IDS,
  toActionId,
  toCameraPoseId,
  toProcessDetailId,
  toProcessDetailResourceId,
  toProcessId,
  toSceneActivationId,
  toSceneId,
  toSceneNodeId,
  toStepId,
  toTopologyId,
  toTransitionId,
  toUnityRuntimeKey,
  toUnitySceneKey,
} from '@/config/scene-topology/identifiers'
import type { SceneTopologyManifest } from '@/config/scene-topology/types'
import { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import { ProcessDetailTransactionHandler, type ProcessDetailUnityPort } from '@/modules/visual/orchestration/process-detail-transaction-handler'
import { ViewOpenTransactionHandler, type ViewOpenUnityPort } from '@/modules/visual/orchestration/view-open-transaction-handler'
import { WorkflowTriggerTransactionHandler } from '@/modules/visual/orchestration/workflow-trigger-transaction-handler'
import { createVisualizationCoordinatorFacade } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import { VisualizationCoordinator } from '@/modules/visual/orchestration/visualization-coordinator'
import { useVisualizationStore } from '@/modules/visual/orchestration/visualization.store'
import { TopologyRuntime, type TopologyCanvasPort } from '@/modules/visual/topology/topology-runtime'

const manifestVersion = 'process-detail-test.1'
const gasSceneId = toSceneId('gas-power')
const gasTopologyId = toTopologyId('topology.gas-power.overview')
const detailActionId = toActionId('action.gas-power.gas-turbine')
const secondDetailActionId = toActionId('action.gas-power.steam-turbine')
const overviewActionId = toActionId('action.gas-power.overview')
const processDetailId = toProcessDetailId('process-detail.gas-power.gas-turbine')
const secondProcessDetailId = toProcessDetailId('process-detail.gas-power.steam-turbine')

/**
 * 构造九场景最小合法清单，给燃气登记两个关键环节以覆盖同场景直接切换。
 * 其余场景保持零项，验证目录不会把关键环节数量写死。
 */
function createManifest(): SceneTopologyManifest {
  const scenes = SCENE_IDS.map((sceneId) => {
    const topologyId = sceneId === gasSceneId ? gasTopologyId : toTopologyId(`topology.${sceneId}.overview`)
    return {
      sceneId,
      title: `测试场景-${sceneId}`,
      unitySceneKey: toUnitySceneKey(`scene.${sceneId}`),
      defaultTopologyId: topologyId,
      topologyIds: [topologyId],
      supportedActionIds: sceneId === gasSceneId ? [overviewActionId, detailActionId, secondDetailActionId] : [],
      sceneMappingVersion: `mapping.${sceneId}.1`,
      resourceVersion: `resource.${sceneId}.1`,
      switchStrategy: 'unload-first' as const,
    }
  })

  return {
    manifestVersion,
    unityBuildId: 'process-detail-build.1',
    unityRuntimeKey: toUnityRuntimeKey('process-detail-runtime'),
    scenes,
    topologies: scenes.map((scene) => ({
      topologyId: scene.defaultTopologyId,
      sceneId: scene.sceneId,
      title: `测试拓扑-${scene.sceneId}`,
      configVersion: manifestVersion,
      nodes: [],
      edges: [],
    })),
    processDetails: [
      {
        sceneId: gasSceneId,
        processId: toProcessId('gas-power-generation'),
        stepId: toStepId('gas-turbine'),
        processDetailId,
        resourceId: toProcessDetailResourceId('process-detail-resource.gas-power.gas-turbine'),
        cameraPoseId: toCameraPoseId('camera-pose.gas-power.gas-turbine'),
        stateNodeId: toSceneNodeId('gas-turbine'),
      },
      {
        sceneId: gasSceneId,
        processId: toProcessId('gas-power-generation'),
        stepId: toStepId('steam-turbine'),
        processDetailId: secondProcessDetailId,
        resourceId: toProcessDetailResourceId('process-detail-resource.gas-power.steam-turbine'),
        cameraPoseId: toCameraPoseId('camera-pose.gas-power.steam-turbine'),
        stateNodeId: toSceneNodeId('steam-turbine'),
      },
    ],
    actions: [
      {
        actionId: overviewActionId,
        title: '返回燃气总览',
        targetViewMode: 'business',
        targetSceneId: gasSceneId,
        targetTopologyId: gasTopologyId,
        allowedParameters: [],
        unityAction: { type: 'none' },
        failurePolicy: 'keep-current-context',
        configVersion: manifestVersion,
      },
      {
        actionId: detailActionId,
        title: '进入燃气轮机关键环节',
        targetViewMode: 'process-detail',
        targetSceneId: gasSceneId,
        processDetailId,
        allowedParameters: [],
        unityAction: { type: 'enterProcessDetail', processDetailId },
        failurePolicy: 'keep-current-context',
        configVersion: manifestVersion,
      },
      {
        actionId: secondDetailActionId,
        title: '进入汽轮机关键环节',
        targetViewMode: 'process-detail',
        targetSceneId: gasSceneId,
        processDetailId: secondProcessDetailId,
        allowedParameters: [],
        unityAction: { type: 'enterProcessDetail', processDetailId: secondProcessDetailId },
        failurePolicy: 'keep-current-context',
        configVersion: manifestVersion,
      },
    ],
    unitySceneMappings: scenes.map((scene) => ({
      sceneId: scene.sceneId,
      mappingVersion: scene.sceneMappingVersion,
      processSteps: [],
      sceneNodeIds: scene.sceneId === gasSceneId ? [toSceneNodeId('gas-turbine'), toSceneNodeId('steam-turbine')] : [],
      routeIds: [],
    })),
  }
}

function createCanvas(): TopologyCanvasPort {
  return {
    setTopology: vi.fn(),
    setSelection: vi.fn(),
    setNodeStatuses: vi.fn(),
    getViewState: vi.fn().mockReturnValue({ zoom: 1.25, offsetX: 12, offsetY: -8 }),
    restoreViewState: vi.fn(),
    dispose: vi.fn(),
  }
}

/** 建立已提交燃气第二层，避免测试绕过真实协调器直接修改 Pinia 状态。 */
function createHarness(unity: ProcessDetailUnityPort, transitionIds = [
  toTransitionId('transition.process-detail.01'),
  toTransitionId('transition.process-detail.02'),
  toTransitionId('transition.process-detail.03'),
], waitForLayoutCommit: () => Promise<void> = async () => undefined) {
  const registryResult = TopologyRegistry.create(createManifest())
  if (registryResult.status !== 'ready') throw new Error(`测试清单无效：${registryResult.issues.map((issue) => issue.code).join(',')}`)
  const registry = registryResult.registry
  const store = useVisualizationStore()
  const facade = createVisualizationCoordinatorFacade(new VisualizationCoordinator(store))
  const topologyRuntime = new TopologyRuntime(registry, createCanvas())
  const initialTransitionId = toTransitionId('transition.initial.gas-business')
  const prepared = topologyRuntime.prepare(gasSceneId, gasTopologyId, initialTransitionId)
  if (!prepared) throw new Error('燃气拓扑预备失败。')
  facade.submit({ type: 'transition.begin', transitionId: initialTransitionId, sceneId: gasSceneId, topologyId: gasTopologyId, actionId: null })
  facade.submit({ type: 'unity.status.reported', transitionId: initialTransitionId, status: 'ready' })
  topologyRuntime.activate(prepared, initialTransitionId)
  facade.submit({ type: 'topology.status.reported', transitionId: initialTransitionId, status: 'ready' })
  facade.submit({ type: 'transition.commit', transitionId: initialTransitionId, sceneId: gasSceneId, topologyId: gasTopologyId, actionId: null })

  let transitionIndex = 0
  const handler = new ProcessDetailTransactionHandler(
    registry,
    topologyRuntime,
    unity,
    facade,
    () => transitionIds[transitionIndex++] ?? toTransitionId(`transition.process-detail.fallback.${transitionIndex}`),
    waitForLayoutCommit,
  )
  return { handler, store, topologyRuntime, unity }
}

beforeEach(() => setActivePinia(createPinia()))

describe('关键环节原子事务', () => {
  it('可从任意已稳定场景直接进入目标关键环节，并在准备资源前等待目标场景状态重放', async () => {
    const registryResult = TopologyRegistry.create(createManifest())
    if (registryResult.status !== 'ready') throw new Error('跨场景关键环节测试清单无效。')
    const registry = registryResult.registry
    const topologyRuntime = new TopologyRuntime(registry, createCanvas())
    const store = useVisualizationStore()
    const facade = createVisualizationCoordinatorFacade(new VisualizationCoordinator(store))
    const sourceSceneId = toSceneId('coal-power')
    const sourceTopologyId = registry.getScene(sourceSceneId)?.defaultTopologyId
    if (!sourceTopologyId) throw new Error('测试来源场景缺少默认拓扑。')

    const initialTransitionId = toTransitionId('transition.initial.coal-business')
    const initialTopology = topologyRuntime.prepare(sourceSceneId, sourceTopologyId, initialTransitionId)
    if (!initialTopology) throw new Error('测试来源拓扑预备失败。')
    facade.submit({ type: 'transition.begin', transitionId: initialTransitionId, sceneId: sourceSceneId, topologyId: sourceTopologyId, actionId: null })
    facade.submit({ type: 'unity.status.reported', transitionId: initialTransitionId, status: 'ready' })
    topologyRuntime.activate(initialTopology, initialTransitionId)
    facade.submit({ type: 'topology.status.reported', transitionId: initialTransitionId, status: 'ready' })
    facade.submit({
      type: 'transition.commit',
      transitionId: initialTransitionId,
      sceneId: sourceSceneId,
      topologyId: sourceTopologyId,
      actionId: null,
      sceneActivationId: toSceneActivationId('scene-activation.coal'),
    })

    const phaseOrder: string[] = []
    const unity: ProcessDetailUnityPort & ViewOpenUnityPort = {
      switchScene: vi.fn(async () => {
        phaseOrder.push('切换目标场景')
        return { success: true, sceneActivationId: toSceneActivationId('scene-activation.gas') }
      }),
      executeAction: vi.fn().mockResolvedValue({ success: true }),
      prepareProcessDetail: vi.fn(async () => {
        phaseOrder.push('准备关键环节')
        return { success: true }
      }),
      commitProcessDetail: vi.fn(async () => {
        phaseOrder.push('提交关键环节')
        return { success: true }
      }),
      abortProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      exitProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      setProcessDetailPlayback: vi.fn().mockResolvedValue({ success: true }),
    }
    const viewOpen = new ViewOpenTransactionHandler(
      registry,
      topologyRuntime,
      unity,
      facade,
      'mapping.runtime.test.1',
      () => toTransitionId('transition.cross-scene.business'),
    )
    const processDetail = new ProcessDetailTransactionHandler(
      registry,
      topologyRuntime,
      unity,
      facade,
      () => toTransitionId('transition.cross-scene.process-detail'),
      async () => { phaseOrder.push('提交全屏布局') },
    )
    const synchronizeState = vi.fn(async () => {
      phaseOrder.push('重放最新状态')
      return true
    })
    const workflow = new WorkflowTriggerTransactionHandler(
      registry,
      viewOpen,
      facade,
      'cross-scene',
      processDetail,
      synchronizeState,
    )

    const result = await workflow.submit({
      type: 'workflow.trigger',
      correlationId: 'cross-scene-direct-process-detail',
      payload: { actionId: detailActionId, expectedContextRevision: 1 },
    })

    expect(result).toMatchObject({ success: true, status: 'completed', contextRevision: 3 })
    expect(unity.switchScene).toHaveBeenCalledWith(
      gasSceneId,
      'mapping.gas-power.1',
      toTransitionId('transition.cross-scene.business'),
    )
    expect(synchronizeState).toHaveBeenCalledWith(toSceneActivationId('scene-activation.gas'))
    expect(phaseOrder).toEqual(['切换目标场景', '重放最新状态', '准备关键环节', '提交全屏布局', '提交关键环节'])
    expect(store.stableContext).toEqual({
      sceneId: gasSceneId,
      processDetailId,
      actionId: detailActionId,
      contextRevision: 3,
    })
    expect(topologyRuntime.getActiveTopology()).toBeUndefined()
  })

  it('联调演示控件只控制当前稳定关键环节并复核上下文版本', async () => {
    const unity: ProcessDetailUnityPort = {
      prepareProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      commitProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      abortProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      exitProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      setProcessDetailPlayback: vi.fn().mockResolvedValue({ success: true }),
    }
    const { handler } = createHarness(unity)

    // 第二层业务视图不得被网页按钮误当成关键环节，也不能提前向 Unity 发送播放命令。
    await expect(handler.setCurrentPlayback(true)).resolves.toMatchObject({ success: false, status: 'failed' })
    expect(unity.setProcessDetailPlayback).not.toHaveBeenCalled()

    await handler.submit({
      type: 'workflow.trigger',
      correlationId: 'partner-demo-enter-detail',
      payload: { actionId: detailActionId, expectedContextRevision: 1 },
    })
    await expect(handler.setCurrentPlayback(true, 2)).resolves.toMatchObject({
      success: true,
      status: 'completed',
      contextRevision: 2,
    })
    expect(unity.setProcessDetailPlayback).toHaveBeenCalledWith(gasSceneId, processDetailId, true)

    // 旧按钮上下文不得在切换后继续控制新视图；冲突在调用 Unity 前即被拒绝。
    await expect(handler.setCurrentPlayback(false, 1)).resolves.toMatchObject({ success: false, status: 'failed' })
    expect(unity.setProcessDetailPlayback).toHaveBeenCalledTimes(1)
  })

  it('按同一事务标识进入无拓扑第三层，再恢复原燃气拓扑', async () => {
    const phaseOrder: string[] = []
    const unity: ProcessDetailUnityPort = {
      prepareProcessDetail: vi.fn(async () => {
        phaseOrder.push('准备候选')
        return { success: true }
      }),
      commitProcessDetail: vi.fn(async () => {
        phaseOrder.push('提交三维')
        return { success: true }
      }),
      abortProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      exitProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      setProcessDetailPlayback: vi.fn().mockResolvedValue({ success: true }),
    }
    const { handler, store, topologyRuntime } = createHarness(unity, undefined, async () => {
      phaseOrder.push('提交全屏布局')
    })

    const entered = await handler.submit({
      type: 'workflow.trigger',
      correlationId: 'parent-detail-enter',
      payload: { actionId: detailActionId, expectedContextRevision: 1 },
    })
    expect(entered).toMatchObject({ success: true, status: 'completed', transitionId: 'transition.process-detail.01' })
    expect(unity.prepareProcessDetail).toHaveBeenCalledWith(
      expect.objectContaining({ processDetailId }),
      toTransitionId('transition.process-detail.01'),
    )
    expect(unity.commitProcessDetail).toHaveBeenCalledWith(gasSceneId, processDetailId, toTransitionId('transition.process-detail.01'))
    expect(phaseOrder).toEqual(['准备候选', '提交全屏布局', '提交三维'])
    expect(topologyRuntime.getActiveTopology()).toBeUndefined()
    expect(store.stableContext).toEqual({
      sceneId: gasSceneId,
      processDetailId,
      actionId: detailActionId,
      contextRevision: 2,
    })

    const exited = await handler.submit({
      type: 'workflow.trigger',
      correlationId: 'parent-detail-exit',
      payload: { actionId: overviewActionId, expectedContextRevision: 2 },
    })
    expect(exited).toMatchObject({ success: true, status: 'completed', transitionId: 'transition.process-detail.02' })
    expect(unity.exitProcessDetail).toHaveBeenCalledWith(
      gasSceneId,
      processDetailId,
      toTransitionId('transition.process-detail.02'),
    )
    expect(topologyRuntime.getActiveTopology()?.topologyId).toBe(gasTopologyId)
    expect(store.stableContext).toEqual({
      sceneId: gasSceneId,
      topologyId: gasTopologyId,
      actionId: overviewActionId,
      contextRevision: 3,
    })
  })

  it('进入超时后恢复原业务上下文，并用原事务编号清理迟到模型', async () => {
    let resolvePrepare: ((result: { success: boolean }) => void) | undefined
    const unity: ProcessDetailUnityPort = {
      // 此用例只验证迟到回执的清理语义；使用上下文推导的端口函数，避免 Vitest 的泛型模拟把 Promise 返回值退化为 unknown。
      prepareProcessDetail: (_detail, _transitionId) => new Promise<{ success: boolean }>((resolve) => { resolvePrepare = resolve }),
      commitProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      abortProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      exitProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      setProcessDetailPlayback: vi.fn().mockResolvedValue({ success: true }),
    }
    const { handler, store, topologyRuntime } = createHarness(unity)
    const pending = handler.submit({
      type: 'workflow.trigger',
      correlationId: 'parent-detail-timeout',
      payload: { actionId: detailActionId, expectedContextRevision: 1 },
    })
    await Promise.resolve()

    handler.cancelTimedOutCommand('parent-detail-timeout')
    expect(store.stableContext).toEqual({
      sceneId: gasSceneId,
      topologyId: gasTopologyId,
      actionId: null,
      contextRevision: 1,
    })
    expect(topologyRuntime.getActiveTopology()?.topologyId).toBe(gasTopologyId)

    resolvePrepare?.({ success: true })
    await expect(pending).resolves.toMatchObject({ success: false, status: 'superseded' })
    expect(unity.abortProcessDetail).toHaveBeenCalledWith(
      gasSceneId,
      processDetailId,
      toTransitionId('transition.process-detail.01'),
    )
  })

  it('已在第三层时直接准备并提交同场景另一关键环节', async () => {
    const unity: ProcessDetailUnityPort = {
      prepareProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      commitProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      abortProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      exitProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      setProcessDetailPlayback: vi.fn().mockResolvedValue({ success: true }),
    }
    const { handler, store, topologyRuntime } = createHarness(unity)
    await handler.submit({
      type: 'workflow.trigger',
      correlationId: 'parent-detail-first',
      payload: { actionId: detailActionId, expectedContextRevision: 1 },
    })

    const switched = await handler.submit({
      type: 'workflow.trigger',
      correlationId: 'parent-detail-switch',
      payload: { actionId: secondDetailActionId, expectedContextRevision: 2 },
    })

    expect(switched).toMatchObject({ success: true, status: 'completed', transitionId: 'transition.process-detail.02' })
    expect(unity.exitProcessDetail).not.toHaveBeenCalled()
    expect(unity.prepareProcessDetail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ processDetailId: secondProcessDetailId }),
      toTransitionId('transition.process-detail.02'),
    )
    expect(unity.commitProcessDetail).toHaveBeenNthCalledWith(
      2,
      gasSceneId,
      secondProcessDetailId,
      toTransitionId('transition.process-detail.02'),
    )
    expect(topologyRuntime.getActiveTopology()).toBeUndefined()
    expect(store.stableContext).toMatchObject({
      sceneId: gasSceneId,
      processDetailId: secondProcessDetailId,
      actionId: secondDetailActionId,
      contextRevision: 3,
    })
  })

  it('退出后拓扑恢复失败时应使用全新事务编号补偿重建第三层', async () => {
    const unity: ProcessDetailUnityPort = {
      prepareProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      commitProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      abortProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      exitProcessDetail: vi.fn().mockResolvedValue({ success: true }),
      setProcessDetailPlayback: vi.fn().mockResolvedValue({ success: true }),
    }
    const { handler, store, topologyRuntime } = createHarness(unity)

    await handler.submit({
      type: 'workflow.trigger',
      correlationId: 'parent-detail-enter-before-recovery',
      payload: { actionId: detailActionId, expectedContextRevision: 1 },
    })
    // 只让返回阶段的拓扑激活失败；初始业务拓扑已在测试夹具创建阶段正常激活。
    vi.spyOn(topologyRuntime, 'activate').mockReturnValue(false)

    const exited = await handler.submit({
      type: 'workflow.trigger',
      correlationId: 'parent-detail-exit-recovery',
      payload: { actionId: overviewActionId, expectedContextRevision: 2 },
    })

    expect(exited).toMatchObject({ success: false, status: 'failed', transitionId: 'transition.process-detail.02' })
    expect(unity.exitProcessDetail).toHaveBeenCalledWith(
      gasSceneId,
      processDetailId,
      toTransitionId('transition.process-detail.02'),
    )
    expect(unity.prepareProcessDetail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ processDetailId }),
      toTransitionId('transition.process-detail.03'),
    )
    expect(unity.commitProcessDetail).toHaveBeenNthCalledWith(
      2,
      gasSceneId,
      processDetailId,
      toTransitionId('transition.process-detail.03'),
    )
    expect(store.stableContext).toMatchObject({ sceneId: gasSceneId, processDetailId })
  })
})

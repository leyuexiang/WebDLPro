import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { NodeId } from '@/config/scene-topology/identifiers'
import {
  toActionId,
  toDeviceId,
  toNodeId,
  toRouteId,
  toSceneId,
  toSceneNodeId,
  toTopologyId,
  toTransitionId,
} from '@/config/scene-topology/identifiers'
import { VisualizationCoordinator } from '@/modules/visual/orchestration/visualization-coordinator'
import { createVisualizationCoordinatorFacade } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import { useVisualizationStore } from '@/modules/visual/orchestration/visualization.store'

describe('VisualizationCoordinator', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('只在同一事务的 Unity 与拓扑均就绪后原子提交一次稳定上下文', () => {
    const store = useVisualizationStore()
    const coordinator = new VisualizationCoordinator(store)
    const transitionId = toTransitionId('transition.open.1')
    const sceneId = toSceneId('gas-power')
    const topologyId = toTopologyId('topology.gas.overview')

    expect(coordinator.submit({
      type: 'transition.begin',
      transitionId,
      sceneId,
      topologyId,
      actionId: null,
      expectedContextRevision: 0,
    })).toMatchObject({ status: 'accepted', transitionId })
    expect(store.runtimeStatus).toBe('switching')
    expect(store.unityStatus).toBe('preparing')
    expect(store.topologyStatus).toBe('preparing')

    expect(coordinator.submit({ type: 'topology.status.reported', transitionId, status: 'ready' })).toMatchObject({ status: 'accepted' })
    expect(coordinator.submit({ type: 'transition.commit', transitionId, sceneId, topologyId, actionId: null })).toMatchObject({
      status: 'rejected',
      error: { code: 'transition.subsystems.not-ready' },
    })
    expect(store.stableContext).toBeNull()

    coordinator.submit({ type: 'unity.status.reported', transitionId, status: 'ready' })
    expect(coordinator.submit({ type: 'transition.commit', transitionId, sceneId, topologyId, actionId: null })).toMatchObject({
      status: 'accepted',
      contextRevision: 1,
    })
    expect(store.stableContext).toEqual({ sceneId, topologyId, actionId: null, contextRevision: 1 })

    expect(coordinator.submit({ type: 'transition.commit', transitionId, sceneId, topologyId, actionId: null })).toEqual({
      status: 'ignored',
      reason: 'stale-transition',
    })
    expect(store.stableContext?.contextRevision).toBe(1)
  })

  it('新事务取代旧提交权，迟到状态和错误不能覆盖新事务', () => {
    const store = useVisualizationStore()
    const coordinator = new VisualizationCoordinator(store)
    const firstTransitionId = toTransitionId('transition.first')
    const secondTransitionId = toTransitionId('transition.second')
    const sceneId = toSceneId('wind-power')
    const firstTopologyId = toTopologyId('topology.wind.overview')
    const secondTopologyId = toTopologyId('topology.wind.collection')

    coordinator.submit({ type: 'transition.begin', transitionId: firstTransitionId, sceneId, topologyId: firstTopologyId, actionId: null })
    expect(coordinator.submit({
      type: 'transition.begin',
      transitionId: secondTransitionId,
      sceneId,
      topologyId: secondTopologyId,
      actionId: null,
    })).toMatchObject({ status: 'accepted', supersededTransitionId: firstTransitionId })

    expect(coordinator.submit({ type: 'unity.status.reported', transitionId: firstTransitionId, status: 'failed' })).toEqual({
      status: 'ignored',
      reason: 'stale-transition',
    })
    expect(coordinator.submit({
      type: 'transition.fail',
      transitionId: firstTransitionId,
      diagnostic: { code: 'scene.switch.failed', correlationId: 'correlation.first', occurredAt: '2026-08-04T08:00:00.000Z' },
    })).toEqual({ status: 'ignored', reason: 'stale-transition' })
    expect(store.activeTransitionId).toBe(secondTransitionId)
    expect(store.latestDiagnostic).toBeNull()
  })

  it('事务失败后恢复上一个稳定上下文与两个子系统就绪状态', () => {
    const store = useVisualizationStore()
    const coordinator = new VisualizationCoordinator(store)
    const stableTransitionId = toTransitionId('transition.stable')
    const failedTransitionId = toTransitionId('transition.failed')
    const sceneId = toSceneId('solar-power')
    const topologyId = toTopologyId('topology.solar.overview')
    const nextTopologyId = toTopologyId('topology.solar.inverter')

    coordinator.submit({ type: 'transition.begin', transitionId: stableTransitionId, sceneId, topologyId, actionId: null })
    coordinator.submit({ type: 'unity.status.reported', transitionId: stableTransitionId, status: 'ready' })
    coordinator.submit({ type: 'topology.status.reported', transitionId: stableTransitionId, status: 'ready' })
    coordinator.submit({ type: 'transition.commit', transitionId: stableTransitionId, sceneId, topologyId, actionId: null })

    coordinator.submit({ type: 'transition.begin', transitionId: failedTransitionId, sceneId, topologyId: nextTopologyId, actionId: null })
    expect(store.unityStatus).toBe('ready')
    expect(store.topologyStatus).toBe('preparing')
    coordinator.submit({ type: 'transition.fail', transitionId: failedTransitionId, diagnostic: {
      code: 'topology.prepare.failed',
      correlationId: 'correlation.failed',
      occurredAt: '2026-08-04T08:01:00.000Z',
    } })

    expect(store.stableContext).toEqual({ sceneId, topologyId, actionId: null, contextRevision: 1 })
    expect(store.runtimeStatus).toBe('ready')
    expect(store.unityStatus).toBe('ready')
    expect(store.topologyStatus).toBe('ready')
  })

  it('受控门面仅提交命令和读取防御性快照', () => {
    const store = useVisualizationStore()
    const facade = createVisualizationCoordinatorFacade(new VisualizationCoordinator(store))
    const transitionId = toTransitionId('transition.selection')
    const sceneId = toSceneId('distribution')
    const topologyId = toTopologyId('topology.distribution.overview')

    expect(Object.isFrozen(facade)).toBe(true)
    expect(Object.keys(facade).sort()).toEqual(['getSnapshot', 'submit'])

    facade.submit({ type: 'transition.begin', transitionId, sceneId, topologyId, actionId: toActionId('action.distribution.open') })
    facade.submit({ type: 'unity.status.reported', transitionId, status: 'ready' })
    facade.submit({ type: 'topology.status.reported', transitionId, status: 'ready' })
    facade.submit({
      type: 'transition.commit',
      transitionId,
      sceneId,
      topologyId,
      actionId: toActionId('action.distribution.open'),
    })
    facade.submit({
      type: 'selection.replace',
      nodeIds: [toNodeId('node.transformer.1'), toNodeId('node.transformer.1')],
      routeIds: [toRouteId('route.feeder.1'), toRouteId('route.feeder.1')],
      deviceId: toDeviceId('device.transformer.1'),
      sceneNodeId: toSceneNodeId('scene-node.transformer.1'),
      source: 'topology',
    })

    const snapshot = facade.getSnapshot()
    expect(snapshot.selectedNodeIds).toEqual([toNodeId('node.transformer.1')])
    expect(snapshot.selectedRouteIds).toEqual([toRouteId('route.feeder.1')])
    ;(snapshot.selectedNodeIds as NodeId[]).push(toNodeId('node.injected'))
    expect(facade.getSnapshot().selectedNodeIds).toEqual([toNodeId('node.transformer.1')])
  })

  it('上下文版本冲突和释放后命令均被结构化拒绝', () => {
    const store = useVisualizationStore()
    const coordinator = new VisualizationCoordinator(store)
    const transitionId = toTransitionId('transition.revision')

    expect(coordinator.submit({
      type: 'transition.begin',
      transitionId,
      sceneId: toSceneId('dispatch'),
      topologyId: toTopologyId('topology.dispatch.overview'),
      actionId: null,
      expectedContextRevision: 3,
    })).toMatchObject({ status: 'rejected', error: { code: 'context.revision.conflict' } })

    expect(coordinator.submit({ type: 'system.release' })).toEqual({ status: 'accepted' })
    expect(coordinator.submit({
      type: 'transition.begin',
      transitionId,
      sceneId: toSceneId('dispatch'),
      topologyId: toTopologyId('topology.dispatch.overview'),
      actionId: null,
    })).toMatchObject({ status: 'rejected', error: { code: 'runtime.disposed' } })
    expect(coordinator.submit({ type: 'system.release' })).toEqual({ status: 'ignored', reason: 'idempotent' })
  })
})

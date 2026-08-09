import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { toActionId, toDeviceId, toNodeId, toRouteId, toSceneId, toSceneNodeId, toTopologyId, toTransitionId } from '@/config/scene-topology/identifiers'
import { useVisualizationStore, VISUALIZATION_TRANSITION_SUMMARY_CAPACITY } from '@/modules/visual/orchestration/visualization.store'

describe('可视化稳定上下文状态仓库', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('只允许当前事务提交稳定上下文，并且上下文版本每次只递增一次', () => {
    const store = useVisualizationStore()
    const transitionId = toTransitionId('transition-01')
    store.beginTransition(transitionId, toSceneId('gas-power'), toTopologyId('gas-power.overview'), null)

    expect(store.commitStableContext(toTransitionId('transition-old'), toSceneId('gas-power'), toTopologyId('gas-power.overview'), null)).toBe(false)
    expect(store.commitStableContext(transitionId, toSceneId('gas-power'), toTopologyId('gas-power.overview'), null)).toBe(true)
    expect(store.stableContext?.contextRevision).toBe(1)
    expect(store.runtimeStatus).toBe('ready')
  })

  it('切换期间保留旧稳定上下文，旧事务失败不能覆盖新状态', () => {
    const store = useVisualizationStore()
    const firstTransition = toTransitionId('transition-01')
    store.beginTransition(firstTransition, toSceneId('gas-power'), toTopologyId('gas-power.overview'), null)
    store.commitStableContext(firstTransition, toSceneId('gas-power'), toTopologyId('gas-power.overview'), null)
    const secondTransition = toTransitionId('transition-02')
    store.beginTransition(secondTransition, toSceneId('wind-power'), toTopologyId('wind-power.overview'), toActionId('wind-power.open'))

    expect(store.stableContext?.sceneId).toBe(toSceneId('gas-power'))
    expect(store.failTransition(toTransitionId('transition-old'), { code: 'scene.switch.failed', correlationId: 'correlation-01', occurredAt: '2026-08-04T00:00:00.000Z' })).toBe(false)
    expect(store.stableContext?.sceneId).toBe(toSceneId('gas-power'))
  })

  it('选择状态与运行状态独立保存，释放后不保留旧上下文或选择', () => {
    const store = useVisualizationStore()
    store.setSelection([toNodeId('node-gas-turbine-01')], [toRouteId('route-gas-01')], 'topology', toDeviceId('device-gas-01'), toSceneNodeId('scene-node-gas-01'))
    store.release()

    expect(store.selectedNodeIds).toEqual([])
    expect(store.selectedDeviceId).toBeNull()
    expect(store.runtimeStatus).toBe('released')
    expect(store.unityStatus).toBe('disposed')
  })

  it('物理回退失败会清空稳定上下文与选择，避免错误态继续暴露旧场景组合', () => {
    const store = useVisualizationStore()
    const stableTransition = toTransitionId('transition-stable')
    const failedTransition = toTransitionId('transition-recovery-failed')
    store.beginTransition(stableTransition, toSceneId('gas-power'), toTopologyId('gas-power.overview'), null)
    store.commitStableContext(stableTransition, toSceneId('gas-power'), toTopologyId('gas-power.overview'), null)
    store.setSelection([toNodeId('node-gas-turbine-01')], [], 'topology')
    store.beginTransition(failedTransition, toSceneId('wind-power'), toTopologyId('wind-power.overview'), null)

    expect(store.failTransitionToError(failedTransition, {
      code: 'transition.recovery.failed',
      correlationId: 'correlation-recovery-failed',
      occurredAt: '2026-08-04T00:00:00.000Z',
    })).toBe(true)
    expect(store.stableContext).toBeNull()
    expect(store.selectedNodeIds).toEqual([])
    expect(store.runtimeStatus).toBe('error')
  })

  it('事务摘要固定保留最近 32 条，并标识被新事务取代与恢复失败的受控终态', () => {
    const store = useVisualizationStore()
    for (let index = 0; index <= VISUALIZATION_TRANSITION_SUMMARY_CAPACITY; index += 1) {
      const transitionId = toTransitionId(`transition-summary-${index}`)
      store.beginTransition(transitionId, toSceneId('gas-power'), toTopologyId('gas-power.overview'), null)
      store.failTransition(transitionId, {
        code: 'command.timeout',
        correlationId: `correlation-summary-${index}`,
        occurredAt: '2026-08-08T00:00:00.000Z',
      })
    }

    // 写入容量加一条后，最早摘要被淘汰；摘要只保留稳定字段和受控错误码，不包含关联载荷内容。
    expect(store.recentTransitionSummaries).toHaveLength(VISUALIZATION_TRANSITION_SUMMARY_CAPACITY)
    expect(store.recentTransitionSummaries[0]).toMatchObject({
      transitionId: toTransitionId('transition-summary-1'),
      outcome: 'failed',
      diagnosticCode: 'command.timeout',
      previousContextRevision: 0,
    })
    expect(store.recentTransitionSummaries.at(-1)).toMatchObject({
      transitionId: toTransitionId(`transition-summary-${VISUALIZATION_TRANSITION_SUMMARY_CAPACITY}`),
      outcome: 'failed',
    })
  })
})

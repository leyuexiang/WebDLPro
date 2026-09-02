import { describe, expect, it, vi } from 'vitest'
import { toActionId, toNodeId, toSceneId, toSessionId, toTopologyId } from '@/config/scene-topology/identifiers'
import { HostCommandDispatcher, type HostCommandCoordinatorPort } from '@/host-bridge/host-command-dispatcher'
import type { HostCommandMessage } from '@/host-bridge/host-protocol'
import type { VisualizationCoordinatorSnapshot } from '@/modules/visual/orchestration/visualization-coordinator'
import type { VisualizationCoordinatorFacade } from '@/modules/visual/orchestration/visualization-coordinator-facade'

/** 创建纯值快照，测试不会创建Pinia仓库、窗口、画布或Unity运行时。 */
function createSnapshot(overrides: Partial<VisualizationCoordinatorSnapshot> = {}): VisualizationCoordinatorSnapshot {
  return {
    stableContext: {
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('gas-power.overview'),
      actionId: null,
      contextRevision: 4,
    },
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
}

/** 外层命令夹具全部经过协议字段约束，业务逻辑测试只变更当前关注的命令和载荷。 */
function createCommand<TType extends HostCommandMessage['type']>(
  type: TType,
  payload: Extract<HostCommandMessage, { type: TType }>['payload'],
): Extract<HostCommandMessage, { type: TType }> {
  return {
    channel: 'power-scene-topology-shell',
    // 第二版协议才能表达无拓扑的第三层关键环节稳定状态。
    version: 2,
    instanceId: 'visual-shell-01',
    sessionId: toSessionId('session-test-01'),
    messageId: `parent-${type.replaceAll('.', '-')}-01`,
    type,
    timestamp: 1,
    payload,
  } as Extract<HostCommandMessage, { type: TType }>
}

function createDispatcher(
  snapshot = createSnapshot(),
  coordinator: HostCommandCoordinatorPort = { submit: vi.fn().mockResolvedValue({ success: true, status: 'completed' }) },
  capabilities?: ConstructorParameters<typeof HostCommandDispatcher>[2],
) {
  const facade: VisualizationCoordinatorFacade = {
    submit: vi.fn().mockReturnValue({ status: 'accepted' }),
    getSnapshot: vi.fn().mockReturnValue(snapshot),
  }
  return { dispatcher: new HostCommandDispatcher(facade, coordinator, capabilities), facade, coordinator }
}

describe('外层命令分派器', () => {
  it('只将已校验的view.open领域意图交给协调端口，不直接写入门面', async () => {
    const coordinator: HostCommandCoordinatorPort = { submit: vi.fn().mockResolvedValue({ success: true, status: 'completed', contextRevision: 5 }) }
    const { dispatcher, facade } = createDispatcher(createSnapshot(), coordinator)
    const result = await dispatcher.execute(createCommand('view.open', {
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('gas-power.overview'),
      actionId: null,
      expectedContextRevision: 4,
    }))

    expect(result).toMatchObject({ success: true, contextRevision: 5 })
    expect(coordinator.submit).toHaveBeenCalledWith(expect.objectContaining({ type: 'view.open', correlationId: 'parent-view-open-01' }))
    expect(facade.submit).not.toHaveBeenCalled()
  })

  it('未声明能力、旧上下文和释放后的非释放命令均返回结构化结果', async () => {
    const coordinator: HostCommandCoordinatorPort = { submit: vi.fn() }
    const unsupported = createDispatcher(createSnapshot(), coordinator, { commandCapabilities: ['state.get'] })
    const stale = createDispatcher(createSnapshot(), coordinator)
    const released = createDispatcher(createSnapshot({ runtimeStatus: 'released', stableContext: null }), coordinator)

    const unsupportedResult = await unsupported.dispatcher.execute(createCommand('workflow.trigger', { actionId: toActionId('gas-power.turbine') }))
    const staleResult = await stale.dispatcher.execute(createCommand('view.open', {
      sceneId: toSceneId('gas-power'), topologyId: toTopologyId('gas-power.overview'), expectedContextRevision: 3,
    }))
    const releasedResult = await released.dispatcher.execute(createCommand('state.get', {}))

    expect(unsupportedResult).toMatchObject({ success: false, error: { code: 'protocol.capability.undeclared' } })
    expect(staleResult).toMatchObject({ success: false, contextRevision: 4, error: { code: 'context.revision.conflict' } })
    expect(releasedResult).toMatchObject({ success: false, error: { code: 'runtime.disposed' } })
    expect(coordinator.submit).not.toHaveBeenCalled()
  })

  it('状态查询只读取防御性快照，释放只提交system.release且可幂等完成', async () => {
    const { dispatcher, facade } = createDispatcher()

    const stateResult = await dispatcher.execute(createCommand('state.get', {}))
    const disposeResult = await dispatcher.execute(createCommand('system.dispose', { reason: 'parent-unmount' }))

    expect(stateResult).toEqual({ success: true, status: 'completed', contextRevision: 4 })
    expect(disposeResult).toEqual({ success: true, status: 'disposed' })
    expect(facade.submit).toHaveBeenCalledWith({ type: 'system.release' })
  })

  it('流程与设备批次都以最小领域意图转交协调端口', async () => {
    const coordinator: HostCommandCoordinatorPort = { submit: vi.fn().mockResolvedValue({ success: true, status: 'completed' }) }
    const { dispatcher } = createDispatcher(createSnapshot(), coordinator)

    await dispatcher.execute(createCommand('workflow.trigger', { actionId: toActionId('gas-power.turbine'), parameters: { unitId: 'unit-01' } }))
    await dispatcher.execute(createCommand('device.states.update', {
      sourceRevision: 8,
      items: [{ nodeId: toNodeId('node.gas.turbine.01'), deviceStatus: 'normal', statusUpdatedAt: '2026-08-04T14:20:30.000Z' }],
    }))

    expect(coordinator.submit).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'workflow.trigger' }))
    expect(coordinator.submit).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'device.states.update' }))
  })

  it('协调端口发生未预期异常时仍返回受控执行失败，不向桥接层抛出异常', async () => {
    const coordinator: HostCommandCoordinatorPort = { submit: vi.fn().mockRejectedValue(new Error('不应外泄')) }
    const { dispatcher } = createDispatcher(createSnapshot(), coordinator)

    const result = await dispatcher.execute(createCommand('workflow.trigger', { actionId: toActionId('gas-power.turbine') }))

    expect(result).toMatchObject({ success: false, status: 'failed', error: { code: 'action.execute.failed', stage: 'executing-action' } })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { toActionId, toDeviceId, toNodeId, toSceneId, toSceneNodeId, toSessionId, toTopologyId } from '@/config/scene-topology/identifiers'
import { HostBridge } from '@/host-bridge/host-bridge'
import { HostRuntimeComposition, type HostDeviceStatesUpdatePort, type HostViewOpenPort, type HostWorkflowTriggerPort } from '@/host-bridge/host-runtime-composition'
import type { HostCommandMessage, HostEventMessage } from '@/host-bridge/host-protocol'
import type { VisualizationCoordinatorFacade } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import type { VisualizationCoordinatorSnapshot } from '@/modules/visual/orchestration/visualization-coordinator'

/** 固定完整快照夹具，组合根只能读取该防御性模型，测试不引入 Pinia 或 Unity 运行时。 */
function createSnapshot(overrides: Partial<VisualizationCoordinatorSnapshot> = {}): VisualizationCoordinatorSnapshot {
  return {
    stableContext: null,
    activeTransitionId: null,
    targetSceneId: null,
    targetTopologyId: null,
    targetActionId: null,
    runtimeStatus: 'idle',
    unityStatus: 'idle',
    topologyStatus: 'idle',
    selectedNodeIds: [],
    selectedRouteIds: [],
    selectedDeviceId: null,
    selectedSceneNodeId: null,
    selectionSource: 'system',
    latestDiagnostic: null,
    ...overrides,
  }
}

/** 只捕获向精确父来源发送的已验证事件，不模拟浏览器窗口或不可信入站数据。 */
function createComposition(
  releaseInnerRuntime: () => Promise<{ success: boolean }> = async () => ({ success: true }),
  workflowTrigger?: HostWorkflowTriggerPort,
  deviceStatesUpdate?: HostDeviceStatesUpdatePort,
): { composition: HostRuntimeComposition; sent: HostEventMessage[]; openCalls: HostCommandMessage['messageId'][] } {
  const sent: HostEventMessage[] = []
  const parentWindow = { postMessage: (event: HostEventMessage) => sent.push(event) }
  const bridge = new HostBridge(
    { parentOrigin: 'https://portal.example.test', instanceId: 'visual-shell-01', sessionId: toSessionId('session-test-01') },
    parentWindow,
  )
  let snapshot = createSnapshot()
  const facade: VisualizationCoordinatorFacade = {
    submit: () => ({ status: 'accepted' }),
    getSnapshot: () => ({ ...snapshot, stableContext: snapshot.stableContext ? { ...snapshot.stableContext } : null }),
  }
  const openCalls: string[] = []
  const viewOpen: HostViewOpenPort = {
    submit: async (command) => {
      openCalls.push(command.correlationId)
      snapshot = createSnapshot({
        stableContext: {
          sceneId: command.payload.sceneId,
          topologyId: command.payload.topologyId,
          actionId: command.payload.actionId ?? null,
          contextRevision: 1,
        },
        runtimeStatus: 'ready',
        unityStatus: 'ready',
        topologyStatus: 'ready',
      })
      return { success: true, status: 'completed', contextRevision: 1 }
    },
  }

  return {
    composition: new HostRuntimeComposition(bridge, facade, viewOpen, '2026.08.04', releaseInnerRuntime, workflowTrigger, deviceStatesUpdate),
    sent,
    openCalls,
  }
}

/** 所有命令夹具均符合协议基础信封，具体测试只替换类型和载荷。 */
function createCommand<TType extends HostCommandMessage['type']>(
  type: TType,
  payload: Extract<HostCommandMessage, { type: TType }>['payload'],
  messageId: string,
): Extract<HostCommandMessage, { type: TType }> {
  return {
    channel: 'power-scene-topology-shell',
    version: 1,
    instanceId: 'visual-shell-01',
    sessionId: toSessionId('session-test-01'),
    messageId,
    type,
    timestamp: 1,
    payload,
  } as Extract<HostCommandMessage, { type: TType }>
}

describe('外层运行时组合根', () => {
  it('初始化复用原子 view.open，并在确认后才上报稳定视图', async () => {
    const { composition, sent, openCalls } = createComposition()
    composition.start()

    await composition.handleCommand(createCommand('system.init', {
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
    }, 'parent-init-01'))

    expect(openCalls).toEqual(['parent-init-01'])
    expect(sent.map((event) => event.type)).toEqual(['system.ready', 'system.ack', 'view.changed'])
    expect(sent[1]).toEqual(expect.objectContaining({ type: 'system.ack', replyTo: 'parent-init-01' }))
    expect(sent[2]).toEqual(expect.objectContaining({
      type: 'view.changed',
      payload: expect.objectContaining({ sceneId: 'gas-power', topologyId: 'topology.gas-power', contextRevision: 1 }),
    }))
    composition.dispose()
  })

  it('初始化前业务命令返回带 replyTo 的受控失败，不能进入事务端口', async () => {
    const { composition, sent, openCalls } = createComposition()
    composition.start()

    await composition.handleCommand(createCommand('view.open', {
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
    }, 'parent-view-before-init'))

    expect(openCalls).toEqual([])
    expect(sent.at(-1)).toEqual(expect.objectContaining({
      type: 'command.result',
      replyTo: 'parent-view-before-init',
      payload: expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'action.execute.failed' }) }),
    }))
    composition.dispose()
  })

  it('状态查询和设备双击均基于已提交上下文，且双击必须匹配当前场景拓扑', async () => {
    const { composition, sent } = createComposition()
    composition.start()
    await composition.handleCommand(createCommand('system.init', {
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
    }, 'parent-init-02'))

    await composition.handleCommand(createCommand('state.get', {}, 'parent-state-01'))
    expect(composition.reportTopologyDeviceDoubleClick({
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
      nodeId: toNodeId('node.turbine'),
      deviceId: toDeviceId('device.turbine'),
    })).toBe(true)
    expect(composition.reportTopologyDeviceDoubleClick({
      sceneId: toSceneId('wind-power'),
      topologyId: toTopologyId('topology.gas-power'),
      nodeId: toNodeId('node.turbine'),
      deviceId: toDeviceId('device.turbine'),
    })).toBe(false)

    expect(sent.some((event) => event.type === 'state.snapshot' && event.replyTo === 'parent-state-01')).toBe(true)
    expect(sent.at(-1)).toEqual(expect.objectContaining({
      type: 'topology.node.dblclick',
      payload: expect.objectContaining({ deviceId: 'device.turbine', contextRevision: 1 }),
    }))
    composition.dispose()
  })

  it('三维反向选择仅在握手和当前稳定上下文均匹配时上报外层事件', async () => {
    const { composition, sent } = createComposition()
    composition.start()
    await composition.handleCommand(createCommand('system.init', {
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
    }, 'parent-init-object-selection'))

    const reported = composition.reportSceneObjectSelected({
      sceneId: toSceneId('gas-power'),
      sceneNodeId: toSceneNodeId('scene-node.turbine'),
      deviceId: toDeviceId('device.turbine'),
      topologyId: toTopologyId('topology.gas-power'),
      nodeIds: [toNodeId('node.turbine')],
      contextRevision: 1,
      correlationId: 'unity-object-select-01',
    })
    const rejected = composition.reportSceneObjectSelected({
      sceneId: toSceneId('wind-power'),
      sceneNodeId: toSceneNodeId('scene-node.turbine'),
      topologyId: toTopologyId('topology.gas-power'),
      nodeIds: [],
      contextRevision: 1,
      correlationId: 'unity-object-select-stale',
    })

    expect(reported).toBe(true)
    expect(rejected).toBe(false)
    expect(sent.find((event) => event.type === 'system.ready')).toEqual(expect.objectContaining({
      payload: expect.objectContaining({ eventCapabilities: expect.arrayContaining(['scene.object.selected']) }),
    }))
    expect(sent.at(-1)).toEqual(expect.objectContaining({
      type: 'scene.object.selected',
      payload: expect.objectContaining({ deviceId: 'device.turbine', contextRevision: 1 }),
    }))
    composition.dispose()
  })

  it('系统释放必须等待内层资源清理完成后才发送 disposed 结果', async () => {
    let resolveRelease: ((result: { success: boolean }) => void) | undefined
    const releaseInnerRuntime = vi.fn(() => new Promise<{ success: boolean }>((resolve) => { resolveRelease = resolve }))
    const { composition, sent } = createComposition(releaseInnerRuntime)
    composition.start()
    await composition.handleCommand(createCommand('system.init', {
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
    }, 'parent-init-release'))

    const disposePromise = composition.handleCommand(createCommand('system.dispose', { reason: 'test-release' }, 'parent-dispose-01'))
    // 命令需先穿过异步生命周期管理器；等待受控端口被调用，而不是假定固定微任务数量。
    await vi.waitFor(() => expect(releaseInnerRuntime).toHaveBeenCalledTimes(1))

    expect(sent.some((event) => event.type === 'command.result' && event.replyTo === 'parent-dispose-01')).toBe(false)

    resolveRelease?.({ success: true })
    await disposePromise

    expect(sent.at(-1)).toEqual(expect.objectContaining({
      type: 'command.result',
      replyTo: 'parent-dispose-01',
      payload: expect.objectContaining({ success: true, status: 'disposed' }),
    }))
  })

  it('缓存命令只重放关联结果，不重复执行事务或派生视图事件', async () => {
    const { composition, sent, openCalls } = createComposition()
    composition.start()
    await composition.handleCommand(createCommand('system.init', {
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
    }, 'parent-init-duplicate'))

    const duplicateCommand = createCommand('view.open', {
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
    }, 'parent-view-duplicate')
    await composition.handleCommand(duplicateCommand)
    await composition.handleCommand(duplicateCommand)

    expect(openCalls).toEqual(['parent-init-duplicate', 'parent-view-duplicate'])
    expect(sent.filter((event) => event.type === 'view.changed')).toHaveLength(2)
    expect(sent.filter((event) => event.type === 'command.result' && event.replyTo === 'parent-view-duplicate')).toHaveLength(2)
    composition.dispose()
  })

  it('安装同场景流程动作后才发布能力、转交命令并在成功时派生一次稳定视图事件', async () => {
    const workflowTrigger: HostWorkflowTriggerPort = {
      submit: vi.fn().mockResolvedValue({ success: true, status: 'completed', contextRevision: 2 }),
    }
    const { composition, sent } = createComposition(async () => ({ success: true }), workflowTrigger)
    composition.start()
    await composition.handleCommand(createCommand('system.init', {
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
    }, 'parent-init-workflow'))

    await composition.handleCommand(createCommand('workflow.trigger', {
      actionId: toActionId('action.gas.reset'),
      expectedContextRevision: 1,
    }, 'parent-workflow-01'))

    expect(workflowTrigger.submit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'workflow.trigger',
      correlationId: 'parent-workflow-01',
    }))
    expect(sent.some((event) => event.type === 'command.result' && event.replyTo === 'parent-workflow-01')).toBe(true)
    expect(sent.filter((event) => event.type === 'view.changed')).toHaveLength(2)
    composition.dispose()
  })

  it('安装批量状态协调器后才发布能力、转交状态命令，并在释放时清空有限诊断', async () => {
    const deviceStatesUpdate: HostDeviceStatesUpdatePort = {
      submit: vi.fn().mockResolvedValue({ success: true, status: 'completed' }),
      dispose: vi.fn(),
    }
    const { composition, sent } = createComposition(async () => ({ success: true }), undefined, deviceStatesUpdate)
    composition.start()
    await composition.handleCommand(createCommand('system.init', {
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
    }, 'parent-init-device-states'))

    const ready = sent.find((event) => event.type === 'system.ready')
    expect(ready).toEqual(expect.objectContaining({
      payload: expect.objectContaining({ commandCapabilities: expect.arrayContaining(['device.states.update']) }),
    }))

    await composition.handleCommand(createCommand('device.states.update', {
      sourceRevision: 1,
      items: [{ deviceId: toDeviceId('device.turbine'), deviceStatus: 'alarm', statusUpdatedAt: '2026-08-05T00:00:00.000Z' }],
    }, 'parent-device-states-01'))

    expect(deviceStatesUpdate.submit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'device.states.update',
      correlationId: 'parent-device-states-01',
    }))
    expect(sent.some((event) => event.type === 'command.result' && event.replyTo === 'parent-device-states-01')).toBe(true)
    composition.dispose()
    expect(deviceStatesUpdate.dispose).toHaveBeenCalledTimes(1)
  })
})

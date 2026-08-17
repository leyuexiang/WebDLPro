import { describe, expect, it, vi } from 'vitest'
import type { HostDispatchableDomainCommand } from '@/host-bridge/host-command-dispatcher'
import { toNodeId, toSceneActivationId, toSceneNodeId } from '@/config/scene-topology/identifiers'
import type { TopologyNodeStateApplyResult, TopologySceneNodeVisualStateUpdate } from '@/modules/visual/topology/topology-device-state-cache'
import type { TopologyRuntime } from '@/modules/visual/topology/topology-runtime'
import { DeviceStatesUpdateCoordinator, type DeviceStatesFrameScheduler, type DeviceStatesUnityPort } from '@/modules/visual/orchestration/device-states-update-coordinator'

const sceneNodeId = toSceneNodeId('scene-node.test')

/** 构造最小已提交完整快照；测试只验证任务-038协调边界，不声明真实业务设备映射。 */
function createTopologyResult(overrides: Partial<TopologyNodeStateApplyResult> = {}): TopologyNodeStateApplyResult {
  return {
    committed: true,
    capacityExceeded: false,
    snapshotSequence: 1,
    acceptedNodeIds: [toNodeId('node.test')],
    restoredNodeIds: [],
    outdatedNodeIds: [],
    unmappedNodeIds: [],
    invalidTimestampNodeIds: [],
    activeTopologyNodeStatuses: new Map(),
    activeSceneNodeStatuses: new Map([[sceneNodeId, 'alarm']]),
    activeSceneNodeStateUpdates: new Map([[sceneNodeId, createState('alarm', 100)]]),
    clearedActiveSceneNodeIds: [],
    ...overrides,
  }
}

/** 平台时间与来源修订只作为诊断值构造，不决定本地快照顺序。 */
function createState(
  visualState: TopologySceneNodeVisualStateUpdate['visualState'],
  sourceRevision: number,
  statusUpdatedAt = '2026-08-05T00:00:00.000Z',
): TopologySceneNodeVisualStateUpdate {
  return { visualState, statusUpdatedAt, sourceRevision }
}

/** 外层命令夹具始终经过领域分派器类型，避免协调器测试绕开完整快照载荷。 */
function createCommand(correlationId: string, sourceRevision = 100): Extract<HostDispatchableDomainCommand, { type: 'device.states.update' }> {
  return {
    type: 'device.states.update',
    correlationId,
    payload: {
      sourceRevision,
      items: [{ nodeId: toNodeId('node.test'), deviceStatus: 'alarm', statusUpdatedAt: '2026-08-05T00:00:00.000Z' }],
    },
  }
}

/** 运行时替身同时公开完整快照提交和恢复重投影端口，不创建画布或 Unity 实例。 */
function createTopologyRuntime(results: readonly TopologyNodeStateApplyResult[]): {
  runtime: TopologyRuntime
  applyDeviceStates: ReturnType<typeof vi.fn>
  getActiveSceneNodeStateSnapshot: ReturnType<typeof vi.fn>
} {
  const applyDeviceStates = vi.fn()
  for (const result of results) applyDeviceStates.mockReturnValueOnce(result)
  const latest = results.at(-1) ?? createTopologyResult({ snapshotSequence: 0, activeSceneNodeStateUpdates: new Map() })
  const getActiveSceneNodeStateSnapshot = vi.fn().mockReturnValue({
    snapshotSequence: latest.snapshotSequence,
    updates: latest.activeSceneNodeStateUpdates,
  })
  return {
    runtime: { applyDeviceStates, getActiveSceneNodeStateSnapshot } as unknown as TopologyRuntime,
    applyDeviceStates,
    getActiveSceneNodeStateSnapshot,
  }
}

/** Unity 替身只记录稳定节点、四态、本地序号和两个诊断字段，不存储完整父页面消息。 */
function createUnityPort(options: { supported?: boolean; success?: boolean } = {}): DeviceStatesUnityPort & {
  setNodeVisualState: ReturnType<typeof vi.fn>
  clearNodeVisualState: ReturnType<typeof vi.fn>
} {
  return {
    supportsNodeVisualState: () => options.supported ?? true,
    setNodeVisualState: vi.fn().mockResolvedValue({ success: options.success ?? true }),
    clearNodeVisualState: vi.fn().mockResolvedValue({ success: options.success ?? true }),
  }
}

/** 手动帧调度器把“同一动画帧”固定为显式 flush，避免测试依赖浏览器刷新频率。 */
function createFrameScheduler(): DeviceStatesFrameScheduler & { flush(): void } {
  let callback: (() => void) | undefined
  const request = vi.fn((next: () => void) => {
    callback = next
    return 1
  }) as unknown as DeviceStatesFrameScheduler['request']
  const cancel = vi.fn((_handle: unknown) => { callback = undefined }) as unknown as DeviceStatesFrameScheduler['cancel']
  return {
    request,
    cancel,
    flush: () => {
      const scheduled = callback
      callback = undefined
      scheduled?.()
    },
  }
}

/** 等待异步工作池完成，不使用真实计时器。 */
async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('设备状态批量协调器', () => {
  it('二维完整快照提交后立即返回唯一成功，不等待动画帧或 Unity 回执', async () => {
    const topologyResult = createTopologyResult()
    const { runtime, applyDeviceStates } = createTopologyRuntime([topologyResult])
    const unity = createUnityPort()
    const frameScheduler = createFrameScheduler()
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, unity, { frameScheduler })

    await expect(coordinator.submit(createCommand('state-immediate-success'))).resolves.toEqual({ success: true, status: 'completed' })

    expect(applyDeviceStates).toHaveBeenCalledTimes(1)
    expect(unity.setNodeVisualState).not.toHaveBeenCalled()
    expect(coordinator.getDiagnostics()).toEqual([expect.objectContaining({
      correlationId: 'state-immediate-success',
      snapshotSequence: 1,
      sourceRevision: 100,
      unityTargetCount: 1,
      unitySucceededCount: 0,
    })])

    frameScheduler.flush()
    await flushPromises()
    expect(unity.setNodeVisualState).toHaveBeenCalledWith(
      sceneNodeId,
      'alarm',
      1,
      '2026-08-05T00:00:00.000Z',
      100,
    )
    expect(coordinator.getDiagnostics()[0]).toEqual(expect.objectContaining({ unitySucceededCount: 1, unityFailedCount: 0 }))
  })

  it('Unity能力缺失或节点失败只进入内部诊断，不改变、延迟或补发外层成功', async () => {
    const missingRuntime = createTopologyRuntime([createTopologyResult()]).runtime
    const missingUnity = createUnityPort({ supported: false })
    const missingFrame = createFrameScheduler()
    const missingCoordinator = new DeviceStatesUpdateCoordinator(missingRuntime, missingUnity, { frameScheduler: missingFrame })

    await expect(missingCoordinator.submit(createCommand('state-capability-missing'))).resolves.toEqual({ success: true, status: 'completed' })
    missingFrame.flush()
    await flushPromises()
    expect(missingUnity.setNodeVisualState).not.toHaveBeenCalled()
    expect(missingCoordinator.getDiagnostics()[0]).toEqual(expect.objectContaining({ unityUnavailable: true, unityFailedCount: 1 }))

    const failedRuntime = createTopologyRuntime([createTopologyResult()]).runtime
    const failedUnity = createUnityPort({ success: false })
    const failedFrame = createFrameScheduler()
    const failedCoordinator = new DeviceStatesUpdateCoordinator(failedRuntime, failedUnity, { frameScheduler: failedFrame })
    await expect(failedCoordinator.submit(createCommand('state-unity-failed'))).resolves.toEqual({ success: true, status: 'completed' })
    failedFrame.flush()
    await flushPromises()
    expect(failedCoordinator.getDiagnostics()[0]).toEqual(expect.objectContaining({ unityUnavailable: false, unityFailedCount: 1 }))
  })

  it('同帧只发送最新本地序号，较小平台来源修订的后到合法快照仍覆盖旧快照', async () => {
    const first = createTopologyResult({
      snapshotSequence: 1,
      activeSceneNodeStateUpdates: new Map([[sceneNodeId, createState('alarm', 900)]]),
    })
    const second = createTopologyResult({
      snapshotSequence: 2,
      activeSceneNodeStateUpdates: new Map([[sceneNodeId, createState('fault', 1, '2026-08-04T00:00:00.000Z')]]),
    })
    const { runtime } = createTopologyRuntime([first, second])
    const unity = createUnityPort()
    const frameScheduler = createFrameScheduler()
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, unity, { frameScheduler })

    await coordinator.submit(createCommand('state-first', 900))
    await coordinator.submit(createCommand('state-second', 1))
    frameScheduler.flush()
    await flushPromises()

    expect(unity.setNodeVisualState).toHaveBeenCalledTimes(1)
    expect(unity.setNodeVisualState).toHaveBeenCalledWith(sceneNodeId, 'fault', 2, '2026-08-04T00:00:00.000Z', 1)
    expect(coordinator.getDiagnostics()).toEqual([
      expect.objectContaining({ correlationId: 'state-first', unityFrameMergedCount: 1 }),
      expect.objectContaining({ correlationId: 'state-second', sourceRevision: 1, unitySucceededCount: 1 }),
    ])
  })

  it('同帧被替换批次会立即完成有限诊断耗时，而不是停留在二维提交时点', async () => {
    const first = createTopologyResult({ snapshotSequence: 1 })
    const second = createTopologyResult({ snapshotSequence: 2 })
    const { runtime } = createTopologyRuntime([first, second])
    const frameScheduler = createFrameScheduler()
    const timePoints = [10, 20, 30, 40, 50]
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, createUnityPort(), {
      frameScheduler,
      now: () => timePoints.shift() ?? 50,
    })

    await coordinator.submit(createCommand('state-diagnostic-first'))
    await coordinator.submit(createCommand('state-diagnostic-second'))

    expect(coordinator.getDiagnostics()[0]).toEqual(expect.objectContaining({
      correlationId: 'state-diagnostic-first',
      processedAt: 50,
      elapsedMilliseconds: 40,
      unityFrameMergedCount: 1,
    }))
  })

  it('工作池等待期间出现新快照后跳过旧序号剩余目标，并在下一帧发送新快照', async () => {
    const secondNodeId = toSceneNodeId('scene-node.second')
    const first = createTopologyResult({
      snapshotSequence: 1,
      activeSceneNodeStateUpdates: new Map([
        [sceneNodeId, createState('alarm', 10)],
        [secondNodeId, createState('alarm', 10)],
      ]),
    })
    const second = createTopologyResult({
      snapshotSequence: 2,
      activeSceneNodeStateUpdates: new Map([[sceneNodeId, createState('fault', 9)]]),
    })
    const { runtime } = createTopologyRuntime([first, second])
    const unity = createUnityPort()
    let resolveFirst: ((value: { success: boolean }) => void) | undefined
    unity.setNodeVisualState.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    const frameScheduler = createFrameScheduler()
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, unity, { frameScheduler, maximumConcurrentUnityCommands: 1 })

    await coordinator.submit(createCommand('state-inflight-first', 10))
    frameScheduler.flush()
    await flushPromises()
    expect(unity.setNodeVisualState).toHaveBeenCalledTimes(1)

    await coordinator.submit(createCommand('state-inflight-second', 9))
    resolveFirst?.({ success: true })
    await flushPromises()
    // 旧批第二个节点因序号落后被跳过；新快照在唯一工作池结束后进入下一帧。
    expect(unity.setNodeVisualState).toHaveBeenCalledTimes(1)
    expect(coordinator.getDiagnostics()[0]).toEqual(expect.objectContaining({ unityStaleSkippedCount: 1 }))

    frameScheduler.flush()
    await flushPromises()
    expect(unity.setNodeVisualState).toHaveBeenCalledTimes(2)
    expect(unity.setNodeVisualState).toHaveBeenLastCalledWith(sceneNodeId, 'fault', 2, '2026-08-05T00:00:00.000Z', 9)
  })

  it('物理场景激活标识变化后跳过旧场景工作池剩余目标，并只向新代次重放完整投影', async () => {
    const secondNodeId = toSceneNodeId('scene-node.second')
    const latest = createTopologyResult({
      snapshotSequence: 5,
      activeSceneNodeStateUpdates: new Map([
        [sceneNodeId, createState('alarm', 5)],
        [secondNodeId, createState('fault', 5)],
      ]),
    })
    const { runtime, getActiveSceneNodeStateSnapshot } = createTopologyRuntime([latest])
    // 首次登记物理场景时不重放尚不存在的状态；场景切换后才返回当前权威完整投影。
    getActiveSceneNodeStateSnapshot
      .mockReturnValueOnce({ snapshotSequence: 0, updates: new Map() })
      .mockReturnValue({ snapshotSequence: 5, updates: latest.activeSceneNodeStateUpdates })
    const unity = createUnityPort()
    let resolveOldFirst: ((value: { success: boolean }) => void) | undefined
    unity.setNodeVisualState.mockImplementationOnce(() => new Promise((resolve) => { resolveOldFirst = resolve }))
    const frameScheduler = createFrameScheduler()
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, unity, {
      frameScheduler,
      maximumConcurrentUnityCommands: 1,
    })

    coordinator.resynchronizeLatestSnapshot(toSceneActivationId('scene-activation.old'))
    await coordinator.submit(createCommand('state-old-physical-scene'))
    frameScheduler.flush()
    await flushPromises()
    expect(unity.setNodeVisualState).toHaveBeenCalledTimes(1)

    coordinator.resynchronizeLatestSnapshot(toSceneActivationId('scene-activation.new'))
    resolveOldFirst?.({ success: true })
    await flushPromises()
    // 旧工作池第二个节点尚未发送，物理场景代次变化后必须被拦截。
    expect(unity.setNodeVisualState).toHaveBeenCalledTimes(1)
    expect(coordinator.getDiagnostics()[0]).toEqual(expect.objectContaining({ unityStaleSkippedCount: 1 }))

    frameScheduler.flush()
    await flushPromises()
    // 新控制器从同一份权威快照重新接收两个目标；旧批只留下首个已发送命令。
    expect(unity.setNodeVisualState).toHaveBeenCalledTimes(3)
    expect(coordinator.getDiagnostics().at(-1)).toEqual(expect.objectContaining({
      correlationId: 'internal-state-replay',
      unityTargetCount: 2,
      unitySucceededCount: 2,
    }))
  })

  it('设备从完整快照消失时发送独立清除命令，不把缺失误判为离线或正常', async () => {
    const first = createTopologyResult()
    const second = createTopologyResult({
      snapshotSequence: 2,
      activeSceneNodeStatuses: new Map(),
      activeSceneNodeStateUpdates: new Map(),
      clearedActiveSceneNodeIds: [sceneNodeId],
    })
    const { runtime } = createTopologyRuntime([first, second])
    const unity = createUnityPort()
    const frameScheduler = createFrameScheduler()
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, unity, { frameScheduler })

    await coordinator.submit(createCommand('state-before-empty'))
    await coordinator.submit(createCommand('state-empty'))
    frameScheduler.flush()
    await flushPromises()

    expect(unity.setNodeVisualState).not.toHaveBeenCalled()
    expect(unity.clearNodeVisualState).toHaveBeenCalledTimes(1)
    expect(unity.clearNodeVisualState).toHaveBeenCalledWith(sceneNodeId, 2)
    expect(coordinator.getDiagnostics()[0]).toEqual(expect.objectContaining({ unityFrameMergedCount: 1 }))
    expect(coordinator.getDiagnostics()[1]).toEqual(expect.objectContaining({ unitySucceededCount: 1 }))
  })

  it('清除失败只写诊断并在下一份完整快照按新序号重试，不改变两次外层成功', async () => {
    const first = createTopologyResult({
      snapshotSequence: 2,
      activeSceneNodeStatuses: new Map(),
      activeSceneNodeStateUpdates: new Map(),
      clearedActiveSceneNodeIds: [sceneNodeId],
    })
    const second = createTopologyResult({
      snapshotSequence: 3,
      activeSceneNodeStatuses: new Map(),
      activeSceneNodeStateUpdates: new Map(),
      clearedActiveSceneNodeIds: [],
    })
    const { runtime } = createTopologyRuntime([first, second])
    const unity = createUnityPort()
    unity.clearNodeVisualState.mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: true })
    const frameScheduler = createFrameScheduler()
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, unity, { frameScheduler })

    await expect(coordinator.submit(createCommand('state-clear-first'))).resolves.toEqual({ success: true, status: 'completed' })
    frameScheduler.flush()
    await flushPromises()
    expect(coordinator.getDiagnostics()[0]).toEqual(expect.objectContaining({ unityFailedCount: 1 }))

    await expect(coordinator.submit(createCommand('state-clear-retry'))).resolves.toEqual({ success: true, status: 'completed' })
    frameScheduler.flush()
    await flushPromises()
    expect(unity.clearNodeVisualState).toHaveBeenNthCalledWith(1, sceneNodeId, 2)
    expect(unity.clearNodeVisualState).toHaveBeenNthCalledWith(2, sceneNodeId, 3)
    expect(coordinator.getDiagnostics()[1]).toEqual(expect.objectContaining({
      // 第二份拓扑结果没有新增节点，但最终三维操作包含上一份快照留下的一个清除债务。
      unityTargetCount: 1,
      unitySucceededCount: 1,
    }))
  })

  it('诊断目标数按最终节点操作去重，不把同节点设置与清除重复计数', async () => {
    const overlapping = createTopologyResult({
      activeSceneNodeStateUpdates: new Map([[sceneNodeId, createState('fault', 3)]]),
      // 防御性模拟上游同时列出同一节点；最终操作表按节点标识只保留清除。
      clearedActiveSceneNodeIds: [sceneNodeId],
    })
    const { runtime } = createTopologyRuntime([overlapping])
    const unity = createUnityPort()
    const frameScheduler = createFrameScheduler()
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, unity, { frameScheduler })

    await coordinator.submit(createCommand('state-deduplicated-target'))
    expect(coordinator.getDiagnostics()[0]).toEqual(expect.objectContaining({ unityTargetCount: 1 }))

    frameScheduler.flush()
    await flushPromises()
    expect(unity.setNodeVisualState).not.toHaveBeenCalled()
    expect(unity.clearNodeVisualState).toHaveBeenCalledTimes(1)
  })

  it('场景重新激活只从缓存重放最新权威快照和本地序号', async () => {
    const latest = createTopologyResult({
      snapshotSequence: 7,
      activeSceneNodeStateUpdates: new Map([[sceneNodeId, createState('offline', 2, '2026-08-03T00:00:00.000Z')]]),
    })
    const { runtime, getActiveSceneNodeStateSnapshot } = createTopologyRuntime([latest])
    const unity = createUnityPort()
    const frameScheduler = createFrameScheduler()
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, unity, { frameScheduler })

    coordinator.resynchronizeLatestSnapshot()
    frameScheduler.flush()
    await flushPromises()

    expect(getActiveSceneNodeStateSnapshot).toHaveBeenCalledTimes(1)
    expect(unity.setNodeVisualState).toHaveBeenCalledWith(sceneNodeId, 'offline', 7, '2026-08-03T00:00:00.000Z', 2)
  })

  it('最新权威快照没有三维目标或清除债务时不生成空重同步诊断', () => {
    const empty = createTopologyResult({
      snapshotSequence: 4,
      activeSceneNodeStatuses: new Map(),
      activeSceneNodeStateUpdates: new Map(),
      clearedActiveSceneNodeIds: [],
    })
    const { runtime, getActiveSceneNodeStateSnapshot } = createTopologyRuntime([empty])
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, createUnityPort(), { frameScheduler: createFrameScheduler() })

    coordinator.resynchronizeLatestSnapshot()

    expect(getActiveSceneNodeStateSnapshot).toHaveBeenCalledTimes(1)
    expect(coordinator.getDiagnostics()).toEqual([])
  })

  it('只有二维未提交、容量超限或已释放时允许外层失败', async () => {
    const rejected = createTopologyResult({ committed: false, capacityExceeded: true })
    const { runtime } = createTopologyRuntime([rejected])
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, createUnityPort())

    await expect(coordinator.submit(createCommand('state-capacity'))).resolves.toEqual(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'protocol.capacity.exceeded' }),
    }))

    coordinator.dispose()
    await expect(coordinator.submit(createCommand('state-after-dispose'))).resolves.toEqual(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'runtime.disposed' }),
    }))
  })

  it('诊断固定容量且释放会取消待发三维任务，不反向改变此前外层成功', async () => {
    const empty = createTopologyResult({ activeSceneNodeStateUpdates: new Map() })
    const { runtime } = createTopologyRuntime([empty, { ...empty, snapshotSequence: 2 }, { ...empty, snapshotSequence: 3 }])
    const unity = createUnityPort()
    const frameScheduler = createFrameScheduler()
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, unity, { frameScheduler, maximumDiagnostics: 2 })

    await expect(coordinator.submit(createCommand('state-01'))).resolves.toEqual({ success: true, status: 'completed' })
    await coordinator.submit(createCommand('state-02'))
    await coordinator.submit(createCommand('state-03'))
    expect(coordinator.getDiagnostics().map((diagnostic) => diagnostic.correlationId)).toEqual(['state-02', 'state-03'])

    coordinator.dispose()
    frameScheduler.flush()
    await flushPromises()
    expect(unity.setNodeVisualState).not.toHaveBeenCalled()
    expect(coordinator.getDiagnostics()).toEqual([])
  })
})

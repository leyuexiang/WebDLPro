import { describe, expect, it, vi } from 'vitest'
import type { HostDispatchableDomainCommand } from '@/host-bridge/host-command-dispatcher'
import { toDeviceId, toSceneNodeId } from '@/config/scene-topology/identifiers'
import type { TopologyDeviceStateApplyResult } from '@/modules/visual/topology/topology-device-state-cache'
import type { TopologyRuntime } from '@/modules/visual/topology/topology-runtime'
import { DeviceStatesUpdateCoordinator, type DeviceStatesUnityPort } from '@/modules/visual/orchestration/device-states-update-coordinator'

/** 构造最小状态缓存返回值；测试仅验证任务-038协调边界，不声明真实业务映射。 */
function createTopologyResult(overrides: Partial<TopologyDeviceStateApplyResult> = {}): TopologyDeviceStateApplyResult {
  return {
    acceptedDeviceIds: [toDeviceId('device.test')],
    outdatedDeviceIds: [],
    unmappedDeviceIds: [],
    invalidTimestampDeviceIds: [],
    activeTopologyNodeStatuses: new Map(),
    activeSceneNodeStatuses: new Map([[toSceneNodeId('scene-node.test'), 'alarm']]),
    ...overrides,
  }
}

/** 外层命令夹具始终经过领域分派器类型，避免协调器测试绕开批量载荷的固定结构。 */
function createCommand(correlationId: string): Extract<HostDispatchableDomainCommand, { type: 'device.states.update' }> {
  return {
    type: 'device.states.update',
    correlationId,
    payload: {
      sourceRevision: 1,
      items: [{ deviceId: toDeviceId('device.test'), deviceStatus: 'alarm', statusUpdatedAt: '2026-08-05T00:00:00.000Z' }],
    },
  }
}

/** 运行时替身只公开任务-038真正依赖的批量状态入口，防止测试意外耦合画布或注册表内部实现。 */
function createTopologyRuntime(result: TopologyDeviceStateApplyResult): { runtime: TopologyRuntime; applyDeviceStates: ReturnType<typeof vi.fn> } {
  const applyDeviceStates = vi.fn().mockReturnValue(result)
  return { runtime: { applyDeviceStates } as unknown as TopologyRuntime, applyDeviceStates }
}

/** Unity 替身只记录稳定三维节点与四态，既不暴露窗口，也不存储完整父页面消息。 */
function createUnityPort(options: { supported?: boolean; success?: boolean } = {}): DeviceStatesUnityPort & { setNodeVisualState: ReturnType<typeof vi.fn> } {
  return {
    supportsNodeVisualState: () => options.supported ?? true,
    setNodeVisualState: vi.fn().mockResolvedValue({ success: options.success ?? true }),
  }
}

describe('设备状态批量协调器', () => {
  it('先更新二维缓存，再向已协商 Unity 下发当前活动场景的显式状态，并记录有限摘要', async () => {
    const { runtime, applyDeviceStates } = createTopologyRuntime(createTopologyResult())
    const unity = createUnityPort()
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, unity, { now: () => 100 })

    const result = await coordinator.submit(createCommand('state-batch-01'))

    expect(result).toEqual({ success: true, status: 'completed' })
    expect(applyDeviceStates).toHaveBeenCalledWith(expect.objectContaining({ items: expect.any(Array) }))
    expect(unity.setNodeVisualState).toHaveBeenCalledWith(toSceneNodeId('scene-node.test'), 'alarm')
    expect(coordinator.getDiagnostics()).toEqual([expect.objectContaining({
      correlationId: 'state-batch-01',
      acceptedCount: 1,
      unityTargetCount: 1,
      unitySucceededCount: 1,
      unityFailedCount: 0,
      unityUnavailable: false,
    })])
  })

  it('Unity 回执失败不回滚已应用的二维状态，但外层命令必须明确失败', async () => {
    const { runtime, applyDeviceStates } = createTopologyRuntime(createTopologyResult())
    const unity = createUnityPort({ success: false })
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, unity)

    const result = await coordinator.submit(createCommand('state-batch-unity-failed'))

    expect(applyDeviceStates).toHaveBeenCalledTimes(1)
    expect(result).toEqual(expect.objectContaining({
      success: false,
      status: 'failed',
      error: expect.objectContaining({ code: 'action.execute.failed', recoverable: true }),
    }))
    expect(coordinator.getDiagnostics()[0]).toEqual(expect.objectContaining({ unityFailedCount: 1, unitySucceededCount: 0 }))
  })

  it('单个 Unity 请求异常不会中断同批其他节点，且会归入受控失败与有限诊断', async () => {
    const result = createTopologyResult({
      activeSceneNodeStatuses: new Map([
        [toSceneNodeId('scene-node.first'), 'alarm'],
        [toSceneNodeId('scene-node.second'), 'fault'],
      ]),
    })
    const { runtime } = createTopologyRuntime(result)
    const unity = createUnityPort()
    unity.setNodeVisualState
      .mockRejectedValueOnce(new Error('仅用于验证协调器的内层异常隔离'))
      .mockResolvedValueOnce({ success: true })
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, unity, { maximumConcurrentUnityCommands: 1 })

    const execution = await coordinator.submit(createCommand('state-batch-unity-rejected'))

    expect(unity.setNodeVisualState).toHaveBeenCalledTimes(2)
    expect(execution).toEqual(expect.objectContaining({ success: false, status: 'failed' }))
    expect(coordinator.getDiagnostics()[0]).toEqual(expect.objectContaining({ unityFailedCount: 1, unitySucceededCount: 1 }))
  })

  it('未协商四态能力时不向 Unity 发送命令，并以受控失败区分二维与三维结果', async () => {
    const { runtime } = createTopologyRuntime(createTopologyResult())
    const unity = createUnityPort({ supported: false })
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, unity)

    const result = await coordinator.submit(createCommand('state-batch-capability-missing'))

    expect(unity.setNodeVisualState).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'action.execute.failed' }) }))
    expect(coordinator.getDiagnostics()[0]).toEqual(expect.objectContaining({ unityUnavailable: true, unityTargetCount: 1 }))
  })

  it('诊断队列严格受限，释放后不保留历史关联标识或批次统计', async () => {
    const { runtime } = createTopologyRuntime(createTopologyResult({ activeSceneNodeStatuses: new Map() }))
    const coordinator = new DeviceStatesUpdateCoordinator(runtime, createUnityPort(), { maximumDiagnostics: 2 })

    await coordinator.submit(createCommand('state-batch-01'))
    await coordinator.submit(createCommand('state-batch-02'))
    await coordinator.submit(createCommand('state-batch-03'))

    expect(coordinator.getDiagnostics().map((diagnostic) => diagnostic.correlationId)).toEqual(['state-batch-02', 'state-batch-03'])
    coordinator.dispose()
    expect(coordinator.getDiagnostics()).toEqual([])
  })
})

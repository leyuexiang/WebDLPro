import { afterEach, describe, expect, it, vi } from 'vitest'
import { toNodeId, toSceneId, toSessionId, toTopologyId } from '@/config/scene-topology/identifiers'
import { HOST_COMMAND_TIMEOUT_MS, HOST_SCENE_TRANSACTION_TIMEOUT_MS, HostCommandLifecycle, HostMessageReceiptRegistry } from '@/host-bridge/host-command-lifecycle'
import type { HostCommandMessage } from '@/host-bridge/host-protocol'

/** 生命周期基础夹具使用无业务副作用的状态查询命令，具体测试只替换消息标识。 */
function createStateGetCommand(messageId = 'parent-command-01'): HostCommandMessage {
  return {
    channel: 'power-scene-topology-shell',
    version: 2,
    instanceId: 'visual-shell-01',
    sessionId: toSessionId('session-test-01'),
    messageId,
    type: 'state.get',
    timestamp: 1,
    payload: {},
  }
}

/** 跨场景夹具只使用稳定标识，用于验证长事务上限，不引入模型名或资源路径。 */
function createViewOpenCommand(messageId = 'parent-view-open-timeout'): HostCommandMessage {
  return {
    channel: 'power-scene-topology-shell',
    version: 2,
    instanceId: 'visual-shell-01',
    sessionId: toSessionId('session-test-01'),
    messageId,
    type: 'view.open',
    timestamp: 1,
    payload: {
      sceneId: toSceneId('coal-power'),
      topologyId: toTopologyId('topology.coal-power.overview'),
    },
  }
}

/** 设备状态夹具遵守任务-007已经关闭的设备号、时区时间和必填来源修订号契约。 */
function createDeviceStatesUpdateCommand(messageId: string, sourceRevision = 1): HostCommandMessage {
  return {
    channel: 'power-scene-topology-shell',
    version: 2,
    instanceId: 'visual-shell-01',
    sessionId: toSessionId('session-test-01'),
    messageId,
    type: 'device.states.update',
    timestamp: 1,
    payload: {
      sourceRevision,
      items: [{
        nodeId: toNodeId('node.test.01'),
        deviceStatus: 'normal',
        statusUpdatedAt: '2026-08-11T12:00:00.000+08:00',
      }],
    },
  }
}

describe('外层命令生命周期', () => {
  afterEach(() => vi.useRealTimers())

  it('重复已完成消息静默丢弃，不回放结果且不重复执行', async () => {
    const executor = vi.fn().mockResolvedValue({ success: true, status: 'completed' as const, contextRevision: 1 })
    const lifecycle = new HostCommandLifecycle(executor)
    const first = await lifecycle.execute(createStateGetCommand())
    const duplicate = await lifecycle.execute(createStateGetCommand())

    expect(executor).toHaveBeenCalledTimes(1)
    expect(first).toEqual(expect.objectContaining({
      status: 'result',
      result: expect.objectContaining({ replyTo: 'parent-command-01', source: 'executed' }),
    }))
    expect(duplicate).toEqual({ status: 'ignored-duplicate' })
    expect(lifecycle.getRecentMessageIds()).toEqual(['parent-command-01'])
  })

  it('同一进行中消息静默丢弃，并保留唯一待确认项', async () => {
    let resolveExecution: ((value: { success: true; status: 'completed' }) => void) | undefined
    const lifecycle = new HostCommandLifecycle(() => new Promise((resolve) => { resolveExecution = resolve }))
    const firstPromise = lifecycle.execute(createStateGetCommand())
    const duplicate = await lifecycle.execute(createStateGetCommand())

    expect(duplicate).toEqual({ status: 'ignored-duplicate' })
    expect(lifecycle.getPendingCount()).toBe(1)

    resolveExecution?.({ success: true, status: 'completed' })
    await firstPromise
    expect(lifecycle.getPendingCount()).toBe(0)
  })

  it('跨场景原子事务不受普通十秒上限误杀，但仍受绝对上限约束', async () => {
    vi.useFakeTimers()
    const lifecycle = new HostCommandLifecycle(() => new Promise(() => {}))
    const resultPromise = lifecycle.execute(createViewOpenCommand())

    await vi.advanceTimersByTimeAsync(HOST_COMMAND_TIMEOUT_MS)
    expect(lifecycle.getPendingCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(HOST_SCENE_TRANSACTION_TIMEOUT_MS - HOST_COMMAND_TIMEOUT_MS)
    await expect(resultPromise).resolves.toEqual(expect.objectContaining({
      status: 'result',
      result: expect.objectContaining({
        source: 'timeout',
        payload: expect.objectContaining({ error: expect.objectContaining({ code: 'command.timeout' }) }),
      }),
    }))
    expect(lifecycle.getPendingCount()).toBe(0)
  })

  it('同一会话只允许一条设备状态命令在途，但不阻塞普通查询', async () => {
    const resolvers = new Map<string, (value: { success: true; status: 'completed' }) => void>()
    const executor = vi.fn((command: HostCommandMessage) => new Promise<{ success: true; status: 'completed' }>((resolve) => {
      resolvers.set(command.messageId, resolve)
    }))
    const lifecycle = new HostCommandLifecycle(executor)

    const firstStatePromise = lifecycle.execute(createDeviceStatesUpdateCommand('parent-state-batch-01'))
    const queryPromise = lifecycle.execute(createStateGetCommand('parent-query-during-state'))
    const secondState = await lifecycle.execute(createDeviceStatesUpdateCommand('parent-state-batch-02', 2))

    expect(executor).toHaveBeenCalledTimes(2)
    expect(lifecycle.getPendingCount()).toBe(2)
    expect(lifecycle.hasPendingDeviceStatesUpdate()).toBe(true)
    expect(secondState).toEqual(expect.objectContaining({
      status: 'result',
      result: expect.objectContaining({
        replyTo: 'parent-state-batch-02',
        source: 'capacity',
        payload: expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'protocol.capacity.exceeded' }) }),
      }),
    }))
    // 容量失败同样只允许发送一次；相同消息标识的再次到达必须静默结束。
    await expect(lifecycle.execute(createDeviceStatesUpdateCommand('parent-state-batch-02', 2))).resolves.toEqual({ status: 'ignored-duplicate' })

    resolvers.get('parent-state-batch-01')?.({ success: true, status: 'completed' })
    resolvers.get('parent-query-during-state')?.({ success: true, status: 'completed' })
    await Promise.all([firstStatePromise, queryPromise])
    expect(lifecycle.hasPendingDeviceStatesUpdate()).toBe(false)

    const thirdStatePromise = lifecycle.execute(createDeviceStatesUpdateCommand('parent-state-batch-03', 3))
    await Promise.resolve()
    expect(executor).toHaveBeenCalledTimes(3)
    resolvers.get('parent-state-batch-03')?.({ success: true, status: 'completed' })
    await expect(thirdStatePromise).resolves.toEqual(expect.objectContaining({
      status: 'result',
      result: expect.objectContaining({ source: 'executed' }),
    }))
  })

  it('超时后清理设备状态槽位、记住消息标识，并忽略迟到完成', async () => {
    vi.useFakeTimers()
    let resolveExecution: ((value: { success: true; status: 'completed' }) => void) | undefined
    const lifecycle = new HostCommandLifecycle(() => new Promise((resolve) => { resolveExecution = resolve }))
    const command = createDeviceStatesUpdateCommand('parent-state-timeout')
    const resultPromise = lifecycle.execute(command)

    vi.advanceTimersByTime(HOST_COMMAND_TIMEOUT_MS)
    const outcome = await resultPromise
    resolveExecution?.({ success: true, status: 'completed' })
    await Promise.resolve()

    expect(outcome).toEqual(expect.objectContaining({
      status: 'result',
      result: expect.objectContaining({
        source: 'timeout',
        payload: expect.objectContaining({ error: expect.objectContaining({ code: 'command.timeout' }) }),
      }),
    }))
    expect(lifecycle.getPendingCount()).toBe(0)
    expect(lifecycle.hasPendingDeviceStatesUpdate()).toBe(false)
    expect(lifecycle.getRecentMessageIds()).toEqual(['parent-state-timeout'])
    await expect(lifecycle.execute(command)).resolves.toEqual({ status: 'ignored-duplicate' })
  })

  it('超时观察器异常不阻断清理、唯一超时结果和迟到隔离', async () => {
    vi.useFakeTimers()
    let resolveExecution: ((value: { success: true; status: 'completed' }) => void) | undefined
    const onTimeout = vi.fn(() => { throw new Error('测试观察器异常') })
    const command = createStateGetCommand('parent-command-timeout-cancel')
    const lifecycle = new HostCommandLifecycle(
      () => new Promise((resolve) => { resolveExecution = resolve }),
      globalThis,
      HOST_COMMAND_TIMEOUT_MS,
      64,
      256,
      onTimeout,
    )

    const resultPromise = lifecycle.execute(command)
    vi.advanceTimersByTime(HOST_COMMAND_TIMEOUT_MS)
    const outcome = await resultPromise
    resolveExecution?.({ success: true, status: 'completed' })
    await Promise.resolve()

    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onTimeout).toHaveBeenCalledWith(command)
    expect(outcome.status === 'result' ? outcome.result.payload.error?.code : undefined).toBe('command.timeout')
    expect(lifecycle.getPendingCount()).toBe(0)
    expect(lifecycle.getRecentMessageIds()).toEqual(['parent-command-timeout-cancel'])
  })

  it('达到待确认容量或释放后不接纳新命令，并清除计时器、状态槽位和近期标识', async () => {
    vi.useFakeTimers()
    let resolveExecution: ((value: { success: true; status: 'completed' }) => void) | undefined
    const lifecycle = new HostCommandLifecycle(
      () => new Promise((resolve) => { resolveExecution = resolve }),
      globalThis,
      HOST_COMMAND_TIMEOUT_MS,
      1,
    )
    const firstPromise = lifecycle.execute(createDeviceStatesUpdateCommand('parent-command-01'))
    const capacity = await lifecycle.execute(createStateGetCommand('parent-command-02'))
    const capacityDuplicate = await lifecycle.execute(createStateGetCommand('parent-command-02'))

    lifecycle.dispose()
    const disposed = await lifecycle.execute(createStateGetCommand('parent-command-03'))
    resolveExecution?.({ success: true, status: 'completed' })
    const first = await firstPromise

    expect(capacity).toEqual(expect.objectContaining({ status: 'result', result: expect.objectContaining({ source: 'capacity' }) }))
    expect(capacityDuplicate).toEqual({ status: 'ignored-duplicate' })
    expect(disposed).toEqual(expect.objectContaining({ status: 'result', result: expect.objectContaining({ source: 'disposed' }) }))
    expect(first).toEqual(expect.objectContaining({ status: 'result', result: expect.objectContaining({ source: 'disposed' }) }))
    expect(lifecycle.getPendingCount()).toBe(0)
    expect(lifecycle.hasPendingDeviceStatesUpdate()).toBe(false)
    expect(lifecycle.getRecentMessageIds()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('近期标识缓存达到上限时淘汰最早项，被淘汰标识可重新执行', async () => {
    const executor = vi.fn().mockResolvedValue({ success: true, status: 'completed' as const })
    // 使用容量一直接验证固定集合淘汰；生产容量仍由协议限制为最近256个标识。
    const lifecycle = new HostCommandLifecycle(executor, globalThis, HOST_COMMAND_TIMEOUT_MS, 64, 1)

    await lifecycle.execute(createStateGetCommand('parent-command-01'))
    await lifecycle.execute(createStateGetCommand('parent-command-02'))
    const evictedResult = await lifecycle.execute(createStateGetCommand('parent-command-01'))

    expect(lifecycle.getRecentMessageIds()).toEqual(['parent-command-01'])
    expect(evictedResult).toEqual(expect.objectContaining({ status: 'result', result: expect.objectContaining({ source: 'executed' }) }))
    expect(executor).toHaveBeenCalledTimes(3)
  })

  it('同步执行异常也会清理待确认项、计时器和状态槽位', async () => {
    vi.useFakeTimers()
    const lifecycle = new HostCommandLifecycle(() => { throw new Error('测试同步异常') })

    const outcome = await lifecycle.execute(createDeviceStatesUpdateCommand('parent-state-sync-error'))

    expect(outcome).toEqual(expect.objectContaining({
      status: 'result',
      result: expect.objectContaining({
        source: 'executed',
        payload: expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'action.execute.failed' }) }),
      }),
    }))
    expect(lifecycle.getPendingCount()).toBe(0)
    expect(lifecycle.hasPendingDeviceStatesUpdate()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('桥接消息登记器只记录一次重复诊断，并按固定窗口淘汰最早标识', () => {
    const receipts = new HostMessageReceiptRegistry(2)

    expect(receipts.register('parent-command-01')).toBe('accepted')
    expect(receipts.register('parent-command-01')).toBe('duplicate-first')
    expect(receipts.register('parent-command-01')).toBe('duplicate-repeat')
    expect(receipts.register('parent-command-02')).toBe('accepted')
    expect(receipts.register('parent-command-03')).toBe('accepted')
    expect(receipts.getRecentMessageIds()).toEqual(['parent-command-02', 'parent-command-03'])
    expect(receipts.register('parent-command-01')).toBe('accepted')

    receipts.dispose()
    expect(receipts.getRecentMessageIds()).toEqual([])
  })
})

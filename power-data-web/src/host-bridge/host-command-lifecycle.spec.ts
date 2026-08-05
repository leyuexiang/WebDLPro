import { afterEach, describe, expect, it, vi } from 'vitest'
import { toSessionId } from '@/config/scene-topology/identifiers'
import { HOST_COMMAND_TIMEOUT_MS, HostCommandLifecycle } from '@/host-bridge/host-command-lifecycle'
import type { HostCommandMessage } from '@/host-bridge/host-protocol'

/** 生命周期测试只使用无业务副作用的状态查询命令，避免夹具伪造场景或 Unity 映射。 */
function createStateGetCommand(messageId = 'parent-command-01'): HostCommandMessage {
  return {
    channel: 'power-scene-topology-shell',
    version: 1,
    instanceId: 'visual-shell-01',
    sessionId: toSessionId('session-test-01'),
    messageId,
    type: 'state.get',
    timestamp: 1,
    payload: {},
  }
}

describe('外层命令生命周期', () => {
  afterEach(() => vi.useRealTimers())

  it('重复已完成消息只返回首个缓存结果，不重复执行执行器', async () => {
    const executor = vi.fn().mockResolvedValue({ success: true, status: 'completed' as const, contextRevision: 1 })
    const lifecycle = new HostCommandLifecycle(executor)
    const first = await lifecycle.execute(createStateGetCommand())
    const duplicate = await lifecycle.execute(createStateGetCommand())

    expect(executor).toHaveBeenCalledTimes(1)
    expect(first.source).toBe('executed')
    expect(duplicate.source).toBe('cached')
    expect(duplicate.replyTo).toBe('parent-command-01')
  })

  it('同一进行中消息拒绝重复执行，并保留唯一待确认项', async () => {
    let resolveExecution: ((value: { success: true; status: 'completed' }) => void) | undefined
    const lifecycle = new HostCommandLifecycle(() => new Promise((resolve) => { resolveExecution = resolve }))
    const firstPromise = lifecycle.execute(createStateGetCommand())
    const duplicate = await lifecycle.execute(createStateGetCommand())
    resolveExecution?.({ success: true, status: 'completed' })
    await firstPromise

    expect(duplicate.source).toBe('duplicate')
    expect(duplicate.payload.error?.code).toBe('protocol.message.duplicate')
    expect(lifecycle.getPendingCount()).toBe(0)
  })

  it('超时后清理待确认项、缓存结果，并忽略迟到完成', async () => {
    vi.useFakeTimers()
    let resolveExecution: ((value: { success: true; status: 'completed' }) => void) | undefined
    const lifecycle = new HostCommandLifecycle(() => new Promise((resolve) => { resolveExecution = resolve }))
    const resultPromise = lifecycle.execute(createStateGetCommand())

    vi.advanceTimersByTime(HOST_COMMAND_TIMEOUT_MS)
    const result = await resultPromise
    resolveExecution?.({ success: true, status: 'completed' })
    await Promise.resolve()

    expect(result.source).toBe('timeout')
    expect(result.payload.error?.code).toBe('command.timeout')
    expect(lifecycle.getPendingCount()).toBe(0)
    expect(lifecycle.getRecentResults()).toHaveLength(1)
  })

  it('达到待确认容量或释放后不会接纳新命令', async () => {
    let resolveExecution: ((value: { success: true; status: 'completed' }) => void) | undefined
    const lifecycle = new HostCommandLifecycle(() => new Promise((resolve) => { resolveExecution = resolve }), globalThis, HOST_COMMAND_TIMEOUT_MS, 1)
    const firstPromise = lifecycle.execute(createStateGetCommand('parent-command-01'))
    const capacity = await lifecycle.execute(createStateGetCommand('parent-command-02'))
    lifecycle.dispose()
    const disposed = await lifecycle.execute(createStateGetCommand('parent-command-03'))
    resolveExecution?.({ success: true, status: 'completed' })
    const first = await firstPromise

    expect(capacity.source).toBe('capacity')
    expect(disposed.source).toBe('disposed')
    expect(first.source).toBe('disposed')
    expect(lifecycle.getPendingCount()).toBe(0)
  })

  it('近期结果缓存达到上限时淘汰最早消息，且被淘汰消息会重新进入执行器', async () => {
    const executor = vi.fn().mockResolvedValue({ success: true, status: 'completed' as const })
    // 使用容量一的夹具直接验证淘汰边界，生产容量仍由协议的 256 条限制提供。
    const lifecycle = new HostCommandLifecycle(executor, globalThis, HOST_COMMAND_TIMEOUT_MS, 64, 1)

    await lifecycle.execute(createStateGetCommand('parent-command-01'))
    await lifecycle.execute(createStateGetCommand('parent-command-02'))
    const evictedResult = await lifecycle.execute(createStateGetCommand('parent-command-01'))

    expect(lifecycle.getRecentResults().map((result) => result.replyTo)).toEqual(['parent-command-01'])
    expect(evictedResult.source).toBe('executed')
    expect(executor).toHaveBeenCalledTimes(3)
  })
})

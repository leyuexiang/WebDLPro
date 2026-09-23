import { describe, expect, it, vi } from 'vitest'
import { EMBEDDED_SHELL_STARTUP_TIMEOUT_MS, EmbeddedShellStartupDeadline, type EmbeddedShellStartupTimer } from '@/app/embedded-shell-startup-deadline'

function createTimer(): EmbeddedShellStartupTimer {
  return globalThis
}

describe('嵌入壳页面级启动期限', () => {
  it('15 秒内成功启动会清理计时器且不触发超时', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const deadline = new EmbeddedShellStartupDeadline(onTimeout, createTimer())
    deadline.start()
    deadline.succeed()
    vi.advanceTimersByTime(EMBEDDED_SHELL_STARTUP_TIMEOUT_MS)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('15 秒未完成时只触发一次超时，迟到成功不能恢复期限', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const deadline = new EmbeddedShellStartupDeadline(onTimeout, createTimer())
    deadline.start()
    vi.advanceTimersByTime(EMBEDDED_SHELL_STARTUP_TIMEOUT_MS)
    deadline.succeed()
    vi.advanceTimersByTime(EMBEDDED_SHELL_STARTUP_TIMEOUT_MS)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(deadline.isExpired).toBe(true)
    vi.useRealTimers()
  })

  it('正常成功不是超时状态', () => {
    const deadline = new EmbeddedShellStartupDeadline(vi.fn(), createTimer())
    deadline.start()
    deadline.succeed()
    expect(deadline.isExpired).toBe(false)
  })

  it('释放会清理计时器且不会产生超时回调', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const deadline = new EmbeddedShellStartupDeadline(onTimeout, createTimer())
    deadline.start()
    deadline.dispose()
    vi.advanceTimersByTime(EMBEDDED_SHELL_STARTUP_TIMEOUT_MS)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

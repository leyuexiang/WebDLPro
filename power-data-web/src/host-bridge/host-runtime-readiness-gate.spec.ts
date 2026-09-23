import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HOST_RUNTIME_PREPARATION_TIMEOUT_MS,
  HostRuntimeReadinessGate,
} from '@/host-bridge/host-runtime-readiness-gate'

describe('外层初始化的 Unity 就绪屏障', () => {
  afterEach(() => vi.useRealTimers())

  it('Unity 提前就绪时立即通过，不创建等待计时器', async () => {
    vi.useFakeTimers()
    const gate = new HostRuntimeReadinessGate()
    gate.report('ready')

    await expect(gate.wait()).resolves.toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('多个内部等待复用唯一槽位，并在宿主就绪后同时结算', async () => {
    const gate = new HostRuntimeReadinessGate()
    gate.report('handshaking')

    const first = gate.wait()
    const second = gate.wait()
    expect(second).toBe(first)

    gate.report('ready')
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
  })

  it('初始化到达后等待120秒即失败，迟到 ready 仍允许下一次合法重试', async () => {
    vi.useFakeTimers()
    const gate = new HostRuntimeReadinessGate()
    gate.report('creating')

    const first = gate.wait()
    await vi.advanceTimersByTimeAsync(HOST_RUNTIME_PREPARATION_TIMEOUT_MS)
    await expect(first).resolves.toBe(false)

    gate.report('ready')
    await expect(gate.wait()).resolves.toBe(true)
  })

  it('释放会结算等待并拒绝迟到状态复活旧页面', async () => {
    const gate = new HostRuntimeReadinessGate()
    const pending = gate.wait()
    gate.dispose()
    gate.report('ready')

    await expect(pending).resolves.toBe(false)
    await expect(gate.wait()).resolves.toBe(false)
  })
})

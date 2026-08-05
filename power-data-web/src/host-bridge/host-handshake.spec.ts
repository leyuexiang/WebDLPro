import { afterEach, describe, expect, it, vi } from 'vitest'
import { toSessionId } from '@/config/scene-topology/identifiers'
import { HostBridge } from '@/host-bridge/host-bridge'
import { HOST_INITIALIZATION_TIMEOUT_MS, HostHandshake, type HostHandshakeMetadata } from '@/host-bridge/host-handshake'
import type { HostVisualizationContext } from '@/host-bridge/host-protocol'
import { WindowMessageRouter } from '@/host-bridge/message-router'

const metadata: HostHandshakeMetadata = {
  manifestVersion: '2026.08.04.1',
  commandCapabilities: ['system.init', 'state.get'],
  eventCapabilities: ['system.ack', 'system.error'],
}

const stableContext: HostVisualizationContext = {
  sceneId: 'gas-power' as never,
  topologyId: 'gas-power.overview' as never,
  actionId: null,
  contextRevision: 1,
  status: 'ready',
}

/** 创建只记录出站事件的桥，握手测试不依赖真实浏览器父窗口。 */
function createHandshake(onInitialize = vi.fn().mockResolvedValue({ success: true, context: stableContext })) {
  const sent: unknown[][] = []
  const bridge = new HostBridge(
    { parentOrigin: 'https://portal.example.test', instanceId: 'visual-shell-01', sessionId: toSessionId('session-test-01') },
    { postMessage: (...arguments_: unknown[]) => sent.push(arguments_) },
    new WindowMessageRouter(),
  )
  return { handshake: new HostHandshake(bridge, metadata, { onInitialize }), sent, onInitialize }
}

describe('外层初始化握手', () => {
  afterEach(() => vi.useRealTimers())

  it('先发送 ready，再按 replyTo 回传成功 ack', async () => {
    const { handshake, sent, onInitialize } = createHandshake()
    handshake.start()
    const initialized = await handshake.handle({
      channel: 'power-scene-topology-shell', version: 1, instanceId: 'visual-shell-01', sessionId: toSessionId('session-test-01'), messageId: 'parent-init-01', type: 'system.init', timestamp: 1,
      payload: { sceneId: 'gas-power' as never, topologyId: 'gas-power.overview' as never, expectedManifestVersion: metadata.manifestVersion },
    })

    expect(initialized).toBe(true)
    expect(onInitialize).toHaveBeenCalledTimes(1)
    expect((sent[0]?.[0] as { type: string }).type).toBe('system.ready')
    expect(sent[1]?.[0]).toMatchObject({ type: 'system.ack', replyTo: 'parent-init-01', payload: { success: true } })
    expect(handshake.isInitialized()).toBe(true)
  })

  it('清单版本不一致时不调用初始化回调，并返回受控失败 ack', async () => {
    const { handshake, sent, onInitialize } = createHandshake()
    handshake.start()
    const initialized = await handshake.handle({
      channel: 'power-scene-topology-shell', version: 1, instanceId: 'visual-shell-01', sessionId: toSessionId('session-test-01'), messageId: 'parent-init-02', type: 'system.init', timestamp: 1,
      payload: { sceneId: 'gas-power' as never, topologyId: 'gas-power.overview' as never, expectedManifestVersion: 'old-manifest' },
    })

    expect(initialized).toBe(false)
    expect(onInitialize).not.toHaveBeenCalled()
    expect(sent[1]?.[0]).toMatchObject({ type: 'system.ack', replyTo: 'parent-init-02', payload: { success: false, error: { code: 'manifest.version.mismatch' } } })
  })

  it('未初始化时拒绝业务命令，且不会越过握手进入初始化回调', async () => {
    const { handshake, onInitialize } = createHandshake()
    handshake.start()
    const accepted = await handshake.handle({
      channel: 'power-scene-topology-shell', version: 1, instanceId: 'visual-shell-01', sessionId: toSessionId('session-test-01'), messageId: 'parent-view-01', type: 'view.open', timestamp: 1,
      // 夹具仅验证握手门禁，不模拟后续场景与拓扑协调器的业务执行。
      payload: { sceneId: 'gas-power' as never, topologyId: 'gas-power.overview' as never },
    })

    expect(accepted).toBe(false)
    expect(onInitialize).not.toHaveBeenCalled()
    expect(handshake.getStatus()).toBe('awaiting-init')
  })

  it('15 秒超时后保持可初始化，并在释放时取消等待计时器', async () => {
    vi.useFakeTimers()
    const { handshake, onInitialize } = createHandshake()
    handshake.start()
    vi.advanceTimersByTime(HOST_INITIALIZATION_TIMEOUT_MS)
    expect(handshake.getStatus()).toBe('timed-out')

    await handshake.handle({
      channel: 'power-scene-topology-shell', version: 1, instanceId: 'visual-shell-01', sessionId: toSessionId('session-test-01'), messageId: 'parent-init-03', type: 'system.init', timestamp: 1,
      payload: { sceneId: 'gas-power' as never, topologyId: 'gas-power.overview' as never },
    })
    handshake.dispose()
    vi.runOnlyPendingTimers()

    expect(onInitialize).toHaveBeenCalledTimes(1)
    expect(handshake.getStatus()).toBe('disposed')
  })
})

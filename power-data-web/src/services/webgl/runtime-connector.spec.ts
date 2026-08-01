import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toRuntimeKey } from '@/config/process/identifiers'
import type { WebglRuntimeRegistration } from '@/config/process/types'
import { WEBGL_PROTOCOL_CHANNEL, WEBGL_PROTOCOL_VERSION, type WebglMessageEnvelope } from './protocol'
import { WebglRuntimeConnector } from './runtime-connector'

/**
 * 连接器测试使用最小伪窗口，不依赖浏览器或真实 iframe。
 * 这样可以精确验证来源、source、requestId 与超时行为，而不会将测试耦合到 UI 渲染。
 */
describe('网页图形受控连接器', () => {
  const childOrigin = 'https://scene.example.com'
  const runtime = {
    // 测试登记项也使用正式稳定标识构造函数，确保夹具不绕过生产配置的类型边界。
    runtimeKey: toRuntimeKey('gas-turbine'),
    buildId: 'build-1',
    configVersion: 'config-1',
    sceneMappingVersion: 'mapping-1',
    protocolVersion: 1,
    resourceDigest: 'sha256:demo',
    entryUrl: `${childOrigin}/index.html`,
    childOrigin,
    allowedParentOrigin: 'https://platform.example.com',
    capabilities: ['init', 'dispose', 'focusNode', 'resize'],
    eventCapabilities: ['ready', 'ack', 'commandResult', 'objectSelected', 'disposed'],
    resourceBudget: { initialMemoryMb: 128, maxConcurrentInstances: 1, cacheMode: 'versioned' },
  } as const satisfies WebglRuntimeRegistration

  const messageListeners = new Set<(event: MessageEvent<unknown>) => void>()
  const childWindow = { postMessage: vi.fn() }

  beforeEach(() => {
    vi.useFakeTimers()
    childWindow.postMessage.mockReset()
    messageListeners.clear()
    vi.stubGlobal('window', {
      addEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) => messageListeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) => messageListeners.delete(listener),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  /** 发送一条伪造的 MessageEvent；连接器仍会自行完成来源、窗口和信封校验。 */
  function emit(data: unknown, origin = childOrigin, source: MessageEventSource | null = childWindow as unknown as MessageEventSource): void {
    messageListeners.forEach((listener) => listener({ data, origin, source } as MessageEvent<unknown>))
  }

  /** 生成符合登记元数据的 ready 信封，便于每个用例只关注自己的状态转换。 */
  function readyEnvelope(): WebglMessageEnvelope<'ready', unknown> {
    return {
      channel: WEBGL_PROTOCOL_CHANNEL,
      version: WEBGL_PROTOCOL_VERSION,
      instanceId: 'instance-1',
      messageId: 'ready-1',
      type: 'ready',
      payload: {
        runtimeKey: runtime.runtimeKey,
        buildId: runtime.buildId,
        sceneMappingVersion: runtime.sceneMappingVersion,
        protocolVersion: runtime.protocolVersion,
        resourceDigest: runtime.resourceDigest,
        commandCapabilities: runtime.capabilities,
        eventCapabilities: runtime.eventCapabilities,
      },
      timestamp: 1,
    }
  }

  /** 完成 ready 与 init 确认，使后续用例从严格协商后的 ready 状态开始。 */
  function createReadyConnector(onCommandFailure = vi.fn()) {
    const statuses: string[] = []
    const connector = new WebglRuntimeConnector(runtime, 'instance-1', {
      onStatusChange: (status) => statuses.push(status),
      onCommandFailure,
    })
    connector.startListening()
    connector.attachChildWindow(childWindow as unknown as WindowProxy)
    emit(readyEnvelope())

    const initMessage = childWindow.postMessage.mock.calls[0]?.[0] as WebglMessageEnvelope
    emit({
      channel: WEBGL_PROTOCOL_CHANNEL,
      version: WEBGL_PROTOCOL_VERSION,
      instanceId: 'instance-1',
      messageId: 'ack-init',
      type: 'ack',
      payload: { requestId: initMessage.messageId, success: true },
      timestamp: 2,
    })

    return { connector, statuses, onCommandFailure }
  }

  it('拒绝来源、窗口或实例不一致的消息', () => {
    const connector = new WebglRuntimeConnector(runtime, 'instance-1')
    connector.startListening()
    connector.attachChildWindow(childWindow as unknown as WindowProxy)

    emit(readyEnvelope(), 'https://forged.example.com')
    emit({ ...readyEnvelope(), instanceId: 'old-instance' })

    expect(childWindow.postMessage).not.toHaveBeenCalled()
    expect(connector.getRejections()).toHaveLength(2)
    connector.forceDispose()
  })

  it('仅在 ready 与 init 确认后开放协商命令能力', () => {
    const { connector, statuses } = createReadyConnector()

    expect(statuses).toEqual(['handshaking', 'ready'])
    expect(connector.supportsCommand('focusNode')).toBe(true)
    expect(connector.sendCommand('focusNode', { nodeId: 'unit.demo.1' })).toContain('instance-1-2')
    expect(childWindow.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'focusNode' }),
      childOrigin,
    )

    connector.forceDispose()
  })

  it('超时命令仅使用同一请求标识重试一次，并清理待确认记录', () => {
    const onCommandFailure = vi.fn()
    const { connector } = createReadyConnector(onCommandFailure)
    const commandId = connector.sendCommand('resize', { width: 800, height: 600 })

    vi.advanceTimersByTime(10_000)
    expect(childWindow.postMessage).toHaveBeenCalledTimes(3)
    expect((childWindow.postMessage.mock.calls[1]?.[0] as WebglMessageEnvelope).messageId).toBe(commandId)
    expect((childWindow.postMessage.mock.calls[2]?.[0] as WebglMessageEnvelope).messageId).toBe(commandId)

    vi.advanceTimersByTime(10_000)
    expect(onCommandFailure).toHaveBeenCalledWith('resize', expect.stringContaining('超时'))

    emit({
      channel: WEBGL_PROTOCOL_CHANNEL,
      version: WEBGL_PROTOCOL_VERSION,
      instanceId: 'instance-1',
      messageId: 'late-result',
      type: 'commandResult',
      payload: { requestId: commandId, success: true },
      timestamp: 3,
    })
    expect(connector.getRejections()).toHaveLength(1)
    connector.forceDispose()
  })

  it('仅接受回填 dispose 原始请求标识的已释放确认', () => {
    const onDisposed = vi.fn()
    const connector = new WebglRuntimeConnector(runtime, 'instance-1', { onDisposed })
    connector.startListening()
    connector.attachChildWindow(childWindow as unknown as WindowProxy)
    emit(readyEnvelope())
    const initMessage = childWindow.postMessage.mock.calls[0]?.[0] as WebglMessageEnvelope
    emit({ channel: WEBGL_PROTOCOL_CHANNEL, version: WEBGL_PROTOCOL_VERSION, instanceId: 'instance-1', messageId: 'ack-init', type: 'ack', payload: { requestId: initMessage.messageId }, timestamp: 2 })

    const disposeRequestId = connector.requestDispose()
    emit({ channel: WEBGL_PROTOCOL_CHANNEL, version: WEBGL_PROTOCOL_VERSION, instanceId: 'instance-1', messageId: 'disposed-1', type: 'disposed', payload: { requestId: disposeRequestId }, timestamp: 3 })

    expect(onDisposed).toHaveBeenCalledWith(disposeRequestId)
    expect(childWindow.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'dispose' }), childOrigin)
  })
})

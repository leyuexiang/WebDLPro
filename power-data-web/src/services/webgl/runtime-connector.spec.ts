import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toRuntimeKey } from '@/config/process/identifiers'
import type { WebglRuntimeRegistration } from '@/config/process/types'
import { WEBGL_PROTOCOL_CHANNEL, WEBGL_PROTOCOL_VERSION, type WebglMessageEnvelope, type WebglObjectSelectedPayload } from './protocol'
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
    capabilities: ['init', 'dispose', 'focusNode', 'resize', 'switchScene', 'setNodeVisualState', 'setRouteFlow'],
    eventCapabilities: ['ready', 'ack', 'commandResult', 'sceneLoadProgress', 'sceneChanged', 'objectSelected', 'disposed'],
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
  function createReadyConnector(
    onCommandFailure = vi.fn(),
    onObjectSelected?: (payload: WebglObjectSelectedPayload, messageId: string) => void,
  ) {
    const statuses: string[] = []
    const connector = new WebglRuntimeConnector(runtime, 'instance-1', {
      onStatusChange: (status) => statuses.push(status),
      onCommandFailure,
      // 测试按正式回调签名注入，确保连接器不会自行把二维节点字段转换为三维节点字段。
      onObjectSelected,
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
    expect(connector.sendCommand('focusNode', { sceneNodeId: 'unit.demo.1', selectionId: 'selection.topology.01', isolate: false })).toContain('instance-1-2')
    expect(childWindow.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'focusNode' }),
      childOrigin,
    )

    connector.forceDispose()
  })

  /** 无效动作载荷不得创建待确认项；固定四态和路径开关通过后才允许送入受控 iframe。 */
  it('在发送前拒绝无效场景动作并允许合法四态和路径命令', () => {
    const onCommandFailure = vi.fn()
    const { connector } = createReadyConnector(onCommandFailure)

    expect(connector.sendCommand('focusNode', { sceneNodeId: 'node.demo.1', isolate: false })).toBeUndefined()
    expect(connector.sendCommand('setNodeVisualState', { sceneNodeId: 'node.demo.1', visualState: 'unexpected' })).toBeUndefined()
    expect(connector.sendCommand('setRouteFlow', { routeId: 'route.demo.1', enabled: true })).toContain('instance-1-2')
    expect(connector.sendCommand('setNodeVisualState', {
      sceneNodeId: 'node.demo.1',
      visualState: 'alarm',
      statusUpdatedAt: '2026-08-08T10:00:00.000Z',
      hasSourceRevision: true,
      sourceRevision: 1,
    })).toContain('instance-1-3')
    expect(onCommandFailure).toHaveBeenCalledTimes(2)
    expect(onCommandFailure).toHaveBeenNthCalledWith(1, 'focusNode', expect.stringContaining('三维节点'))
    expect(onCommandFailure).toHaveBeenNthCalledWith(2, 'setNodeVisualState', expect.stringContaining('四态'))

    connector.forceDispose()
  })

  it('对象选择只接受明确的三维节点字段，旧二维字段不能被隐式转换', () => {
    const onObjectSelected = vi.fn()
    const { connector } = createReadyConnector(vi.fn(), onObjectSelected)

    emit({
      channel: WEBGL_PROTOCOL_CHANNEL,
      version: WEBGL_PROTOCOL_VERSION,
      instanceId: 'instance-1',
      messageId: 'object-selected-canonical',
      type: 'objectSelected',
      payload: { sceneId: 'gas-power', sceneNodeId: 'scene-node.gas-turbine', sceneActivationId: 'scene-activation.gas-1' },
      timestamp: 3,
    })
    emit({
      channel: WEBGL_PROTOCOL_CHANNEL,
      version: WEBGL_PROTOCOL_VERSION,
      instanceId: 'instance-1',
      messageId: 'object-selected-legacy',
      type: 'objectSelected',
      // 该字段曾被错误地当作三维节点标识；回归用例确保升级后不能再通过协议边界。
      payload: { sceneId: 'gas-power', nodeId: 'scene-node.gas-turbine' },
      timestamp: 4,
    })

    expect(onObjectSelected).toHaveBeenCalledTimes(1)
    expect(onObjectSelected).toHaveBeenCalledWith(
      { sceneId: 'gas-power', sceneNodeId: 'scene-node.gas-turbine', sceneActivationId: 'scene-activation.gas-1' },
      'object-selected-canonical',
    )
    expect(connector.getRejections()).toHaveLength(1)
    connector.forceDispose()
  })

  it('超时命令仅使用同一请求标识重试一次，并清理待确认记录', () => {
    const onCommandFailure = vi.fn()
    const onCommandCompleted = vi.fn()
    const connector = new WebglRuntimeConnector(runtime, 'instance-1', { onCommandFailure, onCommandCompleted })
    connector.startListening()
    connector.attachChildWindow(childWindow as unknown as WindowProxy)
    emit(readyEnvelope())
    const initMessage = childWindow.postMessage.mock.calls[0]?.[0] as WebglMessageEnvelope
    emit({ channel: WEBGL_PROTOCOL_CHANNEL, version: WEBGL_PROTOCOL_VERSION, instanceId: 'instance-1', messageId: 'ack-init', type: 'ack', payload: { requestId: initMessage.messageId, success: true }, timestamp: 2 })
    const commandId = connector.sendCommand('resize', { width: 800, height: 600 })

    vi.advanceTimersByTime(10_000)
    expect(childWindow.postMessage).toHaveBeenCalledTimes(3)
    expect((childWindow.postMessage.mock.calls[1]?.[0] as WebglMessageEnvelope).messageId).toBe(commandId)
    expect((childWindow.postMessage.mock.calls[2]?.[0] as WebglMessageEnvelope).messageId).toBe(commandId)

    vi.advanceTimersByTime(10_000)
    expect(onCommandFailure).toHaveBeenCalledWith('resize', expect.stringContaining('超时'))
    expect(onCommandCompleted).toHaveBeenCalledWith({ command: 'resize', requestId: commandId, success: false })

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
    // 即使已收到远端 disposed，也显式释放测试连接器，避免单例消息路由器保留上一个伪窗口订阅。
    connector.forceDispose()
  })

  /** 场景切换必须先收到接收确认，再由同一 requestId、sceneId、transitionId 的进度与完成事件驱动最终结果。 */
  it('仅将匹配原请求的合法场景进度和完成事件交给当前前端', () => {
    const onSceneLoadProgress = vi.fn()
    const onSceneChanged = vi.fn()
    const onCommandCompleted = vi.fn()
    const connector = new WebglRuntimeConnector(runtime, 'instance-1', { onSceneLoadProgress, onSceneChanged, onCommandCompleted })
    connector.startListening()
    connector.attachChildWindow(childWindow as unknown as WindowProxy)
    emit(readyEnvelope())
    const initMessage = childWindow.postMessage.mock.calls[0]?.[0] as WebglMessageEnvelope
    emit({ channel: WEBGL_PROTOCOL_CHANNEL, version: WEBGL_PROTOCOL_VERSION, instanceId: 'instance-1', messageId: 'ack-init', type: 'ack', payload: { requestId: initMessage.messageId, success: true }, timestamp: 2 })

    const requestId = connector.sendCommand('switchScene', {
      sceneId: 'gas-power',
      transitionId: 'transition-gas-1',
      sceneMappingVersion: runtime.sceneMappingVersion,
      forceReload: false,
    })
    emit({ channel: WEBGL_PROTOCOL_CHANNEL, version: WEBGL_PROTOCOL_VERSION, instanceId: 'instance-1', messageId: 'ack-switch', type: 'ack', payload: { requestId, success: true }, timestamp: 3 })

    // 进度越界和旧事务不能进入回调；它们只记录为受限拒绝诊断。
    emit({ channel: WEBGL_PROTOCOL_CHANNEL, version: WEBGL_PROTOCOL_VERSION, instanceId: 'instance-1', messageId: 'progress-invalid', type: 'sceneLoadProgress', payload: { requestId, sceneId: 'gas-power', transitionId: 'transition-gas-1', stageCode: 'loading-scene', progress: 1.2 }, timestamp: 4 })
    emit({ channel: WEBGL_PROTOCOL_CHANNEL, version: WEBGL_PROTOCOL_VERSION, instanceId: 'instance-1', messageId: 'progress-old', type: 'sceneLoadProgress', payload: { requestId, sceneId: 'gas-power', transitionId: 'transition-old', stageCode: 'loading-scene', progress: 0.2 }, timestamp: 5 })
    expect(onSceneLoadProgress).not.toHaveBeenCalled()

    emit({ channel: WEBGL_PROTOCOL_CHANNEL, version: WEBGL_PROTOCOL_VERSION, instanceId: 'instance-1', messageId: 'progress-current', type: 'sceneLoadProgress', payload: { requestId, sceneId: 'gas-power', transitionId: 'transition-gas-1', stageCode: 'loading-scene', progress: 0.6 }, timestamp: 6 })
    emit({ channel: WEBGL_PROTOCOL_CHANNEL, version: WEBGL_PROTOCOL_VERSION, instanceId: 'instance-1', messageId: 'changed-current', type: 'sceneChanged', payload: { requestId, sceneId: 'gas-power', transitionId: 'transition-gas-1', sceneActivationId: 'scene-activation.gas-1', success: true }, timestamp: 7 })

    expect(onSceneLoadProgress).toHaveBeenCalledWith(expect.objectContaining({ progress: 0.6 }), 'progress-current')
    expect(onSceneChanged).toHaveBeenCalledWith(expect.objectContaining({ transitionId: 'transition-gas-1' }), 'changed-current')
    expect(onCommandCompleted).toHaveBeenCalledWith({ command: 'switchScene', requestId, success: true, sceneActivationId: 'scene-activation.gas-1' })
    expect(connector.getRejections()).toHaveLength(2)
    connector.forceDispose()
  })

  it('场景切换失败但 Unity 已自动恢复时，将恢复后的物理场景标识交给原请求等待者', () => {
    const onCommandCompleted = vi.fn()
    const connector = new WebglRuntimeConnector(runtime, 'instance-1', { onCommandCompleted })
    connector.startListening()
    connector.attachChildWindow(childWindow as unknown as WindowProxy)
    emit(readyEnvelope())
    const initMessage = childWindow.postMessage.mock.calls[0]?.[0] as WebglMessageEnvelope
    emit({ channel: WEBGL_PROTOCOL_CHANNEL, version: WEBGL_PROTOCOL_VERSION, instanceId: 'instance-1', messageId: 'ack-init', type: 'ack', payload: { requestId: initMessage.messageId, success: true }, timestamp: 2 })

    const requestId = connector.sendCommand('switchScene', {
      sceneId: 'wind-power',
      transitionId: 'transition-wind-failed',
      sceneMappingVersion: runtime.sceneMappingVersion,
      forceReload: false,
    })
    emit({ channel: WEBGL_PROTOCOL_CHANNEL, version: WEBGL_PROTOCOL_VERSION, instanceId: 'instance-1', messageId: 'ack-switch', type: 'ack', payload: { requestId, success: true }, timestamp: 3 })
    emit({
      channel: WEBGL_PROTOCOL_CHANNEL,
      version: WEBGL_PROTOCOL_VERSION,
      instanceId: 'instance-1',
      messageId: 'result-switch-failed-recovered',
      type: 'commandResult',
      payload: {
        requestId,
        success: false,
        errorCode: 'scene-content-unavailable',
        sceneActivationId: 'scene-activation.gas-restored',
      },
      timestamp: 4,
    })

    expect(onCommandCompleted).toHaveBeenCalledWith({
      command: 'switchScene',
      requestId,
      success: false,
      sceneActivationId: 'scene-activation.gas-restored',
    })
    connector.forceDispose()
  })
})

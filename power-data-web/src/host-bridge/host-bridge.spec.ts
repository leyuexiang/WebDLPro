import { describe, expect, it } from 'vitest'
import { SCENE_IDS, toSessionId } from '@/config/scene-topology/identifiers'
import { createHostBridgeStartup, HostBridge } from '@/host-bridge/host-bridge'
import { HOST_PROTOCOL_CHANNEL, HOST_PROTOCOL_VERSION, type HostEventMessage } from '@/host-bridge/host-protocol'
import { WindowMessageRouter } from '@/host-bridge/message-router'

const deploymentConfiguration = {
  parentOrigin: 'https://portal.example.test',
  // 外层宿主页与 Unity 直接父页面可跨域，测试夹具必须显式保留两个精确来源。
  unityParentOrigin: 'https://visual.example.test',
  unityEntryUrl: 'https://unity.example.test/webgl/index.html',
  unityChildOrigin: 'https://unity.example.test',
  manifestUrl: 'https://config.example.test/power/manifest.json',
  minimumViewportWidth: 1280,
  minimumViewportHeight: 720,
  addressMode: 'fixed-origin',
} as const
const sessionId = toSessionId('session-test-01')

/** 由桥接层接收的完整命令夹具；单个用例只覆盖其关心的安全字段。 */
function createCommandEnvelope(): Record<string, unknown> {
  return {
    channel: HOST_PROTOCOL_CHANNEL,
    version: HOST_PROTOCOL_VERSION,
    instanceId: 'visual-shell-01',
    sessionId: 'session-test-01',
    messageId: 'parent-command-01',
    type: 'state.get',
    timestamp: 1_785_811_200_000,
    payload: {},
  }
}

describe('外层桥安全边界', () => {
  it('启动参数必须同时匹配部署来源、实例标识和固定协议版本', () => {
    const valid = createHostBridgeStartup('?parentOrigin=https%3A%2F%2Fportal.example.test&instanceId=visual-shell-01&protocolVersion=1', deploymentConfiguration, () => sessionId)
    const forgedOrigin = createHostBridgeStartup('?parentOrigin=https%3A%2F%2Fforged.example.test&instanceId=visual-shell-01&protocolVersion=1', deploymentConfiguration, () => sessionId)

    expect(valid.status).toBe('ready')
    expect(forgedOrigin.status).toBe('invalid')
    if (forgedOrigin.status === 'invalid') expect(forgedOrigin.issues[0]?.code).toBe('protocol.origin.rejected')
  })

  it('只把正确来源、父窗口、实例和会话的消息交给业务回调', () => {
    const router = new WindowMessageRouter()
    const parentWindow = { postMessage: () => undefined }
    const sameOriginOtherWindow = { postMessage: () => undefined }
    const receivedMessageIds: string[] = []
    const bridge = new HostBridge(
      { parentOrigin: deploymentConfiguration.parentOrigin, instanceId: 'visual-shell-01', sessionId },
      parentWindow,
      router,
      { onCommand: (command) => receivedMessageIds.push(command.messageId) },
    )
    bridge.start()

    router.route({ data: createCommandEnvelope(), origin: 'https://forged.example.test', source: parentWindow as unknown as MessageEventSource } as MessageEvent<unknown>)
    router.route({ data: createCommandEnvelope(), origin: deploymentConfiguration.parentOrigin, source: sameOriginOtherWindow as unknown as MessageEventSource } as MessageEvent<unknown>)
    router.route({ data: { ...createCommandEnvelope(), instanceId: 'other-shell-01' }, origin: deploymentConfiguration.parentOrigin, source: parentWindow as unknown as MessageEventSource } as MessageEvent<unknown>)
    router.route({ data: { ...createCommandEnvelope(), sessionId: 'old-session-01' }, origin: deploymentConfiguration.parentOrigin, source: parentWindow as unknown as MessageEventSource } as MessageEvent<unknown>)
    router.route({ data: createCommandEnvelope(), origin: deploymentConfiguration.parentOrigin, source: parentWindow as unknown as MessageEventSource } as MessageEvent<unknown>)
    router.route({ data: createCommandEnvelope(), origin: deploymentConfiguration.parentOrigin, source: parentWindow as unknown as MessageEventSource } as MessageEvent<unknown>)
    router.route({ data: createCommandEnvelope(), origin: deploymentConfiguration.parentOrigin, source: parentWindow as unknown as MessageEventSource } as MessageEvent<unknown>)

    expect(receivedMessageIds).toEqual(['parent-command-01'])
    // 同源但非当前父窗口、错误实例和旧会话都必须在业务回调前被拦截，不能因来源字符串相同而放行。
    expect(bridge.getRejections().map((rejection) => rejection.code)).toEqual([
      'protocol.origin.rejected',
      'protocol.source.rejected',
      'protocol.envelope.invalid',
      'protocol.envelope.invalid',
      // 同一当前会话标识的首次重复只记录一次；第三次重放完全静默。
      'protocol.message.duplicate',
    ])
    bridge.dispose()
  })

  it('上行事件只能发往当前精确父来源，错误会话不能发送', () => {
    const router = new WindowMessageRouter()
    const sent: unknown[][] = []
    const parentWindow = { postMessage: (...arguments_: unknown[]) => sent.push(arguments_) }
    const bridge = new HostBridge(
      { parentOrigin: deploymentConfiguration.parentOrigin, instanceId: 'visual-shell-01', sessionId },
      parentWindow,
      router,
    )
    const event: HostEventMessage = {
      channel: HOST_PROTOCOL_CHANNEL,
      version: HOST_PROTOCOL_VERSION,
      instanceId: 'visual-shell-01',
      sessionId,
      messageId: 'shell-ready-01',
      type: 'system.ready',
      timestamp: 1_785_811_200_000,
      payload: {
        manifestVersion: '2026.08.04.1',
        sceneIds: SCENE_IDS,
        commandCapabilities: ['system.init', 'state.get'],
        eventCapabilities: ['system.ack', 'system.error'],
      },
    }

    expect(bridge.send(event)).toBe(true)
    expect(sent).toEqual([[event, deploymentConfiguration.parentOrigin]])
    expect(bridge.send({ ...event, sessionId: toSessionId('old-session-01') })).toBe(false)
    bridge.dispose()
    expect(bridge.send(event)).toBe(false)
    expect(sent).toHaveLength(1)
  })

  it('messageId 在类型和载荷校验前登记，修正载荷后复用同一标识仍被静默拒绝', () => {
    const router = new WindowMessageRouter()
    const parentWindow = { postMessage: () => undefined }
    const receivedMessageIds: string[] = []
    const bridge = new HostBridge(
      { parentOrigin: deploymentConfiguration.parentOrigin, instanceId: 'visual-shell-01', sessionId },
      parentWindow,
      router,
      { onCommand: (command) => receivedMessageIds.push(command.messageId) },
    )
    bridge.start()

    const invalidPayload = { ...createCommandEnvelope(), messageId: 'parent-invalid-then-fixed', payload: { unexpected: true } }
    const correctedPayload = { ...createCommandEnvelope(), messageId: 'parent-invalid-then-fixed' }
    router.route({ data: invalidPayload, origin: deploymentConfiguration.parentOrigin, source: parentWindow as unknown as MessageEventSource } as MessageEvent<unknown>)
    router.route({ data: correctedPayload, origin: deploymentConfiguration.parentOrigin, source: parentWindow as unknown as MessageEventSource } as MessageEvent<unknown>)

    expect(receivedMessageIds).toEqual([])
    expect(bridge.getRejections().map((rejection) => rejection.code)).toEqual([
      'protocol.payload.invalid',
      'protocol.message.duplicate',
    ])
    bridge.dispose()
  })

  it('初始化命令同样在统一入口去重，不会绕过普通命令生命周期重复初始化', () => {
    const router = new WindowMessageRouter()
    const parentWindow = { postMessage: () => undefined }
    const receivedMessageIds: string[] = []
    const bridge = new HostBridge(
      { parentOrigin: deploymentConfiguration.parentOrigin, instanceId: 'visual-shell-01', sessionId },
      parentWindow,
      router,
      { onCommand: (command) => receivedMessageIds.push(command.messageId) },
    )
    bridge.start()

    const initialization = {
      ...createCommandEnvelope(),
      messageId: 'parent-init-duplicate',
      type: 'system.init',
      payload: { sceneId: 'gas-power', topologyId: 'gas-power.overview' },
    }
    router.route({ data: initialization, origin: deploymentConfiguration.parentOrigin, source: parentWindow as unknown as MessageEventSource } as MessageEvent<unknown>)
    router.route({ data: initialization, origin: deploymentConfiguration.parentOrigin, source: parentWindow as unknown as MessageEventSource } as MessageEvent<unknown>)

    expect(receivedMessageIds).toEqual(['parent-init-duplicate'])
    expect(bridge.getRejections().map((rejection) => rejection.code)).toEqual(['protocol.message.duplicate'])
    bridge.dispose()
  })
})

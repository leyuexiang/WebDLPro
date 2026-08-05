import { describe, expect, it } from 'vitest'
import {
  HOST_PROTOCOL_CHANNEL,
  HOST_PROTOCOL_VERSION,
  validateHostCommandMessage,
  validateHostEventMessage,
} from '@/host-bridge/host-protocol'
import { SCENE_IDS } from '@/config/scene-topology/identifiers'

/** 每条测试从同一份完整信封派生，确保失败原因仅来自当前用例修改的字段。 */
function createCommandEnvelope(type: string, payload: unknown): Record<string, unknown> {
  return {
    channel: HOST_PROTOCOL_CHANNEL,
    version: HOST_PROTOCOL_VERSION,
    instanceId: 'visual-shell-01',
    sessionId: 'session-test-01',
    messageId: 'parent-message-01',
    type,
    timestamp: 1_785_811_200_000,
    payload,
  }
}

/** 所有上行失败事件共用固定错误夹具，确保错误码白名单与协议文档持续同步。 */
const undeclaredCapabilityError = {
  code: 'protocol.capability.undeclared',
  message: '当前子应用未声明该命令能力。',
  stage: 'validation',
  recoverable: true,
} as const

/** 从完整命令信封派生事件信封，避免事件测试遗漏协议要求的公共字段。 */
function createEventEnvelope(type: string, payload: unknown, replyTo?: string): Record<string, unknown> {
  return {
    ...createCommandEnvelope(type, payload),
    messageId: `shell-${type.replaceAll('.', '-')}-01`,
    ...(replyTo ? { replyTo } : {}),
  }
}

describe('外层内嵌框架协议', () => {
  it('接受完整的初始化命令并保留受控场景拓扑标识', () => {
    const result = validateHostCommandMessage(createCommandEnvelope('system.init', {
      sceneId: 'gas-power',
      topologyId: 'gas-power.overview',
      actionId: null,
      expectedManifestVersion: '2026.08.04.1',
    }))

    expect(result.status).toBe('valid')
    if (result.status === 'valid') expect(result.message.type).toBe('system.init')
  })

  it('拒绝未知命令、超长信封标识和命令携带的 replyTo', () => {
    const unknown = validateHostCommandMessage(createCommandEnvelope('unity.call', {}))
    const overlong = validateHostCommandMessage({
      ...createCommandEnvelope('state.get', {}),
      messageId: `message-${'x'.repeat(128)}`,
    })
    const replyCommand = validateHostCommandMessage({
      ...createCommandEnvelope('state.get', {}),
      replyTo: 'unexpected-reply',
    })

    expect(unknown.status).toBe('invalid')
    expect(overlong.status).toBe('invalid')
    expect(replyCommand.status).toBe('invalid')
  })

  it('拒绝超出上限的设备状态数组和非四态状态', () => {
    const oversized = validateHostCommandMessage(createCommandEnvelope('device.states.update', {
      items: Array.from({ length: 501 }, (_, index) => ({
        deviceId: `device-${index}`,
        deviceStatus: 'offline',
        statusUpdatedAt: '2026-08-04T14:20:30.000Z',
      })),
    }))
    const illegalStatus = validateHostCommandMessage(createCommandEnvelope('device.states.update', {
      items: [{
        deviceId: 'device-gas-turbine-01',
        deviceStatus: 'unknown',
        statusUpdatedAt: '2026-08-04T14:20:30.000Z',
      }],
    }))

    expect(oversized.status).toBe('invalid')
    expect(illegalStatus.status).toBe('invalid')
  })

  it('接受带 replyTo 的状态快照，并拒绝漏掉设备标识的双击事件', () => {
    const snapshot = validateHostEventMessage({
      ...createCommandEnvelope('state.snapshot', {
        manifestVersion: '2026.08.04.1',
        context: {
          sceneId: 'gas-power',
          topologyId: 'gas-power.overview',
          actionId: null,
          contextRevision: 1,
          status: 'ready',
        },
        unityStatus: 'ready',
        topologyStatus: 'ready',
      }),
      messageId: 'shell-state-01',
      replyTo: 'parent-message-01',
    })
    const doubleClick = validateHostEventMessage(createCommandEnvelope('topology.node.dblclick', {
      sceneId: 'gas-power',
      topologyId: 'gas-power.overview',
      nodeId: 'node-gas-turbine-01',
      contextRevision: 1,
      correlationId: 'correlation-01',
    }))

    expect(snapshot.status).toBe('valid')
    expect(doubleClick.status).toBe('invalid')
  })

  it('拒绝大于协议上限的消息体，且只返回稳定容量错误码', () => {
    const result = validateHostCommandMessage(createCommandEnvelope('system.dispose', {
      reason: 'x'.repeat(256 * 1024),
    }))

    expect(result.status).toBe('invalid')
    if (result.status === 'invalid') expect(result.issues[0]?.code).toBe('protocol.capacity.exceeded')
  })

  it('逐类型接受六类受控父页面命令', () => {
    const commands: readonly [string, unknown][] = [
      ['system.init', { sceneId: 'gas-power', topologyId: 'gas-power.overview', actionId: null }],
      ['view.open', { sceneId: 'wind-power', topologyId: 'wind-power.overview', expectedContextRevision: 2 }],
      ['workflow.trigger', { actionId: 'gas-power.turbine', parameters: { unit_id: 'unit-01', retry: false, priority: 1, note: null } }],
      ['device.states.update', { sourceRevision: 3, items: [{ deviceId: 'device-gas-turbine-01', deviceStatus: 'alarm', statusUpdatedAt: '2026-08-04T14:20:30.000Z' }] }],
      ['state.get', {}],
      ['system.dispose', { reason: 'parent-unmount' }],
    ]

    commands.forEach(([type, payload]) => {
      expect(validateHostCommandMessage(createCommandEnvelope(type, payload)).status, type).toBe('valid')
    })
  })

  it('逐类型接受八类受控子应用事件', () => {
    const stableContext = {
      sceneId: 'gas-power',
      topologyId: 'gas-power.overview',
      actionId: null,
      contextRevision: 4,
      status: 'ready',
    } as const
    const events: readonly [string, unknown, string?][] = [
      ['system.ready', { manifestVersion: '2026.08.04.1', sceneIds: SCENE_IDS, commandCapabilities: ['system.init'], eventCapabilities: ['system.ack'] }],
      ['system.ack', { success: true, context: stableContext }, 'parent-init-01'],
      ['command.result', { success: false, status: 'failed', error: undeclaredCapabilityError }, 'parent-command-01'],
      ['view.changed', { ...stableContext, transitionId: 'transition-view-01' }],
      ['topology.node.dblclick', { sceneId: 'gas-power', topologyId: 'gas-power.overview', nodeId: 'node.gas-turbine.01', deviceId: 'device-gas-turbine-01', contextRevision: 4, correlationId: 'correlation-dblclick-01' }],
      ['scene.object.selected', { sceneId: 'gas-power', sceneNodeId: 'node.gas-turbine.01', deviceId: 'device-gas-turbine-01', topologyId: 'gas-power.overview', nodeIds: ['node.gas-turbine.01'], contextRevision: 4, correlationId: 'correlation-select-01' }],
      ['state.snapshot', { manifestVersion: '2026.08.04.1', context: stableContext, unityStatus: 'ready', topologyStatus: 'ready' }, 'parent-state-01'],
      ['system.error', { error: undeclaredCapabilityError }],
    ]

    events.forEach(([type, payload, replyTo]) => {
      expect(validateHostEventMessage(createEventEnvelope(type, payload, replyTo)).status, type).toBe('valid')
    })
  })

  it('拒绝缺失或伪造的通道、版本、实例、会话、消息标识和时间戳', () => {
    const validEnvelope = createCommandEnvelope('state.get', {})
    const invalidEnvelopes = [
      { ...validEnvelope, channel: 'power3d-unity' },
      { ...validEnvelope, version: 2 },
      { ...validEnvelope, instanceId: 'Visual Shell' },
      { ...validEnvelope, sessionId: '' },
      { ...validEnvelope, messageId: 'message/with-path' },
      { ...validEnvelope, timestamp: -1 },
    ]

    invalidEnvelopes.forEach((input) => {
      const result = validateHostCommandMessage(input)
      expect(result.status).toBe('invalid')
      if (result.status === 'invalid') expect(result.issues[0]?.code).toBe('protocol.envelope.invalid')
    })
  })
})

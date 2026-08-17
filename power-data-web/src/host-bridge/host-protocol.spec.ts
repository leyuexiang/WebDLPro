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

  it('接受1至500项完整快照，并整体拒绝空数组、501项和非四态状态', () => {
    // 合作方约定空绑定仅由运行时清单表达，正式状态通道不得用空数组构造“清除全部”的隐式语义。
    // 已绑定设备从新完整表消失时，由下一份非空快照的缺失项触发二维恢复和三维清除。
    const empty = validateHostCommandMessage(createCommandEnvelope('device.states.update', {
      sourceRevision: 0,
      items: [],
    }))
    const maximum = validateHostCommandMessage(createCommandEnvelope('device.states.update', {
      sourceRevision: 0,
      items: Array.from({ length: 500 }, (_, index) => ({
        nodeId: `node.device-${index}`,
        deviceStatus: 'normal',
        statusUpdatedAt: '2026-08-04T14:20:30.000+08:00',
      })),
    }))
    const oversized = validateHostCommandMessage(createCommandEnvelope('device.states.update', {
      sourceRevision: 1,
      items: Array.from({ length: 501 }, (_, index) => ({
        nodeId: `node.device-${index}`,
        deviceStatus: 'offline',
        statusUpdatedAt: '2026-08-04T14:20:30.000Z',
      })),
    }))
    const illegalStatus = validateHostCommandMessage(createCommandEnvelope('device.states.update', {
      sourceRevision: 2,
      items: [{
        nodeId: 'node.gas-turbine-01',
        deviceStatus: 'unknown',
        statusUpdatedAt: '2026-08-04T14:20:30.000Z',
      }],
    }))

    expect(empty.status).toBe('invalid')
    expect(maximum.status).toBe('valid')
    expect(oversized.status).toBe('invalid')
    expect(illegalStatus.status).toBe('invalid')
  })

  it('强制来源修订号必填且为非负安全整数，但不限制它递增', () => {
    const item = { nodeId: 'node.device-01', deviceStatus: 'alarm', statusUpdatedAt: '2026-08-04T14:20:30Z' }
    const missing = validateHostCommandMessage(createCommandEnvelope('device.states.update', { items: [item] }))
    const negative = validateHostCommandMessage(createCommandEnvelope('device.states.update', { sourceRevision: -1, items: [item] }))
    const unsafe = validateHostCommandMessage(createCommandEnvelope('device.states.update', { sourceRevision: Number.MAX_SAFE_INTEGER + 1, items: [item] }))
    const smaller = validateHostCommandMessage(createCommandEnvelope('device.states.update', { sourceRevision: 0, items: [item] }))

    expect(missing.status).toBe('invalid')
    expect(negative.status).toBe('invalid')
    expect(unsafe.status).toBe('invalid')
    expect(smaller.status).toBe('valid')
  })

  it('节点标识只接受稳定小写格式且最长128位', () => {
    const validateNodeId = (nodeId: string) => validateHostCommandMessage(createCommandEnvelope('device.states.update', {
      sourceRevision: 1,
      items: [{ nodeId, deviceStatus: 'normal', statusUpdatedAt: '2026-08-04T14:20:30Z' }],
    })).status

    expect(validateNodeId('node-01')).toBe('valid')
    expect(validateNodeId(`node.${'a'.repeat(120)}`)).toBe('valid')
    expect(validateNodeId('Device-01')).toBe('invalid')
    expect(validateNodeId('node 01')).toBe('invalid')
    expect(validateNodeId('node/01')).toBe('invalid')
    expect(validateNodeId(`node.${'a'.repeat(128)}`)).toBe('invalid')
  })

  it('状态时间必须是可解析且显式带时区的国际标准时间', () => {
    const validateTime = (statusUpdatedAt: string) => validateHostCommandMessage(createCommandEnvelope('device.states.update', {
      sourceRevision: 1,
        items: [{ nodeId: 'node-01', deviceStatus: 'normal', statusUpdatedAt }],
    })).status

    expect(validateTime('2026-08-04T14:20:30Z')).toBe('valid')
    expect(validateTime('2026-08-04T14:20:30.123+08:00')).toBe('valid')
    expect(validateTime('2024-02-29T23:59:59-05:30')).toBe('valid')
    expect(validateTime('2026-08-04T14:20:30')).toBe('invalid')
    expect(validateTime('2026-08-04')).toBe('invalid')
    expect(validateTime('2026-13-04T14:20:30Z')).toBe('invalid')
    expect(validateTime('2026-02-30T00:00:00Z')).toBe('invalid')
    expect(validateTime('2026-08-04T24:00:00Z')).toBe('invalid')
    expect(validateTime('2026-08-04T14:60:00Z')).toBe('invalid')
    expect(validateTime('2026-08-04T14:20:30+24:00')).toBe('invalid')
  })

  it('接受带 replyTo 的状态快照，并拒绝带旧字段的双击事件', () => {
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
      deviceId: 'device-legacy',
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
      ['device.states.update', { sourceRevision: 3, items: [{ nodeId: 'node.gas-turbine-01', deviceStatus: 'alarm', statusUpdatedAt: '2026-08-04T14:20:30.000Z' }] }],
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
      ['topology.node.dblclick', { sceneId: 'gas-power', topologyId: 'gas-power.overview', nodeId: 'node.gas-turbine.01' }],
      ['scene.object.selected', { sceneId: 'gas-power', sceneNodeId: 'scene.gas-turbine.01', nodeId: 'node.gas-turbine.01' }],
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

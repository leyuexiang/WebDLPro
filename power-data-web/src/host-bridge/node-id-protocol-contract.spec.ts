import { describe, expect, it } from 'vitest'
import { toNodeId, toSessionId, toTopologyId } from '@/config/scene-topology/identifiers'
import { validateHostCommandMessage, validateHostEventMessage } from '@/host-bridge/host-protocol'

const baseEnvelope = {
  channel: 'power-scene-topology-shell' as const,
  version: 1 as const,
  instanceId: 'shell-node-contract',
  sessionId: toSessionId('session.node-contract'),
  timestamp: 1_725_000_000_000,
}

describe('节点编号协议迁移契约', () => {
  it('按 nodeId 接受完整状态快照，并拒绝旧 deviceId 主键', () => {
    const nodeId = toNodeId('gas-power.turbine-01')
    const valid = validateHostCommandMessage({
      ...baseEnvelope,
      messageId: 'command.node-state',
      type: 'device.states.update',
      payload: {
        sourceRevision: 1,
        items: [{ nodeId, deviceStatus: 'alarm', statusUpdatedAt: '2026-08-15T00:00:00.000Z' }],
      },
    })
    expect(valid.status).toBe('valid')

    const legacy = validateHostCommandMessage({
      ...baseEnvelope,
      messageId: 'command.legacy-device-state',
      type: 'device.states.update',
      payload: {
        sourceRevision: 1,
        items: [{ deviceId: 'device.gas.01', deviceStatus: 'alarm', statusUpdatedAt: '2026-08-15T00:00:00.000Z' }],
      },
    })
    expect(legacy.status).toBe('invalid')
  })

  it('双击事件只接受 sceneId、topologyId 和 nodeId，不再要求设备编号', () => {
    const valid = validateHostEventMessage({
      ...baseEnvelope,
      messageId: 'event.node-double-click',
      type: 'topology.node.dblclick',
      payload: {
        sceneId: 'gas-power',
        topologyId: toTopologyId('topology.gas-power.overview'),
        nodeId: toNodeId('gas-power.turbine-01'),
      },
    })
    expect(valid.status).toBe('valid')
  })
})

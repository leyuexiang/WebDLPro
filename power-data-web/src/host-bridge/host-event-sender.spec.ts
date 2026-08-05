import { describe, expect, it, vi } from 'vitest'
import { toDeviceId, toNodeId, toSceneId, toSessionId, toTopologyId } from '@/config/scene-topology/identifiers'
import { HostEventSender, type HostEventTransport } from '@/host-bridge/host-event-sender'
import type { HostEventMessage, HostVisualizationContext } from '@/host-bridge/host-protocol'

/** 夹具桥只记录通过发送器交付的事件，不模拟窗口或路由，保证测试聚焦协议转换职责。 */
function createTransport(): { transport: HostEventTransport; sent: HostEventMessage[] } {
  const sent: HostEventMessage[] = []
  return {
    transport: {
      getContext: () => ({ parentOrigin: 'https://parent.example.test', instanceId: 'visual-shell-01', sessionId: toSessionId('session-test-01') }),
      send: (event) => {
        sent.push(event)
        return true
      },
    },
    sent,
  }
}

/** ready 上下文作为已提交视图夹具，避免测试凭标题或文件名推断场景关系。 */
function createReadyContext(): HostVisualizationContext {
  return {
    sceneId: toSceneId('gas-power'),
    topologyId: toTopologyId('topology.gas-power'),
    actionId: null,
    contextRevision: 3,
    status: 'ready',
  }
}

describe('外层事件发送器', () => {
  it('命令结果保留父命令 replyTo，并由当前安全会话补齐信封', () => {
    const { transport, sent } = createTransport()
    const sender = new HostEventSender(transport, { now: () => 100 })

    const accepted = sender.sendCommandResult({
      replyTo: 'parent-command-01',
      source: 'executed',
      payload: { success: true, status: 'completed', contextRevision: 3, error: null },
    })

    expect(accepted).toBe(true)
    expect(sent).toEqual([expect.objectContaining({
      type: 'command.result',
      replyTo: 'parent-command-01',
      instanceId: 'visual-shell-01',
      timestamp: 100,
    })])
  })

  it('仅在事务提交后的 ready 上下文发送视图变更', () => {
    const { transport, sent } = createTransport()
    const sender = new HostEventSender(transport, { now: () => 101 })

    expect(sender.sendViewChanged({ ...createReadyContext(), status: 'initializing' })).toBe(false)
    expect(sender.sendViewChanged(createReadyContext())).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(expect.objectContaining({
      type: 'view.changed',
      payload: expect.objectContaining({ sceneId: 'gas-power', topologyId: 'topology.gas-power', contextRevision: 3 }),
    }))
  })

  it('正式清单设备双击强制携带设备标识，并以事件标识作为关联标识', () => {
    const { transport, sent } = createTransport()
    const sender = new HostEventSender(transport, { now: () => 102 })

    const accepted = sender.sendTopologyNodeDoubleClick({
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
      nodeId: toNodeId('node.turbine'),
      deviceId: toDeviceId('device.turbine'),
    }, 3)

    expect(accepted).toBe(true)
    expect(sent[0]).toEqual(expect.objectContaining({
      type: 'topology.node.dblclick',
      messageId: 'shell-topology-node-dblclick-1',
      payload: expect.objectContaining({
        deviceId: 'device.turbine',
        correlationId: 'shell-topology-node-dblclick-1',
        contextRevision: 3,
      }),
    }))
  })

  it('状态快照保留查询关联，错误事件不会接收原始 Error 对象', () => {
    const { transport, sent } = createTransport()
    const sender = new HostEventSender(transport, { now: () => 103 })

    expect(sender.sendStateSnapshot('parent-state-get-01', {
      manifestVersion: '2026.08.04',
      context: createReadyContext(),
      unityStatus: 'ready',
      topologyStatus: 'ready',
    })).toBe(true)
    expect(sender.sendSystemError({
      code: 'scene.switch.failed',
      message: '场景切换未完成。',
      stage: 'switching-scene',
      recoverable: true,
    })).toBe(true)

    expect(sent).toHaveLength(2)
    expect(sent[0]).toEqual(expect.objectContaining({ type: 'state.snapshot', replyTo: 'parent-state-get-01' }))
    expect(sent[1]).toEqual(expect.objectContaining({ type: 'system.error' }))
    // 先按可判别联合类型收窄，再验证错误载荷是受控结构，而非浏览器或 Unity 抛出的原始 Error。
    if (sent[1]?.type !== 'system.error') throw new Error('第二条事件必须为系统错误。')
    expect(sent[1].payload.error).not.toBeInstanceOf(Error)
  })

  it('出站校验失败时不会调用桥接层发送', () => {
    const { transport } = createTransport()
    const send = vi.spyOn(transport, 'send')
    const sender = new HostEventSender(transport, { now: () => 104 })

    const accepted = sender.sendTopologyNodeDoubleClick({
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
      nodeId: toNodeId('node.turbine'),
      deviceId: toDeviceId('device.turbine'),
    }, Number.NaN)

    expect(accepted).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})

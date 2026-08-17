import { describe, expect, it, vi } from 'vitest'
import { toNodeId, toSceneId, toSceneNodeId, toSessionId, toTopologyId } from '@/config/scene-topology/identifiers'
import type { HostCommandLifecycleResult } from '@/host-bridge/host-command-lifecycle'
import { HostEventSender, type HostEventTransport } from '@/host-bridge/host-event-sender'
import type { HostEventMessage, HostProtocolError, HostVisualizationContext, SceneObjectSelectedPayload } from '@/host-bridge/host-protocol'
import type { TopologyNodeDoubleClickIntent } from '@/modules/visual/topology/topology-node-interaction'

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

  it('失败结果只发送白名单字段和错误码对应的固定脱敏说明', () => {
    const { transport, sent } = createTransport()
    const sender = new HostEventSender(transport, { now: () => 100 })
    const taintedResult = {
      replyTo: 'parent-command-sensitive-01',
      source: 'executed',
      payload: {
        success: false,
        status: 'failed',
        error: {
          code: 'scene.switch.failed',
          message: 'Root/Plant/Turbine，token=secret-value，payload={"raw":true}',
          stage: 'switching-scene',
          recoverable: true,
          rawPayload: { credential: 'secret-value' },
        },
        unityHierarchyPath: 'Root/Plant/Turbine',
      },
    } as HostCommandLifecycleResult

    expect(sender.sendCommandResult(taintedResult)).toBe(true)
    expect(sent[0]).toEqual(expect.objectContaining({
      type: 'command.result',
      replyTo: 'parent-command-sensitive-01',
      payload: expect.objectContaining({
        success: false,
        error: expect.objectContaining({ message: '目标场景切换未能完成。' }),
      }),
    }))
    const serialized = JSON.stringify(sent[0])
    expect(serialized).not.toContain('Root/Plant/Turbine')
    expect(serialized).not.toContain('secret-value')
    expect(serialized).not.toContain('rawPayload')
  })

  it('仅在事务提交后的 ready 上下文发送视图变更', () => {
    const { transport, sent } = createTransport()
    const sender = new HostEventSender(transport, { now: () => 101 })

    expect(sender.sendViewChanged({ ...createReadyContext(), status: 'initializing' })).toBe(false)
    expect(sender.sendViewChanged(createReadyContext(), undefined, 'parent-view-01')).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(expect.objectContaining({
      type: 'view.changed',
      replyTo: 'parent-view-01',
      payload: expect.objectContaining({ sceneId: 'gas-power', topologyId: 'topology.gas-power', contextRevision: 3 }),
    }))
  })

  it('双击只发送场景、拓扑和节点三项稳定标识', () => {
    const { transport, sent } = createTransport()
    const sender = new HostEventSender(transport, { now: () => 102 })

    const taintedIntent = {
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
      nodeId: toNodeId('node.turbine'),
      unityHierarchyPath: 'Root/Plant/Turbine',
      accessToken: 'secret-value',
    } as TopologyNodeDoubleClickIntent
    const accepted = sender.sendTopologyNodeDoubleClick(taintedIntent)

    expect(accepted).toBe(true)
    expect(sent[0]).toEqual(expect.objectContaining({
      type: 'topology.node.dblclick',
      messageId: 'shell-topology-node-dblclick-1',
      payload: { sceneId: 'gas-power', topologyId: 'topology.gas-power', nodeId: 'node.turbine' },
    }))
    expect(JSON.stringify(sent[0])).not.toContain('unityHierarchyPath')
    expect(JSON.stringify(sent[0])).not.toContain('secret-value')
  })

  it('三维对象选择只投影稳定映射字段，不透传Unity原始选择附加数据', () => {
    const { transport, sent } = createTransport()
    const sender = new HostEventSender(transport, { now: () => 102 })
    const taintedSelection = {
      sceneId: toSceneId('gas-power'),
      sceneNodeId: toSceneNodeId('scene-node.turbine'),
      nodeId: toNodeId('node.turbine'),
      unityMessageId: 'unity-inner-message-01',
      unityHierarchyPath: 'Root/Plant/Turbine',
      rawUnityPayload: { accessToken: 'secret-value' },
    } as SceneObjectSelectedPayload

    expect(sender.sendSceneObjectSelected(taintedSelection)).toBe(true)
    expect(sent[0]).toEqual(expect.objectContaining({
      type: 'scene.object.selected',
      payload: { sceneId: 'gas-power', sceneNodeId: 'scene-node.turbine', nodeId: 'node.turbine' },
    }))
    const serialized = JSON.stringify(sent[0])
    expect(serialized).not.toContain('unity-inner-message-01')
    expect(serialized).not.toContain('Root/Plant/Turbine')
    expect(serialized).not.toContain('secret-value')
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
    const taintedError = {
      code: 'scene.switch.failed',
      message: 'Assets/Scenes/Business/GasPower.unity，password=secret-value',
      stage: 'switching-scene',
      recoverable: true,
      rawPayload: { password: 'secret-value' },
    } as HostProtocolError
    expect(sender.sendSystemError(taintedError, 'parent-error-01')).toBe(true)

    expect(sent).toHaveLength(2)
    expect(sent[0]).toEqual(expect.objectContaining({ type: 'state.snapshot', replyTo: 'parent-state-get-01' }))
    expect(sent[1]).toEqual(expect.objectContaining({ type: 'system.error', replyTo: 'parent-error-01' }))
    // 先按可判别联合类型收窄，再验证错误载荷是受控结构，而非浏览器或 Unity 抛出的原始 Error。
    if (sent[1]?.type !== 'system.error') throw new Error('第二条事件必须为系统错误。')
    expect(sent[1].payload.error).not.toBeInstanceOf(Error)
    expect(sent[1].payload.error.message).toBe('目标场景切换未能完成。')
    const serialized = JSON.stringify(sent[1])
    expect(serialized).not.toContain('Assets/Scenes/Business/GasPower.unity')
    expect(serialized).not.toContain('secret-value')
    expect(serialized).not.toContain('rawPayload')
  })

  it('启动期限超时时只上报固定错误码和脱敏说明', () => {
    const { transport, sent } = createTransport()
    const sender = new HostEventSender(transport, { now: () => 104 })

    expect(sender.sendSystemError({
      code: 'runtime.startup.timeout',
      message: 'manifestUrl=https://internal.example.test/path，UnityError=secret-value',
      stage: 'handshake',
      recoverable: true,
    })).toBe(true)

    expect(sent).toEqual([expect.objectContaining({
      type: 'system.error',
      payload: expect.objectContaining({
        error: expect.objectContaining({
          code: 'runtime.startup.timeout',
          message: '页面未能在启动期限内完成运行时准备。',
        }),
      }),
    })])
    expect(JSON.stringify(sent[0])).not.toContain('internal.example.test')
    expect(JSON.stringify(sent[0])).not.toContain('secret-value')
  })

  it('出站校验失败时不会调用桥接层发送', () => {
    const { transport } = createTransport()
    const send = vi.spyOn(transport, 'send')
    const sender = new HostEventSender(transport, { now: () => 104 })

    const accepted = sender.sendTopologyNodeDoubleClick({
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
      nodeId: undefined,
    } as unknown as TopologyNodeDoubleClickIntent)

    const missingNodeAccepted = sender.sendTopologyNodeDoubleClick({
      sceneId: toSceneId('gas-power'),
      topologyId: toTopologyId('topology.gas-power'),
      nodeId: toNodeId('node.turbine'),
    })
    const invalidReplyAccepted = sender.sendSystemError({
      code: 'scene.switch.failed',
      message: '该文本不会直接发送。',
      stage: 'switching-scene',
      recoverable: true,
    }, '')

    expect(accepted).toBe(false)
    expect(missingNodeAccepted).toBe(true)
    expect(invalidReplyAccepted).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

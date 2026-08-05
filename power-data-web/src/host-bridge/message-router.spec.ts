import { describe, expect, it } from 'vitest'
import { HOST_PROTOCOL_CHANNEL } from '@/host-bridge/host-protocol'
import { WindowMessageRouter } from '@/host-bridge/message-router'
import { WEBGL_PROTOCOL_CHANNEL } from '@/services/webgl/protocol'

/** 轻量监听目标记录注册和移除次数，用于验证路由器不会重复持有全局监听。 */
class FakeMessageTarget {
  public addCount = 0
  public removeCount = 0

  public addEventListener(): void {
    this.addCount += 1
  }

  public removeEventListener(): void {
    this.removeCount += 1
  }
}

/** 构造最小消息事件，路由器只读取 data.channel，不依赖浏览器窗口实现。 */
function createMessage(channel: string): MessageEvent<unknown> {
  return { data: { channel } } as MessageEvent<unknown>
}

describe('统一窗口消息路由器', () => {
  it('将外层与 Unity 通道分别分发给各自订阅者', () => {
    const target = new FakeMessageTarget()
    const router = new WindowMessageRouter(target)
    const receivedChannels: string[] = []
    const unsubscribeHost = router.subscribe(HOST_PROTOCOL_CHANNEL, () => receivedChannels.push('host'))
    const unsubscribeUnity = router.subscribe(WEBGL_PROTOCOL_CHANNEL, () => receivedChannels.push('unity'))

    router.route(createMessage(HOST_PROTOCOL_CHANNEL))
    router.route(createMessage(WEBGL_PROTOCOL_CHANNEL))
    unsubscribeHost()
    unsubscribeUnity()

    expect(receivedChannels).toEqual(['host', 'unity'])
    expect(target.addCount).toBe(1)
    expect(target.removeCount).toBe(1)
  })

  it('安静拒绝未知通道并将诊断日志限制为固定容量', () => {
    const router = new WindowMessageRouter(new FakeMessageTarget())
    for (let index = 0; index < 51; index += 1) router.route(createMessage(`unknown-${index}`))

    const diagnostics = router.getDiagnostics()
    expect(diagnostics).toHaveLength(50)
    expect(diagnostics[0]?.channel).toBe('unknown-1')
    expect(diagnostics.every((diagnostic) => diagnostic.code === 'message.channel.unknown')).toBe(true)
  })
})

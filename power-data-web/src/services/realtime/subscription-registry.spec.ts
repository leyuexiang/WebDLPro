import { describe, expect, it } from 'vitest'
import { RealtimeSubscriptionRegistry, type RealtimeMessageListener, type RealtimeTransport } from './subscription-registry'

/** 注册表测试确保同主题只创建一次底层订阅，并在最后一个引用释放后清理。 */
describe('实时订阅注册表', () => {
  it('对同一主题去重并按引用释放', () => {
    let subscribeCount = 0
    let unsubscribeCount = 0
    let transportListener: RealtimeMessageListener | undefined
    const transport: RealtimeTransport = {
      subscribe(_topic, listener) {
        subscribeCount += 1
        transportListener = listener
        return () => {
          unsubscribeCount += 1
        }
      },
    }
    const registry = new RealtimeSubscriptionRegistry(transport)
    const received: unknown[] = []
    const releaseFirst = registry.subscribe('metric.demo', (payload) => received.push(payload))
    const releaseSecond = registry.subscribe('metric.demo', (payload) => received.push(`second:${String(payload)}`))

    transportListener?.({ value: 1 })
    releaseFirst()
    expect(subscribeCount).toBe(1)
    expect(unsubscribeCount).toBe(0)
    expect(received).toEqual([{ value: 1 }, 'second:[object Object]'])

    releaseSecond()
    releaseSecond()
    expect(unsubscribeCount).toBe(1)
  })
})

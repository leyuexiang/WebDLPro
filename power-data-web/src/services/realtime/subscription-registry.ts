/** 单个实时主题消息的最小传输契约，实际协议由任务 043 后的适配器负责解析。 */
export type RealtimeMessageListener = (payload: unknown) => void

/**
 * 传输层只需提供“按主题订阅”的能力，注册表无需耦合 WebSocket、服务端事件或轮询实现。
 * 退订函数必须可重复调用，不应因重复清理导致连接状态异常。
 */
export interface RealtimeTransport {
  subscribe(topic: string, listener: RealtimeMessageListener): () => void
}

interface SubscriptionEntry {
  listeners: Set<RealtimeMessageListener>
  unsubscribe: () => void
}

/**
 * 单标签页订阅去重与引用计数注册表。
 * 第一个监听者才创建底层订阅，最后一个监听者释放时才取消；运行时对象只保留在服务层，不进入状态仓库。
 */
export class RealtimeSubscriptionRegistry {
  private readonly entries = new Map<string, SubscriptionEntry>()

  public constructor(private readonly transport: RealtimeTransport) {}

  /**
   * 订阅一个主题并返回幂等释放函数。
   * 分发时复制监听器集合，确保某个监听器在回调内取消订阅不会跳过同批其他监听器。
   */
  public subscribe(topic: string, listener: RealtimeMessageListener): () => void {
    let entry = this.entries.get(topic)

    if (!entry) {
      const listeners = new Set<RealtimeMessageListener>()
      const unsubscribe = this.transport.subscribe(topic, (payload) => {
        for (const currentListener of [...listeners]) {
          currentListener(payload)
        }
      })
      entry = { listeners, unsubscribe }
      this.entries.set(topic, entry)
    }

    entry.listeners.add(listener)
    let released = false

    return () => {
      if (released) return
      released = true
      this.release(topic, listener)
    }
  }

  /** 释放单个监听器；引用归零时先从映射移除，再调用传输层退订以防重入。 */
  private release(topic: string, listener: RealtimeMessageListener): void {
    const entry = this.entries.get(topic)
    if (!entry) return

    entry.listeners.delete(listener)
    if (entry.listeners.size > 0) return

    this.entries.delete(topic)
    entry.unsubscribe()
  }

  /** 应用退出或鉴权切换时一次性释放所有底层订阅，防止连接与监听器残留。 */
  public dispose(): void {
    const entries = [...this.entries.values()]
    this.entries.clear()

    for (const entry of entries) {
      entry.unsubscribe()
    }
  }
}

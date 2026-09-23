import { HOST_PROTOCOL_CHANNEL } from '@/host-bridge/host-protocol'
import { WEBGL_PROTOCOL_CHANNEL } from '@/services/webgl/protocol'

/** 仅允许两个已知通道进入路由器；其他窗口消息不进入任一业务连接器。 */
export type RoutedMessageChannel = typeof HOST_PROTOCOL_CHANNEL | typeof WEBGL_PROTOCOL_CHANNEL

/** 拒绝诊断只保存有限元数据，禁止记录完整外部载荷。 */
export interface MessageRouterDiagnostic {
  code: 'message.channel.unknown'
  channel: string
  timestamp: number
}

/** 全局监听目标最小接口，既支持浏览器 window，也便于单元测试提供轻量事件目标。 */
interface MessageEventTarget {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

type RoutedMessageListener = (event: MessageEvent<unknown>) => void

const ROUTED_CHANNELS: readonly RoutedMessageChannel[] = [HOST_PROTOCOL_CHANNEL, WEBGL_PROTOCOL_CHANNEL]
const MAXIMUM_DIAGNOSTICS = 50

/**
 * 单一窗口消息路由器。
 * 它只按顶层 channel 分流，不校验来源、窗口、会话或业务载荷；这些安全职责仍归各自连接器所有，
 * 因而外层桥和 Unity 内层连接器不会重复记录同一次拒绝。
 */
export class WindowMessageRouter {
  private readonly listenersByChannel = new Map<RoutedMessageChannel, Set<RoutedMessageListener>>()
  private readonly diagnostics: MessageRouterDiagnostic[] = []
  private readonly receiveMessageBound = (event: MessageEvent<unknown>) => this.route(event)
  private activeEventTarget: MessageEventTarget | undefined
  private listening = false

  /** 测试可注入事件目标；生产单例在首次订阅时才读取当前 window，避免模块加载顺序影响监听。 */
  public constructor(private readonly providedEventTarget?: MessageEventTarget) {}

  /**
   * 订阅指定协议通道。首次订阅才注册浏览器全局监听，最后一个订阅释放后立即移除，
   * 防止子应用卸载后遗留全局闭包和消息入口。
   */
  public subscribe(channel: RoutedMessageChannel, listener: RoutedMessageListener): () => void {
    const listeners = this.listenersByChannel.get(channel) ?? new Set<RoutedMessageListener>()
    listeners.add(listener)
    this.listenersByChannel.set(channel, listeners)
    this.startListening()

    return () => {
      const currentListeners = this.listenersByChannel.get(channel)
      if (!currentListeners) return
      currentListeners.delete(listener)
      if (currentListeners.size === 0) this.listenersByChannel.delete(channel)
      if (this.listenersByChannel.size === 0) this.stopListening()
    }
  }

  /** 返回固定上限的只读诊断快照，调用方不能修改路由器内部日志。 */
  public getDiagnostics(): readonly MessageRouterDiagnostic[] {
    return [...this.diagnostics]
  }

  /** 测试与浏览器监听共用相同分流逻辑，保证行为不会因入口不同而变化。 */
  public route(event: MessageEvent<unknown>): void {
    const channel = readChannel(event.data)
    if (!isRoutedMessageChannel(channel)) {
      this.recordUnknownChannel(channel)
      return
    }

    // 克隆监听器集合，允许回调在处理过程中安全解除自身订阅而不影响当前分发循环。
    const listeners = [...(this.listenersByChannel.get(channel) ?? [])]
    listeners.forEach((listener) => listener(event))
  }

  /** 完整释放路由器，用于应用销毁或测试结束；重复调用安全。 */
  public dispose(): void {
    this.stopListening()
    this.listenersByChannel.clear()
    this.diagnostics.length = 0
  }

  /** 浏览器环境中至多注册一个全局 message 监听器。 */
  private startListening(): void {
    const eventTarget: MessageEventTarget | undefined = this.providedEventTarget ?? (typeof window === 'undefined' ? undefined : window)
    if (this.listening || !eventTarget) return
    eventTarget.addEventListener('message', this.receiveMessageBound)
    this.activeEventTarget = eventTarget
    this.listening = true
  }

  /** 无订阅后立即移除监听，避免路由器成为页面卸载后的长生命周期根引用。 */
  private stopListening(): void {
    if (!this.listening || !this.activeEventTarget) return
    this.activeEventTarget.removeEventListener('message', this.receiveMessageBound)
    this.activeEventTarget = undefined
    this.listening = false
  }

  /** 未知通道被静默拒绝，只保留截断通道名、时间和固定错误代码。 */
  private recordUnknownChannel(channel: string | undefined): void {
    this.diagnostics.push({
      code: 'message.channel.unknown',
      channel: (channel ?? 'missing').slice(0, 128),
      timestamp: Date.now(),
    })
    if (this.diagnostics.length > MAXIMUM_DIAGNOSTICS) this.diagnostics.shift()
  }
}

/** 当前子应用的唯一全局路由器；外层桥与 Unity 连接器都必须从此处订阅。 */
export const windowMessageRouter = new WindowMessageRouter()

/** 只读取顶层字符串 channel，不对任意 payload 做序列化或深层遍历。 */
function readChannel(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const channel = (value as Record<string, unknown>).channel
  return typeof channel === 'string' ? channel : undefined
}

/** 使用类型守卫把不可信字符串收敛为两个固定协议通道之一。 */
function isRoutedMessageChannel(value: string | undefined): value is RoutedMessageChannel {
  return typeof value === 'string' && ROUTED_CHANNELS.includes(value as RoutedMessageChannel)
}

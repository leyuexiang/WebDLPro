import type { WebglRuntimeRegistration } from '@/config/process/types'
import {
  createWebglCommand,
  isWebglEventType,
  isWebglMessageEnvelope,
  isWebglObjectSelectedPayload,
  isWebglReadyPayload,
  isWebglRequestAcknowledgementPayload,
  type WebglCommandType,
  type WebglEventType,
  type WebglMessageEnvelope,
  type WebglObjectSelectedPayload,
  type WebglReadyPayload,
} from '@/services/webgl/protocol'

/** 单个网页图形运行时的连接阶段；宿主会将其映射为页面可见状态。 */
export type WebglConnectorStatus = 'idle' | 'handshaking' | 'ready' | 'releasing' | 'disposed' | 'failed'

/** 受限日志只保留最近记录，便于排查被拒绝消息，同时避免异常页面持续发包造成内存增长。 */
export interface WebglMessageRejection {
  reason: string
  timestamp: number
}

/** 连接器向唯一宿主报告的事件；业务组件不得订阅 window.message 或直接调用 postMessage。 */
export interface WebglRuntimeConnectorCallbacks {
  onStatusChange?: (status: WebglConnectorStatus, reason?: string) => void
  onReady?: (ready: WebglReadyPayload) => void
  onObjectSelected?: (payload: WebglObjectSelectedPayload, messageId: string) => void
  onCommandFailure?: (command: WebglCommandType, reason: string) => void
  onDisposed?: (requestId: string) => void
}

interface PendingCommand {
  envelope: WebglMessageEnvelope<WebglCommandType, unknown>
  retryCount: number
  timeoutHandle: ReturnType<typeof setTimeout>
}

const COMMAND_TIMEOUT_MS = 10_000
const HANDSHAKE_TIMEOUT_MS = 15_000
const MAX_PENDING_COMMANDS = 64
const MAX_REJECTION_LOGS = 50

/**
 * 可在网络抖动后安全重发一次的命令。所有重试沿用同一个 messageId，
 * 子页面可据此做幂等去重，前端也不会生成第二条待确认记录。
 */
const IDEMPOTENT_COMMANDS = new Set<WebglCommandType>([
  'init',
  'resize',
  'resetScene',
  'focusNode',
  'setNodeVisibility',
  'setRouteFlow',
  'dispose',
])

/** 由单实例宿主创建的安全消息连接器。它是整个前端唯一接触 window.message 的位置。 */
export class WebglRuntimeConnector {
  private readonly pendingCommands = new Map<string, PendingCommand>()
  private readonly rejections: WebglMessageRejection[] = []
  private readonly receiveMessageBound = (event: MessageEvent<unknown>) => this.receiveMessage(event)
  private readonly negotiatedCommandCapabilities = new Set<WebglCommandType>()
  private readonly negotiatedEventCapabilities = new Set<WebglEventType>()
  private childWindow: WindowProxy | null = null
  private handshakeTimeoutHandle: ReturnType<typeof setTimeout> | undefined
  private nextMessageSequence = 0
  private status: WebglConnectorStatus = 'idle'

  public constructor(
    private readonly runtime: WebglRuntimeRegistration,
    private readonly instanceId: string,
    private readonly callbacks: WebglRuntimeConnectorCallbacks = {},
  ) {}

  /**
   * 在 iframe 设置 src 前调用，先建立父页面监听，避免极快加载的子页面发出 ready 后丢失。
   * 监听注册只发生一次，重复调用不会叠加事件处理器。
   */
  public startListening(): void {
    if (this.status !== 'idle') return

    window.addEventListener('message', this.receiveMessageBound)
  }

  /**
   * 在 iframe 元素创建后绑定其 contentWindow，并从此刻开始计算 15 秒握手时限。
   * 未绑定 iframe 窗口时，即便来源相同也会被拒绝，防止同源其他页面伪造运行时消息。
   */
  public attachChildWindow(childWindow: WindowProxy | null): void {
    if (!childWindow || this.status === 'disposed' || this.status === 'failed') return

    this.childWindow = childWindow
    this.changeStatus('handshaking')
    this.clearHandshakeTimeout()
    this.handshakeTimeoutHandle = setTimeout(() => {
      this.fail('网页图形运行时握手超时。')
    }, HANDSHAKE_TIMEOUT_MS)
  }

  /** 仅返回已通过 ready 协商的命令能力，调用方不得用配置猜测子页面实际能力。 */
  public supportsCommand(command: WebglCommandType): boolean {
    return this.status === 'ready' && this.negotiatedCommandCapabilities.has(command)
  }

  /** 返回协商后的只读命令能力快照，供状态层展示与二次保护使用。 */
  public getCommandCapabilities(): readonly WebglCommandType[] {
    return [...this.negotiatedCommandCapabilities]
  }

  /** 返回受限拒绝日志快照；日志中不保存不可信 payload，避免泄露或无界缓存。 */
  public getRejections(): readonly WebglMessageRejection[] {
    return [...this.rejections]
  }

  /**
   * 向已就绪运行时发送一条受白名单约束的命令，并建立有限待确认记录。
   * 返回原始 messageId，业务协调器可将它用于来源追踪；发送失败时返回 undefined。
   */
  public sendCommand(command: Exclude<WebglCommandType, 'init'>, payload: unknown): string | undefined {
    if (this.status !== 'ready') {
      this.callbacks.onCommandFailure?.(command, '网页图形运行时尚未就绪。')
      return undefined
    }

    if (!this.negotiatedCommandCapabilities.has(command)) {
      this.callbacks.onCommandFailure?.(command, `运行时未声明 ${command} 命令能力。`)
      return undefined
    }

    if (command === 'dispose') this.changeStatus('releasing')

    return this.sendPendingCommand(command, payload)
  }

  /**
   * 释放前主动下发 dispose，并等待带有同一 requestId 的 disposed 事件。
   * 子页面不支持释放命令、已经失效或已经释放时，调用方可立即清理 DOM，不会遗留监听器。
   */
  public requestDispose(): string | undefined {
    if (this.status === 'disposed') return undefined

    if (this.status !== 'ready' || !this.negotiatedCommandCapabilities.has('dispose')) {
      this.forceDispose()
      return undefined
    }

    return this.sendCommand('dispose', { reason: 'parent-release' })
  }

  /**
   * 立即释放本地资源，不等待远端响应。用于切换失败、组件卸载或 dispose 超时后的兜底，
   * 会清空全部计时器与待确认表，保证旧实例消息不能污染新实例。
   */
  public forceDispose(): void {
    this.clearHandshakeTimeout()
    this.clearPendingCommands()
    window.removeEventListener('message', this.receiveMessageBound)
    this.childWindow = null

    // 失败是宿主可见终态，强制清理不能再将其伪装成已确认的远端 disposed。
    if (this.status !== 'disposed' && this.status !== 'failed') this.changeStatus('disposed')
  }

  /**
   * 所有上行消息先经过来源、窗口实例、协议版本、频道、实例标识和事件白名单校验。
   * 任一条件不符都会被拒绝，且绝不会进入业务状态或待确认表。
   */
  private receiveMessage(event: MessageEvent<unknown>): void {
    if (event.origin !== this.runtime.childOrigin) {
      this.reject('消息来源与登记的子页面来源不一致。')
      return
    }

    if (!this.childWindow || event.source !== this.childWindow) {
      this.reject('消息发送窗口与当前 iframe 实例不一致。')
      return
    }

    if (!isWebglMessageEnvelope(event.data)) {
      this.reject('消息信封格式、频道或协议版本无效。')
      return
    }

    const envelope = event.data
    if (envelope.instanceId !== this.instanceId) {
      this.reject('消息实例标识与当前运行时不一致。')
      return
    }

    if (!isWebglEventType(envelope.type)) {
      this.reject('消息类型不在上行事件白名单内。')
      return
    }

    if (!this.runtime.eventCapabilities.includes(envelope.type)) {
      this.reject('运行时登记表未授权该上行事件。')
      return
    }

    this.handleEvent(envelope as WebglMessageEnvelope<WebglEventType, unknown>)
  }

  /** 根据已验证事件类型进入相应处理分支，未知事件在上游已经被拒绝。 */
  private handleEvent(envelope: WebglMessageEnvelope<WebglEventType, unknown>): void {
    switch (envelope.type) {
      case 'ready':
        this.handleReady(envelope)
        return
      case 'ack':
        this.handleAcknowledgement(envelope, 'ack')
        return
      case 'commandResult':
        this.handleAcknowledgement(envelope, 'commandResult')
        return
      case 'objectSelected':
        this.handleObjectSelected(envelope)
        return
      case 'disposed':
        this.handleDisposed(envelope)
        return
    }
  }

  /** ready 必须精确匹配登记表中的构建、映射、协议和资源摘要，能力声明也必须覆盖登记项。 */
  private handleReady(envelope: WebglMessageEnvelope<WebglEventType, unknown>): void {
    if (this.status !== 'handshaking') {
      this.reject('非握手阶段收到 ready 事件。')
      return
    }

    if (!isWebglReadyPayload(envelope.payload)) {
      this.fail('网页图形运行时 ready 载荷无效。')
      return
    }

    const ready = envelope.payload
    const isMatchingRuntime =
      ready.runtimeKey === this.runtime.runtimeKey &&
      ready.buildId === this.runtime.buildId &&
      ready.sceneMappingVersion === this.runtime.sceneMappingVersion &&
      ready.protocolVersion === this.runtime.protocolVersion &&
      ready.resourceDigest === this.runtime.resourceDigest
    const hasRegisteredCommands = this.runtime.capabilities.every((command) => ready.commandCapabilities.includes(command))
    const hasRegisteredEvents = this.runtime.eventCapabilities.every((event) => ready.eventCapabilities.includes(event))

    if (!isMatchingRuntime || !hasRegisteredCommands || !hasRegisteredEvents) {
      this.fail('网页图形运行时构建、映射、资源摘要或能力声明与登记表不一致。')
      return
    }

    this.negotiatedCommandCapabilities.clear()
    ready.commandCapabilities.forEach((command) => this.negotiatedCommandCapabilities.add(command))
    this.negotiatedEventCapabilities.clear()
    ready.eventCapabilities.forEach((event) => this.negotiatedEventCapabilities.add(event))
    this.callbacks.onReady?.(ready)

    this.sendPendingCommand('init', {
      runtimeKey: this.runtime.runtimeKey,
      buildId: this.runtime.buildId,
      sceneMappingVersion: this.runtime.sceneMappingVersion,
      resourceDigest: this.runtime.resourceDigest,
    })
  }

  /** ack 只会确认 init 或已登记的常规命令；requestId 必须命中原始 messageId。 */
  private handleAcknowledgement(
    envelope: WebglMessageEnvelope<WebglEventType, unknown>,
    eventType: 'ack' | 'commandResult',
  ): void {
    if (!isWebglRequestAcknowledgementPayload(envelope.payload)) {
      this.reject(`${eventType} 事件缺少原始 requestId。`)
      return
    }

    const pending = this.pendingCommands.get(envelope.payload.requestId)
    if (!pending) {
      this.reject(`${eventType} 事件未命中待确认命令。`)
      return
    }

    if (pending.envelope.type === 'dispose') {
      if (envelope.payload.success === false) this.fail('网页图形运行时拒绝执行释放命令。')
      return
    }

    this.completePendingCommand(pending.envelope.messageId)
    if (envelope.payload.success === false) {
      const reason = envelope.payload.message ?? '网页图形运行时执行命令失败。'
      if (pending.envelope.type === 'init') {
        this.fail(reason)
        return
      }

      this.callbacks.onCommandFailure?.(pending.envelope.type, reason)
      return
    }

    if (pending.envelope.type === 'init') {
      this.clearHandshakeTimeout()
      this.changeStatus('ready')
    }
  }

  /** 对象选中仅在已就绪且协商声明该事件后才允许影响二维拓扑与详情联动。 */
  private handleObjectSelected(envelope: WebglMessageEnvelope<WebglEventType, unknown>): void {
    if (this.status !== 'ready' || !this.negotiatedEventCapabilities.has('objectSelected')) {
      this.reject('未就绪运行时不能触发对象选中联动。')
      return
    }

    if (!isWebglObjectSelectedPayload(envelope.payload)) {
      this.reject('对象选中事件缺少稳定节点标识。')
      return
    }

    this.callbacks.onObjectSelected?.(envelope.payload, envelope.messageId)
  }

  /** disposed 必须回填 dispose 原始 messageId；收到确认后才让宿主移除 iframe。 */
  private handleDisposed(envelope: WebglMessageEnvelope<WebglEventType, unknown>): void {
    if (!isWebglRequestAcknowledgementPayload(envelope.payload)) {
      this.reject('disposed 事件缺少原始 requestId。')
      return
    }

    const pending = this.pendingCommands.get(envelope.payload.requestId)
    if (!pending || pending.envelope.type !== 'dispose') {
      this.reject('disposed 事件未命中释放命令。')
      return
    }

    this.completePendingCommand(pending.envelope.messageId)
    this.clearHandshakeTimeout()
    this.changeStatus('disposed')
    this.callbacks.onDisposed?.(envelope.payload.requestId)
  }

  /**
   * 所有下行命令都以登记的精确子页面来源作为 targetOrigin，禁止使用通配符。
   * 待确认表达到上限时拒绝继续发送，避免子页面失联导致内存无界增长。
   */
  private sendPendingCommand(command: WebglCommandType, payload: unknown): string | undefined {
    if (!this.childWindow) {
      this.callbacks.onCommandFailure?.(command, '网页图形 iframe 窗口尚未绑定。')
      return undefined
    }

    if (this.pendingCommands.size >= MAX_PENDING_COMMANDS) {
      this.callbacks.onCommandFailure?.(command, '网页图形待确认命令已达到安全上限。')
      return undefined
    }

    const messageId = `${this.instanceId}-${++this.nextMessageSequence}`
    const envelope = createWebglCommand(this.instanceId, messageId, command, payload)
    const timeoutHandle = setTimeout(() => this.handleCommandTimeout(messageId), COMMAND_TIMEOUT_MS)
    this.pendingCommands.set(messageId, { envelope, retryCount: 0, timeoutHandle })
    this.postCommand(envelope)
    return messageId
  }

  /** 使用同一信封重发，以保留 requestId 的可追踪性与子页面幂等去重语义。 */
  private postCommand(envelope: WebglMessageEnvelope<WebglCommandType, unknown>): void {
    this.childWindow?.postMessage(envelope, this.runtime.childOrigin)
  }

  /** 10 秒超时后仅对幂等命令重试一次；其余命令立刻删除待确认记录并上报失败。 */
  private handleCommandTimeout(messageId: string): void {
    const pending = this.pendingCommands.get(messageId)
    if (!pending) return

    if (pending.retryCount === 0 && IDEMPOTENT_COMMANDS.has(pending.envelope.type)) {
      pending.retryCount = 1
      pending.timeoutHandle = setTimeout(() => this.handleCommandTimeout(messageId), COMMAND_TIMEOUT_MS)
      this.postCommand(pending.envelope)
      return
    }

    this.completePendingCommand(messageId)
    const reason = `网页图形命令 ${pending.envelope.type} 确认超时。`
    if (pending.envelope.type === 'init' || pending.envelope.type === 'dispose') {
      this.fail(reason)
      return
    }

    this.callbacks.onCommandFailure?.(pending.envelope.type, reason)
  }

  /** 成功或失败后统一清理定时器与表项，避免同一 command 的后续消息再次影响状态。 */
  private completePendingCommand(messageId: string): void {
    const pending = this.pendingCommands.get(messageId)
    if (!pending) return

    clearTimeout(pending.timeoutHandle)
    this.pendingCommands.delete(messageId)
  }

  /** 失败是终态：清空本实例全部资源，旧窗口后续消息会因 source 或监听器缺失而失效。 */
  private fail(reason: string): void {
    this.clearHandshakeTimeout()
    this.clearPendingCommands()
    window.removeEventListener('message', this.receiveMessageBound)
    this.changeStatus('failed', reason)
  }

  /** 统一记录不可信消息拒绝原因，并固定上限防止恶意来源制造内存压力。 */
  private reject(reason: string): void {
    this.rejections.push({ reason, timestamp: Date.now() })
    if (this.rejections.length > MAX_REJECTION_LOGS) this.rejections.shift()
  }

  /** 只在状态真正改变时通知宿主，避免重复渲染或重复触发释放逻辑。 */
  private changeStatus(status: WebglConnectorStatus, reason?: string): void {
    if (this.status === status) return

    this.status = status
    this.callbacks.onStatusChange?.(status, reason)
  }

  /** 清除握手计时器，防止运行时已就绪后旧定时器误将状态改为失败。 */
  private clearHandshakeTimeout(): void {
    if (this.handshakeTimeoutHandle === undefined) return

    clearTimeout(this.handshakeTimeoutHandle)
    this.handshakeTimeoutHandle = undefined
  }

  /** 释放全部命令定时器与映射项，确保每个实例最多拥有有限资源。 */
  private clearPendingCommands(): void {
    this.pendingCommands.forEach((pending) => clearTimeout(pending.timeoutHandle))
    this.pendingCommands.clear()
  }
}

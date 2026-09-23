import type { WebglRuntimeRegistration } from '@/config/process/types'
import {
  createWebglCommand,
  WEBGL_PROTOCOL_CHANNEL,
  isWebglEventType,
  isWebglEnterProcessStepPayload,
  isWebglMessageEnvelope,
  isWebglObjectSelectedPayload,
  isWebglSelectionClearedPayload,
  isWebglReadyPayload,
  isWebglRequestAcknowledgementPayload,
  isWebglSceneChangedPayload,
  isWebglSceneLoadProgressPayload,
  isWebglFocusNodePayload,
  isWebglSetNodeVisibilityPayload,
  isWebglSetNodeVisualStatePayload,
  isWebglClearNodeVisualStatePayload,
  isWebglSetRouteFlowPayload,
  isWebglSwitchScenePayload,
  type WebglCommandType,
  type WebglEventType,
  type WebglMessageEnvelope,
  type WebglObjectSelectedPayload,
  type WebglReadyPayload,
  type WebglSelectionClearedPayload,
  type WebglSceneChangedPayload,
  type WebglSceneLoadProgressPayload,
} from '@/services/webgl/protocol'
import { windowMessageRouter } from '@/host-bridge/message-router'

/** 单个网页图形运行时的连接阶段；宿主会将其映射为页面可见状态。 */
export type WebglConnectorStatus = 'idle' | 'handshaking' | 'ready' | 'releasing' | 'disposed' | 'failed'

/** 受限日志只保留最近记录，便于排查被拒绝消息，同时避免异常页面持续发包造成内存增长。 */
export interface WebglMessageRejection {
  reason: string
  timestamp: number
}

/**
 * 已确认命令的受控完成摘要。
 * 该摘要只保留命令类型、原请求标识和成功状态；不会将 Unity 返回的对象、场景层级或原始消息交给宿主。
 */
export interface WebglCommandCompletion {
  command: WebglCommandType
  requestId: string
  success: boolean
  /** switchScene 成功时表示目标实例；失败时仅在 Unity 自动恢复旧场景后表示恢复出的新实例。 */
  sceneActivationId?: string
}

/** 连接器向唯一宿主报告的事件；业务组件不得订阅 window.message 或直接调用 postMessage。 */
export interface WebglRuntimeConnectorCallbacks {
  onStatusChange?: (status: WebglConnectorStatus, reason?: string) => void
  onReady?: (ready: WebglReadyPayload) => void
  onObjectSelected?: (payload: WebglObjectSelectedPayload, messageId: string) => void
  onSelectionCleared?: (payload: WebglSelectionClearedPayload, messageId: string) => void
  onSceneLoadProgress?: (payload: WebglSceneLoadProgressPayload, messageId: string) => void
  onSceneChanged?: (payload: WebglSceneChangedPayload, messageId: string) => void
  onCommandFailure?: (command: WebglCommandType, reason: string) => void
  /** 普通命令、场景切换最终结果和超时都会回调，宿主据此结算有限等待表。 */
  onCommandCompleted?: (completion: WebglCommandCompletion) => void
  onDisposed?: (requestId: string) => void
}

interface PendingCommand {
  envelope: WebglMessageEnvelope<WebglCommandType, unknown>
  retryCount: number
  timeoutHandle: ReturnType<typeof setTimeout>
  /** switchScene 已确认接收后等待最终 sceneChanged 的状态，进度会刷新该受限等待窗口。 */
  awaitingSceneResult?: boolean
  /** 同一事务进度不可倒退；仅保存一个数值，不缓存外部载荷或无界进度历史。 */
  lastSceneProgress?: number
}

const COMMAND_TIMEOUT_MS = 10_000
const SCENE_SWITCH_RESULT_TIMEOUT_MS = 30_000
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
  'clearSelection',
  'setNodeVisualState',
  // 同一快照序号的清除命令由 Unity 幂等处理；回执丢失时重发一次才能避免旧颜色长期残留。
  'clearNodeVisualState',
  'setRouteFlow',
  'setNodeVisibility',
  'dispose',
])

/** 由单实例宿主创建的安全消息连接器。它是整个前端唯一接触 window.message 的位置。 */
export class WebglRuntimeConnector {
  private readonly pendingCommands = new Map<string, PendingCommand>()
  private readonly rejections: WebglMessageRejection[] = []
  private unsubscribeMessageRouter: (() => void) | undefined
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

    this.unsubscribeMessageRouter = windowMessageRouter.subscribe(WEBGL_PROTOCOL_CHANNEL, (event) => this.receiveMessage(event))
  }

  /**
   * 绑定当前 iframe 的 contentWindow（内容窗口）。首次绑定才开始 15 秒握手时限；
   * iframe 从 about:blank（初始空白页）导航到 Unity 页面后，宿主会在 load（加载完成）事件中再次调用本方法。
   * 重新绑定只替换严格校验所使用的窗口代理，不延长既有握手期限，既避免初始空白页的代理与实际 Unity
   * 页面消息来源不一致，也避免异常页面借由反复导航无限延长连接等待时间。
   */
  public attachChildWindow(childWindow: WindowProxy | null): void {
    if (!childWindow || this.status === 'disposed' || this.status === 'failed') return

    const isInitialBinding = this.childWindow === null
    this.childWindow = childWindow

    if (isInitialBinding) {
      this.changeStatus('handshaking')
      this.clearHandshakeTimeout()
      this.handshakeTimeoutHandle = setTimeout(() => {
        this.fail('网页图形运行时握手超时。')
      }, HANDSHAKE_TIMEOUT_MS)
      return
    }

    // 后续 load 只用最新 contentWindow 更新严格来源校验目标；不重置既有握手时限，防止反复导航无限延长等待。
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
    this.unsubscribeMessageRouter?.()
    this.unsubscribeMessageRouter = undefined
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
      case 'sceneLoadProgress':
        this.handleSceneLoadProgress(envelope)
        return
      case 'sceneChanged':
        this.handleSceneChanged(envelope)
        return
      case 'objectSelected':
        this.handleObjectSelected(envelope)
        return
      case 'selectionCleared':
        this.handleSelectionCleared(envelope)
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
    /*
     * selectionCleared（选择清除）是新版本 Unity 的可选上行事件：旧的已发布网页图形仍能
     * 提供对象选中、场景切换和拓扑聚焦，但不会在三维空白点击时回传清除事件。握手不能因为
     * 这一项缺失而阻断整个三维运行时；真正收到该事件前仍由 negotiatedEventCapabilities（协商能力）
     * 门禁拦截，拓扑侧主动发送 clearSelection（清除选择）命令的能力不受影响。
     */
    const requiredEvents = this.runtime.eventCapabilities.filter((event) => event !== 'selectionCleared')
    const hasRegisteredEvents = requiredEvents.every((event) => ready.eventCapabilities.includes(event))

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

  /** ack 只会确认 init 或已登记的常规命令；switchScene 的 ack 仅确认接收，最终结果仍须等待 sceneChanged 或 commandResult。 */
  private handleAcknowledgement(
    envelope: WebglMessageEnvelope<WebglEventType, unknown>,
    eventType: 'ack' | 'commandResult',
  ): void {
    if (!isWebglRequestAcknowledgementPayload(envelope.payload)) {
      /*
       * `requestId` 已存在不代表整个确认负载合法：例如 Unity 旧通用模型会把可选
       * `sceneActivationId` 序列化为空字符串。该值一旦出现就必须是合法稳定标识，
       * 不能把字段级协议错误误报为“缺少原始请求标识”，否则会掩盖跨端模型不一致。
       */
      this.reject(`${eventType} 事件确认载荷无效。`)
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

    if (pending.envelope.type === 'switchScene' && eventType === 'ack') {
      if (envelope.payload.success === false) {
        this.completePendingCommand(pending.envelope.messageId)
        this.callbacks.onCommandFailure?.('switchScene', envelope.payload.message ?? '网页图形运行时拒绝场景切换请求。')
        this.callbacks.onCommandCompleted?.({ command: 'switchScene', requestId: pending.envelope.messageId, success: false })
        return
      }

      // 接收确认不等于场景可用：保留原 requestId，等待带同一事务的最终 sceneChanged。
      pending.awaitingSceneResult = true
      this.refreshSceneSwitchTimeout(pending)
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
      this.callbacks.onCommandCompleted?.({
        command: pending.envelope.type,
        requestId: pending.envelope.messageId,
        success: false,
        // 失败回执只有在 switchScene 已由 Unity 自动恢复旧场景时才允许携带实例标识；
        // 连接器已在协议层验证该值，宿主无需读取原始 commandResult 载荷。
        ...(pending.envelope.type === 'switchScene' && envelope.payload.sceneActivationId
          ? { sceneActivationId: envelope.payload.sceneActivationId }
          : {}),
      })
      return
    }

    if (pending.envelope.type === 'init') {
      this.clearHandshakeTimeout()
      this.changeStatus('ready')
      return
    }

    this.callbacks.onCommandCompleted?.({ command: pending.envelope.type, requestId: pending.envelope.messageId, success: true })
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

  /** 三维空白清除只影响二维选择，不进入命令发送链路，避免清除事件回发 Unity 形成循环。 */
  private handleSelectionCleared(envelope: WebglMessageEnvelope<WebglEventType, unknown>): void {
    if (this.status !== 'ready' || !this.negotiatedEventCapabilities.has('selectionCleared')) {
      this.reject('未就绪运行时不能触发选择清除联动。')
      return
    }

    if (!isWebglSelectionClearedPayload(envelope.payload)) {
      this.reject('选择清除事件的场景或物理实例标识无效。')
      return
    }

    this.callbacks.onSelectionCleared?.(envelope.payload, envelope.messageId)
  }

  /**
   * 进度事件只能匹配仍待完成的 switchScene 命令，且场景、事务与原始下行载荷必须严格一致。
   * 旧事务、伪造 requestId、越界/倒退进度均只记受限拒绝信息，绝不回调业务层。
   */
  private handleSceneLoadProgress(envelope: WebglMessageEnvelope<WebglEventType, unknown>): void {
    if (this.status !== 'ready' || !this.negotiatedEventCapabilities.has('sceneLoadProgress')) {
      this.reject('未就绪运行时不能上报场景加载进度。')
      return
    }
    if (!isWebglSceneLoadProgressPayload(envelope.payload)) {
      this.reject('场景加载进度载荷无效。')
      return
    }

    const pending = this.pendingCommands.get(envelope.payload.requestId)
    if (!pending || pending.envelope.type !== 'switchScene' || !pending.awaitingSceneResult) {
      this.reject('场景加载进度未命中已确认的切换请求。')
      return
    }
    if (!isWebglSwitchScenePayload(pending.envelope.payload) ||
      pending.envelope.payload.sceneId !== envelope.payload.sceneId ||
      pending.envelope.payload.transitionId !== envelope.payload.transitionId) {
      this.reject('场景加载进度的场景或事务标识与原请求不一致。')
      return
    }
    if (pending.lastSceneProgress !== undefined && envelope.payload.progress < pending.lastSceneProgress) {
      this.reject('场景加载进度不能在同一事务内倒退。')
      return
    }

    pending.lastSceneProgress = envelope.payload.progress
    this.refreshSceneSwitchTimeout(pending)
    this.callbacks.onSceneLoadProgress?.(envelope.payload, envelope.messageId)
  }

  /**
   * sceneChanged 是 switchScene 的唯一成功终态。它必须回填原 requestId 并与原场景、事务完全一致；
   * 验证成功后统一清理待确认项，避免旧完成事件在后续场景切换中被再次接收。
   */
  private handleSceneChanged(envelope: WebglMessageEnvelope<WebglEventType, unknown>): void {
    if (this.status !== 'ready' || !this.negotiatedEventCapabilities.has('sceneChanged')) {
      this.reject('未就绪运行时不能上报场景切换完成。')
      return
    }
    if (!isWebglSceneChangedPayload(envelope.payload)) {
      this.reject('场景切换完成载荷无效。')
      return
    }

    const pending = this.pendingCommands.get(envelope.payload.requestId)
    if (!pending || pending.envelope.type !== 'switchScene' || !pending.awaitingSceneResult) {
      this.reject('场景切换完成事件未命中已确认的切换请求。')
      return
    }
    if (!isWebglSwitchScenePayload(pending.envelope.payload) ||
      pending.envelope.payload.sceneId !== envelope.payload.sceneId ||
      pending.envelope.payload.transitionId !== envelope.payload.transitionId) {
      this.reject('场景切换完成事件的场景或事务标识与原请求不一致。')
      return
    }

    this.completePendingCommand(pending.envelope.messageId)
    this.callbacks.onSceneChanged?.(envelope.payload, envelope.messageId)
    // 物理场景激活标识只从已核验的最终 sceneChanged 透传给等待该 requestId 的编排端口；
    // 不能从下行 transitionId 推导，以免同场景拓扑事务或失败恢复错认成同一 Unity 实例。
    this.callbacks.onCommandCompleted?.({
      command: 'switchScene',
      requestId: pending.envelope.messageId,
      success: true,
      sceneActivationId: envelope.payload.sceneActivationId,
    })
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

    if (!isValidWebglCommandPayload(command, payload)) {
      this.callbacks.onCommandFailure?.(command, getWebglCommandPayloadError(command))
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
    const reason = pending.envelope.type === 'switchScene' && pending.awaitingSceneResult
      ? '网页图形场景切换完成事件超时。'
      : `网页图形命令 ${pending.envelope.type} 确认超时。`
    if (pending.envelope.type === 'init' || pending.envelope.type === 'dispose') {
      this.fail(reason)
      return
    }

    this.callbacks.onCommandFailure?.(pending.envelope.type, reason)
    this.callbacks.onCommandCompleted?.({ command: pending.envelope.type, requestId: pending.envelope.messageId, success: false })
  }

  /** 成功或失败后统一清理定时器与表项，避免同一 command 的后续消息再次影响状态。 */
  private completePendingCommand(messageId: string): void {
    const pending = this.pendingCommands.get(messageId)
    if (!pending) return

    clearTimeout(pending.timeoutHandle)
    this.pendingCommands.delete(messageId)
  }

  /**
   * switchScene 接收确认后需要等待异步加载完成。每次合法进度都会刷新 30 秒窗口，
   * 防止大场景加载过程被普通命令的十秒确认超时误判，同时不会无限等待失联运行时。
   */
  private refreshSceneSwitchTimeout(pending: PendingCommand): void {
    clearTimeout(pending.timeoutHandle)
    pending.timeoutHandle = setTimeout(() => this.handleCommandTimeout(pending.envelope.messageId), SCENE_SWITCH_RESULT_TIMEOUT_MS)
  }

  /** 失败是终态：清空本实例全部资源，旧窗口后续消息会因 source 或监听器缺失而失效。 */
  private fail(reason: string): void {
    this.clearHandshakeTimeout()
    this.clearPendingCommands()
    this.unsubscribeMessageRouter?.()
    this.unsubscribeMessageRouter = undefined
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

/**
 * 在创建待确认记录前校验场景动作载荷，避免无效稳定标识占用有限请求表。
 * init、resize、resetScene 和 dispose 的结构分别由握手、尺寸观察器或释放流程固定生成，
 * 此处只校验会被动作映射或交互层传入的场景相关命令。
 */
function isValidWebglCommandPayload(command: WebglCommandType, payload: unknown): boolean {
  switch (command) {
    case 'switchScene':
      return isWebglSwitchScenePayload(payload)
    case 'enterProcessStep':
      return isWebglEnterProcessStepPayload(payload)
    case 'focusNode':
      return isWebglFocusNodePayload(payload)
    case 'setNodeVisualState':
      return isWebglSetNodeVisualStatePayload(payload)
    case 'clearNodeVisualState':
      return isWebglClearNodeVisualStatePayload(payload)
    case 'setRouteFlow':
      return isWebglSetRouteFlowPayload(payload)
    case 'setNodeVisibility':
      return isWebglSetNodeVisibilityPayload(payload)
    default:
      return true
  }
}

/** 返回不泄露原始载荷的稳定错误说明，供外层协调器映射为结构化命令失败。 */
function getWebglCommandPayloadError(command: WebglCommandType): string {
  switch (command) {
    case 'switchScene':
      return '场景切换命令缺少合法场景标识、事务标识或映射版本。'
    case 'enterProcessStep':
      return '流程命令缺少合法流程、步骤、机组或隔离标识。'
    case 'focusNode':
      return '聚焦命令缺少合法三维节点标识、选择标识或隔离开关。'
    case 'setNodeVisualState':
      return '设备状态命令缺少合法三维节点标识或四态状态。'
    case 'clearNodeVisualState':
      return '设备状态清除命令缺少合法三维节点标识或本地快照序号。'
    case 'setRouteFlow':
      return '路径命令缺少合法路径标识或开关值。'
    case 'setNodeVisibility':
      return '显隐命令缺少合法三维节点标识或开关值。'
    default:
      return '网页图形命令载荷无效。'
  }
}

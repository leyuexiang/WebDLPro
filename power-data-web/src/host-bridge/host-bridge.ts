import { readDeploymentConfiguration, type DeploymentConfiguration } from '@/config/deployment/deployment-config'
import { toSessionId, validateStableIdentifier } from '@/config/scene-topology/identifiers'
import type { SessionId } from '@/config/scene-topology/identifiers'
import {
  HOST_PROTOCOL_VERSION,
  isHostEventMessage,
  validateHostCommandMessage,
  type HostCommandMessage,
  type HostEventMessage,
  type HostProtocolErrorCode,
} from '@/host-bridge/host-protocol'
import { windowMessageRouter, type WindowMessageRouter } from '@/host-bridge/message-router'

/** 通过地址参数和部署白名单共同确认的外层桥安全上下文。 */
export interface HostBridgeSecurityContext {
  parentOrigin: string
  instanceId: string
  sessionId: SessionId
}

/** 启动参数或部署配置不合法时只返回稳定错误，不回显查询参数。 */
export interface HostBridgeStartupIssue {
  code: 'protocol.envelope.invalid' | 'protocol.origin.rejected'
  message: string
}

export type HostBridgeStartupResult =
  | { status: 'ready'; context: HostBridgeSecurityContext; issues: readonly [] }
  | { status: 'invalid'; issues: readonly HostBridgeStartupIssue[] }

/** 接收拒绝记录限定为安全元数据，不保存完整外部消息。 */
export interface HostBridgeRejection {
  code: HostProtocolErrorCode
  timestamp: number
  messageId?: string
}

/** 桥接层只把通过安全边界的已验证领域命令交给后续协调器。 */
export interface HostBridgeCallbacks {
  onCommand?: (command: HostCommandMessage) => void
  onRejection?: (rejection: HostBridgeRejection) => void
}

/** 供测试注入的最小父窗口接口；生产使用 window.parent。 */
interface ParentMessageWindow {
  postMessage(message: unknown, targetOrigin: string): void
}

const MAXIMUM_REJECTIONS = 50

/**
 * 读取外层启动参数并建立新会话。
 * 查询参数只用于与部署配置做等值匹配，不能单独成为授权依据；每次调用均生成新的 sessionId。
 */
export function createHostBridgeStartup(
  search: string,
  configuration: DeploymentConfiguration,
  createSessionId: () => SessionId = createSessionIdentifier,
): HostBridgeStartupResult {
  const params = new URLSearchParams(search)
  const parentOrigin = params.get('parentOrigin')
  const instanceId = params.get('instanceId')
  const protocolVersion = params.get('protocolVersion')

  if (parentOrigin !== configuration.parentOrigin) {
    return { status: 'invalid', issues: [{ code: 'protocol.origin.rejected', message: '启动参数中的父页面来源未通过部署白名单校验。' }] }
  }
  if (!isOpaqueIdentifier(instanceId) || protocolVersion !== String(HOST_PROTOCOL_VERSION)) {
    return { status: 'invalid', issues: [{ code: 'protocol.envelope.invalid', message: '启动参数中的实例标识或协议版本无效。' }] }
  }

  return {
    status: 'ready',
    context: { parentOrigin: configuration.parentOrigin, instanceId, sessionId: createSessionId() },
    issues: [],
  }
}

/**
 * 外层桥只负责跨窗口安全边界：它不调用 Unity、画布或状态仓库。
 * 成功命令由回调交给任务-010及之后的受控生命周期与协调器，出站事件固定使用精确父来源。
 */
export class HostBridge {
  private readonly rejections: HostBridgeRejection[] = []
  private unsubscribeRouter: (() => void) | undefined

  public constructor(
    private readonly context: HostBridgeSecurityContext,
    private readonly parentWindow: ParentMessageWindow,
    private readonly router: WindowMessageRouter = windowMessageRouter,
    private readonly callbacks: HostBridgeCallbacks = {},
  ) {}

  /** 订阅外层固定通道；重复启动不会重复注册同一个路由订阅。 */
  public start(): void {
    if (this.unsubscribeRouter) return
    this.unsubscribeRouter = this.router.subscribe('power-scene-topology-shell', (event) => this.receive(event))
  }

  /** 完整释放路由订阅和有限诊断，子应用销毁后不再保留父窗口引用。 */
  public dispose(): void {
    this.unsubscribeRouter?.()
    this.unsubscribeRouter = undefined
    this.rejections.length = 0
  }

  /** 返回当前会话的只读安全上下文，调用方不可替换 parentOrigin 或 sessionId。 */
  public getContext(): HostBridgeSecurityContext {
    return this.context
  }

  /** 返回有限拒绝快照，避免外部恶意发包造成无界内存增长。 */
  public getRejections(): readonly HostBridgeRejection[] {
    return [...this.rejections]
  }

  /**
   * 发送前二次验证上行事件，并强制要求事件实例与会话属于当前桥。
   * 所有 postMessage（跨窗口消息）均使用部署确认过的精确 targetOrigin，永不使用通配符。
   */
  public send(event: HostEventMessage): boolean {
    if (!isHostEventMessage(event) || event.instanceId !== this.context.instanceId || event.sessionId !== this.context.sessionId) {
      this.reject('protocol.envelope.invalid', event.messageId)
      return false
    }

    this.parentWindow.postMessage(event, this.context.parentOrigin)
    return true
  }

  /**
   * 依协议安全顺序校验来源、父窗口、信封、实例和会话。
   * 任一失败都在进入业务回调前返回，且拒绝日志不保存 payload（载荷）。
   */
  private receive(event: MessageEvent<unknown>): void {
    if (event.origin !== this.context.parentOrigin) {
      this.reject('protocol.origin.rejected', readMessageId(event.data))
      return
    }
    if (event.source !== (this.parentWindow as unknown as MessageEventSource)) {
      this.reject('protocol.source.rejected', readMessageId(event.data))
      return
    }

    const result = validateHostCommandMessage(event.data)
    if (result.status === 'invalid') {
      this.reject(result.issues[0]?.code ?? 'protocol.envelope.invalid', readMessageId(event.data))
      return
    }
    if (result.message.instanceId !== this.context.instanceId || result.message.sessionId !== this.context.sessionId) {
      this.reject('protocol.envelope.invalid', result.message.messageId)
      return
    }

    this.callbacks.onCommand?.(result.message)
  }

  /** 记录固定容量的拒绝摘要并通知可选诊断回调；不会把外部载荷交给日志。 */
  private reject(code: HostProtocolErrorCode, messageId?: string): void {
    const rejection: HostBridgeRejection = {
      code,
      timestamp: Date.now(),
      ...(messageId ? { messageId: messageId.slice(0, 128) } : {}),
    }
    this.rejections.push(rejection)
    if (this.rejections.length > MAXIMUM_REJECTIONS) this.rejections.shift()
    this.callbacks.onRejection?.(rejection)
  }
}

/** 读取当前构建环境，配置无效时不创建桥；嵌入壳已负责把配置失败显示为脱敏状态。 */
export function createConfiguredHostBridge(search: string, parentWindow: ParentMessageWindow = window.parent): HostBridgeStartupResult | HostBridge {
  const configurationResult = readDeploymentConfiguration()
  if (configurationResult.status === 'invalid' || !configurationResult.configuration) {
    return { status: 'invalid', issues: [{ code: 'protocol.origin.rejected', message: '部署配置无效，无法建立外层通信桥。' }] }
  }

  const startup = createHostBridgeStartup(search, configurationResult.configuration)
  return startup.status === 'ready' ? new HostBridge(startup.context, parentWindow) : startup
}

/** 会话标识包含时间和随机片段，且在返回前经稳定标识工厂校验。 */
function createSessionIdentifier(): SessionId {
  const randomPart = globalThis.crypto?.randomUUID?.().toLowerCase() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return toSessionId(`session-${randomPart}`)
}

/** 启动参数与外层信封使用相同的稳定标识格式和长度限制。 */
function isOpaqueIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && validateStableIdentifier(value).length === 0
}

/** 只从普通对象读取并截断 messageId，拒绝日志不会解析或保留完整未知载荷。 */
function readMessageId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const messageId = (value as Record<string, unknown>).messageId
  return isOpaqueIdentifier(messageId) ? messageId : undefined
}

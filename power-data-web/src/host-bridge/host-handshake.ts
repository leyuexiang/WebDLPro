import { OVERVIEW_SCENE_ID, SCENE_IDS } from '@/config/scene-topology/identifiers'
import type { HostBridge } from '@/host-bridge/host-bridge'
import {
  HOST_COMMAND_TYPES,
  HOST_EVENT_TYPES,
  type HostCommandMessage,
  type HostCommandType,
  type HostEventType,
  type HostProtocolError,
  type HostVisualizationContext,
} from '@/host-bridge/host-protocol'

/** 初始化握手最多等待 15 秒；超时只进入可见等待态，仍允许后续首次合法初始化。 */
export const HOST_INITIALIZATION_TIMEOUT_MS = 15_000

/** 握手状态只描述外层协议，不混入 Unity、画布或场景切换内部状态。 */
export type HostHandshakeStatus = 'idle' | 'awaiting-init' | 'initializing' | 'initialized' | 'timed-out' | 'disposed'

/** 就绪事件所需的已发布清单元数据，由后续清单加载器在校验成功后提供。 */
export interface HostHandshakeMetadata {
  manifestVersion: string
  commandCapabilities: readonly HostCommandType[]
  eventCapabilities: readonly HostEventType[]
}

/** 初始化回调的成功或失败结果；失败理由必须是受控协议错误。 */
export type HostInitializationResult =
  | { success: true; context: HostVisualizationContext }
  | { success: false; error: HostProtocolError }

/** 回调让握手层保持无业务副作用，场景与拓扑事务将由后续唯一协调器执行。 */
export interface HostHandshakeCallbacks {
  onInitialize: (command: Extract<HostCommandMessage, { type: 'system.init' }>) => Promise<HostInitializationResult>
  /**
   * 初始化失败必须同时通知组合根发送关联的 `system.error`（系统错误）。
   * 握手层不直接负责错误事件序列号或脱敏投影，避免生成第二条绕过统一出站门禁的发送路径。
   */
  onInitializationFailure?: (replyTo: string, error: HostProtocolError) => void
  onStatusChange?: (status: HostHandshakeStatus) => void
}

/** 可注入的计时器接口，保证单元测试可验证超时与释放而不等待真实时间。 */
interface HandshakeTimer {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

/**
 * 外层握手状态机实现 `system.ready → system.init → system.ack`。
 * 它只处理一次初始化协议与超时，不直接操作 Unity 或拓扑；未初始化前业务命令由调用方据此拒绝。
 */
export class HostHandshake {
  private status: HostHandshakeStatus = 'idle'
  private initializationTimer: ReturnType<typeof setTimeout> | undefined
  private messageSequence = 0

  public constructor(
    private readonly bridge: HostBridge,
    private readonly metadata: HostHandshakeMetadata,
    private readonly callbacks: HostHandshakeCallbacks,
    private readonly timer: HandshakeTimer = globalThis,
  ) {}

  /** 发送 ready 并开始 15 秒等待；重复调用不会重复发送或叠加计时器。 */
  public start(): void {
    if (this.status !== 'idle') return
    this.transitionTo('awaiting-init')
    this.bridge.send(this.createEvent('system.ready', {
      manifestVersion: this.metadata.manifestVersion,
      sceneIds: SCENE_IDS,
      overviewSceneId: OVERVIEW_SCENE_ID,
      commandCapabilities: this.metadata.commandCapabilities,
      eventCapabilities: this.metadata.eventCapabilities,
    }))
    this.initializationTimer = this.timer.setTimeout(() => {
      this.initializationTimer = undefined
      if (this.status === 'awaiting-init') this.transitionTo('timed-out')
    }, HOST_INITIALIZATION_TIMEOUT_MS)
  }

  /** 返回当前状态，后续命令分派器用它阻止未初始化业务命令进入协调器。 */
  public getStatus(): HostHandshakeStatus {
    return this.status
  }

  /** 只有完成初始化确认后才允许业务命令；释放和再次 init 的具体幂等规则由命令生命周期管理器处理。 */
  public isInitialized(): boolean {
    return this.status === 'initialized'
  }

  /**
   * 接收已通过 HostBridge 安全边界的命令。
   * 未初始化时只接受 system.init；父页面延迟超过 15 秒后仍可完成首次合法初始化。
   */
  public async handle(command: HostCommandMessage): Promise<boolean> {
    if (this.status === 'disposed') return false
    if (command.type !== 'system.init') return this.isInitialized()
    if (this.status === 'initializing') return false

    if (command.payload.expectedManifestVersion && command.payload.expectedManifestVersion !== this.metadata.manifestVersion) {
      this.reportInitializationFailure(command.messageId, {
        success: false,
        error: createHandshakeError('manifest.version.mismatch', '父页面期望的清单版本与当前已发布版本不一致。', true),
      })
      return false
    }

    this.clearInitializationTimer()
    this.transitionTo('initializing')
    try {
      const result = await this.callbacks.onInitialize(command)
      // 组件可能在初始化事务等待 Unity 或拓扑期间被卸载；释放后迟到结果只能清理自身，不能复活握手或发 ack。
      if (this.isDisposed()) return false
      if (result.success) this.sendInitializationAcknowledgement(command.messageId, result)
      else this.reportInitializationFailure(command.messageId, result)
      this.transitionTo(result.success ? 'initialized' : 'awaiting-init')
      if (!result.success) this.restartInitializationTimer()
      return result.success
    } catch {
      if (this.isDisposed()) return false
      this.reportInitializationFailure(command.messageId, {
        success: false,
        error: createHandshakeError('topology.prepare.failed', '初始化准备失败，当前视图未提交。', true),
      })
      this.transitionTo('awaiting-init')
      this.restartInitializationTimer()
      return false
    }
  }

  /** 清除计时器并进入释放态；应用销毁后不会再发送确认或接受初始化。 */
  public dispose(): void {
    if (this.status === 'disposed') return
    this.clearInitializationTimer()
    this.transitionTo('disposed')
  }

  /** 成功和失败确认都使用原 system.init 的 messageId 作为 replyTo。 */
  private sendInitializationAcknowledgement(replyTo: string, result: HostInitializationResult): void {
    this.bridge.send(this.createEvent('system.ack', result.success
      ? { success: true, context: result.context, error: null }
      : { success: false, error: result.error }, replyTo))
  }

  /**
   * 初始化失败的确认与系统错误必须共用原 `system.init` 消息标识。
   * 先发 `system.ack` 让父页面确认初始化未提交，再委托组合根发送经过统一脱敏的 `system.error`；
   * 这样错误不会携带原始异常或任意运行时对象，也不会落入普通 `command.result`（命令结果）路径。
   */
  private reportInitializationFailure(
    replyTo: string,
    result: Extract<HostInitializationResult, { success: false }>,
  ): void {
    this.sendInitializationAcknowledgement(replyTo, result)
    this.callbacks.onInitializationFailure?.(replyTo, result.error)
  }

  /** 统一生成当前实例、会话和递增消息标识，调用者无法覆盖安全上下文。 */
  private createEvent<TType extends HostEventType>(type: TType, payload: ExtractEventPayload<TType>, replyTo?: string): Extract<import('@/host-bridge/host-protocol').HostEventMessage, { type: TType }> {
    this.messageSequence += 1
    const context = this.bridge.getContext()
    return {
      channel: 'power-scene-topology-shell',
      version: 1,
      instanceId: context.instanceId,
      sessionId: context.sessionId,
      messageId: `shell-${type.replaceAll('.', '-')}-${this.messageSequence}`,
      ...(replyTo ? { replyTo } : {}),
      type,
      timestamp: Date.now(),
      payload,
    } as Extract<import('@/host-bridge/host-protocol').HostEventMessage, { type: TType }>
  }

  /** 启动失败或初始化失败后重新进入一个受上限的 15 秒等待周期。 */
  private restartInitializationTimer(): void {
    this.clearInitializationTimer()
    this.initializationTimer = this.timer.setTimeout(() => {
      this.initializationTimer = undefined
      if (this.status === 'awaiting-init') this.transitionTo('timed-out')
    }, HOST_INITIALIZATION_TIMEOUT_MS)
  }

  /** 计时器只在一个握手生命周期内存在，释放和初始化成功都会主动取消。 */
  private clearInitializationTimer(): void {
    if (this.initializationTimer === undefined) return
    this.timer.clearTimeout(this.initializationTimer)
    this.initializationTimer = undefined
  }

  /** 状态改变才通知外部，避免重复 start 或重复 dispose 造成无意义的渲染更新。 */
  private transitionTo(nextStatus: HostHandshakeStatus): void {
    if (this.status === nextStatus) return
    this.status = nextStatus
    this.callbacks.onStatusChange?.(nextStatus)
  }

  /** 异步边界后重新读取完整状态联合，避免编译器沿用 await 前已经失效的控制流收窄结果。 */
  private isDisposed(): boolean {
    return this.status === 'disposed'
  }
}

/** 按事件类型取得对应 payload，保持 createEvent 的调用点与协议载荷严格绑定。 */
type ExtractEventPayload<TType extends HostEventType> = Extract<import('@/host-bridge/host-protocol').HostEventMessage, { type: TType }>['payload']

/** 就绪能力默认引用协议白名单；实际运行时可在清单加载后收窄该集合。 */
export const DEFAULT_HOST_HANDSHAKE_METADATA: HostHandshakeMetadata = Object.freeze({
  manifestVersion: 'unpublished',
  commandCapabilities: HOST_COMMAND_TYPES,
  eventCapabilities: HOST_EVENT_TYPES,
})

/** 构造不泄露内部异常的握手错误对象。 */
function createHandshakeError(code: HostProtocolError['code'], message: string, recoverable: boolean): HostProtocolError {
  return { code, message, stage: 'handshake', recoverable }
}

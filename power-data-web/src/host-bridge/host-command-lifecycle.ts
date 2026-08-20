import type { TransitionId } from '@/config/scene-topology/identifiers'
import { HOST_PROTOCOL_LIMITS, type CommandResultPayload, type HostCommandMessage, type HostProtocolError, type HostProtocolErrorCode } from '@/host-bridge/host-protocol'

/** 普通外层命令最多等待 10 秒，避免查询、状态更新或释放请求长期占用有限待确认表。 */
export const HOST_COMMAND_TIMEOUT_MS = 10_000

/**
 * 打开视图和触发流程可能包含大场景卸载、未使用资源回收及下一场景解码。
 * 这里给完整原子事务 120 秒绝对上限；内层仍以进度事件刷新自己的 30 秒阶段窗口，
 * 因此失联会先由内层失败，正常的大模型切换则不会被普通命令的 10 秒上限误杀。
 */
export const HOST_SCENE_TRANSACTION_TIMEOUT_MS = 120_000

/** 执行器只能返回受控结果，不能把任意异常对象或外部消息直接写回父页面。 */
export type HostCommandExecutionResult =
  | { success: true; status: 'completed' | 'disposed'; transitionId?: TransitionId; contextRevision?: number }
  | { success: false; status: 'failed' | 'superseded'; transitionId?: TransitionId; contextRevision?: number; error: HostProtocolError }

/** 生命周期结果始终带 replyTo，事件发送器据此构造 command.result（命令结果）信封。 */
export interface HostCommandLifecycleResult {
  replyTo: string
  payload: CommandResultPayload
  source: 'executed' | 'capacity' | 'timeout' | 'disposed'
}

/**
 * 生命周期显式区分“需要发送结果”和“重复消息静默忽略”。
 * 使用判别联合而非空载荷，可让组合根在编译期无法把重复消息误传给 command.result 发送器。
 */
export type HostCommandLifecycleOutcome =
  | { status: 'result'; result: HostCommandLifecycleResult }
  | { status: 'ignored-duplicate' }

/** 重复消息共用冻结结果，避免恶意重放为每次拒绝额外分配对象。 */
const IGNORED_DUPLICATE_OUTCOME = Object.freeze({ status: 'ignored-duplicate' as const })

/** 外层桥登记当前会话消息标识后的三种常数时间结果。 */
export type HostMessageReceiptResult = 'accepted' | 'duplicate-first' | 'duplicate-repeat'

/**
 * 外层桥使用的会话级有限消息登记器。
 * 每个标识在通过基础信封与会话校验后立即登记，因此包括 system.init 和载荷非法消息在内的重放
 * 都会在进入类型、载荷和业务处理前被拦截；两个 Set 仅保存标识，绝不保留外部载荷或业务结果。
 */
export class HostMessageReceiptRegistry {
  private readonly recentMessageIds = new Set<string>()
  private readonly duplicateReportedMessageIds = new Set<string>()

  public constructor(private readonly maximumRecentMessageIds: number = HOST_PROTOCOL_LIMITS.recentMessageIds) {}

  /** 首次标识进入有限窗口；同一标识只允许记录一次重复诊断，后续重放完全静默。 */
  public register(messageId: string): HostMessageReceiptResult {
    if (this.recentMessageIds.has(messageId)) {
      if (this.duplicateReportedMessageIds.has(messageId)) return 'duplicate-repeat'
      this.duplicateReportedMessageIds.add(messageId)
      return 'duplicate-first'
    }

    if (this.maximumRecentMessageIds <= 0) return 'accepted'
    this.recentMessageIds.add(messageId)
    if (this.recentMessageIds.size > this.maximumRecentMessageIds) {
      const oldestMessageId = this.recentMessageIds.values().next().value
      if (oldestMessageId) {
        this.recentMessageIds.delete(oldestMessageId)
        this.duplicateReportedMessageIds.delete(oldestMessageId)
      }
    }
    return 'accepted'
  }

  /** 释放会话时清空全部标识，旧会话不能污染重新加载后生成的新 sessionId。 */
  public dispose(): void {
    this.recentMessageIds.clear()
    this.duplicateReportedMessageIds.clear()
  }

  /** 只返回标识快照，便于容量测试，不暴露内部可变集合。 */
  public getRecentMessageIds(): readonly string[] {
    return [...this.recentMessageIds]
  }
}

/** 执行器由后续命令分派器提供；生命周期管理器不依赖 Unity、画布或状态仓库。 */
export type HostCommandExecutor = (command: HostCommandMessage) => Promise<HostCommandExecutionResult>

/**
 * 外层超时通知只传递已经过来源与协议校验的命令对象。
 * 回调必须同步撤销领域事务的提交权；耗时的物理回退由领域端口自行异步收尾，不能阻塞
 * `command.timeout`（命令超时）回包，也不能让生命周期管理器持有 Unity 或画布资源。
 */
export type HostCommandTimeoutObserver = (command: HostCommandMessage) => void

/** 计时器可注入，保证超时和释放在单元测试中可精确验证。 */
interface LifecycleTimer {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

interface PendingCommand {
  timeoutHandle: ReturnType<typeof setTimeout>
  settled: boolean
  resolve: (outcome: HostCommandLifecycleOutcome) => void
}

/**
 * 外层命令生命周期管理器。
 * 它将待执行表限制为 64 条、已完成去重缓存限制为 256 条，并在释放时取消全部计时器；
 * 因此重复消息、超时回调和父页面卸载都不会使业务命令无界累积。
 */
export class HostCommandLifecycle {
  private readonly pendingByMessageId = new Map<string, PendingCommand>()
  /** 最近消息只保存标识，不再保留或回放已经发送过的业务结果。 */
  private readonly recentMessageIds = new Set<string>()
  /** 设备状态使用独立单槽位；普通查询、视图和释放命令仍遵循全局64条容量。 */
  private pendingDeviceStatesUpdateMessageId: string | undefined
  private disposed = false

  public constructor(
    private readonly executor: HostCommandExecutor,
    private readonly timer: LifecycleTimer = globalThis,
    private readonly timeoutMs: number = HOST_COMMAND_TIMEOUT_MS,
    private readonly maximumPending: number = HOST_PROTOCOL_LIMITS.pendingCommands,
    private readonly maximumRecentResults: number = HOST_PROTOCOL_LIMITS.recentMessageIds,
    private readonly onTimeout?: HostCommandTimeoutObserver,
    private readonly sceneTransactionTimeoutMs: number = HOST_SCENE_TRANSACTION_TIMEOUT_MS,
  ) {}

  /**
   * 执行一条已通过桥接安全校验的命令。
   * 重复消息无论仍在执行还是已经完成，都只返回 ignored-duplicate，调用方必须静默结束；
   * 不同消息标识的第二条设备状态命令触发单槽位容量失败，不能与第一条并行修改完整快照。
   */
  public execute(command: HostCommandMessage): Promise<HostCommandLifecycleOutcome> {
    if (this.disposed) return Promise.resolve(this.result(this.createFailure(command.messageId, 'disposed', 'runtime.disposed', '子应用已释放，不能继续执行外层命令。')))

    // 两次常数时间查询覆盖执行中与已完成消息；重复消息不生成错误结果，也不刷新近期缓存顺序。
    if (this.recentMessageIds.has(command.messageId) || this.pendingByMessageId.has(command.messageId)) {
      return Promise.resolve(IGNORED_DUPLICATE_OUTCOME)
    }
    if (command.type === 'device.states.update' && this.pendingDeviceStatesUpdateMessageId !== undefined) {
      const failure = this.createFailure(command.messageId, 'capacity', 'protocol.capacity.exceeded', '当前会话已有一条设备状态命令等待完成。')
      this.rememberMessageId(command.messageId)
      return Promise.resolve(this.result(failure))
    }
    if (this.pendingByMessageId.size >= this.maximumPending) {
      const failure = this.createFailure(command.messageId, 'capacity', 'protocol.capacity.exceeded', '外层待确认命令已达到协议上限。')
      this.rememberMessageId(command.messageId)
      return Promise.resolve(this.result(failure))
    }

    return new Promise((resolve) => {
      const pending: PendingCommand = {
        settled: false,
        resolve,
        timeoutHandle: this.timer.setTimeout(() => {
          if (pending.settled) return
          pending.settled = true
          this.clearPendingCommand(command.messageId)
          // 先撤销领域提交权，再向父页面回传超时。即使三维最终回调晚到，也不能继续提交旧场景或旧拓扑。
          // 观察器属于可选领域扩展；它自身的实现错误绝不能阻断已定义的超时回包和待确认表清理。
          try {
            this.onTimeout?.(command)
          } catch {
            // 生命周期不读取或外泄观察器异常，继续返回协议规定的 command.timeout。
          }
          const timeoutResult = this.createFailure(command.messageId, 'timeout', 'command.timeout', '外层命令等待执行结果超时。')
          this.rememberMessageId(command.messageId)
          resolve(this.result(timeoutResult))
        }, this.resolveTimeoutMs(command)),
      }
      this.pendingByMessageId.set(command.messageId, pending)
      if (command.type === 'device.states.update') this.pendingDeviceStatesUpdateMessageId = command.messageId

      // 先进入已兑现 Promise 再调用执行器，可把测试替身或未来端口的同步抛错统一收敛到下方 catch；
      // 否则同步异常会跳出构造回调并遗留计时器、待确认项和设备状态槽位。
      void Promise.resolve()
        .then(() => this.executor(command))
        .then((executionResult) => {
          if (pending.settled) return
          pending.settled = true
          this.timer.clearTimeout(pending.timeoutHandle)
          this.clearPendingCommand(command.messageId)
          const result = this.createExecutionResult(command.messageId, executionResult)
          this.rememberMessageId(command.messageId)
          resolve(this.result(result))
        })
        .catch(() => {
          if (pending.settled) return
          pending.settled = true
          this.timer.clearTimeout(pending.timeoutHandle)
          this.clearPendingCommand(command.messageId)
          const failureResult = this.createFailure(command.messageId, 'executed', 'action.execute.failed', '外层命令执行失败，当前稳定上下文未被覆盖。')
          this.rememberMessageId(command.messageId)
          resolve(this.result(failureResult))
        })
    })
  }

  /**
   * 只有可能跨场景的两类原子事务使用长上限；其余命令继续沿用构造时注入的普通上限。
   * 使用常数时间的类型判断，不读取清单或当前场景，避免生命周期层反向依赖领域状态。
   */
  private resolveTimeoutMs(command: HostCommandMessage): number {
    return command.type === 'view.open' || command.type === 'workflow.trigger'
      ? this.sceneTransactionTimeoutMs
      : this.timeoutMs
  }

  /** 返回当前待确认数量，便于桥接诊断；不暴露内部命令对象或父页面 payload。 */
  public getPendingCount(): number {
    return this.pendingByMessageId.size
  }

  /** 返回最近已处理消息标识的有限快照，不暴露或保留已发送业务结果。 */
  public getRecentMessageIds(): readonly string[] {
    return [...this.recentMessageIds]
  }

  /** 仅暴露设备状态单槽位是否占用，便于无载荷诊断和精确单元测试。 */
  public hasPendingDeviceStatesUpdate(): boolean {
    return this.pendingDeviceStatesUpdateMessageId !== undefined
  }

  /** 释放时取消全部超时器并清理去重缓存；迟到 Promise 完成会被 settled 标记忽略。 */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.pendingByMessageId.forEach((pending, messageId) => {
      pending.settled = true
      this.timer.clearTimeout(pending.timeoutHandle)
      pending.resolve(this.result(this.createFailure(messageId, 'disposed', 'runtime.disposed', '子应用已释放，不能继续执行外层命令。')))
    })
    this.pendingByMessageId.clear()
    this.pendingDeviceStatesUpdateMessageId = undefined
    this.recentMessageIds.clear()
  }

  /** 将执行器输出转换为协议 command.result（命令结果）载荷，并保留 replyTo 关联。 */
  private createExecutionResult(replyTo: string, executionResult: HostCommandExecutionResult): HostCommandLifecycleResult {
    return executionResult.success
      ? {
          replyTo,
          source: 'executed',
          payload: {
            success: true,
            status: executionResult.status,
            ...(executionResult.transitionId ? { transitionId: executionResult.transitionId } : {}),
            ...(executionResult.contextRevision !== undefined ? { contextRevision: executionResult.contextRevision } : {}),
            error: null,
          },
        }
      : {
          replyTo,
          source: 'executed',
          payload: {
            success: false,
            status: executionResult.status,
            ...(executionResult.transitionId ? { transitionId: executionResult.transitionId } : {}),
            ...(executionResult.contextRevision !== undefined ? { contextRevision: executionResult.contextRevision } : {}),
            error: executionResult.error,
          },
        }
  }

  /** 创建不泄露内部异常的协议失败结果。 */
  private createFailure(
    replyTo: string,
    source: HostCommandLifecycleResult['source'],
    code: HostProtocolErrorCode,
    message: string,
  ): HostCommandLifecycleResult {
    return {
      replyTo,
      source,
      payload: {
        success: false,
        // 已释放后拒绝的新业务命令属于失败；真正的 system.dispose 成功由执行器返回 success + disposed。
        status: 'failed',
        error: { code, message, stage: source === 'timeout' ? 'executing-action' : 'validation', recoverable: source !== 'disposed' },
      },
    }
  }

  /** 将可发送结果包装为判别联合的成功分支，组合根只能从此分支取得业务载荷。 */
  private result(result: HostCommandLifecycleResult): HostCommandLifecycleOutcome {
    return { status: 'result', result }
  }

  /** 同时清理全局待确认表和设备状态单槽位，超时、成功与异常路径共用同一逻辑。 */
  private clearPendingCommand(messageId: string): void {
    this.pendingByMessageId.delete(messageId)
    if (this.pendingDeviceStatesUpdateMessageId === messageId) this.pendingDeviceStatesUpdateMessageId = undefined
  }

  /** 写入固定大小的近期消息标识集合；Set 的插入顺序天然表示完成顺序。 */
  private rememberMessageId(messageId: string): void {
    if (this.maximumRecentResults <= 0) return
    this.recentMessageIds.add(messageId)
    if (this.recentMessageIds.size > this.maximumRecentResults) {
      const oldestMessageId = this.recentMessageIds.values().next().value
      if (oldestMessageId) this.recentMessageIds.delete(oldestMessageId)
    }
  }
}

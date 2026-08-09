import type { TransitionId } from '@/config/scene-topology/identifiers'
import { HOST_PROTOCOL_LIMITS, type CommandResultPayload, type HostCommandMessage, type HostProtocolError, type HostProtocolErrorCode } from '@/host-bridge/host-protocol'

/** 外层命令默认仅等待 10 秒；场景协调器可另行声明内部阶段超时，但不能突破此总上限。 */
export const HOST_COMMAND_TIMEOUT_MS = 10_000

/** 执行器只能返回受控结果，不能把任意异常对象或外部消息直接写回父页面。 */
export type HostCommandExecutionResult =
  | { success: true; status: 'completed' | 'disposed'; transitionId?: TransitionId; contextRevision?: number }
  | { success: false; status: 'failed' | 'superseded'; transitionId?: TransitionId; contextRevision?: number; error: HostProtocolError }

/** 生命周期结果始终带 replyTo，事件发送器据此构造 command.result（命令结果）信封。 */
export interface HostCommandLifecycleResult {
  replyTo: string
  payload: CommandResultPayload
  source: 'executed' | 'cached' | 'duplicate' | 'capacity' | 'timeout' | 'disposed'
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
  resolve: (result: HostCommandLifecycleResult) => void
}

/**
 * 外层命令生命周期管理器。
 * 它将待执行表限制为 64 条、已完成去重缓存限制为 256 条，并在释放时取消全部计时器；
 * 因此重复消息、超时回调和父页面卸载都不会使业务命令无界累积。
 */
export class HostCommandLifecycle {
  private readonly pendingByMessageId = new Map<string, PendingCommand>()
  private readonly recentResultsByMessageId = new Map<string, HostCommandLifecycleResult>()
  private disposed = false

  public constructor(
    private readonly executor: HostCommandExecutor,
    private readonly timer: LifecycleTimer = globalThis,
    private readonly timeoutMs: number = HOST_COMMAND_TIMEOUT_MS,
    private readonly maximumPending: number = HOST_PROTOCOL_LIMITS.pendingCommands,
    private readonly maximumRecentResults: number = HOST_PROTOCOL_LIMITS.recentMessageIds,
    private readonly onTimeout?: HostCommandTimeoutObserver,
  ) {}

  /**
   * 执行一条已通过桥接安全校验的命令。
   * 重复已完成消息返回首个结果；重复进行中消息不重复执行；容量不足和释放状态均返回结构化失败。
   */
  public execute(command: HostCommandMessage): Promise<HostCommandLifecycleResult> {
    if (this.disposed) return Promise.resolve(this.createFailure(command.messageId, 'disposed', 'runtime.disposed', '子应用已释放，不能继续执行外层命令。'))

    const cachedResult = this.recentResultsByMessageId.get(command.messageId)
    if (cachedResult) return Promise.resolve({ ...cachedResult, source: 'cached' })
    if (this.pendingByMessageId.has(command.messageId)) {
      return Promise.resolve(this.createFailure(command.messageId, 'duplicate', 'protocol.message.duplicate', '当前会话已存在相同消息标识的命令。'))
    }
    if (this.pendingByMessageId.size >= this.maximumPending) {
      return Promise.resolve(this.createFailure(command.messageId, 'capacity', 'protocol.capacity.exceeded', '外层待确认命令已达到协议上限。'))
    }

    return new Promise((resolve) => {
      const pending: PendingCommand = {
        settled: false,
        resolve,
        timeoutHandle: this.timer.setTimeout(() => {
          if (pending.settled) return
          pending.settled = true
          this.pendingByMessageId.delete(command.messageId)
          // 先撤销领域提交权，再向父页面回传超时。即使三维最终回调晚到，也不能继续提交旧场景或旧拓扑。
          // 观察器属于可选领域扩展；它自身的实现错误绝不能阻断已定义的超时回包和待确认表清理。
          try {
            this.onTimeout?.(command)
          } catch {
            // 生命周期不读取或外泄观察器异常，继续返回协议规定的 command.timeout。
          }
          const timeoutResult = this.createFailure(command.messageId, 'timeout', 'command.timeout', '外层命令等待执行结果超时。')
          this.cacheResult(timeoutResult)
          resolve(timeoutResult)
        }, this.timeoutMs),
      }
      this.pendingByMessageId.set(command.messageId, pending)

      void this.executor(command)
        .then((executionResult) => {
          if (pending.settled) return
          pending.settled = true
          this.timer.clearTimeout(pending.timeoutHandle)
          this.pendingByMessageId.delete(command.messageId)
          const result = this.createExecutionResult(command.messageId, executionResult)
          this.cacheResult(result)
          resolve(result)
        })
        .catch(() => {
          if (pending.settled) return
          pending.settled = true
          this.timer.clearTimeout(pending.timeoutHandle)
          this.pendingByMessageId.delete(command.messageId)
          const failureResult = this.createFailure(command.messageId, 'executed', 'action.execute.failed', '外层命令执行失败，当前稳定上下文未被覆盖。')
          this.cacheResult(failureResult)
          resolve(failureResult)
        })
    })
  }

  /** 返回当前待确认数量，便于桥接诊断；不暴露内部命令对象或父页面 payload。 */
  public getPendingCount(): number {
    return this.pendingByMessageId.size
  }

  /** 返回最近完成结果的有限快照，调用方不能改变去重缓存。 */
  public getRecentResults(): readonly HostCommandLifecycleResult[] {
    return [...this.recentResultsByMessageId.values()]
  }

  /** 释放时取消全部超时器并清理去重缓存；迟到 Promise 完成会被 settled 标记忽略。 */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.pendingByMessageId.forEach((pending, messageId) => {
      pending.settled = true
      this.timer.clearTimeout(pending.timeoutHandle)
      pending.resolve(this.createFailure(messageId, 'disposed', 'runtime.disposed', '子应用已释放，不能继续执行外层命令。'))
    })
    this.pendingByMessageId.clear()
    this.recentResultsByMessageId.clear()
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

  /** 写入固定大小的近期结果缓存；Map 的插入顺序天然表示最近完成顺序。 */
  private cacheResult(result: HostCommandLifecycleResult): void {
    this.recentResultsByMessageId.set(result.replyTo, result)
    if (this.recentResultsByMessageId.size > this.maximumRecentResults) {
      const oldestMessageId = this.recentResultsByMessageId.keys().next().value
      if (oldestMessageId) this.recentResultsByMessageId.delete(oldestMessageId)
    }
  }
}

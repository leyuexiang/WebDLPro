import type { VisualizationRuntimeLifecycle } from '@/modules/visual/runtime/visualization-runtime-host'

/**
 * 平台可在收到 system.ready（系统就绪）后立即发送 system.init（系统初始化）。
 * Unity 三维运行时及首个稳定视图仍允许最多等待两分钟；该期限与清单读取、外层就绪、
 * 父页面发送初始化命令的等待期限相互独立，不能复用同一个计时器后形成隐式延长。
 */
export const HOST_RUNTIME_PREPARATION_TIMEOUT_MS = 120_000

/** 可注入计时器只用于确定性单元测试；生产默认使用浏览器全局计时器。 */
interface RuntimeReadinessTimer {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

/**
 * Unity 就绪屏障只保存一个共享等待槽位，不保存 system.init 原始载荷，也不形成命令队列。
 * 多个内部调用复用同一 Promise（异步结果）；外层握手状态机仍负责只允许一条初始化命令在途。
 */
export class HostRuntimeReadinessGate {
  private lifecycle: VisualizationRuntimeLifecycle = 'idle'
  private pendingPromise: Promise<boolean> | undefined
  private resolvePending: ((ready: boolean) => void) | undefined
  private timeoutHandle: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  public constructor(
    private readonly timeoutMilliseconds = HOST_RUNTIME_PREPARATION_TIMEOUT_MS,
    private readonly timer: RuntimeReadinessTimer = globalThis,
  ) {}

  /**
   * 宿主状态由唯一 VisualizationRuntimeHost（可视化运行时宿主）上报。
   * ready（就绪）结算成功；failed/disposed（失败/释放）立即结算失败；中间状态只更新快照。
   */
  public report(lifecycle: VisualizationRuntimeLifecycle): void {
    if (this.disposed) return
    this.lifecycle = lifecycle
    if (lifecycle === 'ready') this.settle(true)
    else if (lifecycle === 'failed' || lifecycle === 'disposed') this.settle(false)
  }

  /**
   * 初始化命令到达后才开始120秒计时，避免平台尚未发送 system.init 时提前消耗 Unity 初始化期限。
   * 超时只结算当前等待；若运行时随后真实就绪，新的合法初始化重试仍可立即通过。
   */
  public wait(): Promise<boolean> {
    if (this.disposed || this.lifecycle === 'failed' || this.lifecycle === 'disposed') return Promise.resolve(false)
    if (this.lifecycle === 'ready') return Promise.resolve(true)
    if (this.pendingPromise) return this.pendingPromise

    this.pendingPromise = new Promise<boolean>((resolve) => {
      this.resolvePending = resolve
      this.timeoutHandle = this.timer.setTimeout(() => this.settle(false), this.timeoutMilliseconds)
    })
    return this.pendingPromise
  }

  /** 释放时结算唯一等待槽并清理计时器，禁止迟到 Unity ready 复活旧页面会话。 */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.settle(false)
  }

  /** 每次结算都清空槽位；失败后的合法重试因此不会继承上一条命令的 Promise。 */
  private settle(ready: boolean): void {
    if (this.timeoutHandle !== undefined) this.timer.clearTimeout(this.timeoutHandle)
    this.timeoutHandle = undefined
    const resolve = this.resolvePending
    this.resolvePending = undefined
    this.pendingPromise = undefined
    resolve?.(ready)
  }
}

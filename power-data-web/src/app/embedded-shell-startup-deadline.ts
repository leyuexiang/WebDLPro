/** 页面加载后允许完成清单、拓扑和三维准备的最长时间。 */
export const EMBEDDED_SHELL_STARTUP_TIMEOUT_MS = 15_000

/** 计时器接口可替换为假计时器，使启动期限测试不依赖真实等待。 */
export interface EmbeddedShellStartupTimer {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

/**
 * 管理一次嵌入壳启动期限。
 * 成功、超时和释放均为终态，回调最多执行一次，避免迟到运行时重新唤醒已失败页面。
 */
export class EmbeddedShellStartupDeadline {
  private handle: ReturnType<typeof setTimeout> | undefined
  private settled = false
  private expired = false

  public constructor(
    private readonly onTimeout: () => void,
    private readonly timer: EmbeddedShellStartupTimer = globalThis,
  ) {}

  /** 页面开始加载时启动单个计时器；重复启动不会叠加计时器。 */
  public start(): void {
    if (this.settled || this.handle !== undefined) return
    this.handle = this.timer.setTimeout(() => {
      this.handle = undefined
      if (this.settled) return
      this.settled = true
      this.expired = true
      this.onTimeout()
    }, EMBEDDED_SHELL_STARTUP_TIMEOUT_MS)
  }

  /** 运行时组合根成功启动并发送 system.ready 后关闭期限。 */
  public succeed(): void {
    if (this.settled) return
    this.settled = true
    this.clearTimer()
  }

  /** 页面卸载时清理计时器，不触发超时回调。 */
  public dispose(): void {
    if (this.settled) {
      this.clearTimer()
      return
    }
    this.settled = true
    this.clearTimer()
  }

  /** 超时后的迟到回调可通过此状态门禁拒绝。 */
  public get isExpired(): boolean {
    return this.expired
  }

  private clearTimer(): void {
    if (this.handle === undefined) return
    this.timer.clearTimeout(this.handle)
    this.handle = undefined
  }
}

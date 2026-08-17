/**
 * 本地宿主页的设备状态检查控制器。
 *
 * 该控制器仅用于任务-014的受控测试页，模拟合作方父页面每五秒检查一次最新完整快照的行为。
 * 它不属于嵌入壳生产代码、不读取 iframe 内部对象，也不改变外层协议：真正的命令仍由宿主页通过
 * `postMessage`（跨窗口消息）发往嵌入壳。测试页只借此验证父页面应遵守的单在途、十秒截止、
 * 新标识重试、显式不可恢复失败抑制与释放停止规则。
 */
export class LocalShellDeviceStateRetryController {
  /**
   * @param {{
   *   readLatestSnapshot: () => { sourceRevision: number, items: readonly unknown[] } | undefined,
   *   sendSnapshot: (snapshot: { sourceRevision: number, items: readonly unknown[] }) => string | undefined,
   *   onAttempt?: (attempt: { messageId: string, snapshot: { sourceRevision: number, items: readonly unknown[] } }) => void,
   *   onSkipped?: (attempt: { messageId: string, snapshot: { sourceRevision: number, items: readonly unknown[] } }) => void,
   *   onTimeout?: (attempt: { messageId: string, snapshot: { sourceRevision: number, items: readonly unknown[] } }) => void,
   *   onSettled?: (attempt: { messageId: string, snapshot: { sourceRevision: number, items: readonly unknown[] } }) => void,
   *   onNonRecoverableFailure?: (attempt: { messageId: string, snapshot: { sourceRevision: number, items: readonly unknown[] } }) => void,
   *   timer?: Pick<typeof globalThis, 'setInterval' | 'clearInterval' | 'setTimeout' | 'clearTimeout'>,
   *   pollIntervalMs?: number,
   *   resultTimeoutMs?: number,
   * }} options 受控测试依赖；调用方只能读取最新快照并发送，不可注入任意协议消息。
   */
  constructor({
    readLatestSnapshot,
    sendSnapshot,
    onAttempt,
    onSkipped,
    onTimeout,
    onSettled,
    onNonRecoverableFailure,
    timer = globalThis,
    pollIntervalMs = 5_000,
    resultTimeoutMs = 10_000,
  }) {
    this.readLatestSnapshot = readLatestSnapshot
    this.sendSnapshot = sendSnapshot
    this.onAttempt = onAttempt
    this.onSkipped = onSkipped
    this.onTimeout = onTimeout
    this.onSettled = onSettled
    this.onNonRecoverableFailure = onNonRecoverableFailure
    this.timer = timer
    this.pollIntervalMs = pollIntervalMs
    this.resultTimeoutMs = resultTimeoutMs
    this.pollHandle = undefined
    this.inFlight = undefined
    // 只缓存最近一次不可恢复失败的“状态内容”，不包含仅供诊断的 sourceRevision。
    // 因而数据源即使仅重新编号，也不会绕过协议的“状态内容未变化不得重发”约束。
    this.blockedStateContentSignature = undefined
    this.stopped = false
  }

  /**
   * 立即发起首轮检查，随后按五秒间隔检查。
   * 首轮发送后即登记在途项，后续检查只会跳过而不会复用同一个 messageId（消息标识）重发。
   */
  start() {
    if (this.stopped || this.pollHandle !== undefined) return
    this.poll()
    this.pollHandle = this.timer.setInterval(() => this.poll(), this.pollIntervalMs)
  }

  /**
   * 接收宿主页已验证的 `command.result`（命令结果）。
   * 释放结果无论关联哪个外层命令，都会终止本会话的全部重试资源；其他结果只有关联当前
   * 在途标识时才可结算，避免旧确认、重复确认或其他命令意外释放状态命令槽位。
   */
  handleCommandResult(messageId, result) {
    if (result?.success === true && result.status === 'disposed' && result.error === null) {
      this.stop()
      return 'disposed'
    }
    return this.settle(messageId, result) ? 'settled' : 'ignored'
  }

  /**
   * 结算当前状态命令。显式不可恢复失败会保留本次完整状态内容指纹，后续五秒检查只能在
   * 状态内容实际变化后发送新快照，不能仅更换 messageId 或 sourceRevision 就重发相同状态。
   */
  settle(messageId, result) {
    if (this.stopped || !this.inFlight || this.inFlight.messageId !== messageId) return false
    const attempt = this.inFlight
    this.timer.clearTimeout(attempt.timeoutHandle)
    this.inFlight = undefined
    if (isExplicitNonRecoverableFailure(result)) {
      this.blockedStateContentSignature = attempt.stateContentSignature
      this.onNonRecoverableFailure?.(this.toPublicAttempt(attempt))
    }
    this.onSettled?.(this.toPublicAttempt(attempt))
    return true
  }

  /**
   * 释放时同步停止轮询与当前十秒计时器。
   * 已释放会话不得等待旧结果、更不得在后续检查中创建新的重试消息。
   */
  stop() {
    if (this.stopped) return
    this.stopped = true
    if (this.pollHandle !== undefined) this.timer.clearInterval(this.pollHandle)
    this.pollHandle = undefined
    if (this.inFlight) this.timer.clearTimeout(this.inFlight.timeoutHandle)
    this.inFlight = undefined
    this.blockedStateContentSignature = undefined
  }

  /** 只读查询供本地页面和自动测试断言单在途状态，不暴露定时器句柄。 */
  isAwaiting(messageId) {
    return !this.stopped && this.inFlight?.messageId === messageId
  }

  /** 五秒检查只在没有在途命令时读取最新完整快照，防止旧快照在等待期内被重复发送。 */
  poll() {
    if (this.stopped) return
    if (this.inFlight) {
      this.onSkipped?.(this.toPublicAttempt(this.inFlight))
      return
    }

    const snapshot = this.readLatestSnapshot()
    if (!snapshot) return
    const stateContentSignature = createStateContentSignature(snapshot)
    if (this.blockedStateContentSignature === stateContentSignature) {
      // 协议要求不可恢复失败后的相同状态保持静默，直到父页面读取到真正变化的完整快照。
      return
    }
    // 新状态内容已出现；旧失败不再阻断本次独立且使用新标识的发送。
    this.blockedStateContentSignature = undefined
    const messageId = this.sendSnapshot(snapshot)
    // 宿主页未建立有效会话时不登记假在途项；下一轮仍可在会话恢复后重新读取最新快照。
    if (typeof messageId !== 'string' || messageId.length === 0) return

    const attempt = {
      messageId,
      snapshot,
      stateContentSignature,
      timeoutHandle: undefined,
    }
    this.inFlight = attempt
    attempt.timeoutHandle = this.timer.setTimeout(() => {
      if (this.stopped || this.inFlight !== attempt) return
      this.inFlight = undefined
      // 超时后不复用旧标识或旧快照。下一次五秒检查会重新调用 readLatestSnapshot，再生成新的 messageId。
      this.onTimeout?.(this.toPublicAttempt(attempt))
    }, this.resultTimeoutMs)
    this.onAttempt?.(this.toPublicAttempt(attempt))
  }

  /** 对外只保留关联标识与不可变快照引用，定时器句柄始终停留在控制器内部。 */
  toPublicAttempt({ messageId, snapshot }) {
    return { messageId, snapshot }
  }
}

/**
 * 协议中只有“失败且明确 recoverable 为 false”的结果会阻断相同状态重发。超时、网络缺失
 * 回执和可恢复失败仍由十秒截止后的下一次五秒检查处理，且必须重新读取最新完整快照。
 */
function isExplicitNonRecoverableFailure(result) {
  return result?.success === false
    && result.status === 'failed'
    && result.error?.recoverable === false
}

/**
 * sourceRevision 只用于观察和诊断，不能作为状态变化依据。夹具的状态项由正式协议校验为
 * 有限 JSON 数据，因此按原数组顺序序列化可保留“同设备最后一项生效”的完整快照语义。
 */
function createStateContentSignature(snapshot) {
  return JSON.stringify(snapshot.items)
}

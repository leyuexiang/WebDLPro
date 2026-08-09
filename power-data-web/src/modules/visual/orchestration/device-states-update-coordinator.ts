import type { HostCommandExecutionResult } from '@/host-bridge/host-command-lifecycle'
import type { HostDispatchableDomainCommand } from '@/host-bridge/host-command-dispatcher'
import type { HostProtocolError } from '@/host-bridge/host-protocol'
import type { SceneNodeId } from '@/config/scene-topology/identifiers'
import type { DeviceVisualStatus } from '@/config/scene-topology/types'
import type { TopologyDeviceStateApplyResult, TopologySceneNodeVisualStateUpdate } from '@/modules/visual/topology/topology-device-state-cache'
import type { TopologyRuntime } from '@/modules/visual/topology/topology-runtime'

/** 当前 Unity 运行时的最小状态端口；编排层不能取得 iframe、窗口或连接器实例。 */
export interface DeviceStatesUnityPort {
  /** 只在当前 Unity 运行时已协商四态命令能力时返回 true，避免发送未声明命令。 */
  supportsNodeVisualState(): boolean
  /**
   * 向已验证的三维节点发送单项四态、标准化状态时间和可选来源修订号，并等待同一请求的最终受控回执。
   * 时间优先、修订号只裁决相同时间，使 Unity 在异步回执交错时仍与二维缓存使用相同因果顺序。
   */
  setNodeVisualState(
    sceneNodeId: SceneNodeId,
    visualState: DeviceVisualStatus,
    statusUpdatedAt: string,
    sourceRevision?: number,
  ): Promise<{ success: boolean }>
}

/** 诊断不保存设备状态、节点标识或原始外层载荷，只保留容量受限的计数与关联信息。 */
export interface DeviceStatesBatchDiagnostic {
  correlationId: string
  processedAt: number
  elapsedMilliseconds: number
  acceptedCount: number
  outdatedCount: number
  unmappedCount: number
  invalidTimestampCount: number
  unityTargetCount: number
  unitySucceededCount: number
  unityFailedCount: number
  unityUnavailable: boolean
  /** 当前批次中被同一动画帧更新覆盖的三维节点数，便于诊断合帧是否真实生效。 */
  unityFrameMergedCount: number
}

/** 动画帧调度器可注入，生产使用浏览器帧时序，测试可精确控制“同帧”的合并边界。 */
export interface DeviceStatesFrameScheduler {
  request(callback: () => void): unknown
  cancel(handle: unknown): void
}

/** 协调器选项保持有限并可注入时间、帧调度器，测试不依赖机器时钟或异步调度时序。 */
export interface DeviceStatesUpdateCoordinatorOptions {
  maximumDiagnostics?: number
  maximumConcurrentUnityCommands?: number
  maximumPendingBatches?: number
  now?: () => number
  frameScheduler?: DeviceStatesFrameScheduler
}

/**
 * 设备状态批量协调器。
 * 它先把已校验的 deviceId（设备标识）批次交给唯一拓扑运行时，再把当前活动场景的显式三维节点快照
 * 通过能力协商后的 Unity 端口下发。二维与三维各自结算：三维失败不会撤回已显示的二维真实状态，
 * 但外层命令会返回失败，因而不会把“仅二维成功”伪装为全链路成功。
 */
export class DeviceStatesUpdateCoordinator {
  private readonly diagnostics: DeviceStatesBatchDiagnostic[] = []
  private readonly maximumDiagnostics: number
  private readonly maximumConcurrentUnityCommands: number
  private readonly maximumPendingBatches: number
  private readonly now: () => number
  private readonly frameScheduler: DeviceStatesFrameScheduler
  /** 当前等待同一动画帧的批次；与待确认外层命令一样有容量边界。 */
  private readonly scheduledBatches: QueuedDeviceStatesBatch[] = []
  /** 尚未结算的批次包含已发送但等待 Unity 回执的项目，释放时必须全部受控结算。 */
  private readonly unsettledBatches = new Set<QueuedDeviceStatesBatch>()
  /** 同一帧内每个场景节点只保留最后一次已接受状态，防止重复挤占 Unity 待确认表。 */
  private readonly pendingUnityStateBySceneNodeId = new Map<SceneNodeId, PendingUnityState>()
  private frameHandle: unknown | undefined
  private disposed = false

  public constructor(
    private readonly topologyRuntime: TopologyRuntime,
    private readonly unity: DeviceStatesUnityPort,
    options: DeviceStatesUpdateCoordinatorOptions = {},
  ) {
    this.maximumDiagnostics = normalizePositiveSafeInteger(options.maximumDiagnostics, 64)
    // Unity 连接器的待确认命令表上限为 64；默认八路并发在吞吐与页面资源间保留足够余量。
    this.maximumConcurrentUnityCommands = normalizePositiveSafeInteger(options.maximumConcurrentUnityCommands, 8, 64)
    // 外层生命周期同样最多保持 64 条待确认命令；这里重复设限，防止单元替身或未来组合绕过该边界。
    this.maximumPendingBatches = normalizePositiveSafeInteger(options.maximumPendingBatches, 64, 64)
    this.now = options.now ?? (() => Date.now())
    this.frameScheduler = options.frameScheduler ?? createDefaultFrameScheduler()
  }

  /**
   * 处理已通过外层协议校验的状态命令。
   * 时间戳、同帧去重、无映射丢弃与二维状态覆盖全部委托给任务-029缓存；本类不重复扫描完整拓扑，
   * 只遍历当前活动场景已经显式映射的三维节点快照。
   */
  public async submit(command: Extract<HostDispatchableDomainCommand, { type: 'device.states.update' }>): Promise<HostCommandExecutionResult> {
    if (this.disposed) return this.createDisposedFailure()
    if (this.unsettledBatches.size >= this.maximumPendingBatches) return this.createCapacityFailure()

    const startedAt = this.now()
    let topologyResult: TopologyDeviceStateApplyResult
    try {
      topologyResult = this.topologyRuntime.applyDeviceStates(command.payload)
    } catch {
      // 运行时画布或缓存异常不能泄露实现对象；此时无法可靠声明二维已提交，统一返回受控失败。
      return this.createTopologyFailure()
    }

    const unityTargets = new Map(topologyResult.activeSceneNodeStateUpdates)
    if (unityTargets.size > 0) return this.scheduleUnityStateDispatch(command.correlationId, startedAt, topologyResult, unityTargets)

    const diagnostic = this.createDiagnostic(command.correlationId, startedAt, topologyResult, 0, createEmptyUnityDispatchResult(), 0)
    this.recordDiagnostic(diagnostic)
    return { success: true, status: 'completed' }
  }

  /** 返回防御性诊断副本；调用方不能改写内部有限队列。 */
  public getDiagnostics(): readonly DeviceStatesBatchDiagnostic[] {
    return this.diagnostics.map((diagnostic) => ({ ...diagnostic }))
  }

  /** 释放诊断队列；组合根卸载后不保留外层关联标识或历史处理计数。 */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.frameHandle !== undefined) this.frameScheduler.cancel(this.frameHandle)
    this.frameHandle = undefined
    this.scheduledBatches.length = 0
    this.pendingUnityStateBySceneNodeId.clear()
    // 已发送命令不能撤回 Unity 侧网络投递，但释放后的回执绝不能继续写诊断或完成旧外层命令。
    for (const batch of this.unsettledBatches) this.settleBatch(batch, this.createDisposedFailure(), undefined)
    this.unsettledBatches.clear()
    this.diagnostics.length = 0
  }

  /**
   * 将当前批次加入下一动画帧。二维状态已在 submit 中同步提交；三维只等待一帧以合并跨外层消息的重复节点。
   * 每个外层批次仍保留自己的 Promise 和诊断，因而不会把合帧误报为未处理或全链路成功。
   */
  private scheduleUnityStateDispatch(
    correlationId: string,
    startedAt: number,
    topologyResult: TopologyDeviceStateApplyResult,
    unityTargets: ReadonlyMap<SceneNodeId, TopologySceneNodeVisualStateUpdate>,
  ): Promise<HostCommandExecutionResult> {
    return new Promise((resolve) => {
      const batch: QueuedDeviceStatesBatch = {
        correlationId,
        startedAt,
        topologyResult,
        unityTargets,
        unityFrameMergedCount: 0,
        resolve,
        settled: false,
      }
      this.unsettledBatches.add(batch)
      this.scheduledBatches.push(batch)

      for (const [sceneNodeId, state] of unityTargets) {
        const previous = this.pendingUnityStateBySceneNodeId.get(sceneNodeId)
        // 同帧较晚的父页面状态覆盖前一状态，但前一外层命令仍等待最终节点回执并得到可观测摘要。
        if (previous && previous.source !== batch) previous.source.unityFrameMergedCount += 1
        this.pendingUnityStateBySceneNodeId.set(sceneNodeId, { ...state, source: batch })
      }

      if (this.frameHandle === undefined) {
        this.frameHandle = this.frameScheduler.request(() => this.flushUnityStateFrame())
      }
    })
  }

  /** 取走本帧所有节点最新状态后异步等待 Unity；后续帧不会与本帧共享可变 Map。 */
  private flushUnityStateFrame(): void {
    this.frameHandle = undefined
    if (this.disposed || this.scheduledBatches.length === 0) return

    const batches = this.scheduledBatches.splice(0)
    const targets = [...this.pendingUnityStateBySceneNodeId]
    this.pendingUnityStateBySceneNodeId.clear()
    void this.dispatchAndSettleUnityFrame(batches, targets)
  }

  /** 单帧全部节点使用有限工作池；单项失败被隔离，随后依批次投影为各自的结构化结果。 */
  private async dispatchAndSettleUnityFrame(
    batches: readonly QueuedDeviceStatesBatch[],
    targets: readonly (readonly [SceneNodeId, PendingUnityState])[],
  ): Promise<void> {
    const unityResult = await this.dispatchUnityStates(targets)
    if (this.disposed) return

    for (const batch of batches) {
      const result = this.createBatchResult(batch, unityResult)
      this.settleBatch(batch, result, unityResult)
    }
  }

  /**
   * 当前内层协议仅有单节点四态命令，故以有限工作池下发。
   * 并发度严格小于连接器 64 条待确认上限，避免一个最多 500 项的父页面批次挤占所有内层命令容量。
   */
  private async dispatchUnityStates(targets: readonly (readonly [SceneNodeId, PendingUnityState])[]): Promise<UnityDispatchResult> {
    if (targets.length === 0) return createEmptyUnityDispatchResult()
    let supported = false
    try {
      supported = this.unity.supportsNodeVisualState()
    } catch {
      // 能力端口异常与未协商能力同样不能发送内层命令；只在脱敏摘要中标记为不可用。
      return createUnavailableUnityDispatchResult(targets)
    }
    if (!supported) return createUnavailableUnityDispatchResult(targets)

    let nextTargetIndex = 0
    const resultBySceneNodeId = new Map<SceneNodeId, boolean>()
    const workerCount = Math.min(this.maximumConcurrentUnityCommands, targets.length)

    const workers = Array.from({ length: workerCount }, async () => {
      while (nextTargetIndex < targets.length) {
        const target = targets[nextTargetIndex]
        nextTargetIndex += 1
        if (!target) continue

        const [sceneNodeId, pendingState] = target
        try {
          const result = await this.unity.setNodeVisualState(
            sceneNodeId,
            pendingState.visualState,
            pendingState.statusUpdatedAt,
            pendingState.sourceRevision,
          )
          resultBySceneNodeId.set(sceneNodeId, result.success)
        } catch {
          // 单个内层请求的异常只计为该节点失败：其余节点仍须获得本批次状态，
          // 最终再以受控失败回执告诉父页面“二维已更新、部分三维未确认”。
          // 不保存异常对象或原始消息，避免有限诊断队列泄露内层实现细节。
          resultBySceneNodeId.set(sceneNodeId, false)
        }
      }
    })
    await Promise.all(workers)
    return { unavailable: false, resultBySceneNodeId }
  }

  /** 将拓扑缓存结果收敛为有限诊断，既可审计状态丢弃，也不会保留任意设备原始状态。 */
  private createDiagnostic(
    correlationId: string,
    startedAt: number,
    topologyResult: TopologyDeviceStateApplyResult,
    unityTargetCount: number,
    unityResult: UnityDispatchResult,
    unityFrameMergedCount: number,
  ): DeviceStatesBatchDiagnostic {
    const processedAt = this.now()
    return {
      correlationId,
      processedAt,
      elapsedMilliseconds: Math.max(0, processedAt - startedAt),
      acceptedCount: topologyResult.acceptedDeviceIds.length,
      outdatedCount: topologyResult.outdatedDeviceIds.length,
      unmappedCount: topologyResult.unmappedDeviceIds.length,
      invalidTimestampCount: topologyResult.invalidTimestampDeviceIds.length,
      unityTargetCount,
      unitySucceededCount: countUnityDispatches(unityResult.resultBySceneNodeId, true),
      unityFailedCount: countUnityDispatches(unityResult.resultBySceneNodeId, false),
      unityUnavailable: unityResult.unavailable,
      unityFrameMergedCount,
    }
  }

  /** 固定长度 FIFO（先进先出）诊断队列；仅保存任务要求的有限摘要。 */
  private recordDiagnostic(diagnostic: DeviceStatesBatchDiagnostic): void {
    this.diagnostics.push(diagnostic)
    while (this.diagnostics.length > this.maximumDiagnostics) this.diagnostics.shift()
  }

  /** 三维能力缺失和回执失败使用同一协议许可错误码，但保持可区分的脱敏说明。 */
  private createUnityFailure(unavailable: boolean): HostProtocolError {
    return {
      code: 'action.execute.failed',
      stage: 'executing-action',
      message: unavailable
        ? '二维设备状态已更新，但当前 Unity 运行时未协商四态状态能力。'
        : '二维设备状态已更新，但部分 Unity 三维节点状态未能确认。',
      recoverable: true,
    }
  }

  /** 按本批受影响节点计算最终 Unity 回执；同帧被较新状态覆盖的节点仍共享最后一次受控结果。 */
  private createBatchResult(batch: QueuedDeviceStatesBatch, unityResult: UnityDispatchResult): HostCommandExecutionResult {
    const failedCount = countBatchUnityDispatchFailures(batch.unityTargets, unityResult)
    if (unityResult.unavailable || failedCount > 0) {
      return { success: false, status: 'failed', error: this.createUnityFailure(unityResult.unavailable) }
    }
    return { success: true, status: 'completed' }
  }

  /** 每个批次只结算一次；释放与迟到 Unity 回执竞争时，先结算的结果拥有唯一写入权。 */
  private settleBatch(
    batch: QueuedDeviceStatesBatch,
    result: HostCommandExecutionResult,
    unityResult: UnityDispatchResult | undefined,
  ): void {
    if (batch.settled) return
    batch.settled = true
    this.unsettledBatches.delete(batch)
    if (!this.disposed && unityResult) {
      this.recordDiagnostic(this.createDiagnostic(
        batch.correlationId,
        batch.startedAt,
        batch.topologyResult,
        batch.unityTargets.size,
        projectBatchUnityDispatchResult(batch.unityTargets, unityResult),
        batch.unityFrameMergedCount,
      ))
    }
    batch.resolve(result)
  }

  /** 释放后未发送或迟到批次均以统一失败回包结算，不再触碰拓扑、Unity 或诊断队列。 */
  private createDisposedFailure(): HostCommandExecutionResult {
    return {
      success: false,
      status: 'failed',
      error: { code: 'runtime.disposed', stage: 'disposing', message: '可视化运行时已释放，不能继续同步设备状态。', recoverable: false },
    }
  }

  /** 防御性队列容量失败不会让未进入二维缓存的批次占用 Unity 或诊断资源。 */
  private createCapacityFailure(): HostCommandExecutionResult {
    return {
      success: false,
      status: 'failed',
      error: { code: 'protocol.capacity.exceeded', stage: 'validation', message: '设备状态批量等待队列已达到安全上限。', recoverable: true },
    }
  }

  /** 拓扑端口抛错时不能假设二维是否已部分更新，因而只返回不泄露底层异常的可恢复失败。 */
  private createTopologyFailure(): HostCommandExecutionResult {
    return {
      success: false,
      status: 'failed',
      error: { code: 'action.execute.failed', stage: 'executing-action', message: '设备状态二维处理失败，当前批次未继续下发 Unity。', recoverable: true },
    }
  }
}

/** 单个外层批次保留必要摘要与 Promise；不保存原始状态列表、设备名称或 Unity 对象。 */
interface QueuedDeviceStatesBatch {
  correlationId: string
  startedAt: number
  topologyResult: TopologyDeviceStateApplyResult
  unityTargets: ReadonlyMap<SceneNodeId, TopologySceneNodeVisualStateUpdate>
  unityFrameMergedCount: number
  resolve: (result: HostCommandExecutionResult) => void
  settled: boolean
}

/** 进入单帧出站 Map 的节点状态额外记录来源批次，仅用于合帧计数，不会进入内层协议。 */
interface PendingUnityState extends TopologySceneNodeVisualStateUpdate {
  source: QueuedDeviceStatesBatch
}

/** Unity 下发结果只在当前调用栈存活，不进入长期状态仓库或协议事件。 */
interface UnityDispatchResult {
  unavailable: boolean
  resultBySceneNodeId: ReadonlyMap<SceneNodeId, boolean>
}

/** 浏览器优先使用真实动画帧；非浏览器单元环境安全退化为零延迟计时器，仍保持异步合批语义。 */
function createDefaultFrameScheduler(): DeviceStatesFrameScheduler {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return {
      request: (callback) => globalThis.requestAnimationFrame(callback),
      cancel: (handle) => globalThis.cancelAnimationFrame(handle as number),
    }
  }
  return {
    request: (callback) => globalThis.setTimeout(callback, 0),
    cancel: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
}

/** 空批次不创建数组，且始终返回新的只读 Map，避免调用方意外共享可变状态。 */
function createEmptyUnityDispatchResult(): UnityDispatchResult {
  return { unavailable: false, resultBySceneNodeId: new Map() }
}

/** 能力不可用时每个目标都明确记为失败，便于各外层批次得到与自身节点数一致的摘要。 */
function createUnavailableUnityDispatchResult(targets: readonly (readonly [SceneNodeId, PendingUnityState])[]): UnityDispatchResult {
  return { unavailable: true, resultBySceneNodeId: new Map(targets.map(([sceneNodeId]) => [sceneNodeId, false])) }
}

/** 统计固定结果 Map 中的成功或失败数，不读取或存储任何外层状态值。 */
function countUnityDispatches(resultBySceneNodeId: ReadonlyMap<SceneNodeId, boolean>, expected: boolean): number {
  let count = 0
  for (const result of resultBySceneNodeId.values()) if (result === expected) count += 1
  return count
}

/** 将本批节点投影为独立统计，避免一个合帧内无关节点失败污染其他外层命令结果。 */
function projectBatchUnityDispatchResult(
  targets: ReadonlyMap<SceneNodeId, TopologySceneNodeVisualStateUpdate>,
  unityResult: UnityDispatchResult,
): UnityDispatchResult {
  const resultBySceneNodeId = new Map<SceneNodeId, boolean>()
  for (const sceneNodeId of targets.keys()) resultBySceneNodeId.set(sceneNodeId, unityResult.resultBySceneNodeId.get(sceneNodeId) === true)
  return { unavailable: unityResult.unavailable, resultBySceneNodeId }
}

/** 缺失回执按失败处理；这比把异步容量、释放或协议异常伪装为状态已同步更安全。 */
function countBatchUnityDispatchFailures(
  targets: ReadonlyMap<SceneNodeId, TopologySceneNodeVisualStateUpdate>,
  unityResult: UnityDispatchResult,
): number {
  let failedCount = 0
  for (const sceneNodeId of targets.keys()) if (unityResult.resultBySceneNodeId.get(sceneNodeId) !== true) failedCount += 1
  return failedCount
}

/** 选项必须为安全正整数；并发上限额外受连接器容量保护。 */
function normalizePositiveSafeInteger(value: number | undefined, fallback: number, maximum: number = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback
}

import type { HostCommandExecutionResult } from '@/host-bridge/host-command-lifecycle'
import type { HostDispatchableDomainCommand } from '@/host-bridge/host-command-dispatcher'
import type { SceneActivationId, SceneNodeId } from '@/config/scene-topology/identifiers'
import type { DeviceVisualStatus } from '@/config/scene-topology/types'
import type { TopologyNodeStateApplyResult, TopologySceneNodeVisualStateUpdate } from '@/modules/visual/topology/topology-device-state-cache'
import type { TopologyRuntime } from '@/modules/visual/topology/topology-runtime'

/** 当前 Unity 运行时的最小状态端口；编排层不能取得 iframe（内嵌框架）、窗口或连接器实例。 */
export interface DeviceStatesUnityPort {
  /**
   * 只有设置四态和清除动态覆盖两项能力均已协商时返回 true。
   * 缺少清除能力的旧运行时不能完整表达权威快照替换，必须整体降级为三维不可用。
   */
  supportsNodeVisualState(): boolean
  /**
   * 向已验证三维节点发送固定四态和壳会话内快照序号。
   * `snapshotSequence` 是唯一迟到门禁；平台时间和来源修订号只随命令进入有限诊断，不参与覆盖排序。
   */
  setNodeVisualState(
    sceneNodeId: SceneNodeId,
    visualState: DeviceVisualStatus,
    snapshotSequence: number,
    statusUpdatedAt: string,
    sourceRevision: number,
  ): Promise<{ success: boolean }>
  /** 撤销指定节点的动态状态覆盖并恢复场景登记的模型基础视觉；不得伪装为 `normal`。 */
  clearNodeVisualState(sceneNodeId: SceneNodeId, snapshotSequence: number): Promise<{ success: boolean }>
}

/** 诊断不保存设备状态、节点标识或原始外层载荷，只保留容量受限的计数与关联信息。 */
export interface DeviceStatesBatchDiagnostic {
  correlationId: string
  snapshotSequence: number
  sourceRevision: number
  processedAt: number
  elapsedMilliseconds: number
  acceptedCount: number
  outdatedCount: number
  unmappedCount: number
  invalidTimestampCount: number
  unityTargetCount: number
  unitySucceededCount: number
  unityFailedCount: number
  unityStaleSkippedCount: number
  unityUnavailable: boolean
  /** 当前完整快照中被同一动画帧内更新快照覆盖的相同三维节点数。 */
  unityFrameMergedCount: number
}

/** 动画帧调度器可注入，生产使用浏览器帧时序，测试可精确控制合并边界。 */
export interface DeviceStatesFrameScheduler {
  request(callback: () => void): unknown
  cancel(handle: unknown): void
}

/** 协调器选项保持有限并可注入时间、帧调度器，测试不依赖机器时钟或异步调度时序。 */
export interface DeviceStatesUpdateCoordinatorOptions {
  maximumDiagnostics?: number
  maximumConcurrentUnityCommands?: number
  /**
   * 旧版按外层批次等待 Unity 时使用的容量项。最终契约固定为“一个待发送完整快照槽位”，
   * 因此保留字段只为兼容既有调用配置，不再允许扩大内部队列。
   */
  maximumPendingBatches?: number
  now?: () => number
  frameScheduler?: DeviceStatesFrameScheduler
}

/**
 * 设备状态完整快照协调器。
 *
 * 二维画布与权威状态表在 `submit` 内同步原子提交，提交成功即形成唯一外层成功结果；
 * 三维投递使用“一个待发送完整快照槽位 + 一个有限并发工作池”。新快照会整体取代尚未发送的旧快照，
 * 已发送命令则由 `snapshotSequence` 在 Unity 端阻止迟到覆盖。任何三维失败只更新有限内部诊断，
 * 不撤销二维、不延迟外层结果，也不补发外层失败事件。
 */
export class DeviceStatesUpdateCoordinator {
  private readonly diagnostics: DeviceStatesBatchDiagnostic[] = []
  private readonly maximumDiagnostics: number
  private readonly maximumConcurrentUnityCommands: number
  private readonly now: () => number
  private readonly frameScheduler: DeviceStatesFrameScheduler
  /** 尚未进入工作池的最新完整三维投影；单槽结构从根源上避免状态批次无界积压。 */
  private pendingBatch: PendingUnityBatch | undefined
  private frameHandle: unknown | undefined
  private unityDispatchActive = false
  private latestSnapshotSequence = 0
  /**
   * 每次确认物理场景激活标识变化时递增。快照序号只区分设备快照，不能区分同一快照在两个物理控制器实例上的投影；
   * 工作项必须同时匹配快照序号和本代次，才允许进入当前 Unity 控制器。
   */
  private unityDispatchGeneration = 0
  /** 用物理激活标识区分同名场景的不同实例；旧实例的动态覆盖不需要也不能清到新实例。 */
  private activeSceneActivationId: SceneActivationId | undefined
  /**
   * Unity 暂不可用时仍需记住已从权威快照消失的节点；恢复后才能补发基础视觉清除。
   * 结构清单校验明确限制每个场景最多500个不同状态三维目标，因此该表不会随快照次数增长；
   * 值用于防止旧清除回执误删较新的补偿任务。
   */
  private readonly pendingClearSequenceBySceneNodeId = new Map<SceneNodeId, number>()
  private disposed = false

  public constructor(
    private readonly topologyRuntime: TopologyRuntime,
    private readonly unity: DeviceStatesUnityPort,
    options: DeviceStatesUpdateCoordinatorOptions = {},
  ) {
    this.maximumDiagnostics = normalizePositiveSafeInteger(options.maximumDiagnostics, 64)
    // Unity 连接器待确认表上限为64；最多八路并发为其他视图命令保留容量，且不会随快照数量增长。
    this.maximumConcurrentUnityCommands = normalizePositiveSafeInteger(options.maximumConcurrentUnityCommands, 8, 64)
    this.now = options.now ?? (() => Date.now())
    this.frameScheduler = options.frameScheduler ?? createDefaultFrameScheduler()
  }

  /**
   * 处理已通过外层协议校验的完整快照。
   * 只有运行时释放、二维容量拒绝或二维事务异常可以返回失败；Unity 是否就绪或最终执行结果均不参与返回值。
   */
  public async submit(command: Extract<HostDispatchableDomainCommand, { type: 'device.states.update' }>): Promise<HostCommandExecutionResult> {
    if (this.disposed) return this.createDisposedFailure()

    const startedAt = this.now()
    let topologyResult: TopologyNodeStateApplyResult
    try {
      topologyResult = this.topologyRuntime.applyDeviceStates(command.payload)
    } catch {
      // 画布或缓存异常时无法证明二维已提交；只返回稳定错误，不泄露底层异常对象。
      return this.createTopologyFailure()
    }
    if (!topologyResult.committed) {
      return topologyResult.capacityExceeded ? this.createCapacityFailure() : this.createTopologyFailure()
    }

    this.latestSnapshotSequence = topologyResult.snapshotSequence
    const diagnostic = this.createDiagnostic(command, startedAt, topologyResult)
    const unityTargets = this.createUnityTargets(topologyResult)
    // 目标数量必须取最终操作表：同一节点的设置/清除会去重，历史清除债务也会在这里合并。
    diagnostic.unityTargetCount = unityTargets.size
    this.recordDiagnostic(diagnostic)
    // 清除目标与四态目标属于同一权威快照；单槽替换可阻止旧颜色在下一帧迟到写回。
    this.scheduleLatestUnitySnapshot(topologyResult.snapshotSequence, unityTargets, diagnostic)

    // 此返回点只依赖上方二维原子提交；后续动画帧、Unity 能力、超时或回执均不能再改变它。
    return { success: true, status: 'completed' }
  }

  /** 返回防御性诊断副本；调用方不能改写内部有限队列。 */
  public getDiagnostics(): readonly DeviceStatesBatchDiagnostic[] {
    return this.diagnostics.map((diagnostic) => ({ ...diagnostic }))
  }

  /**
   * Unity 恢复或场景重新激活后，从拓扑缓存的最新权威完整快照重建三维投影。
   * 该内部补同步不产生外层命令结果，也不会为旧批次保留队列；相同序号由 Unity 新控制器实例重新接纳。
   */
  public resynchronizeLatestSnapshot(sceneActivationId?: SceneActivationId): void {
    const replay = this.createLatestReplay(sceneActivationId, 'internal-state-replay')
    if (!replay) return
    this.scheduleLatestUnitySnapshot(replay.snapshotSequence, replay.targets, replay.diagnostic)
  }

  /**
   * 跨场景关键环节必须等目标业务控制器真正接收最新权威状态后才能准备隐藏资源。
   * 该屏障绕过动画帧单槽，但仍使用有限工作池并等待每条 Unity 回执；普通实时快照继续走原异步快路径，
   * 因此不会把所有设备状态更新改成阻塞外层命令。
   */
  public async resynchronizeLatestSnapshotAndWait(sceneActivationId?: SceneActivationId): Promise<boolean> {
    const replay = this.createLatestReplay(sceneActivationId, 'internal-state-replay-barrier')
    if (!replay) return !this.disposed
    return this.dispatchUnityReplayImmediately(replay)
  }

  /**
   * 建立一次场景重放的固定投影和诊断。物理实例变化时先废弃旧代次待发批次，避免旧场景命令进入新控制器；
   * 空快照或空目标直接返回，不占用诊断槽位，也不创建无意义的异步任务。
   */
  private createLatestReplay(
    sceneActivationId: SceneActivationId | undefined,
    correlationId: string,
  ): {
    snapshotSequence: number
    generation: number
    targets: ReadonlyMap<SceneNodeId, UnityNodeVisualStateOperation>
    diagnostic: DeviceStatesBatchDiagnostic
  } | undefined {
    if (this.disposed) return undefined
    if (sceneActivationId && sceneActivationId !== this.activeSceneActivationId) {
      this.unityDispatchGeneration += 1
      this.pendingClearSequenceBySceneNodeId.clear()
      this.invalidatePendingBatchForSceneChange()
    }
    if (sceneActivationId) this.activeSceneActivationId = sceneActivationId
    const snapshot = this.topologyRuntime.getActiveSceneNodeStateSnapshot()
    if (snapshot.snapshotSequence <= 0) return undefined

    this.latestSnapshotSequence = Math.max(this.latestSnapshotSequence, snapshot.snapshotSequence)
    const firstUpdate = snapshot.updates.values().next().value as TopologySceneNodeVisualStateUpdate | undefined
    const diagnostic: DeviceStatesBatchDiagnostic = {
      correlationId,
      snapshotSequence: snapshot.snapshotSequence,
      sourceRevision: firstUpdate?.sourceRevision ?? 0,
      processedAt: this.now(),
      elapsedMilliseconds: 0,
      acceptedCount: 0,
      outdatedCount: 0,
      unmappedCount: 0,
      invalidTimestampCount: 0,
      unityTargetCount: 0,
      unitySucceededCount: 0,
      unityFailedCount: 0,
      unityStaleSkippedCount: 0,
      unityUnavailable: false,
      unityFrameMergedCount: 0,
    }
    const replayTargets = new Map<SceneNodeId, UnityNodeVisualStateOperation>()
    snapshot.updates.forEach((state, sceneNodeId) => replayTargets.set(sceneNodeId, { kind: 'set', state }))
    this.pendingClearSequenceBySceneNodeId.forEach((_sequence, sceneNodeId) => {
      if (!replayTargets.has(sceneNodeId)) replayTargets.set(sceneNodeId, { kind: 'clear' })
    })
    if (replayTargets.size === 0) return undefined

    diagnostic.unityTargetCount = replayTargets.size
    this.recordDiagnostic(diagnostic)
    return {
      snapshotSequence: snapshot.snapshotSequence,
      generation: this.unityDispatchGeneration,
      targets: replayTargets,
      diagnostic,
    }
  }

  /**
   * 阻塞式重放只用于跨场景关键环节准备屏障。工作项数量受现有并发上限约束，
   * 每个节点仍携带本地快照序号，期间到达的新快照可由 Unity 端序号门禁覆盖旧值。
   */
  private async dispatchUnityReplayImmediately(replay: {
    snapshotSequence: number
    generation: number
    targets: ReadonlyMap<SceneNodeId, UnityNodeVisualStateOperation>
    diagnostic: DeviceStatesBatchDiagnostic
  }): Promise<boolean> {
    let supported = false
    try {
      supported = this.unity.supportsNodeVisualState()
    } catch {
      supported = false
    }
    if (!supported) {
      replay.diagnostic.unityUnavailable = true
      replay.diagnostic.unityFailedCount = replay.targets.size
      this.completeDiagnostic(replay.diagnostic)
      return false
    }

    const targets = [...replay.targets]
    let nextTargetIndex = 0
    let allSucceeded = true
    const workerCount = Math.min(this.maximumConcurrentUnityCommands, targets.length)
    const workers = Array.from({ length: workerCount }, async () => {
      while (!this.disposed && nextTargetIndex < targets.length) {
        const target = targets[nextTargetIndex]
        nextTargetIndex += 1
        if (!target) continue
        if (replay.generation !== this.unityDispatchGeneration) {
          replay.diagnostic.unityStaleSkippedCount += 1
          allSucceeded = false
          continue
        }

        const [sceneNodeId, operation] = target
        try {
          const result = operation.kind === 'set'
            ? await this.unity.setNodeVisualState(
              sceneNodeId,
              operation.state.visualState,
              replay.snapshotSequence,
              operation.state.statusUpdatedAt,
              operation.state.sourceRevision,
            )
            : await this.unity.clearNodeVisualState(sceneNodeId, replay.snapshotSequence)
          if (result.success) {
            replay.diagnostic.unitySucceededCount += 1
            if (operation.kind === 'clear' && this.pendingClearSequenceBySceneNodeId.get(sceneNodeId) === replay.snapshotSequence) {
              this.pendingClearSequenceBySceneNodeId.delete(sceneNodeId)
            }
          } else {
            replay.diagnostic.unityFailedCount += 1
            allSucceeded = false
          }
        } catch {
          replay.diagnostic.unityFailedCount += 1
          allSucceeded = false
        }
      }
    })
    await Promise.all(workers)
    if (this.disposed) return false
    this.completeDiagnostic(replay.diagnostic)
    return allSucceeded && replay.generation === this.unityDispatchGeneration
  }

  /**
   * 释放只取消尚未发送的三维内部任务并清空诊断。
   * 已经返回给外层的二维成功不会被反向改写；在途 Unity 回执回来后也不得重新写入诊断。
   */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.frameHandle !== undefined) this.frameScheduler.cancel(this.frameHandle)
    this.frameHandle = undefined
    this.pendingBatch = undefined
    this.activeSceneActivationId = undefined
    this.pendingClearSequenceBySceneNodeId.clear()
    this.diagnostics.length = 0
  }

  /**
   * 单槽只保留最新完整快照。新快照到达时，相同目标计为同帧合并；旧快照独有目标计为过期跳过，
   * 绝不继续把已从权威快照消失的旧颜色送入 Unity。
   */
  private scheduleLatestUnitySnapshot(
    snapshotSequence: number,
    targets: ReadonlyMap<SceneNodeId, UnityNodeVisualStateOperation>,
    diagnostic: DeviceStatesBatchDiagnostic,
  ): void {
    const previous = this.pendingBatch
    if (previous) {
      for (const sceneNodeId of previous.targets.keys()) {
        if (targets.has(sceneNodeId)) previous.diagnostic.unityFrameMergedCount += 1
        else previous.diagnostic.unityStaleSkippedCount += 1
      }
      // 被整体替换的批次不会再进入工作池，必须在替换时完成其耗时摘要，不能永久停留在二维提交时点。
      this.completeDiagnostic(previous.diagnostic)
    }

    this.pendingBatch = { snapshotSequence, generation: this.unityDispatchGeneration, targets, diagnostic }
    // 工作池运行期间继续在单槽合并；上一批结束后才开启下一帧，内层待确认数始终不超过并发上限。
    if (targets.size === 0) {
      if (this.frameHandle !== undefined) this.frameScheduler.cancel(this.frameHandle)
      this.frameHandle = undefined
      this.pendingBatch = undefined
      this.completeDiagnostic(diagnostic)
      return
    }
    if (!this.unityDispatchActive && this.frameHandle === undefined) this.requestUnityFrame()
  }

  /** 帧调度器异常属于三维不可用，立即写有限诊断但不改变已经形成的外层成功。 */
  private requestUnityFrame(): void {
    try {
      this.frameHandle = this.frameScheduler.request(() => this.flushLatestUnitySnapshot())
    } catch {
      const failedBatch = this.pendingBatch
      this.pendingBatch = undefined
      if (failedBatch) {
        failedBatch.diagnostic.unityUnavailable = true
        failedBatch.diagnostic.unityFailedCount = failedBatch.targets.size
        this.completeDiagnostic(failedBatch.diagnostic)
      }
    }
  }

  /** 取走当前最新快照后启动唯一工作池；执行期间到达的新快照继续占用同一个等待槽位。 */
  private flushLatestUnitySnapshot(): void {
    this.frameHandle = undefined
    if (this.disposed || this.unityDispatchActive || !this.pendingBatch) return

    const batch = this.pendingBatch
    this.pendingBatch = undefined
    this.unityDispatchActive = true
    void this.dispatchUnitySnapshot(batch).finally(() => {
      this.unityDispatchActive = false
      if (!this.disposed && this.pendingBatch && this.frameHandle === undefined) this.requestUnityFrame()
    })
  }

  /**
   * 单份快照使用有限工作池下发。每个工作项发送前再次比较本地序号，避免等待工作池期间被新快照替代；
   * 已经发出的旧命令由 Unity 使用同一序号做最终门禁。
   */
  private async dispatchUnitySnapshot(batch: PendingUnityBatch): Promise<void> {
    if (this.disposed) return
    let supported = false
    try {
      supported = this.unity.supportsNodeVisualState()
    } catch {
      supported = false
    }
    if (!supported) {
      if (!this.disposed) {
        batch.diagnostic.unityUnavailable = true
        batch.diagnostic.unityFailedCount = batch.targets.size
        this.completeDiagnostic(batch.diagnostic)
      }
      return
    }

    const targets = [...batch.targets]
    let nextTargetIndex = 0
    const workerCount = Math.min(this.maximumConcurrentUnityCommands, targets.length)
    const workers = Array.from({ length: workerCount }, async () => {
      while (!this.disposed && nextTargetIndex < targets.length) {
        const target = targets[nextTargetIndex]
        nextTargetIndex += 1
        if (!target) continue

        // 较新完整快照已提交二维后，旧工作项不能再进入 Unity；这里只计内部过期，不触发任何外层事件。
        if (batch.snapshotSequence !== this.latestSnapshotSequence || batch.generation !== this.unityDispatchGeneration) {
          batch.diagnostic.unityStaleSkippedCount += 1
          continue
        }

        const [sceneNodeId, operation] = target
        try {
          const result = operation.kind === 'set'
            ? await this.unity.setNodeVisualState(
              sceneNodeId,
              operation.state.visualState,
              batch.snapshotSequence,
              operation.state.statusUpdatedAt,
              operation.state.sourceRevision,
            )
            : await this.unity.clearNodeVisualState(sceneNodeId, batch.snapshotSequence)
          if (result.success) {
            batch.diagnostic.unitySucceededCount += 1
            if (operation.kind === 'clear' && this.pendingClearSequenceBySceneNodeId.get(sceneNodeId) === batch.snapshotSequence) {
              this.pendingClearSequenceBySceneNodeId.delete(sceneNodeId)
            }
          } else batch.diagnostic.unityFailedCount += 1
        } catch {
          // 单节点异常只计为三维失败；不保存异常、不停止其他目标，也不反向改变二维成功。
          batch.diagnostic.unityFailedCount += 1
        }
      }
    })
    await Promise.all(workers)
    if (!this.disposed) this.completeDiagnostic(batch.diagnostic)
  }

  /** 将拓扑结果收敛为固定字段摘要；平台修订只记录数值，绝不作为接纳水位。 */
  private createDiagnostic(
    command: Extract<HostDispatchableDomainCommand, { type: 'device.states.update' }>,
    startedAt: number,
    topologyResult: TopologyNodeStateApplyResult,
  ): DeviceStatesBatchDiagnostic {
    const processedAt = this.now()
    return {
      correlationId: command.correlationId,
      snapshotSequence: topologyResult.snapshotSequence,
      sourceRevision: command.payload.sourceRevision,
      processedAt,
      elapsedMilliseconds: Math.max(0, processedAt - startedAt),
      acceptedCount: topologyResult.acceptedNodeIds.length,
      outdatedCount: topologyResult.outdatedNodeIds.length,
      unmappedCount: topologyResult.unmappedNodeIds.length,
      invalidTimestampCount: topologyResult.invalidTimestampNodeIds.length,
      // 最终值由 createUnityTargets 完成节点去重和清除债务合并后回填，禁止用两个输入集合长度相加高估目标数。
      unityTargetCount: 0,
      unitySucceededCount: 0,
      unityFailedCount: 0,
      unityStaleSkippedCount: 0,
      unityUnavailable: false,
      unityFrameMergedCount: 0,
    }
  }

  /**
   * 建立当前完整快照的最终三维操作，并同步有限清除债务。
   * 明确四态优先取消旧清除；本快照明确要求清除时再覆盖为清除操作并记录本地序号。
   */
  private createUnityTargets(result: TopologyNodeStateApplyResult): Map<SceneNodeId, UnityNodeVisualStateOperation> {
    const targets = new Map<SceneNodeId, UnityNodeVisualStateOperation>()
    result.activeSceneNodeStateUpdates.forEach((state, sceneNodeId) => {
      this.pendingClearSequenceBySceneNodeId.delete(sceneNodeId)
      targets.set(sceneNodeId, { kind: 'set', state })
    })
    result.clearedActiveSceneNodeIds.forEach((sceneNodeId) => {
      this.pendingClearSequenceBySceneNodeId.set(sceneNodeId, result.snapshotSequence)
      targets.set(sceneNodeId, { kind: 'clear' })
    })
    // Unity 暂不可用或先前清除失败时，每份新快照都以自己的更大本地序号重试清除债务。
    // 明确四态已经在上方删除同节点债务，因此不会被此循环误清除。
    this.pendingClearSequenceBySceneNodeId.forEach((_previousSequence, sceneNodeId) => {
      if (targets.has(sceneNodeId)) return
      this.pendingClearSequenceBySceneNodeId.set(sceneNodeId, result.snapshotSequence)
      targets.set(sceneNodeId, { kind: 'clear' })
    })
    return targets
  }

  /** 异步三维任务完成后只更新同一个有限摘要，不新增第二条批次记录。 */
  private completeDiagnostic(diagnostic: DeviceStatesBatchDiagnostic): void {
    const processedAt = this.now()
    diagnostic.elapsedMilliseconds += Math.max(0, processedAt - diagnostic.processedAt)
    diagnostic.processedAt = processedAt
  }

  /**
   * 物理场景实例变化后，等待动画帧或等待上一工作池结束的旧投影已失去目标控制器。
   * 将它整体记为过期并取消唯一待发帧；正在执行的批次由 generation（投递代次）在每个工作项前继续拦截。
   */
  private invalidatePendingBatchForSceneChange(): void {
    const staleBatch = this.pendingBatch
    if (!staleBatch) return
    staleBatch.diagnostic.unityStaleSkippedCount += staleBatch.targets.size
    this.pendingBatch = undefined
    if (this.frameHandle !== undefined) this.frameScheduler.cancel(this.frameHandle)
    this.frameHandle = undefined
    this.completeDiagnostic(staleBatch.diagnostic)
  }

  /** 固定长度先进先出诊断队列；只保存任务要求的有限摘要。 */
  private recordDiagnostic(diagnostic: DeviceStatesBatchDiagnostic): void {
    this.diagnostics.push(diagnostic)
    while (this.diagnostics.length > this.maximumDiagnostics) this.diagnostics.shift()
  }

  /** 释放发生在二维提交前时才允许外层失败；已提交结果不会进入本分支。 */
  private createDisposedFailure(): HostCommandExecutionResult {
    return {
      success: false,
      status: 'failed',
      error: { code: 'runtime.disposed', stage: 'disposing', message: '可视化运行时已释放，不能继续同步设备状态。', recoverable: false },
    }
  }

  /** 防御性容量失败只描述二维权威快照未提交，不把三维内部拥塞伪装为外层失败。 */
  private createCapacityFailure(): HostCommandExecutionResult {
    return {
      success: false,
      status: 'failed',
      error: { code: 'protocol.capacity.exceeded', stage: 'validation', message: '设备状态完整快照超过本地安全上限。', recoverable: true },
    }
  }

  /** 拓扑端口抛错时不能假设二维是否已部分更新，统一返回不泄露底层异常的可恢复失败。 */
  private createTopologyFailure(): HostCommandExecutionResult {
    return {
      success: false,
      status: 'failed',
      error: { code: 'action.execute.failed', stage: 'executing-action', message: '设备状态二维处理失败，当前完整快照未提交。', recoverable: true },
    }
  }
}

/** 单槽批次只保存三维投影和有限诊断引用，不保存设备号、原始消息或 Unity 对象。 */
interface PendingUnityBatch {
  snapshotSequence: number
  /** 当前物理场景控制器投递代次；与设备快照序号共同阻止跨场景误投。 */
  generation: number
  targets: ReadonlyMap<SceneNodeId, UnityNodeVisualStateOperation>
  diagnostic: DeviceStatesBatchDiagnostic
}

/**
 * 同一节点在一份完整快照中只能有一种最终操作：写入明确四态，或撤销上一份快照留下的动态覆盖。
 * 判别联合避免用空状态、特殊枚举或 `normal` 混淆两种业务语义。
 */
type UnityNodeVisualStateOperation =
  | { kind: 'set'; state: TopologySceneNodeVisualStateUpdate }
  | { kind: 'clear' }

/** 浏览器优先使用真实动画帧；非浏览器单元环境退化为零延迟计时器，仍保持异步合批语义。 */
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

/** 选项必须为安全正整数；并发上限额外受连接器容量保护。 */
function normalizePositiveSafeInteger(value: number | undefined, fallback: number, maximum: number = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback
}

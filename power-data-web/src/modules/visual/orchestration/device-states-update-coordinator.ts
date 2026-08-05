import type { HostCommandExecutionResult } from '@/host-bridge/host-command-lifecycle'
import type { HostDispatchableDomainCommand } from '@/host-bridge/host-command-dispatcher'
import type { HostProtocolError } from '@/host-bridge/host-protocol'
import type { SceneNodeId } from '@/config/scene-topology/identifiers'
import type { DeviceVisualStatus } from '@/config/scene-topology/types'
import type { TopologyDeviceStateApplyResult } from '@/modules/visual/topology/topology-device-state-cache'
import type { TopologyRuntime } from '@/modules/visual/topology/topology-runtime'

/** 当前 Unity 运行时的最小状态端口；编排层不能取得 iframe、窗口或连接器实例。 */
export interface DeviceStatesUnityPort {
  /** 只在当前 Unity 运行时已协商四态命令能力时返回 true，避免发送未声明命令。 */
  supportsNodeVisualState(): boolean
  /** 向已验证的三维节点发送单项四态并等待同一请求的最终受控回执。 */
  setNodeVisualState(sceneNodeId: SceneNodeId, visualState: DeviceVisualStatus): Promise<{ success: boolean }>
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
}

/** 协调器选项保持有限并可注入时间，测试不依赖机器时钟或异步调度时序。 */
export interface DeviceStatesUpdateCoordinatorOptions {
  maximumDiagnostics?: number
  maximumConcurrentUnityCommands?: number
  now?: () => number
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
  private readonly now: () => number

  public constructor(
    private readonly topologyRuntime: TopologyRuntime,
    private readonly unity: DeviceStatesUnityPort,
    options: DeviceStatesUpdateCoordinatorOptions = {},
  ) {
    this.maximumDiagnostics = normalizePositiveSafeInteger(options.maximumDiagnostics, 64)
    // Unity 连接器的待确认命令表上限为 64；默认八路并发在吞吐与页面资源间保留足够余量。
    this.maximumConcurrentUnityCommands = normalizePositiveSafeInteger(options.maximumConcurrentUnityCommands, 8, 64)
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * 处理已通过外层协议校验的状态命令。
   * 时间戳、同帧去重、无映射丢弃与二维状态覆盖全部委托给任务-029缓存；本类不重复扫描完整拓扑，
   * 只遍历当前活动场景已经显式映射的三维节点快照。
   */
  public async submit(command: Extract<HostDispatchableDomainCommand, { type: 'device.states.update' }>): Promise<HostCommandExecutionResult> {
    const startedAt = this.now()
    const topologyResult = this.topologyRuntime.applyDeviceStates(command.payload)
    const unityTargets = [...topologyResult.activeSceneNodeStatuses]
    const unityResult = await this.dispatchUnityStates(unityTargets)
    const diagnostic = this.createDiagnostic(command.correlationId, startedAt, topologyResult, unityTargets.length, unityResult)
    this.recordDiagnostic(diagnostic)

    if (unityTargets.length > 0 && (unityResult.unavailable || unityResult.failedCount > 0)) {
      return {
        success: false,
        status: 'failed',
        error: this.createUnityFailure(unityResult.unavailable),
      }
    }

    return { success: true, status: 'completed' }
  }

  /** 返回防御性诊断副本；调用方不能改写内部有限队列。 */
  public getDiagnostics(): readonly DeviceStatesBatchDiagnostic[] {
    return this.diagnostics.map((diagnostic) => ({ ...diagnostic }))
  }

  /** 释放诊断队列；组合根卸载后不保留外层关联标识或历史处理计数。 */
  public dispose(): void {
    this.diagnostics.length = 0
  }

  /**
   * 当前内层协议仅有单节点四态命令，故以有限工作池下发。
   * 并发度严格小于连接器 64 条待确认上限，避免一个最多 500 项的父页面批次挤占所有内层命令容量。
   */
  private async dispatchUnityStates(targets: readonly (readonly [SceneNodeId, DeviceVisualStatus])[]): Promise<UnityDispatchResult> {
    if (targets.length === 0) return { unavailable: false, succeededCount: 0, failedCount: 0 }
    if (!this.unity.supportsNodeVisualState()) return { unavailable: true, succeededCount: 0, failedCount: 0 }

    let nextTargetIndex = 0
    let succeededCount = 0
    let failedCount = 0
    const workerCount = Math.min(this.maximumConcurrentUnityCommands, targets.length)

    const workers = Array.from({ length: workerCount }, async () => {
      while (nextTargetIndex < targets.length) {
        const target = targets[nextTargetIndex]
        nextTargetIndex += 1
        if (!target) continue

        const [sceneNodeId, visualState] = target
        try {
          const result = await this.unity.setNodeVisualState(sceneNodeId, visualState)
          if (result.success) succeededCount += 1
          else failedCount += 1
        } catch {
          // 单个内层请求的异常只计为该节点失败：其余节点仍须获得本批次状态，
          // 最终再以受控失败回执告诉父页面“二维已更新、部分三维未确认”。
          // 不保存异常对象或原始消息，避免有限诊断队列泄露内层实现细节。
          failedCount += 1
        }
      }
    })
    await Promise.all(workers)
    return { unavailable: false, succeededCount, failedCount }
  }

  /** 将拓扑缓存结果收敛为有限诊断，既可审计状态丢弃，也不会保留任意设备原始状态。 */
  private createDiagnostic(
    correlationId: string,
    startedAt: number,
    topologyResult: TopologyDeviceStateApplyResult,
    unityTargetCount: number,
    unityResult: UnityDispatchResult,
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
      unitySucceededCount: unityResult.succeededCount,
      unityFailedCount: unityResult.failedCount,
      unityUnavailable: unityResult.unavailable,
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
}

/** Unity 下发统计只在当前调用栈存活，不进入长期状态仓库或协议事件。 */
interface UnityDispatchResult {
  unavailable: boolean
  succeededCount: number
  failedCount: number
}

/** 选项必须为安全正整数；并发上限额外受连接器容量保护。 */
function normalizePositiveSafeInteger(value: number | undefined, fallback: number, maximum: number = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback
}

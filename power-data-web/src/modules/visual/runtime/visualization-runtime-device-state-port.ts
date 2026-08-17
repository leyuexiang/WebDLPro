import type { SceneNodeId } from '@/config/scene-topology/identifiers'
import type { DeviceVisualStatus } from '@/config/scene-topology/types'
import type { DeviceStatesUnityPort } from '@/modules/visual/orchestration/device-states-update-coordinator'
import type { VisualizationRuntimeHostController } from '@/modules/visual/runtime/visualization-runtime-host'

/**
 * 任务-038的 Unity 状态端口适配器。
 * 它只将正式清单已映射的三维节点标识、固定四态和壳内快照序号传给宿主；能力读取与回执等待仍由宿主和连接器执行，
 * 因而协调器不能越过 iframe（内嵌网页框架）直接发送窗口消息。
 */
export class VisualizationRuntimeDeviceStatePort implements DeviceStatesUnityPort {
  public constructor(private readonly runtime: VisualizationRuntimeHostController) {}

  /**
   * 完整快照语义同时依赖四态设置和动态覆盖清除；旧运行时缺少任一能力时整体安全降级，
   * 防止设备从后续快照消失后模型永久残留旧告警颜色。
   */
  public supportsNodeVisualState(): boolean {
    return this.runtime.status.value === 'ready' &&
      this.runtime.capabilities.value.includes('setNodeVisualState') &&
      this.runtime.capabilities.value.includes('clearNodeVisualState')
  }

  /**
   * `snapshotSequence`（快照序号）由壳内权威快照缓存生成并始终必填，是唯一覆盖门禁；
   * `statusUpdatedAt`（状态时间）和 `sourceRevision`（来源修订号）仅供内层有限诊断，不参与新旧裁决。
   */
  public setNodeVisualState(
    sceneNodeId: SceneNodeId,
    visualState: DeviceVisualStatus,
    snapshotSequence: number,
    statusUpdatedAt: string,
    sourceRevision: number,
  ): Promise<{ success: boolean }> {
    return this.runtime.sendCommandAndWait('setNodeVisualState', {
      sceneNodeId,
      visualState,
      snapshotSequence,
      statusUpdatedAt,
      sourceRevision,
    })
  }

  /** 清除只传稳定节点标识和本地序号，Unity 根据场景登记恢复模型基础视觉。 */
  public clearNodeVisualState(sceneNodeId: SceneNodeId, snapshotSequence: number): Promise<{ success: boolean }> {
    return this.runtime.sendCommandAndWait('clearNodeVisualState', { sceneNodeId, snapshotSequence })
  }
}

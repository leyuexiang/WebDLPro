import type { SceneNodeId } from '@/config/scene-topology/identifiers'
import type { DeviceVisualStatus } from '@/config/scene-topology/types'
import type { DeviceStatesUnityPort } from '@/modules/visual/orchestration/device-states-update-coordinator'
import type { VisualizationRuntimeHostController } from '@/modules/visual/runtime/visualization-runtime-host'

/**
 * 任务-038的 Unity 状态端口适配器。
 * 它只将正式清单已映射的三维节点标识和固定四态传给宿主；能力读取与回执等待仍由宿主和连接器执行，
 * 因而协调器不能越过 iframe（内嵌网页框架）直接发送窗口消息。
 */
export class VisualizationRuntimeDeviceStatePort implements DeviceStatesUnityPort {
  public constructor(private readonly runtime: VisualizationRuntimeHostController) {}

  /** 只在 ready（就绪）且协商到固定四态命令时允许协调器发起内层请求。 */
  public supportsNodeVisualState(): boolean {
    return this.runtime.status.value === 'ready' && this.runtime.capabilities.value.includes('setNodeVisualState')
  }

  /**
   * 载荷由场景拓扑品牌类型、标准化时间和可选来源修订共同约束；宿主仍会执行内层校验与回执关联。
   * 内层始终发送 `hasSourceRevision + sourceRevision` 固定二元组，既保留外层可选兼容性，也让 Unity
   * 明确区分“未提供修订号”和“显式修订号为零”，避免 JSON 默认值破坏同时间覆盖语义。
   */
  public setNodeVisualState(
    sceneNodeId: SceneNodeId,
    visualState: DeviceVisualStatus,
    statusUpdatedAt: string,
    sourceRevision?: number,
  ): Promise<{ success: boolean }> {
    return this.runtime.sendCommandAndWait('setNodeVisualState', {
      sceneNodeId,
      visualState,
      statusUpdatedAt,
      hasSourceRevision: sourceRevision !== undefined,
      sourceRevision: sourceRevision ?? 0,
    })
  }
}

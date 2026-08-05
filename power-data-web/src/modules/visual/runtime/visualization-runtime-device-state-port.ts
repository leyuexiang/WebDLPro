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

  /** 载荷由场景拓扑品牌类型约束；宿主仍会在发送前执行内层协议校验和回执关联。 */
  public setNodeVisualState(sceneNodeId: SceneNodeId, visualState: DeviceVisualStatus): Promise<{ success: boolean }> {
    return this.runtime.sendCommandAndWait('setNodeVisualState', { sceneNodeId, visualState })
  }
}

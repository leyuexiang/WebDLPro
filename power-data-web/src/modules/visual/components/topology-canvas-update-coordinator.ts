import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition, TopologyDeviceStatus } from '@/config/process/types'
import type { TopologyRenderer } from '@/services/topology/topology-renderer'

/**
 * 拓扑画布更新协调器。
 * 它将定义、选择、节点状态和容器尺寸分成四条固定调用路径，避免组件观察器在选择或状态变更时
 * 误调用 setTopology（设置拓扑）并使节点索引、布局和路径缓存重新计算。
 */
export class TopologyCanvasUpdateCoordinator {
  private topologyDefinition: TopologyDefinition | undefined

  public constructor(private readonly renderer: TopologyRenderer) {}

  /** 仅当拓扑引用真正变更时更新定义；同一只读配置快照不重复重建画布缓存。 */
  public updateTopology(topology: TopologyDefinition): void {
    if (this.topologyDefinition === topology) return
    this.topologyDefinition = topology
    this.renderer.setTopology(topology)
  }

  /** 选择始终走局部高亮接口，不读取或替换当前拓扑定义。 */
  public updateSelection(nodeIds: readonly ProcessNodeId[], routeIds: readonly RouteId[]): void {
    this.renderer.setSelection(nodeIds, routeIds)
  }

  /** 节点状态快照由适配器在下一帧合并绘制，不参与拓扑缓存失效判断。 */
  public updateNodeStatuses(statusByNodeId: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>): void {
    this.renderer.setNodeStatuses(statusByNodeId)
  }

  /** 容器尺寸变化只调整画布像素缓冲和布局；状态、选择和定义均保持原值。 */
  public updateContainerSize(width: number, height: number): void {
    this.renderer.resize(width, height)
  }
}

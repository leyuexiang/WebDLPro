import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition, TopologyDeviceStatus } from '@/config/process/types'
import type { CanvasTopologyViewState } from '@/services/topology/canvas-topology-adapter'

/**
 * 多拓扑运行时取得的受控画布端口。
 *
 * 端口不暴露底层 Canvas（画布）元素、适配器实例或事件处理器，只允许替换已校验的定义、
 * 同步选择与保存/恢复视图；从而确保整个页面始终复用当前唯一画布实例。
 */
export interface TopologyCanvasController {
  setTopology(topology: TopologyDefinition): void
  setSelection(nodeIds: readonly ProcessNodeId[], routeIds: readonly RouteId[]): void
  /** 实时四态只更新当前节点图元，不能借由控制器重建拓扑定义、路径或布局缓存。 */
  setNodeStatuses(statuses: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>): void
  getViewState(): CanvasTopologyViewState | undefined
  restoreViewState(state: CanvasTopologyViewState): void
  dispose(): void
}

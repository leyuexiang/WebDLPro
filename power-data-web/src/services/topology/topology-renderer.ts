import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition } from '@/config/process/types'

/** 统一二维拓扑渲染器接口；页面组件不依赖具体 Canvas 或未来图表实现。 */
export interface TopologyRenderer {
  setTopology(topology: TopologyDefinition): void
  setSelection(nodeIds: readonly ProcessNodeId[], routeIds: readonly RouteId[]): void
  resize(width: number, height: number): void
  pickNodeAt(x: number, y: number): ProcessNodeId | undefined
  dispose(): void
}

import { toProcessNodeId, toRouteId } from '@/config/process/identifiers'
import type { ProcessNodeId, RouteId as ProcessRouteId } from '@/config/process/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { projectTopologyForCanvas } from '@/config/scene-topology/topology-canvas-projection'
import type { NodeId, RouteId } from '@/config/scene-topology/identifiers'
import type { DeviceVisualStatus } from '@/config/scene-topology/types'
import type { TopologyCanvasController } from '@/modules/visual/components/topology-canvas-controller'
import type { TopologyCanvasPort, TopologyViewState } from '@/modules/visual/topology/topology-runtime'

/**
 * 正式场景拓扑运行时到既有单画布的受控适配端口。
 *
 * 新旧模型的转换只允许出现在这里：正式清单经过已存在的投影器变成旧画布输入，
 * 选择标识仅做受控品牌类型转换。端口绝不根据名称、坐标或图元键补充设备、三维节点或路径映射。
 */
export class ManifestTopologyCanvasPort implements TopologyCanvasPort {
  public constructor(
    private readonly canvas: TopologyCanvasController,
    private readonly onTopologyProjected: (topology: ReturnType<typeof projectTopologyForCanvas>) => void = () => undefined,
    private readonly onSelectionChanged: (nodeIds: readonly ProcessNodeId[], routeIds: readonly ProcessRouteId[]) => void = () => undefined,
    /** 运行时状态通过 Vue（渐进式网页框架）属性同步到唯一画布，避免端口和观察器重复写入同一状态快照。 */
    private readonly onNodeStatusesChanged: (statuses: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>) => void = () => undefined,
  ) {}

  /** 将已校验的正式拓扑投影到同一画布；组件不会因此创建新的 Canvas（画布）或图元缓存。 */
  public setTopology(topology: Parameters<TopologyCanvasPort['setTopology']>[0]): void {
    const projectedTopology = projectTopologyForCanvas(topology)

    // 先更新组件声明值，再写当前画布：Vue（渐进式网页框架）下一轮属性同步会复用同一对象引用，
    // 因而不会把同一拓扑再次视为新定义并重建节点索引与路径缓存。
    this.onTopologyProjected(projectedTopology)
    this.canvas.setTopology(projectedTopology)
  }

  /** 将运行时稳定标识转换为旧画布的品牌类型；值本身不变，避免通过字符串重组产生猜测映射。 */
  public setSelection(nodeIds: readonly NodeId[], routeIds: readonly RouteId[]): void {
    const projectedNodeIds = nodeIds.map((nodeId) => toProcessNodeId(String(nodeId)))
    const projectedRouteIds = routeIds.map((routeId) => toRouteId(String(routeId)))

    // 先同步 Vue（渐进式网页框架）声明值，再写画布，确保稍后的属性重渲染不会把运行时刚恢复的选择清空。
    this.onSelectionChanged(projectedNodeIds, projectedRouteIds)
    this.canvas.setSelection(projectedNodeIds, projectedRouteIds)
  }

  /**
   * 将正式节点状态投影为旧画布品牌标识后交给组件声明值。
   * 调用方传入的映射会复制，Vue 后续属性观察器才是唯一实际画布写入路径，避免一批状态产生两次遍历与两次绘制调度。
   */
  public setNodeStatuses(statuses: ReadonlyMap<NodeId, DeviceVisualStatus>): void {
    const projectedStatuses = new Map<ProcessNodeId, TopologyDeviceStatus>()
    for (const [nodeId, deviceStatus] of statuses) {
      projectedStatuses.set(toProcessNodeId(String(nodeId)), deviceStatus)
    }
    this.onNodeStatusesChanged(projectedStatuses)
  }

  /**
   * 旧画布只保存缩放和平移；节点与路径选择会由 TopologyRuntime（拓扑运行时）在恢复视图后单独下发。
   * 这样切换流程不会在两个入口各写一次选择，避免迟到选择覆盖当前事务。
   */
  public restoreViewState(state: TopologyViewState): void {
    this.canvas.restoreViewState({ zoom: state.zoom, offsetX: state.offsetX, offsetY: state.offsetY })
  }

  /** 运行时释放时同步释放唯一画布端口；组件卸载再次调用也是幂等的。 */
  public dispose(): void {
    this.canvas.dispose()
  }
}

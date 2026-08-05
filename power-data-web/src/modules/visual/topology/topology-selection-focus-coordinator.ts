import type { SceneNodeId } from '@/config/scene-topology/identifiers'
import type { VisualizationSelectionSource } from '@/modules/visual/orchestration/visualization.store'

/** 三维聚焦端口只允许暴露能力查询与受控异步聚焦，不能让拓扑组件取得 iframe 或连接器。 */
export interface TopologyFocusPort {
  supportsFocusNode(): boolean
  focusNode(sceneNodeId: SceneNodeId): Promise<{ success: boolean }>
}

/** 单击聚焦请求只保存稳定来源、关联标识和显式三维节点，不携带 Canvas 坐标、标题或模型路径。 */
export interface TopologySelectionFocusRequest {
  source: VisualizationSelectionSource
  correlationId: string
  sceneNodeId?: SceneNodeId
}

/**
 * 拓扑单击到三维聚焦的受控协调器。
 * 最近关联标识采用固定容量，防止双击派生单击、浏览器重放或未来 Unity 回写造成重复 focusNode（聚焦节点）命令。
 */
export class TopologySelectionFocusCoordinator {
  private readonly handledCorrelationIds = new Map<string, true>()

  public constructor(
    private readonly focusPort: TopologyFocusPort,
    private readonly maximumHandledCorrelations: number = 64,
  ) {}

  /**
   * 只有二维拓扑来源可以向三维聚焦；Unity 来源只同步二维选中，绝不向 Unity 回写，阻断选择回环。
   * 缺少显式三维节点、能力未协商或同一关联标识重复时均无副作用，且不会影响已提交的二维选择。
   */
  public async requestFocus(request: TopologySelectionFocusRequest): Promise<boolean> {
    if (request.source !== 'topology' || !request.sceneNodeId || !this.focusPort.supportsFocusNode()) return false
    if (this.handledCorrelationIds.has(request.correlationId)) return false

    this.rememberCorrelation(request.correlationId)
    const result = await this.focusPort.focusNode(request.sceneNodeId)
    return result.success
  }

  /** Map 插入顺序作为最近使用顺序；容量达到上限时仅删除最早关联，不保存无限历史或 Promise。 */
  private rememberCorrelation(correlationId: string): void {
    this.handledCorrelationIds.delete(correlationId)
    this.handledCorrelationIds.set(correlationId, true)
    while (this.handledCorrelationIds.size > this.maximumHandledCorrelations) {
      const oldestCorrelationId = this.handledCorrelationIds.keys().next().value
      if (!oldestCorrelationId) return
      this.handledCorrelationIds.delete(oldestCorrelationId)
    }
  }
}

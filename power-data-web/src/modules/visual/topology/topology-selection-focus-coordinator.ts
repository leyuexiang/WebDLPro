import type { SceneNodeId, SelectionId } from '@/config/scene-topology/identifiers'
import type { VisualizationSelectionSource } from '@/modules/visual/orchestration/visualization.store'

/** 三维聚焦端口只允许暴露能力查询与受控异步聚焦，不能让拓扑组件取得 iframe 或连接器。 */
export interface TopologyFocusPort {
  supportsFocusNode(): boolean
  focusNode(sceneNodeId: SceneNodeId, selectionId: SelectionId): Promise<{ success: boolean }>
  supportsClearSelection(): boolean
  clearSelection(): Promise<{ success: boolean }>
}

/** 单击聚焦请求只保存稳定来源、关联标识和显式三维节点，不携带 Canvas 坐标、标题或模型路径。 */
export interface TopologySelectionFocusRequest {
  source: VisualizationSelectionSource
  selectionId: SelectionId
  sceneNodeId?: SceneNodeId
}

/**
 * 拓扑单击到三维聚焦的受控协调器。
 * 最近关联标识采用固定容量，防止双击派生单击、浏览器重放或未来 Unity 回写造成重复 focusNode（聚焦节点）命令。
 */
export class TopologySelectionFocusCoordinator {
  private readonly handledSelectionIds = new Map<SelectionId, true>()
  private disposed = false

  public constructor(
    private readonly focusPort: TopologyFocusPort,
    private readonly maximumHandledCorrelations: number = 64,
  ) {}

  /**
   * 只有二维拓扑来源可以影响三维选中；Unity 来源只同步二维选中，绝不向 Unity 回写，阻断选择回环。
   * 未绑定三维节点的二维图元不能让上一枚三维高亮残留，因此改为发送最小 clearSelection（清除选择）命令；
   * 能力未协商或同一关联标识重复时不发送聚焦，且始终不会影响已提交的二维选择。
   */
  public async requestFocus(request: TopologySelectionFocusRequest): Promise<boolean> {
    if (this.disposed || request.source !== 'topology') return false
    if (!request.sceneNodeId) return this.requestClearSelection()
    if (!this.focusPort.supportsFocusNode()) return false
    if (this.handledSelectionIds.has(request.selectionId)) return false

    this.rememberSelection(request.selectionId)
    const result = await this.focusPort.focusNode(request.sceneNodeId, request.selectionId)
    return result.success
  }

  /**
   * 仅请求 Unity 清除当前交互选中描边，不重置场景、流程、显隐或镜头。
   * 空白点击时二维选择已经先行提交，三维失败只返回 false，不回滚二维状态。
   */
  public async requestClearSelection(): Promise<boolean> {
    if (this.disposed || !this.focusPort.supportsClearSelection()) return false
    const result = await this.focusPort.clearSelection()
    return result.success
  }

  /** 组件释放后清空固定容量历史；迟到异步结果只返回给原调用方，不再保留协调器状态。 */
  public dispose(): void {
    this.disposed = true
    this.handledSelectionIds.clear()
  }

  /** Map 插入顺序作为最近使用顺序；容量达到上限时仅删除最早选择，不保存无限历史或 Promise。 */
  private rememberSelection(selectionId: SelectionId): void {
    this.handledSelectionIds.delete(selectionId)
    this.handledSelectionIds.set(selectionId, true)
    while (this.handledSelectionIds.size > this.maximumHandledCorrelations) {
      const oldestSelectionId = this.handledSelectionIds.keys().next().value
      if (!oldestSelectionId) return
      this.handledSelectionIds.delete(oldestSelectionId)
    }
  }
}

import type { CanvasTopologyViewState } from '@/services/topology/canvas-topology-adapter'
import type { TopologyKey } from '@/config/process/identifiers'

/** 下钻关闭原因决定旧画布快照能否继续用于当前画布。 */
export type TopologyDrilldownCloseReason = 'regular-close' | 'topology-change'

/** 快照绑定捕获时的拓扑标识，异步刷新后仅允许恢复到同一拓扑。 */
export interface TopologyDrilldownCanvasViewSnapshot {
  topologyKey: TopologyKey
  viewState: CanvasTopologyViewState
}

/**
 * 管理一次下钻会话持有的正式画布视图快照。
 * 普通关闭会消费并返回快照；拓扑切换会直接丢弃快照，防止异步关闭流程把旧拓扑坐标恢复到新拓扑。
 * 快照只保留一份且在结束时立即清空，避免重复关闭或组件长期运行时持有无效状态。
 */
export class TopologyDrilldownCanvasViewSession {
  private savedSnapshot: TopologyDrilldownCanvasViewSnapshot | undefined

  /** 打开下钻时把正式画布数值快照绑定到当前拓扑；画布尚未就绪时保持为空。 */
  public capture(topologyKey: TopologyKey, viewState: CanvasTopologyViewState | undefined): void {
    this.savedSnapshot = viewState ? { topologyKey, viewState } : undefined
  }

  /**
   * 结束会话并消费快照。
   * 只有普通关闭返回快照供调用方恢复；拓扑变化意味着画布上下文已经失效，必须返回空值。
   */
  public finish(reason: TopologyDrilldownCloseReason): TopologyDrilldownCanvasViewSnapshot | undefined {
    const snapshot = reason === 'regular-close' ? this.savedSnapshot : undefined
    this.savedSnapshot = undefined
    return snapshot
  }

  /** 组件卸载时清理未完成会话，不触发任何画布副作用。 */
  public clear(): void {
    this.savedSnapshot = undefined
  }
}

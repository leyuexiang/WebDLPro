import { isOverviewSceneId } from '@/config/scene-topology/identifiers'
import type { VisualizationRuntimeStatus } from '@/modules/visual/orchestration/visualization.store'
import type { VisualizationCoordinatorSnapshot } from '@/modules/visual/orchestration/visualization-coordinator'

/**
 * 事务遮罩只读取协调器快照中证明“当前事务仍在进行”的最小字段。
 * 它不展示场景、拓扑、动作或事务标识，避免把尚未提交的业务目标提前暴露给用户界面。
 */
type VisualizationTransitionOverlaySource = Pick<
  VisualizationCoordinatorSnapshot,
  'activeTransitionId' | 'targetSceneId' | 'targetTopologyId' | 'runtimeStatus'
>

/** 壳层渲染所需的脱敏遮罩模型；不携带进度或业务目标，避免把伪实时反馈展示给用户。 */
export interface VisualizationTransitionOverlayState {
  readonly visible: boolean
}

/** 只有准备和切换阶段可触发事务遮罩；其他运行阶段永远不能复用这类交互阻断。 */
function isTransitioningStatus(status: VisualizationRuntimeStatus): boolean {
  return status === 'preparing' || status === 'switching'
}

/**
 * 将可序列化事务状态收敛为可访问界面的遮罩状态。
 * 事务标识和场景、拓扑目标必须同时存在，防止迟到清理或不完整状态导致旧页面被错误锁定。
 */
export function getVisualizationTransitionOverlayState(
  source: VisualizationTransitionOverlaySource,
): VisualizationTransitionOverlayState {
  const hasActiveTarget = source.activeTransitionId !== null
    && source.targetSceneId !== null
    && (isOverviewSceneId(source.targetSceneId)
      ? source.targetTopologyId === null
      : source.targetTopologyId !== null)

  if (!hasActiveTarget || !isTransitioningStatus(source.runtimeStatus)) {
    return { visible: false }
  }

  // 进度事件仍由协调器保存并写入控制台，但页面只呈现无数值的遮挡层，避免伪造加载百分比。
  return { visible: true }
}

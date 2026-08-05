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

/** 壳层渲染所需的脱敏遮罩模型；隐藏时消息为空，避免无效实时播报。 */
export interface VisualizationTransitionOverlayState {
  readonly visible: boolean
  readonly message: string
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
    && source.targetTopologyId !== null

  if (!hasActiveTarget || !isTransitioningStatus(source.runtimeStatus)) {
    return { visible: false, message: '' }
  }

  return {
    visible: true,
    message: source.runtimeStatus === 'preparing'
      ? '正在准备拓扑视图，请稍候。'
      : '正在切换三维场景与拓扑，请稍候。',
  }
}

import type { VisualizationRuntimeStatus, VisualizationSceneLoadProgress } from '@/modules/visual/orchestration/visualization.store'
import type { VisualizationCoordinatorSnapshot } from '@/modules/visual/orchestration/visualization-coordinator'

/**
 * 事务遮罩只读取协调器快照中证明“当前事务仍在进行”的最小字段。
 * 它不展示场景、拓扑、动作或事务标识，避免把尚未提交的业务目标提前暴露给用户界面。
 */
type VisualizationTransitionOverlaySource = Pick<
  VisualizationCoordinatorSnapshot,
  'activeTransitionId' | 'targetSceneId' | 'targetTopologyId' | 'runtimeStatus' | 'sceneLoadProgress'
>

/** 壳层渲染所需的脱敏遮罩模型；隐藏时消息为空，避免无效实时播报。 */
export interface VisualizationTransitionOverlayState {
  readonly visible: boolean
  readonly message: string
  /** 仅在 Unity 已回传有效阶段进度时显示，null 表示仍等待第一条受控反馈。 */
  readonly progressPercent: number | null
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
    return { visible: false, message: '', progressPercent: null }
  }

  // 旧只读快照适配器可能尚未包含该字段；缺失时与显式 null 一样，继续显示无百分比的安全遮罩。
  const sceneProgress = source.runtimeStatus === 'switching' ? source.sceneLoadProgress ?? null : null
  return {
    visible: true,
    message: source.runtimeStatus === 'preparing'
      ? '正在准备拓扑视图，请稍候。'
      : getSceneSwitchMessage(sceneProgress),
    progressPercent: sceneProgress ? Math.round(sceneProgress.progress * 100) : null,
  }
}

/**
 * 阶段名称只说明当前切换工作，不携带目标场景、拓扑、事务或 Unity 资源信息。
 * 这样用户能获得真实加载反馈，同时未提交目标仍不会成为可操作或可枚举的业务视图。
 */
function getSceneSwitchMessage(progress: VisualizationSceneLoadProgress | null): string {
  if (!progress) return '正在切换三维场景与拓扑，请稍候。'

  const percent = Math.round(progress.progress * 100)
  switch (progress.stageCode) {
    case 'unloading-scene':
      return `正在卸载当前三维场景（${percent}%），请稍候。`
    case 'loading-scene':
      return `正在加载目标三维场景（${percent}%），请稍候。`
    case 'initializing-scene':
      return `正在初始化目标三维场景（${percent}%），请稍候。`
    case 'restoring-scene':
      return `正在恢复上一稳定三维场景（${percent}%），请稍候。`
  }
}

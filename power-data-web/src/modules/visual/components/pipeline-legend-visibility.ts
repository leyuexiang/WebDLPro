import {
  isBusinessVisualizationStableContext,
  type VisualizationRuntimeStatus,
  type VisualizationStableContext,
} from '@/modules/visual/orchestration/visualization.store'

/**
 * 管线图例只属于已经稳定提交的第二层业务场景。
 * 使用稳定上下文类型判断而不是场景名称白名单，使九个现有业务场景和后续仍属于第二层的场景自动复用；
 * 第一层沙盘、第三层关键环节及切换中的旧画面均不会误显示图例。
 */
export function shouldShowPipelineLegend(
  runtimeStatus: VisualizationRuntimeStatus,
  stableContext: VisualizationStableContext | null,
): boolean {
  return runtimeStatus === 'ready'
    && stableContext !== null
    && isBusinessVisualizationStableContext(stableContext)
}

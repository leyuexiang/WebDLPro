import {
  isBusinessVisualizationStableContext,
  type VisualizationRuntimeStatus,
  type VisualizationStableContext,
} from '@/modules/visual/orchestration/visualization.store'

/**
 * 管线图例资源的业务语义。图例始终由公共三维容器渲染，场景层仅决议应使用的已发布资源，
 * 从而避免燃煤稳定上下文短暂沿用或回退到燃气图例。
 */
export type PipelineLegendVariant = 'coal' | 'gas'

/**
 * 解析已提交第二层业务场景应使用的管线图例资源。
 * 第一层沙盘、第三层关键环节及切换中的旧画面返回空值，调用方不会创建图例节点；
 * 燃煤必须显式映射为燃煤资源，其余当前已发布第二层场景继续复用既有燃气资源，
 * 以保持本次修复只替换燃煤场景且不改变其他业务场景的既有展示。
 */
export function resolvePipelineLegendVariant(
  runtimeStatus: VisualizationRuntimeStatus,
  stableContext: VisualizationStableContext | null,
): PipelineLegendVariant | null {
  if (
    runtimeStatus !== 'ready'
    || stableContext === null
    || !isBusinessVisualizationStableContext(stableContext)
  ) return null

  // 只在统一入口识别燃煤稳定标识，组件本身不读取场景名，确保普通与全屏视图使用同一份判定结果。
  return stableContext.sceneId === 'coal-power' ? 'coal' : 'gas'
}

import {
  isBusinessVisualizationStableContext,
  type VisualizationRuntimeStatus,
  type VisualizationStableContext,
} from '@/modules/visual/orchestration/visualization.store'

/**
 * 管线图例资源的业务语义。图例始终由公共三维容器渲染，场景层仅决议应使用的已发布资源，
 * 从而避免燃煤稳定上下文短暂沿用或回退到燃气图例。
 * elec 为电力场景通用图例（蓝色代表电线、绿色代表控制线），覆盖燃煤与燃气以外的全部业务场景。
 */
export type PipelineLegendVariant = 'coal' | 'gas' | 'elec'

/**
 * 解析已提交第二层业务场景应使用的管线图例资源。
 * 第一层沙盘、第三层关键环节及切换中的旧画面返回空值，调用方不会创建图例节点；
 * 燃煤与燃气各自显式映射为专属资源，其余已发布第二层场景统一使用电力场景通用图例。
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

  // 只在统一入口按稳定标识显式映射，组件本身不读取场景名，确保普通与全屏视图使用同一份判定结果。
  if (stableContext.sceneId === 'coal-power') return 'coal'
  if (stableContext.sceneId === 'gas-power') return 'gas'
  return 'elec'
}

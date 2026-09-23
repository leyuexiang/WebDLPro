import type { InjectionKey } from 'vue'
import type {
  VisualizationCoordinator,
  VisualizationCoordinatorResult,
  VisualizationCoordinatorSnapshot,
  VisualizationDomainCommand,
} from '@/modules/visual/orchestration/visualization-coordinator'

/**
 * 组件、外层桥和 Unity 事件适配器可见的最小门面。
 * 门面不公开协调器实例、Pinia 仓库或状态写方法，只允许提交领域命令和读取防御性快照。
 */
export interface VisualizationCoordinatorFacade {
  submit(command: VisualizationDomainCommand): VisualizationCoordinatorResult
  getSnapshot(): VisualizationCoordinatorSnapshot
}

/**
 * 创建冻结门面，防止运行时调用方替换 submit/getSnapshot 实现。
 * 方法通过闭包转发，调用方即使解构函数也不会丢失协调器实例上下文。
 */
export function createVisualizationCoordinatorFacade(coordinator: VisualizationCoordinator): VisualizationCoordinatorFacade {
  return Object.freeze({
    submit: (command: VisualizationDomainCommand) => coordinator.submit(command),
    getSnapshot: () => coordinator.getSnapshot(),
  })
}

/** Vue 组件只能注入受控门面；禁止把状态仓库或协调器写端口注册到依赖注入树。 */
export const visualizationCoordinatorFacadeKey: InjectionKey<VisualizationCoordinatorFacade> = Symbol('visualization-coordinator-facade')

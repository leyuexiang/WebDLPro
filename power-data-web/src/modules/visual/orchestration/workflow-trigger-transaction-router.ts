import type { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import type { HostCommandExecutionResult } from '@/host-bridge/host-command-lifecycle'
import type { HostDispatchableDomainCommand } from '@/host-bridge/host-command-dispatcher'
import type { VisualizationCoordinatorFacade } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import type { WorkflowTriggerTransactionHandler } from '@/modules/visual/orchestration/workflow-trigger-transaction-handler'

/**
 * 只按“动作显式目标场景是否等于当前稳定场景”路由流程触发。
 * 不按标题、流程名称、按钮来源或 Unity 场景名猜测范围；具体校验仍由两个范围处理器各自复核。
 */
export class WorkflowTriggerTransactionRouter {
  public constructor(
    private readonly registry: TopologyRegistry,
    private readonly coordinator: VisualizationCoordinatorFacade,
    private readonly sameScene: Pick<WorkflowTriggerTransactionHandler, 'submit'> & Partial<Pick<WorkflowTriggerTransactionHandler, 'cancelTimedOutCommand'>>,
    private readonly crossScene: Pick<WorkflowTriggerTransactionHandler, 'submit'> & Partial<Pick<WorkflowTriggerTransactionHandler, 'cancelTimedOutCommand'>>,
  ) {}

  /** 当前没有稳定上下文或动作未登记时交给同场景处理器返回统一受控错误，不在路由层复制错误构造。 */
  public async submit(command: Extract<HostDispatchableDomainCommand, { type: 'workflow.trigger' }>): Promise<HostCommandExecutionResult> {
    const action = this.registry.getAction(command.payload.actionId)
    const currentSceneId = this.coordinator.getSnapshot().stableContext?.sceneId
    if (!action || !currentSceneId || action.targetSceneId === currentSceneId) return this.sameScene.submit(command)
    return this.crossScene.submit(command)
  }

  /**
   * 超时清理必须沿着与 submit 相同的两条处理器路径传播。
   * 两个处理器内部均按关联标识做常数时间查找；向二者广播不会根据动作标题或当前场景猜测原事务去向。
   */
  public cancelTimedOutCommand(correlationId: string): void {
    this.sameScene.cancelTimedOutCommand?.(correlationId)
    this.crossScene.cancelTimedOutCommand?.(correlationId)
  }
}

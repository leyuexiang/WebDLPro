import type { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import type { HostCommandExecutionResult } from '@/host-bridge/host-command-lifecycle'
import type { HostDispatchableDomainCommand } from '@/host-bridge/host-command-dispatcher'
import type { HostProtocolError, WorkflowTriggerPayload } from '@/host-bridge/host-protocol'
import type { VisualizationCoordinatorFacade } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import type { ViewOpenTransactionHandler } from '@/modules/visual/orchestration/view-open-transaction-handler'

/** 流程触发处理器可以明确限定为同场景或跨场景，防止组合根把两类动作混入同一隐式分支。 */
export type WorkflowTriggerScope = 'same-scene' | 'cross-scene'

/**
 * `workflow.trigger`（流程触发）事务处理器。
 * 它只把已登记动作投影成现有 `view.open` 原子事务，不能直接写状态、调用画布、发送窗口消息或释放 Unity。
 */
export class WorkflowTriggerTransactionHandler {
  public constructor(
    private readonly registry: TopologyRegistry,
    private readonly viewOpen: Pick<ViewOpenTransactionHandler, 'submit'>,
    private readonly coordinator: VisualizationCoordinatorFacade,
    private readonly scope: WorkflowTriggerScope = 'same-scene',
  ) {}

  /** 仅接收已由外层分派器校验过的流程触发意图；跨场景动作留给任务-035的专用路径处理。 */
  public async submit(command: HostDispatchableDomainCommand): Promise<HostCommandExecutionResult> {
    if (command.type !== 'workflow.trigger') {
      return this.failure('action.execute.failed', 'executing-action', '当前流程动作处理器只接收流程触发命令。')
    }

    return this.trigger(command.payload, command.correlationId)
  }

  /**
   * 动作、稳定上下文和参数均在这里做最终交叉校验。
   * 即使外层载荷已通过协议格式校验，也不能据此推断动作目标场景、拓扑或 Unity 参数绑定。
   */
  private async trigger(payload: WorkflowTriggerPayload, correlationId: string): Promise<HostCommandExecutionResult> {
    const action = this.registry.getAction(payload.actionId)
    if (!action) return this.failure('action.unknown', 'validation', '流程动作未在当前原子清单中登记。')

    const snapshot = this.coordinator.getSnapshot()
    const currentContext = snapshot.stableContext
    if (!currentContext || snapshot.runtimeStatus !== 'ready') {
      return this.failure('action.execute.failed', 'validation', '当前不存在可执行同场景流程动作的稳定视图。')
    }
    const isSameScene = action.targetSceneId === currentContext.sceneId
    if (this.scope === 'same-scene' && !isSameScene) {
      return this.failure('action.context.mismatch', 'validation', '流程动作目标不属于当前业务场景，已交由跨场景动作路径处理。')
    }
    if (this.scope === 'cross-scene' && isSameScene) {
      return this.failure('action.context.mismatch', 'validation', '流程动作目标已是当前业务场景，不能误走跨场景动作路径。')
    }

    const parameters = payload.parameters ?? {}
    const parameterNames = Object.keys(parameters)
    if (!parameterNames.every((name) => action.allowedParameters.includes(name))) {
      return this.failure('action.context.mismatch', 'validation', '流程动作包含当前清单未声明的参数。')
    }
    if (parameterNames.length > 0) {
      /*
       * 当前原子动作模型尚未定义“外层参数 → Unity 白名单字段”的显式映射。
       * 即使参数名称被动作登记，也不能按名称猜测其应写入流程、节点、路径或状态命令，因此拒绝而非静默忽略。
       */
      return this.failure('action.execute.failed', 'validation', '流程动作参数尚未配置到 Unity 受控字段映射。')
    }

    /*
     * 复用唯一原子处理器：同场景时其不会发送 switchScene；跨场景时严格按“预解析 → 切场景 → 动作 → 激活 → 提交”推进。
     * 两种范围都不会触发运行时释放或重新下载，且旧事务取代、超时和失败恢复继续由同一处理器统一治理。
     */
    return this.viewOpen.submit({
      type: 'view.open',
      correlationId,
      payload: {
        sceneId: action.targetSceneId,
        topologyId: action.targetTopologyId,
        actionId: action.actionId,
        expectedContextRevision: payload.expectedContextRevision ?? currentContext.contextRevision,
      },
    })
  }

  /** 统一返回协议许可的有限失败，不包含参数值、原始外层载荷或 Unity 内部错误。 */
  private failure(code: HostProtocolError['code'], stage: HostProtocolError['stage'], message: string): HostCommandExecutionResult {
    return {
      success: false,
      status: 'failed',
      error: { code, stage, message, recoverable: true },
    }
  }
}

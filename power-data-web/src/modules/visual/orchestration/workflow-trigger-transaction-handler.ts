import type { SceneActivationId } from '@/config/scene-topology/identifiers'
import type { ActionDefinition } from '@/config/scene-topology/types'
import type { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import type { HostCommandExecutionResult } from '@/host-bridge/host-command-lifecycle'
import type { HostDispatchableDomainCommand } from '@/host-bridge/host-command-dispatcher'
import type { HostProtocolError, WorkflowTriggerPayload } from '@/host-bridge/host-protocol'
import type { VisualizationCoordinatorFacade } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import type { ViewOpenTransactionHandler } from '@/modules/visual/orchestration/view-open-transaction-handler'
import type { ProcessDetailTransactionHandler } from '@/modules/visual/orchestration/process-detail-transaction-handler'
import { isProcessDetailVisualizationStableContext } from '@/modules/visual/orchestration/visualization.store'

/** 跨场景进入关键环节前，必须等待最新权威设备状态完成向目标物理场景的重放。 */
export type CrossSceneProcessDetailStateSynchronizer = (sceneActivationId?: SceneActivationId) => Promise<boolean>

/** 跨场景流程动作在两个内部阶段之间仍受同一外层关联标识约束，超时后不得继续启动关键环节。 */
interface ActiveCrossSceneProcessDetailTransition {
  cancelled: boolean
}

/** 流程触发处理器可以明确限定为同场景或跨场景，防止组合根把两类动作混入同一隐式分支。 */
export type WorkflowTriggerScope = 'same-scene' | 'cross-scene'

/**
 * `workflow.trigger`（流程触发）事务处理器。
 * 它将已登记动作投影到现有视图与关键环节事务；跨场景第三层会先建立目标业务场景，
 * 但不能直接写状态、调用画布、发送窗口消息或释放 Unity。
 */
export class WorkflowTriggerTransactionHandler {
  /** 只保存当前跨场景关键环节命令的取消标记；外层生命周期容量固定，记录会在异步入口结束后立即删除。 */
  private readonly activeCrossSceneProcessDetails = new Map<string, ActiveCrossSceneProcessDetailTransition>()

  public constructor(
    private readonly registry: TopologyRegistry,
    private readonly viewOpen: Pick<ViewOpenTransactionHandler, 'submit'>,
    private readonly coordinator: VisualizationCoordinatorFacade,
    private readonly scope: WorkflowTriggerScope = 'same-scene',
    private readonly processDetail?: Pick<ProcessDetailTransactionHandler, 'submit' | 'cancelTimedOutCommand'>,
    private readonly synchronizeCrossSceneProcessDetailState: CrossSceneProcessDetailStateSynchronizer = async () => true,
  ) {}

  /**
   * 旧的视图打开事务由其自身端口处理超时；本处理器只转发第三层独立资源事务。
   * 未登记关键环节的流程处理器保持空操作，不会凭动作名称猜测需要释放的 Unity 资源。
   */
  public cancelTimedOutCommand(correlationId: string): void {
    const activeCrossSceneProcessDetail = this.activeCrossSceneProcessDetails.get(correlationId)
    if (activeCrossSceneProcessDetail) activeCrossSceneProcessDetail.cancelled = true
    this.processDetail?.cancelTimedOutCommand(correlationId)
  }

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

    /**
     * 第三层动作和从第三层返回的业务动作统一交给独立事务处理器。
     * 跨场景进入关键环节时，必须先复用受控 view.open 建立目标业务场景和默认拓扑，
     * 再等待最新状态重放，最后进入第三层；外层仍只会在整个 workflow.trigger 成功后发布一次稳定视图事件。
     */
    if (action.targetViewMode === 'process-detail' || isProcessDetailVisualizationStableContext(currentContext)) {
      if (!this.processDetail) return this.failure('protocol.capability.undeclared', 'validation', '当前发布未接入关键环节事务能力。')
      if (action.targetViewMode === 'process-detail' && this.scope === 'cross-scene') {
        return this.enterCrossSceneProcessDetail(action, payload, correlationId, currentContext.contextRevision)
      }
      return this.processDetail.submit({ type: 'workflow.trigger', correlationId, payload })
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

  /**
   * 跨场景关键环节不能直接调用只接受当前活动业务控制器的 Unity 命令。
   * 这里先进入目标场景默认拓扑，确认目标控制器和物理场景实例已稳定，再阻塞式重放最新设备状态，
   * 最后把同一外层动作交给现有第三层两阶段事务；不复制场景切换、拓扑激活或关键环节资源逻辑。
   */
  private async enterCrossSceneProcessDetail(
    action: Extract<ActionDefinition, { targetViewMode: 'process-detail' }>,
    payload: WorkflowTriggerPayload,
    correlationId: string,
    expectedContextRevision: number,
  ): Promise<HostCommandExecutionResult> {
    const targetScene = this.registry.getScene(action.targetSceneId)
    if (!targetScene) return this.failure('scene.unknown', 'validation', '关键环节所属业务场景未在当前原子清单中登记。')

    const active: ActiveCrossSceneProcessDetailTransition = { cancelled: false }
    this.activeCrossSceneProcessDetails.set(correlationId, active)
    try {
      const opened = await this.viewOpen.submit({
        type: 'view.open',
        correlationId,
        payload: {
          sceneId: targetScene.sceneId,
          topologyId: targetScene.defaultTopologyId,
          expectedContextRevision,
        },
      })
      if (!opened.success) return opened
      if (active.cancelled) return this.superseded(opened.transitionId)

      const targetSnapshot = this.coordinator.getSnapshot()
      const targetContext = targetSnapshot.stableContext
      if (
        !targetContext
        || targetSnapshot.runtimeStatus !== 'ready'
        || !('topologyId' in targetContext)
        || targetContext.sceneId !== targetScene.sceneId
        || targetContext.topologyId !== targetScene.defaultTopologyId
      ) {
        return this.failure('action.execute.failed', 'switching-scene', '目标业务场景未形成可进入关键环节的稳定上下文。')
      }

      let synchronized = false
      try {
        synchronized = await this.synchronizeCrossSceneProcessDetailState(targetSnapshot.sceneActivationId ?? undefined)
      } catch {
        synchronized = false
      }
      if (active.cancelled) return this.superseded(opened.transitionId)
      if (!synchronized) {
        return this.failure('action.execute.failed', 'executing-action', '目标业务场景未能在进入关键环节前完成最新设备状态重放。')
      }

      return this.processDetail!.submit({
        type: 'workflow.trigger',
        correlationId,
        payload: {
          ...payload,
          // 场景准备阶段已经提交一次内部稳定上下文，第三层必须基于该最新版本取得提交权。
          expectedContextRevision: targetContext.contextRevision,
        },
      })
    } finally {
      if (this.activeCrossSceneProcessDetails.get(correlationId) === active) {
        this.activeCrossSceneProcessDetails.delete(correlationId)
      }
    }
  }

  /** 超时或新命令取代跨场景准备后，旧调用只能返回已取代，不能继续启动第三层资源事务。 */
  private superseded(transitionId?: HostCommandExecutionResult['transitionId']): HostCommandExecutionResult {
    return {
      success: false,
      status: 'superseded',
      ...(transitionId ? { transitionId } : {}),
      error: { code: 'command.superseded', stage: 'executing-action', message: '跨场景关键环节事务已被更新请求取代。', recoverable: true },
    }
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

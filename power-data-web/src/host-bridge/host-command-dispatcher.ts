import type {
  DeviceStatesUpdatePayload,
  HostCommandMessage,
  HostCommandType,
  HostDispatchableCommandType,
  HostProtocolError,
  ProcessDetailPlaybackPayload,
  ViewOpenPayload,
  WorkflowTriggerPayload,
} from '@/host-bridge/host-protocol'
import { HOST_DISPATCHABLE_COMMAND_TYPES } from '@/host-bridge/host-protocol'
import type { HostCommandExecutionResult } from '@/host-bridge/host-command-lifecycle'
import type { VisualizationCoordinatorFacade } from '@/modules/visual/orchestration/visualization-coordinator-facade'

/**
 * 外层业务命令进入后续事务处理器前的受控领域意图。
 * 它只携带已通过协议校验的稳定标识与标量载荷，不暴露窗口事件、Unity对象、画布或状态仓库。
 */
export type HostDispatchableDomainCommand =
  | {
      type: 'view.open'
      correlationId: string
      payload: ViewOpenPayload
    }
  | {
      type: 'workflow.trigger'
      correlationId: string
      payload: WorkflowTriggerPayload
    }
  | {
      type: 'process-detail.playback'
      correlationId: string
      payload: ProcessDetailPlaybackPayload
    }
  | {
      type: 'device.states.update'
      correlationId: string
      payload: DeviceStatesUpdatePayload
    }

/**
 * 后续任务-033、034、038实现该端口，将领域意图转换为协调器提交。
 * 分派器只依赖这个最小端口，因而不能直接调用Unity、二维画布或Pinia状态仓库。
 */
export interface HostCommandCoordinatorPort {
  submit(command: HostDispatchableDomainCommand): Promise<HostCommandExecutionResult>
}

/**
 * 能力集合由当前子应用实际安装的事务处理器决定。
 * system.init属于握手状态机，不由本分派器公布；传入其他命令类型会在构造时被丢弃，防止误把握手能力当作业务分派能力。
 */
export interface HostCommandDispatcherOptions {
  commandCapabilities?: readonly HostDispatchableCommandType[]
}

/**
 * 外层命令分派器。
 * 该类是任务-012的唯一入口：先检查能力、运行状态和上下文版本，再把业务意图交给受控协调端口。
 * 场景切换、动作执行和设备状态渲染分别留给后续原子任务，不能由此层越级实现。
 */
export class HostCommandDispatcher {
  private readonly commandCapabilities: ReadonlySet<HostDispatchableCommandType>

  public constructor(
    private readonly facade: VisualizationCoordinatorFacade,
    private readonly coordinator: HostCommandCoordinatorPort,
    options: HostCommandDispatcherOptions = {},
  ) {
    const requestedCapabilities = options.commandCapabilities ?? HOST_DISPATCHABLE_COMMAND_TYPES
    // 配置来自部署元数据，运行时仍做白名单交集，防止错误配置把system.init或未知字符串注入业务分派器。
    this.commandCapabilities = new Set(requestedCapabilities.filter((capability) => isDispatchableCommand(capability)))
  }

  /** 返回冻结的能力快照，握手层可将其并入system.ready，父页面不得猜测未声明命令。 */
  public getCommandCapabilities(): readonly HostDispatchableCommandType[] {
    return [...this.commandCapabilities]
  }

  /**
   * 分派已通过HostBridge安全验证的命令。
   * system.init必须由HostHandshake处理；若组合层误投该命令，会得到结构化失败而非隐式初始化。
   */
  public async execute(command: HostCommandMessage): Promise<HostCommandExecutionResult> {
    if (!isDispatchableCommand(command.type)) {
      return this.failure('protocol.envelope.invalid', 'handshake', '初始化命令必须由外层握手状态机处理。', true)
    }

    if (!this.commandCapabilities.has(command.type)) {
      return this.failure('protocol.capability.undeclared', 'validation', '当前子应用未声明该外层命令能力。', true)
    }

    const snapshot = this.facade.getSnapshot()
    if (command.type !== 'system.dispose' && snapshot.runtimeStatus === 'released') {
      return this.failure('runtime.disposed', 'disposing', '子应用已释放，不能继续处理外层命令。', false)
    }

    const expectedContextRevision = readExpectedContextRevision(command)
    const currentContextRevision = snapshot.stableContext?.contextRevision ?? 0
    if (expectedContextRevision !== undefined && expectedContextRevision !== currentContextRevision) {
      return this.failure('context.revision.conflict', 'validation', '父页面命令基于旧的稳定上下文版本。', true, currentContextRevision)
    }

    switch (command.type) {
      case 'state.get':
        // 状态快照事件由任务-013发送；本任务只返回已校验查询的完成结果与版本号。
        return { success: true, status: 'completed', contextRevision: currentContextRevision }
      case 'system.dispose':
        return this.dispose()
      case 'view.open':
        return this.submitDomainCommand({ type: 'view.open', correlationId: command.messageId, payload: command.payload })
      case 'workflow.trigger':
        return this.submitDomainCommand({ type: 'workflow.trigger', correlationId: command.messageId, payload: command.payload })
      case 'process-detail.playback':
        return this.submitDomainCommand({ type: 'process-detail.playback', correlationId: command.messageId, payload: command.payload })
      case 'device.states.update':
        return this.submitDomainCommand({ type: 'device.states.update', correlationId: command.messageId, payload: command.payload })
    }
  }

  /**
   * 后续事务处理器可能来自异步场景、动作或设备状态任务。
   * 任意未预期异常在此收敛为协议错误，防止生命周期管理器之外的调用方得到未处理拒绝。
   */
  private async submitDomainCommand(command: HostDispatchableDomainCommand): Promise<HostCommandExecutionResult> {
    try {
      return await this.coordinator.submit(command)
    } catch {
      return this.failure('action.execute.failed', 'executing-action', '受控领域命令处理失败，当前稳定上下文未被覆盖。', true)
    }
  }

  /**
   * 释放只通过协调器门面写入system.release，确保桥接层拿不到状态仓库或运行时对象。
   * 重复释放是幂等成功，方便父页面在卸载竞争中安全重试。
   */
  private dispose(): HostCommandExecutionResult {
    try {
      const result = this.facade.submit({ type: 'system.release' })
      if (result.status === 'accepted' || result.status === 'ignored') return { success: true, status: 'disposed' }
      return this.failure(result.error.code === 'runtime.disposed' ? 'runtime.disposed' : 'action.execute.failed', 'disposing', result.error.message, result.error.recoverable)
    } catch {
      return this.failure('action.execute.failed', 'disposing', '释放协调器执行失败，运行时保持当前受控状态。', false)
    }
  }

  /** 统一生成协议允许的有限错误，不回传捕获异常、外部载荷或内部对象信息。 */
  private failure(
    code: HostProtocolError['code'],
    stage: HostProtocolError['stage'],
    message: string,
    recoverable: boolean,
    contextRevision?: number,
  ): HostCommandExecutionResult {
    return {
      success: false,
      status: 'failed',
      ...(contextRevision !== undefined ? { contextRevision } : {}),
      error: { code, stage, message, recoverable },
    }
  }
}

/** 只允许任务-012定义的五种分派命令进入后续状态检查与协调端口。 */
function isDispatchableCommand(type: HostCommandType): type is HostDispatchableCommandType {
  return (HOST_DISPATCHABLE_COMMAND_TYPES as readonly HostCommandType[]).includes(type)
}

/** 只有会修改或派生稳定视图上下文的命令才携带乐观并发版本。 */
function readExpectedContextRevision(command: HostCommandMessage): number | undefined {
  if (command.type === 'view.open' || command.type === 'workflow.trigger' || command.type === 'process-detail.playback') return command.payload.expectedContextRevision
  return undefined
}

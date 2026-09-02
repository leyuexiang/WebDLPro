import type { HostCommandExecutionResult, HostCommandLifecycleResult } from '@/host-bridge/host-command-lifecycle'
import { HostCommandLifecycle } from '@/host-bridge/host-command-lifecycle'
import { HostCommandDispatcher, type HostCommandCoordinatorPort, type HostDispatchableDomainCommand } from '@/host-bridge/host-command-dispatcher'
import { HostEventSender } from '@/host-bridge/host-event-sender'
import { HostHandshake, type HostInitializationResult } from '@/host-bridge/host-handshake'
import { HOST_EVENT_TYPES, type HostCommandMessage, type HostCommandType, type HostDispatchableCommandType, type HostEventType, type HostProtocolError, type HostVisualizationContext } from '@/host-bridge/host-protocol'
import type { HostBridge } from '@/host-bridge/host-bridge'
import type { VisualizationCoordinatorFacade } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import type { TopologyNodeDoubleClickIntent } from '@/modules/visual/topology/topology-node-interaction'
import type { OverviewBuildingSelectionIntent, SceneObjectSelectionIntent } from '@/modules/visual/orchestration/unity-object-selection-coordinator'
import type { SceneActivationId } from '@/config/scene-topology/identifiers'
import { isBusinessVisualizationStableContext, isProcessDetailVisualizationStableContext } from '@/modules/visual/orchestration/visualization.store'
import type { BusinessViewOpenPayload, OverviewViewOpenPayload, ViewOpenPayload } from '@/host-bridge/host-protocol'

/**
 * 原子打开视图端口仅接收任务-012已经收敛的领域命令。
 * 它由任务-033的事务处理器实现，外层桥接组合根不接触拓扑画布、Unity iframe（内嵌网页框架）或状态仓库。
 */
export interface HostViewOpenPort {
  submit(command: Extract<HostDispatchableDomainCommand, { type: 'view.open' }>): Promise<HostCommandExecutionResult>
  /**
   * 外层命令超时时按关联标识撤销对应原子事务的提交权。
   * 这是可选端口，便于旧的只读测试替身继续使用；正式组合根始终注入任务-036处理器实现。
   */
  cancelTimedOutCommand?(correlationId: string): void
}

/** 同场景流程动作端口与打开视图端口独立声明，未安装时不会向父页面暴露 `workflow.trigger` 能力。 */
export interface HostWorkflowTriggerPort {
  submit(command: Extract<HostDispatchableDomainCommand, { type: 'workflow.trigger' }>): Promise<HostCommandExecutionResult>
  /**
   * 流程触发同样可能等待独立资源加载，外层超时时必须撤销其事务提交权。
   * 该接口保持可选，兼容尚未实现第三层的旧流程路由；正式关键环节路由会转发到专用处理器。
   */
  cancelTimedOutCommand?(correlationId: string): void
}

/** 播放端口只接收已校验的开关意图；当前活动场景和关键环节由处理器从稳定上下文锁定。 */
export interface HostProcessDetailPlaybackPort {
  submit(command: Extract<HostDispatchableDomainCommand, { type: 'process-detail.playback' }>): Promise<HostCommandExecutionResult>
}

/** 设备状态端口只接收协议已验证的批量意图；实际二维、三维与诊断处理属于任务-038协调器。 */
export interface HostDeviceStatesUpdatePort {
  submit(command: Extract<HostDispatchableDomainCommand, { type: 'device.states.update' }>): Promise<HostCommandExecutionResult>
  /** 场景重新激活后只重投影最新权威快照；旧测试替身可不实现该可选内部能力。 */
  resynchronizeLatestSnapshot?(sceneActivationId?: SceneActivationId): void
  /** 组合根释放时清空有限状态诊断，不保留外层关联标识。 */
  dispose(): void
}

/**
 * 外层组合根在 Unity 完成前即可启动；该只读回调只负责等待唯一内层运行时准备结果。
 * 默认立即成功以兼容已在构造前完成运行时准备的调用方和既有单元测试。
 */
export interface HostRuntimeCompositionOptions {
  waitForInnerRuntimeReady?: () => Promise<boolean>
}

/**
 * 本版本真正对父页面声明的命令能力。
 * 流程动作和设备状态只有在对应协调器实际注入时才声明；父页面无法借由协议直达未实现能力。
 */
const BASE_INSTALLED_COMMAND_CAPABILITIES: readonly HostDispatchableCommandType[] = Object.freeze([
  'view.open',
  'state.get',
  'system.dispose',
])

/**
 * 本版本真正安装的上行事件能力。
 * `scene.object.selected`（三维对象选择）只由任务-037的受控映射方法发送；它先校验当前稳定上下文，
 * 因而不会把 Unity 原始节点、层级路径或不稳定选择提前发布到父页面。
 */
const INSTALLED_EVENT_CAPABILITIES: readonly HostEventType[] = Object.freeze([...HOST_EVENT_TYPES])

/**
 * 外层桥、握手、命令生命周期、事件发送器和任务-033事务的唯一组合根。
 * 它不拥有窗口监听器或 Unity 资源：前者仍由 HostBridge（外层桥）负责，后者仍由运行时宿主负责；
 * 本类只维持有限的协议对象，并在释放时按握手、生命周期、桥接顺序清理全部引用。
 */
export class HostRuntimeComposition implements HostCommandCoordinatorPort {
  private readonly eventSender: HostEventSender
  private readonly dispatcher: HostCommandDispatcher
  private readonly lifecycle: HostCommandLifecycle
  private readonly handshake: HostHandshake
  /** 同一释放命令链只启动一次内层清理；重复等待共享该 Promise，避免重复销毁 iframe 或 Unity 资源。 */
  private innerReleasePromise: Promise<{ success: boolean }> | undefined
  private disposed = false

  public constructor(
    private readonly bridge: HostBridge,
    private readonly facade: VisualizationCoordinatorFacade,
    private readonly viewOpen: HostViewOpenPort,
    private readonly manifestVersion: string,
    /**
     * 由嵌入壳注入的内层资源释放端口。
     * 它必须在连接器确认或本地兜底清理完成后才结算，组合根不会直接访问 iframe、Window 或 Unity 对象。
     */
    private readonly releaseInnerRuntime: () => Promise<{ success: boolean }> = async () => ({ success: true }),
    /** 流程动作处理器仅在完整清单、运行时和同场景事务均已安装时注入，避免能力声明先于实现。 */
    private readonly workflowTrigger?: HostWorkflowTriggerPort,
    /** 批量状态协调器仅在唯一拓扑运行时与 Unity 状态端口均就绪时注入。 */
    private readonly deviceStatesUpdate?: HostDeviceStatesUpdatePort,
    /** 关键环节播放控制复用已安装的第三层事务处理器，不创建第二个 Unity 通道。 */
    private readonly processDetailPlayback?: HostProcessDetailPlaybackPort,
    private readonly options: HostRuntimeCompositionOptions = {},
  ) {
    this.eventSender = new HostEventSender(bridge)
    this.dispatcher = new HostCommandDispatcher(facade, this, {
      commandCapabilities: [
        ...BASE_INSTALLED_COMMAND_CAPABILITIES,
        ...(workflowTrigger ? ['workflow.trigger' as const] : []),
        ...(processDetailPlayback ? ['process-detail.playback' as const] : []),
        ...(deviceStatesUpdate ? ['device.states.update' as const] : []),
      ],
    })
    this.lifecycle = new HostCommandLifecycle(
      (command) => this.executeAfterHandshake(command),
      globalThis,
      undefined,
      undefined,
      undefined,
      (command) => this.cancelTimedOutDomainTransaction(command),
    )
    this.handshake = new HostHandshake(bridge, {
      manifestVersion,
      // `system.init` 由握手层消费而非分派器消费，仍必须在 ready 能力中发布，父页面才能按协议启动会话。
      commandCapabilities: ['system.init', ...this.dispatcher.getCommandCapabilities()] as readonly HostCommandType[],
      eventCapabilities: INSTALLED_EVENT_CAPABILITIES,
    }, {
      onInitialize: (command) => this.initializeView(command),
      // `system.init` 不进入普通命令生命周期；初始化失败由握手层回调此处，
      // 确保失败确认与脱敏系统错误使用同一原始命令关联标识。
      onInitializationFailure: (replyTo, error) => this.eventSender.sendSystemError(error, replyTo),
    })
  }

  /** 启动时先订阅安全桥接入口，再发送 ready（就绪）事件，避免极快的 system.init 丢失。 */
  public start(): void {
    if (this.disposed) return
    this.bridge.start()
    this.handshake.start()
  }

  /**
   * 接收已经由 HostBridge 校验来源、父窗口、实例和会话的命令。
   * 初始化命令由握手状态机专门处理；其余命令统一进入十秒超时、去重和 replyTo（回复关联）生命周期，
   * 不允许 `system.init` 混入普通命令回包路径。
   */
  public async handleCommand(command: HostCommandMessage): Promise<void> {
    if (this.disposed) return

    if (command.type === 'system.init') {
      const initialized = await this.handshake.handle(command)
      // 初始化成功后的 view.changed（视图变更）仍属于原 system.init（系统初始化）命令，
      // 必须使用同一 messageId 作为 replyTo，父页面才能把确认与最终稳定视图归入同一次初始化事务。
      if (initialized && !this.disposed) {
        // 初始化也建立当前物理场景代次；后续同场景补同步与跨场景清除债务据此严格隔离。
        this.resynchronizeLatestBusinessSnapshot()
        this.reportCommittedView(undefined, command.messageId)
      }
      return
    }

    const outcome = await this.lifecycle.execute(command)
    // 重复 messageId 在生命周期层只产生忽略结果；组合根必须在释放、副作用和事件发送前静默结束。
    // 组件若在命令等待期间已卸载，同样禁止迟到 Promise 再向已经失效的父页面会话发送结果。
    if (outcome.status === 'ignored-duplicate' || this.disposed) return
    const result = outcome.result
    this.reportCommandSideEffects(command, result)
    this.eventSender.sendCommandResult(result)

    // 释放成功或达到十秒总截止后，都必须先发送唯一结果再关闭桥；内层迟到完成只负责资源收尾，不再补发结果。
    if (command.type === 'system.dispose' && (
      (result.payload.success && result.payload.status === 'disposed') || result.source === 'timeout'
    )) this.dispose()
  }

  /**
   * 接收任务-027的正式节点双击意图。
   * 仅在握手完成、稳定上下文就绪且场景/拓扑与当前提交值一致时上报，过期 Canvas（画布）回调、
   * 等待态节点或切换中的目标节点均被静默拒绝，绝不依标题或坐标补全映射。
   */
  public reportTopologyNodeDoubleClick(intent: TopologyNodeDoubleClickIntent): boolean {
    if (this.disposed || !this.handshake.isInitialized()) return false
    const context = this.getReadyContext()
    if (!context || !('topologyId' in context) || context.sceneId !== intent.sceneId || context.topologyId !== intent.topologyId) return false
    return this.eventSender.sendTopologyNodeDoubleClick(intent)
  }

  /**
   * 接收任务-037已从当前结构清单解析出的三维反向选择。
   * 方法再次核对握手、稳定场景、拓扑与上下文版本；即使壳层出现迟到回调，也不能将旧选择发给父页面。
   */
  public reportSceneObjectSelected(selection: SceneObjectSelectionIntent): boolean {
    if (this.disposed || !this.handshake.isInitialized()) return false
    const context = this.getReadyContext()
    if (!context || !('topologyId' in context)) return false
    if (
      selection.sceneId !== context.sceneId ||
      selection.topologyId !== context.topologyId ||
      selection.contextRevision !== context.contextRevision
    ) return false
    return this.eventSender.sendSceneObjectSelected({
      sceneId: selection.sceneId,
      sceneNodeId: selection.sceneNodeId,
      nodeId: selection.nodeId,
    })
  }

  /**
   * 总览建筑点击属于内部视图导航，不属于业务拓扑节点选择。
   * 组合根复核当前仍是同一总览修订后，复用既有 view.open 原子事务；成功后才发布无 replyTo 的稳定视图变更。
   */
  public async openOverviewBuilding(selection: OverviewBuildingSelectionIntent): Promise<boolean> {
    if (this.disposed || !this.handshake.isInitialized()) return false
    const context = this.getReadyContext()
    if (
      !context ||
      context.viewMode !== 'overview' ||
      context.contextRevision !== selection.expectedContextRevision
    ) return false

    const result = await this.viewOpen.submit({
      type: 'view.open',
      correlationId: selection.correlationId,
      payload: {
        sceneId: selection.sceneId,
        topologyId: selection.topologyId,
        expectedContextRevision: selection.expectedContextRevision,
      },
    })
    if (this.disposed || !result.success) return false

    this.resynchronizeLatestBusinessSnapshot()
    this.reportCommittedView(result.transitionId)
    return true
  }

  /**
   * 仅由 HostCommandDispatcher 回调的领域命令端口。
   * 当前安装 `view.open`、可选流程动作与可选批量状态协调器；未声明的状态命令在分派器能力门禁前已被拒绝，此处仍保留防御性失败，
   * 防止未来组合错误绕过能力白名单。
   */
  public async submit(command: HostDispatchableDomainCommand): Promise<HostCommandExecutionResult> {
    if (command.type === 'view.open') return this.viewOpen.submit(command)
    if (command.type === 'workflow.trigger' && this.workflowTrigger) return this.workflowTrigger.submit(command)
    if (command.type === 'process-detail.playback' && this.processDetailPlayback) return this.processDetailPlayback.submit(command)
    if (command.type === 'device.states.update' && this.deviceStatesUpdate) return this.deviceStatesUpdate.submit(command)
    return this.failure('protocol.capability.undeclared', 'validation', '当前发布版本未安装该外层业务命令能力。', true)
  }

  /** 释放有限协议对象并解除外层窗口监听；重复调用安全，业务协调器释放仍由调用方的统一生命周期负责。 */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.handshake.dispose()
    this.lifecycle.dispose()
    this.bridge.dispose()
    this.deviceStatesUpdate?.dispose()
  }

  /**
   * 只有握手完成后普通命令才可进入分派器。
   * 早到命令仍经生命周期生成带 replyTo 的结构化失败，而不是无响应地丢弃或越过 system.init 直接修改运行时。
   */
  private async executeAfterHandshake(command: HostCommandMessage): Promise<HostCommandExecutionResult> {
    if (!this.handshake.isInitialized()) {
      return this.failure('action.execute.failed', 'validation', '外层会话尚未完成初始化，不能执行业务命令。', true)
    }
    const result = await this.dispatcher.execute(command)
    if (command.type !== 'system.dispose' || !result.success || result.status !== 'disposed') return result

    // 内层释放属于 system.dispose 的完成条件，必须位于同一个十秒生命周期内；否则 iframe 卡住会让外层无限等待。
    try {
      const innerRelease = await this.getOrStartInnerRelease()
      return innerRelease.success
        ? result
        : this.failure('action.execute.failed', 'disposing', '内层图形运行时未能完成释放。', true)
    } catch {
      return this.failure('action.execute.failed', 'disposing', '内层图形运行时释放失败。', true)
    }
  }

  /**
   * 生命周期只知道外层消息；原子事务处理器才掌握“关联标识 → 事务 → 上一稳定上下文”的受控映射。
   * 因此超时只委托给该端口，不在组合根猜测场景、拓扑、动作或 Unity 恢复策略。
   */
  private cancelTimedOutDomainTransaction(command: HostCommandMessage): void {
    this.viewOpen.cancelTimedOutCommand?.(command.messageId)
    if (command.type === 'workflow.trigger') this.workflowTrigger?.cancelTimedOutCommand?.(command.messageId)
  }

  /**
   * 返回当前唯一内层释放任务；失败或完成后清除引用，允许尚未超时的受控新消息标识再次尝试。
   * Promise 本身不持有外层命令或载荷，超时后继续完成也不会造成消息和状态缓存泄漏。
   */
  private getOrStartInnerRelease(): Promise<{ success: boolean }> {
    if (this.innerReleasePromise) return this.innerReleasePromise

    const releasePromise = this.releaseInnerRuntime()
    this.innerReleasePromise = releasePromise
    void releasePromise.then(
      () => {
        if (this.innerReleasePromise === releasePromise) this.innerReleasePromise = undefined
      },
      () => {
        if (this.innerReleasePromise === releasePromise) this.innerReleasePromise = undefined
      },
    )
    return releasePromise
  }

  /** 将 system.init 的初始目标转换为与普通 view.open 完全相同的原子事务，避免产生第二套场景切换流程。 */
  private async initializeView(command: Extract<HostCommandMessage, { type: 'system.init' }>): Promise<HostInitializationResult> {
    /*
     * system.ready 只说明清单摘要、能力声明和外层消息通道已经可用，不再等待 Unity。
     * 早到的唯一 system.init 在这里等待内层运行时，成功确认仍必须晚于真实场景与拓扑稳定提交。
     */
    const waitForInnerRuntimeReady = this.options.waitForInnerRuntimeReady ?? (async () => true)
    let innerRuntimeReady = false
    try {
      innerRuntimeReady = await waitForInnerRuntimeReady()
    } catch {
      // 屏障接口不得向外层传播实现异常；统一投影为可恢复的运行时启动失败。
      innerRuntimeReady = false
    }
    if (!innerRuntimeReady) {
      return {
        success: false,
        error: this.createError(
          'runtime.startup.timeout',
          'handshake',
          'Unity 三维运行时未能在120秒内完成准备，初始视图尚未提交。',
          true,
        ),
      }
    }

    const payload: ViewOpenPayload = 'topologyId' in command.payload
      ? {
          sceneId: command.payload.sceneId,
          topologyId: command.payload.topologyId,
          ...(command.payload.actionId !== undefined ? { actionId: command.payload.actionId } : {}),
        } as BusinessViewOpenPayload
      : {
          sceneId: command.payload.sceneId,
          ...(command.payload.actionId !== undefined ? { actionId: command.payload.actionId } : {}),
        } as OverviewViewOpenPayload
    const result = await this.viewOpen.submit({
      type: 'view.open',
      correlationId: command.messageId,
      payload,
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    const context = this.getReadyContext()
    return context
      ? { success: true, context }
      : { success: false, error: this.createError('topology.activate.failed', 'activating-topology', '初始化事务未产生可发布的稳定视图。', true) }
  }

  /** 成功命令只派生协议定义的两个附加事件；错误已由 command.result 安全表达，不重复外泄原始异常。 */
  private reportCommandSideEffects(command: Exclude<HostCommandMessage, { type: 'system.init' }>, result: HostCommandLifecycleResult): void {
    // 缓存回包与重复进行中消息只承担请求级确认，绝不再次发布全局视图/快照事件。
    // 这样同一 messageId 的重试不会造成父页面收到重复 view.changed，也不会把状态查询变成无界事件源。
    if (!result.payload.success || result.source !== 'executed') return

    if (command.type === 'view.open' || command.type === 'workflow.trigger') {
      // 视图事务已经同时提交场景与拓扑后，才允许按当前权威快照补同步新三维控制器。
      this.resynchronizeLatestBusinessSnapshot()
      this.reportCommittedView(result.payload.transitionId, result.replyTo)
      return
    }

    if (command.type === 'state.get') {
      const context = this.getReadyContext()
      if (!context) return
      const snapshot = this.facade.getSnapshot()
      this.eventSender.sendStateSnapshot(result.replyTo, {
        manifestVersion: this.manifestVersion,
        context,
        // 协调器的 preparing（准备中）是事务内部阶段；外层协议将其统一命名为 initializing（初始化中）。
        unityStatus: toHostUnityStatus(snapshot.unityStatus),
        topologyStatus: snapshot.topologyStatus,
      })
    }
  }

  /** 读取只允许对外暴露的 ready 稳定上下文；进行中目标字段、诊断和选择均不进入视图事件。 */
  private getReadyContext(): HostVisualizationContext | undefined {
    const snapshot = this.facade.getSnapshot()
    const stableContext = snapshot.stableContext
    if (!stableContext || snapshot.runtimeStatus !== 'ready') return undefined

    if (isBusinessVisualizationStableContext(stableContext)) {
      return {
        viewMode: 'business',
        sceneId: stableContext.sceneId,
        topologyId: stableContext.topologyId,
        actionId: stableContext.actionId,
        contextRevision: stableContext.contextRevision,
        status: 'ready',
      }
    }
    if (isProcessDetailVisualizationStableContext(stableContext)) {
      return {
        viewMode: 'process-detail',
        sceneId: stableContext.sceneId,
        processDetailId: stableContext.processDetailId,
        actionId: stableContext.actionId,
        contextRevision: stableContext.contextRevision,
        status: 'ready',
      }
    }
    return {
      viewMode: 'overview',
      sceneId: stableContext.sceneId,
      actionId: null,
      contextRevision: stableContext.contextRevision,
      status: 'ready',
    }
  }

  /**
   * 只有事务已经提交后的稳定快照才触发 view.changed，严格避免半成品拓扑或场景对外可操作。
   * 由父命令触发时同步传递 replyTo；该参数仅为未来内部自发视图事件保留可选边界，当前生产命令链始终提供。
   */
  private reportCommittedView(
    transitionId?: HostCommandLifecycleResult['payload']['transitionId'],
    replyTo?: string,
  ): void {
    const context = this.getReadyContext()
    if (context) this.eventSender.sendViewChanged(context, transitionId, replyTo)
  }

  /** 仅业务稳定上下文需要向 Unity 重投影；平台总览没有拓扑，不得把隐藏旧快照发送给内层运行时。 */
  private resynchronizeLatestBusinessSnapshot(): void {
    const snapshot = this.facade.getSnapshot()
    if (!snapshot.stableContext || !isBusinessVisualizationStableContext(snapshot.stableContext)) return
    this.deviceStatesUpdate?.resynchronizeLatestSnapshot?.(snapshot.sceneActivationId ?? undefined)
  }

  /** 统一创建协议许可的有限错误，任何捕获异常均不在此层读取、拼接或传出。 */
  private failure(
    code: HostProtocolError['code'],
    stage: HostProtocolError['stage'],
    message: string,
    recoverable: boolean,
  ): HostCommandExecutionResult {
    return { success: false, status: 'failed', error: this.createError(code, stage, message, recoverable) }
  }

  /** 错误构造集中在组合根，保证握手和普通命令的脱敏语义相同。 */
  private createError(
    code: HostProtocolError['code'],
    stage: HostProtocolError['stage'],
    message: string,
    recoverable: boolean,
  ): HostProtocolError {
    return { code, stage, message, recoverable }
  }
}

/**
 * 将协调器 Unity 子状态映射到外层快照的有限枚举。
 * 仅 `preparing` 需要术语转换；其余值均为双方共同允许的稳定状态，不能把切换细节或 Unity 原始阶段透出。
 */
function toHostUnityStatus(status: 'idle' | 'preparing' | 'ready' | 'failed' | 'disposed'): 'idle' | 'initializing' | 'ready' | 'failed' | 'disposed' {
  return status === 'preparing' ? 'initializing' : status
}

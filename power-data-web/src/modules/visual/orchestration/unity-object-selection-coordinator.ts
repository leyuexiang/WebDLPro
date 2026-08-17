import { toSceneNodeId, validateStableIdentifier } from '@/config/scene-topology/identifiers'
import type { NodeId, SceneId, SceneNodeId, TopologyId } from '@/config/scene-topology/identifiers'
import type { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import type { SceneObjectSelectedPayload } from '@/host-bridge/host-protocol'
import type { VisualizationCoordinatorFacade } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import type { VisualizationObjectSelection } from '@/modules/visual/runtime/visualization-runtime-host'
import type { TopologyRuntime } from '@/modules/visual/topology/topology-runtime'

/**
 * Unity（游戏引擎）反向选择协调器。
 * 它只接受内层协议已经验证的稳定节点标识，再从当前结构清单精确反查唯一二维节点；
 * 对象名称、层级、坐标和原始事件载荷均不参与任何映射、诊断或外层事件。
 */
export class UnityObjectSelectionCoordinator {
  /** 已处理内层消息标识采用固定容量，只用于阻止浏览器重放或重复 Unity 回调产生重复选择。 */
  private readonly handledIncomingMessageIds = new Map<string, true>()
  /** 外层关联标识由本壳生成，避免把 Unity 运行时的内部消息格式透传到外层协议。 */
  private correlationSequence = 0

  public constructor(
    private readonly registry: TopologyRegistry,
    private readonly topologyRuntime: TopologyRuntime,
    private readonly facade: VisualizationCoordinatorFacade,
    private readonly options: UnityObjectSelectionCoordinatorOptions = {},
  ) {}

  /**
   * 将 Unity 选择转换为当前拓扑选择和可安全上报的外层载荷。
   * 返回 undefined 表示当前选择无法证明映射关系；调用方只保留诊断，不发送 `focusNode`（聚焦节点）
   * 或 `scene.object.selected`（三维对象选择）事件，因此不会形成 Unity→二维→Unity 的选择回环。
   */
  public resolve(selection: VisualizationObjectSelection): SceneObjectSelectionIntent | undefined {
    const incomingMessageId = selection.messageId
    if (!isBoundedIncomingMessageId(incomingMessageId)) {
      this.recordDiagnostic('unity.selection.correlation.invalid', 'unity-selection-invalid')
      return undefined
    }
    if (this.handledIncomingMessageIds.has(incomingMessageId)) return undefined
    /*
     * 基础消息标识合法后立即登记，而不是等映射成功才登记。
     * 无映射、上下文失配和旧实例事件同样是“已处理”的输入：允许它们重放会反复制造诊断，
     * 且可能在新稳定上下文出现后把旧选择误当成可重试业务意图。
     */
    this.rememberIncomingMessageId(incomingMessageId)
    const correlationId = this.createCorrelationId()

    const snapshot = this.facade.getSnapshot()
    const context = snapshot.stableContext
    const activeTopology = this.topologyRuntime.getActiveTopology()
    if (!context || snapshot.runtimeStatus !== 'ready' || !activeTopology) {
      this.recordDiagnostic('unity.selection.context.unavailable', correlationId)
      return undefined
    }
    if (activeTopology.sceneId !== context.sceneId || activeTopology.topologyId !== context.topologyId) {
      this.recordDiagnostic('unity.selection.topology.mismatch', correlationId)
      return undefined
    }
    // Unity 自报场景必须与当前稳定上下文一致。场景切换后的迟到事件不能借用新上下文解析同名三维节点。
    if (selection.payload.sceneId !== context.sceneId) {
      this.recordDiagnostic('unity.selection.scene.mismatch', correlationId)
      return undefined
    }
    // 场景名称相同不足以证明来自同一个 Unity 实例：A→B→A 的首个 A 迟到事件必须被精确阻断。
    if (!snapshot.sceneActivationId || selection.payload.sceneActivationId !== snapshot.sceneActivationId) {
      this.recordDiagnostic('unity.selection.activation.mismatch', correlationId)
      return undefined
    }
    if (validateStableIdentifier(selection.payload.sceneNodeId).length > 0) {
      this.recordDiagnostic('unity.selection.node.invalid', correlationId)
      return undefined
    }

    // 协议字段已经明确为三维节点标识，只做受检字符串到品牌类型的转换；
    // 绝不从二维 nodeId（拓扑节点标识）、对象名称或层级路径推导三维目标。
    const sceneNodeId = toSceneNodeId(selection.payload.sceneNodeId)
    const nodeId = this.registry.getNodeIdForSceneNode(context.sceneId, sceneNodeId)
    if (!nodeId) {
      this.recordDiagnostic('unity.selection.mapping.missing', correlationId)
      return undefined
    }

    if (!activeTopology.topology.nodes.some((node) => node.nodeId === nodeId)) {
      // 映射存在于其他拓扑时不能回退选择默认图或同名节点；仅留下受限原因以便定位发布缺口。
      this.recordDiagnostic('unity.selection.current-topology.missing', correlationId)
      return undefined
    }

    const routeIds = activeTopology.topology.edges
      .filter((edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId)
      .map((edge) => edge.edgeId)
    const selectionResult = this.facade.submit({
      type: 'selection.replace',
      nodeIds: [nodeId],
      routeIds,
      source: 'unity',
      sceneNodeId,
    })
    if (selectionResult.status !== 'accepted') {
      this.recordDiagnostic('unity.selection.commit.rejected', correlationId)
      return undefined
    }

    // 同一场景的唯一画布只更新选择增量；不会重建拓扑、发起聚焦命令或影响设备状态快照。
    this.topologyRuntime.setSelection([nodeId], routeIds)
    return {
      sceneId: context.sceneId,
      sceneNodeId,
      nodeId,
      topologyId: context.topologyId,
      contextRevision: context.contextRevision,
      correlationId,
    }
  }

  /** 释放时清除有限去重表，避免被卸载的嵌入壳保留内层关联标识。 */
  public dispose(): void {
    this.handledIncomingMessageIds.clear()
  }

  /** 将无法映射的选择收敛为固定代码和安全关联标识，绝不写入 Unity 原始节点、对象名称或异常文本。 */
  private recordDiagnostic(code: string, correlationId: string): void {
    this.facade.submit({
      type: 'diagnostic.record',
      diagnostic: {
        code,
        correlationId,
        occurredAt: new Date(this.options.now?.() ?? Date.now()).toISOString(),
      },
    })
  }

  /** 固定长度先进先出队列只为短时间重放去重服务，不形成跨场景或跨会话的选择历史。 */
  private rememberIncomingMessageId(messageId: string): void {
    this.handledIncomingMessageIds.set(messageId, true)
    const maximumHandledCorrelations = normalizePositiveSafeInteger(this.options.maximumHandledCorrelations, 64)
    while (this.handledIncomingMessageIds.size > maximumHandledCorrelations) {
      const oldestMessageId = this.handledIncomingMessageIds.keys().next().value
      if (!oldestMessageId) return
      this.handledIncomingMessageIds.delete(oldestMessageId)
    }
  }

  /** 外层协议标识始终由小写字母开头且仅包含安全字符，不复用内层时间戳或随机消息格式。 */
  private createCorrelationId(): string {
    this.correlationSequence += 1
    return `unity-selection-${this.correlationSequence}`
  }
}

/**
 * 三维反向选择在组合根复核前保留当前拓扑和上下文版本；真正发给平台的协议载荷只投影前三个标识。
 * 该意图不含设备编号，平台收到 nodeId 后自行查询内部绑定。
 */
export interface SceneObjectSelectionIntent extends SceneObjectSelectedPayload {
  sceneId: SceneId
  sceneNodeId: SceneNodeId
  nodeId: NodeId
  topologyId: TopologyId
  contextRevision: number
  correlationId: string
}

/** 选项仅服务测试时钟和去重容量，生产默认值固定并且始终受安全整数约束。 */
export interface UnityObjectSelectionCoordinatorOptions {
  maximumHandledCorrelations?: number
  now?: () => number
}

/** 非法容量回退默认 64，避免不可信配置让去重表变成无界内存。 */
function normalizePositiveSafeInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

/** 内层协议基础信封允许时间戳前缀消息标识；它只在私有去重表中保存，仍受严格长度限制。 */
function isBoundedIncomingMessageId(value: string): boolean {
  return value.length > 0 && value.length <= 128
}

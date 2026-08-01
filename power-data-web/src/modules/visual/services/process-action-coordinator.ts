import type { ProcessNodeId, ProcessStepId, RouteId } from '@/config/process/identifiers'
import type { ProcessConfigurationBundle } from '@/config/process/types'
import type { ProcessSelectionSource } from '@/stores/process-context.store'
import type { WebglCommandType } from '@/services/webgl/protocol'

/** 可由三个视图发出的统一交互意图；所有事件都必须携带来源和关联标识。 */
export type ProcessInteraction =
  | { type: 'select-step'; stepId: ProcessStepId; source: ProcessSelectionSource; correlationId: string }
  | { type: 'select-node'; nodeId: ProcessNodeId; source: ProcessSelectionSource; correlationId: string }

/** 协调器依赖的最小状态写入面，保持该服务可在单测中脱离 Pinia 验证。 */
export interface ProcessContextWriter {
  sceneStatus: { value: string }
  sceneCapabilities: { value: readonly WebglCommandType[] }
  selectStep: (
    stepId: ProcessStepId,
    nodeIds: readonly ProcessNodeId[],
    routeIds: readonly RouteId[],
    source: ProcessSelectionSource,
  ) => void
  selectNode: (
    nodeId: ProcessNodeId,
    routeIds: readonly RouteId[],
    source: ProcessSelectionSource,
    matchedStepId?: ProcessStepId,
  ) => void
  recordCommand: (command: { type: WebglCommandType | 'ui-selection'; source: ProcessSelectionSource; correlationId: string; issuedAt: string }) => void
}

/** 受控三维命令由协调器产出意图；真正发送由后续运行时连接器完成。 */
export interface CoordinatedSceneCommand {
  type: 'enterProcessStep' | 'focusNode'
  payload: Record<string, string>
}

/** 协调结果让页面更新二维视图后按需交给受控连接器，不直接接触 iframe。 */
export interface ProcessInteractionResult {
  idempotent: boolean
  sceneCommand?: CoordinatedSceneCommand
}

/**
 * 将导览、二维拓扑和 WebGL 回传事件汇聚为单向状态变更。
 * 已处理关联标识使用有界集合缓存；WebGL 来源不会生成新的 WebGL 命令，从而避免回写循环。
 */
export class ProcessActionCoordinator {
  private readonly processedKeys = new Set<string>()
  private readonly processedKeyQueue: string[] = []

  public constructor(private readonly context: ProcessContextWriter) {}

  /** 根据当前页面配置执行一次幂等交互协调。 */
  public coordinate(bundle: ProcessConfigurationBundle, interaction: ProcessInteraction): ProcessInteractionResult {
    const idempotencyKey = `${interaction.type}:${interaction.correlationId}`

    if (this.processedKeys.has(idempotencyKey)) {
      return { idempotent: true }
    }

    this.remember(idempotencyKey)

    if (interaction.type === 'select-step') {
      const step = bundle.guide.steps.find((candidate) => candidate.stepId === interaction.stepId)

      if (!step) {
        return { idempotent: false }
      }

      this.context.selectStep(step.stepId, step.nodeIds, step.activeRouteIds, interaction.source)
      this.context.recordCommand({ type: 'ui-selection', source: interaction.source, correlationId: interaction.correlationId, issuedAt: new Date().toISOString() })

      return {
        idempotent: false,
        sceneCommand: this.createStepSceneCommand(bundle, step.stepId, interaction.source),
      }
    }

    const topologyNode = bundle.topology.nodes.find((node) => node.nodeId === interaction.nodeId)

    if (!topologyNode) {
      return { idempotent: false }
    }

    const matchedStep = bundle.guide.steps.find((step) => step.nodeIds.includes(interaction.nodeId))
    this.context.selectNode(interaction.nodeId, matchedStep?.activeRouteIds ?? [], interaction.source, matchedStep?.stepId)
    this.context.recordCommand({ type: 'ui-selection', source: interaction.source, correlationId: interaction.correlationId, issuedAt: new Date().toISOString() })

    return {
      idempotent: false,
      sceneCommand: this.createNodeSceneCommand(bundle, interaction.nodeId, interaction.source),
    }
  }

  /** 组件卸载时清空有界幂等缓存，保证不跨页面保留交互记录。 */
  public dispose(): void {
    this.processedKeys.clear()
    this.processedKeyQueue.length = 0
  }

  /** WebGL 仅在实际 ready、声明能力存在且事件不来自 WebGL 时接受下行命令。 */
  private canDispatchSceneCommand(source: ProcessSelectionSource, requiredCapability: WebglCommandType): boolean {
    return source !== 'webgl' && this.context.sceneStatus.value === 'ready' && this.context.sceneCapabilities.value.includes(requiredCapability)
  }

  /** 步骤命令还必须引用已登记场景映射，空场景页永远不产生网页图形命令。 */
  private createStepSceneCommand(
    bundle: ProcessConfigurationBundle,
    stepId: ProcessStepId,
    source: ProcessSelectionSource,
  ): CoordinatedSceneCommand | undefined {
    if (!this.canDispatchSceneCommand(source, 'enterProcessStep')) {
      return undefined
    }

    const step = bundle.guide.steps.find((candidate) => candidate.stepId === stepId)
    const hasMappedNode = step?.nodeIds.some((nodeId) => bundle.sceneMapping.mappedNodeIds.includes(nodeId)) ?? false

    if (!hasMappedNode) {
      return undefined
    }

    return { type: 'enterProcessStep', payload: { processId: bundle.page.processId, stepId } }
  }

  /** 节点命令同样限制在已映射节点，拓扑上的概念节点不会越权调用 Unity。 */
  private createNodeSceneCommand(
    bundle: ProcessConfigurationBundle,
    nodeId: ProcessNodeId,
    source: ProcessSelectionSource,
  ): CoordinatedSceneCommand | undefined {
    if (!this.canDispatchSceneCommand(source, 'focusNode') || !bundle.sceneMapping.mappedNodeIds.includes(nodeId)) {
      return undefined
    }

    return { type: 'focusNode', payload: { nodeId } }
  }

  /** 维护最多 128 条关联标识，避免长时间停留页面时幂等缓存无界增长。 */
  private remember(key: string): void {
    this.processedKeys.add(key)
    this.processedKeyQueue.push(key)

    if (this.processedKeyQueue.length > 128) {
      const expiredKey = this.processedKeyQueue.shift()

      if (expiredKey) {
        this.processedKeys.delete(expiredKey)
      }
    }
  }
}

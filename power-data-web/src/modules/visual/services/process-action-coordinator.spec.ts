import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { localProcessConfigLoader } from '@/config/process/local-process-config'
import type { ProcessNodeId, ProcessStepId } from '@/config/process/identifiers'
import { ProcessActionCoordinator, type ProcessContextWriter } from '@/modules/visual/services/process-action-coordinator'
import type { ProcessSelectionSource } from '@/stores/process-context.store'
import type { WebglCommandType } from '@/services/webgl/protocol'

describe('工艺交互协调器', () => {
  it('统一导览选择并对同一关联标识保持幂等', () => {
    const result = localProcessConfigLoader.load('gas-overview')
    const bundle = result.bundle

    if (!bundle) throw new Error('燃气总览配置应存在。')

    const selectedSteps: ProcessStepId[] = []
    const selectedNodes: ProcessNodeId[] = []
    const commandTypes: string[] = []
    const context: ProcessContextWriter = {
      // 模拟正式握手后的运行时能力，以验证协调器只产生受控的命令意图。
      sceneStatus: ref('ready'),
      sceneCapabilities: ref<WebglCommandType[]>(['enterProcessStep', 'focusNode']),
      selectStep: (stepId) => selectedSteps.push(stepId),
      selectNode: (nodeId) => selectedNodes.push(nodeId),
      recordCommand: (command) => commandTypes.push(command.type),
    }
    const coordinator = new ProcessActionCoordinator(context)
    const first = coordinator.coordinate(bundle, {
      type: 'select-step',
      stepId: bundle.guide.steps[3]!.stepId,
      source: 'guide',
      correlationId: 'guide:one',
    })
    const repeated = coordinator.coordinate(bundle, {
      type: 'select-step',
      stepId: bundle.guide.steps[3]!.stepId,
      source: 'guide',
      correlationId: 'guide:one',
    })

    expect(selectedSteps).toHaveLength(1)
    expect(commandTypes).toEqual(['ui-selection'])
    expect(first.sceneCommand?.type).toBe('enterProcessStep')
    expect(repeated.idempotent).toBe(true)
    expect(selectedNodes).toHaveLength(0)
  })

  it('不将来自网页图形的选择再回写为网页图形命令', () => {
    const result = localProcessConfigLoader.load('gas-overview')
    const bundle = result.bundle

    if (!bundle) throw new Error('燃气总览配置应存在。')

    const context: ProcessContextWriter = {
      // 回传事件仍会更新二维选择，但 source 为 webgl 时必须打断下行命令循环。
      sceneStatus: ref('ready'),
      sceneCapabilities: ref<WebglCommandType[]>(['enterProcessStep', 'focusNode']),
      selectStep: () => undefined,
      selectNode: () => undefined,
      recordCommand: () => undefined,
    }
    const coordinator = new ProcessActionCoordinator(context)
    const nodeId = bundle.topology.nodes[2]!.nodeId
    const interactionSource: ProcessSelectionSource = 'webgl'
    const outcome = coordinator.coordinate(bundle, { type: 'select-node', nodeId, source: interactionSource, correlationId: 'webgl:one' })

    expect(outcome.sceneCommand).toBeUndefined()
    coordinator.dispose()
  })
})

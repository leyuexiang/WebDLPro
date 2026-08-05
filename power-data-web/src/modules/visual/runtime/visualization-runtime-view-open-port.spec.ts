import { describe, expect, it, vi } from 'vitest'
import { toActionId, toProcessId, toSceneId, toStepId, toTransitionId } from '@/config/scene-topology/identifiers'
import { VisualizationRuntimeViewOpenPort } from '@/modules/visual/runtime/visualization-runtime-view-open-port'
import type { VisualizationRuntimeHostController } from '@/modules/visual/runtime/visualization-runtime-host'

/** 运行时宿主夹具只公开事务适配器需要的等待命令端口，避免测试耦合 iframe 或跨窗口消息。 */
function createRuntime(success = true): VisualizationRuntimeHostController {
  return {
    sendCommandAndWait: vi.fn().mockResolvedValue({ success }),
  } as unknown as VisualizationRuntimeHostController
}

describe('view.open Unity 运行时端口', () => {
  it('切换场景时传递固定场景、映射版本与事务标识，并等待受控完成结果', async () => {
    const runtime = createRuntime()
    const port = new VisualizationRuntimeViewOpenPort(runtime)

    await expect(port.switchScene(toSceneId('wind-power'), 'mapping.wind.1', toTransitionId('transition.wind.1'))).resolves.toEqual({ success: true })
    expect(runtime.sendCommandAndWait).toHaveBeenCalledWith('switchScene', {
      sceneId: toSceneId('wind-power'),
      sceneMappingVersion: 'mapping.wind.1',
      transitionId: toTransitionId('transition.wind.1'),
    })
  })

  it('流程动作只转换为内层白名单载荷，失败不透出运行时原因', async () => {
    const runtime = createRuntime(false)
    const port = new VisualizationRuntimeViewOpenPort(runtime)

    await expect(port.executeAction({
      type: 'enterProcessStep',
      processId: toProcessId('wind-power-generation'),
      stepId: toStepId('overview'),
      defaultUnitId: 'all',
      isolate: true,
    }, toActionId('action.wind.overview'), toTransitionId('transition.wind.2'))).resolves.toEqual({ success: false, errorCode: 'action.execute.failed' })
    expect(runtime.sendCommandAndWait).toHaveBeenCalledWith('enterProcessStep', {
      processId: toProcessId('wind-power-generation'),
      stepId: toStepId('overview'),
      unitId: 'all',
      isolate: true,
    })
  })
})

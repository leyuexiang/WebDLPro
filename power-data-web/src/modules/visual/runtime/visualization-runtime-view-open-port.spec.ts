import { describe, expect, it, vi } from 'vitest'
import {
  toActionId,
  toCameraPoseId,
  toProcessDetailId,
  toProcessDetailResourceId,
  toProcessId,
  toSceneActivationId,
  toSceneId,
  toSceneNodeId,
  toStepId,
  toTransitionId,
} from '@/config/scene-topology/identifiers'
import type { ProcessDetailDefinition } from '@/config/scene-topology/types'
import { VisualizationRuntimeViewOpenPort } from '@/modules/visual/runtime/visualization-runtime-view-open-port'
import type { VisualizationRuntimeHostController } from '@/modules/visual/runtime/visualization-runtime-host'

/** 运行时宿主夹具只公开事务适配器需要的等待命令端口，避免测试耦合 iframe 或跨窗口消息。 */
function createRuntime(success = true): VisualizationRuntimeHostController {
  return {
    // switchScene 成功必须携带 Unity 实际生成的物理场景实例标识；动作命令会忽略该字段。
    sendCommandAndWait: vi.fn().mockResolvedValue({ success, ...(success ? { sceneActivationId: 'scene-activation.runtime-test' } : {}) }),
  } as unknown as VisualizationRuntimeHostController
}

describe('view.open Unity 运行时端口', () => {
  it('切换场景时传递固定场景、映射版本与事务标识，并等待受控完成结果', async () => {
    const runtime = createRuntime()
    const port = new VisualizationRuntimeViewOpenPort(runtime)

    await expect(port.switchScene(toSceneId('wind-power'), 'mapping.wind.1', toTransitionId('transition.wind.1'), true)).resolves.toEqual({
      success: true,
      sceneActivationId: toSceneActivationId('scene-activation.runtime-test'),
    })
    expect(runtime.sendCommandAndWait).toHaveBeenCalledWith('switchScene', {
      sceneId: toSceneId('wind-power'),
      sceneMappingVersion: 'mapping.wind.1',
      transitionId: toTransitionId('transition.wind.1'),
      forceReload: true,
    })
  })

  it('普通场景切换显式发送非强制重载，避免协议缺省值在不同运行时产生歧义', async () => {
    const runtime = createRuntime()
    const port = new VisualizationRuntimeViewOpenPort(runtime)

    await port.switchScene(toSceneId('gas-power'), 'mapping.gas.1', toTransitionId('transition.gas.1'))

    expect(runtime.sendCommandAndWait).toHaveBeenCalledWith('switchScene', {
      sceneId: toSceneId('gas-power'),
      sceneMappingVersion: 'mapping.gas.1',
      transitionId: toTransitionId('transition.gas.1'),
      forceReload: false,
    })
  })

  it('切换失败但运行时已自动恢复时保留恢复后的物理场景标识', async () => {
    const runtime = createRuntime(false)
    vi.mocked(runtime.sendCommandAndWait).mockResolvedValueOnce({
      success: false,
      sceneActivationId: 'scene-activation.gas-restored',
    })
    const port = new VisualizationRuntimeViewOpenPort(runtime)

    await expect(port.switchScene(
      toSceneId('wind-power'),
      'mapping.wind.1',
      toTransitionId('transition.wind.failed'),
    )).resolves.toEqual({
      success: false,
      errorCode: 'scene.switch.failed',
      sceneActivationId: toSceneActivationId('scene-activation.gas-restored'),
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

  it('聚焦动作使用当前视图事务作为显式选择标识', async () => {
    const runtime = createRuntime()
    const port = new VisualizationRuntimeViewOpenPort(runtime)
    const transitionId = toTransitionId('transition.gas.focus.01')

    await expect(port.executeAction({
      type: 'focusNode',
      sceneNodeId: toSceneNodeId('scene-node.gas-turbine'),
      isolate: false,
    }, toActionId('action.gas.focus'), transitionId)).resolves.toEqual({ success: true })
    expect(runtime.sendCommandAndWait).toHaveBeenCalledWith('focusNode', {
      sceneNodeId: toSceneNodeId('scene-node.gas-turbine'),
      selectionId: transitionId,
      isolate: false,
    })
  })

  it('第三层准备、提交、取消和退出都携带同一事务标识', async () => {
    const runtime = createRuntime()
    const port = new VisualizationRuntimeViewOpenPort(runtime)
    const transitionId = toTransitionId('transition.gas-turbine.detail.01')
    const detail: ProcessDetailDefinition = {
      sceneId: toSceneId('gas-power'),
      processId: toProcessId('gas-power-generation'),
      stepId: toStepId('gas-turbine'),
      processDetailId: toProcessDetailId('process-detail.gas-power.gas-turbine'),
      resourceId: toProcessDetailResourceId('process-detail-resource.gas-power.gas-turbine'),
      cameraPoseId: toCameraPoseId('camera-pose.gas-power.gas-turbine'),
      stateNodeId: toSceneNodeId('gas-turbine'),
    }

    await expect(port.prepareProcessDetail(detail, transitionId)).resolves.toEqual({ success: true })
    await expect(port.commitProcessDetail(detail.sceneId, detail.processDetailId, transitionId)).resolves.toEqual({ success: true })
    await expect(port.abortProcessDetail(detail.sceneId, detail.processDetailId, transitionId)).resolves.toEqual({ success: true })
    await expect(port.setProcessDetailPlayback(detail.sceneId, detail.processDetailId, false)).resolves.toEqual({ success: true })
    await expect(port.exitProcessDetail(detail.sceneId, detail.processDetailId, transitionId)).resolves.toEqual({ success: true })

    expect(runtime.sendCommandAndWait).toHaveBeenNthCalledWith(1, 'prepareProcessDetail', {
      sceneId: detail.sceneId,
      processId: detail.processId,
      stepId: detail.stepId,
      processDetailId: detail.processDetailId,
      transitionId,
    })
    expect(runtime.sendCommandAndWait).toHaveBeenNthCalledWith(2, 'commitProcessDetail', {
      sceneId: detail.sceneId,
      processDetailId: detail.processDetailId,
      transitionId,
    })
    expect(runtime.sendCommandAndWait).toHaveBeenNthCalledWith(3, 'abortProcessDetail', {
      sceneId: detail.sceneId,
      processDetailId: detail.processDetailId,
      transitionId,
    })
    expect(runtime.sendCommandAndWait).toHaveBeenNthCalledWith(4, 'setProcessDetailPlayback', {
      sceneId: detail.sceneId,
      processDetailId: detail.processDetailId,
      playing: false,
    })
    expect(runtime.sendCommandAndWait).toHaveBeenNthCalledWith(5, 'exitProcessDetail', {
      sceneId: detail.sceneId,
      processDetailId: detail.processDetailId,
      transitionId,
    })
  })
})

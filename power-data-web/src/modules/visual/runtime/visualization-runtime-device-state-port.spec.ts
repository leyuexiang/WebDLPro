import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { toSceneNodeId } from '@/config/scene-topology/identifiers'
import { VisualizationRuntimeDeviceStatePort } from '@/modules/visual/runtime/visualization-runtime-device-state-port'
import type { VisualizationRuntimeHostController } from '@/modules/visual/runtime/visualization-runtime-host'

/** 夹具只实现状态适配器所需的能力快照和等待命令端口，不创建内嵌框架或浏览器消息监听器。 */
function createRuntime(): VisualizationRuntimeHostController {
  return {
    status: ref('ready'),
    capabilities: ref(['setNodeVisualState']),
    sendCommandAndWait: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as VisualizationRuntimeHostController
}

describe('设备状态 Unity 运行时端口', () => {
  it('显式来源修订号转换为有修订二元组，保留修订号零与缺失的语义差异', async () => {
    const runtime = createRuntime()
    const port = new VisualizationRuntimeDeviceStatePort(runtime)

    await port.setNodeVisualState(toSceneNodeId('scene-node.test'), 'fault', '2026-08-09T08:00:00.000Z', 0)

    expect(runtime.sendCommandAndWait).toHaveBeenCalledWith('setNodeVisualState', {
      sceneNodeId: toSceneNodeId('scene-node.test'),
      visualState: 'fault',
      statusUpdatedAt: '2026-08-09T08:00:00.000Z',
      hasSourceRevision: true,
      sourceRevision: 0,
    })
  })

  it('外层未提供来源修订号时固定发送无修订二元组，避免 Unity 将缺失字段误判为显式零', async () => {
    const runtime = createRuntime()
    const port = new VisualizationRuntimeDeviceStatePort(runtime)

    await port.setNodeVisualState(toSceneNodeId('scene-node.test'), 'alarm', '2026-08-09T08:00:01.000Z')

    expect(runtime.sendCommandAndWait).toHaveBeenCalledWith('setNodeVisualState', {
      sceneNodeId: toSceneNodeId('scene-node.test'),
      visualState: 'alarm',
      statusUpdatedAt: '2026-08-09T08:00:01.000Z',
      hasSourceRevision: false,
      sourceRevision: 0,
    })
  })
})

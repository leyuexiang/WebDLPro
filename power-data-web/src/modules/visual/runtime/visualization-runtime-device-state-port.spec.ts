import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { toSceneNodeId } from '@/config/scene-topology/identifiers'
import { VisualizationRuntimeDeviceStatePort } from '@/modules/visual/runtime/visualization-runtime-device-state-port'
import type { VisualizationRuntimeHostController } from '@/modules/visual/runtime/visualization-runtime-host'

/** 夹具只实现状态适配器所需的能力快照和等待命令端口，不创建内嵌框架或浏览器消息监听器。 */
function createRuntime(): VisualizationRuntimeHostController {
  return {
    status: ref('ready'),
    capabilities: ref(['setNodeVisualState', 'clearNodeVisualState']),
    sendCommandAndWait: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as VisualizationRuntimeHostController
}

describe('设备状态 Unity 运行时端口', () => {
  it('固定发送本地快照序号，并将平台时间与来源修订仅作为诊断字段透传', async () => {
    const runtime = createRuntime()
    const port = new VisualizationRuntimeDeviceStatePort(runtime)

    await port.setNodeVisualState(
      toSceneNodeId('scene-node.test'),
      'fault',
      7,
      '2026-08-09T08:00:00.000Z',
      0,
    )

    expect(runtime.sendCommandAndWait).toHaveBeenCalledWith('setNodeVisualState', {
      sceneNodeId: toSceneNodeId('scene-node.test'),
      visualState: 'fault',
      snapshotSequence: 7,
      statusUpdatedAt: '2026-08-09T08:00:00.000Z',
      sourceRevision: 0,
    })
  })

  it('只有设置与清除能力同时就绪才支持完整快照，并按本地序号发送基础状态恢复', async () => {
    const runtime = createRuntime()
    const port = new VisualizationRuntimeDeviceStatePort(runtime)

    expect(port.supportsNodeVisualState()).toBe(true)
    await port.clearNodeVisualState(toSceneNodeId('scene-node.test'), 8)
    expect(runtime.sendCommandAndWait).toHaveBeenCalledWith('clearNodeVisualState', {
      sceneNodeId: toSceneNodeId('scene-node.test'),
      snapshotSequence: 8,
    })

    ;(runtime.capabilities as { value: readonly string[] }).value = ['setNodeVisualState']
    expect(port.supportsNodeVisualState()).toBe(false)
  })
})

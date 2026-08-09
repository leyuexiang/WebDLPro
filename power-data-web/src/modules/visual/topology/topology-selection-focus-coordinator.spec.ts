import { describe, expect, it, vi } from 'vitest'
import { toSceneNodeId, toSelectionId } from '@/config/scene-topology/identifiers'
import { TopologySelectionFocusCoordinator, type TopologyFocusPort } from '@/modules/visual/topology/topology-selection-focus-coordinator'

function createFocusPort(supportsFocusNode = true, success = true): TopologyFocusPort {
  return {
    supportsFocusNode: vi.fn(() => supportsFocusNode),
    focusNode: vi.fn().mockResolvedValue({ success }),
  }
}

describe('TopologySelectionFocusCoordinator', () => {
  it('只将拓扑来源且显式映射的节点聚焦一次', async () => {
    const port = createFocusPort()
    const coordinator = new TopologySelectionFocusCoordinator(port)
    const request = { source: 'topology' as const, selectionId: toSelectionId('selection.topology.01'), sceneNodeId: toSceneNodeId('scene-node.gas-turbine') }

    await expect(coordinator.requestFocus(request)).resolves.toBe(true)
    await expect(coordinator.requestFocus(request)).resolves.toBe(false)
    expect(port.focusNode).toHaveBeenCalledTimes(1)
    expect(port.focusNode).toHaveBeenCalledWith(toSceneNodeId('scene-node.gas-turbine'), toSelectionId('selection.topology.01'))
  })

  it('Unity 来源、缺少映射或未协商能力均不向三维回写', async () => {
    const port = createFocusPort(false)
    const coordinator = new TopologySelectionFocusCoordinator(port)

    await expect(coordinator.requestFocus({ source: 'unity', selectionId: toSelectionId('selection.unity.01'), sceneNodeId: toSceneNodeId('scene-node.gas-turbine') })).resolves.toBe(false)
    await expect(coordinator.requestFocus({ source: 'topology', selectionId: toSelectionId('selection.topology.no-node') })).resolves.toBe(false)
    await expect(coordinator.requestFocus({ source: 'topology', selectionId: toSelectionId('selection.topology.no-capability'), sceneNodeId: toSceneNodeId('scene-node.gas-turbine') })).resolves.toBe(false)
    expect(port.focusNode).not.toHaveBeenCalled()
  })

  it('三维聚焦失败不撤销已处理关联，重放同一关联不会重复发送命令', async () => {
    const port = createFocusPort(true, false)
    const coordinator = new TopologySelectionFocusCoordinator(port)
    const request = { source: 'topology' as const, selectionId: toSelectionId('selection.topology.failed'), sceneNodeId: toSceneNodeId('scene-node.gas-turbine') }

    await expect(coordinator.requestFocus(request)).resolves.toBe(false)
    await expect(coordinator.requestFocus(request)).resolves.toBe(false)
    expect(port.focusNode).toHaveBeenCalledTimes(1)
  })

  it('释放后清空有限选择历史并拒绝迟到聚焦', async () => {
    const port = createFocusPort()
    const coordinator = new TopologySelectionFocusCoordinator(port)
    coordinator.dispose()

    await expect(coordinator.requestFocus({
      source: 'topology',
      selectionId: toSelectionId('selection.topology.after-dispose'),
      sceneNodeId: toSceneNodeId('scene-node.gas-turbine'),
    })).resolves.toBe(false)
    expect(port.focusNode).not.toHaveBeenCalled()
  })
})

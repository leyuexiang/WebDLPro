import { describe, expect, it, vi } from 'vitest'
import { toSceneNodeId, toSelectionId } from '@/config/scene-topology/identifiers'
import { TopologySelectionFocusCoordinator, type TopologyFocusPort } from '@/modules/visual/topology/topology-selection-focus-coordinator'

function createFocusPort(supportsFocusNode = true, success = true, supportsClearSelection = true): TopologyFocusPort {
  return {
    supportsFocusNode: vi.fn(() => supportsFocusNode),
    focusNode: vi.fn().mockResolvedValue({ success }),
    supportsClearSelection: vi.fn(() => supportsClearSelection),
    clearSelection: vi.fn().mockResolvedValue({ success }),
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

  it('空白点击只发送三维清除选择命令，不依赖场景重置', async () => {
    const port = createFocusPort()
    const coordinator = new TopologySelectionFocusCoordinator(port)

    await expect(coordinator.requestClearSelection()).resolves.toBe(true)
    expect(port.clearSelection).toHaveBeenCalledTimes(1)
  })

  it('未协商清除能力或清除失败时不产生错误的三维成功状态', async () => {
    const unsupportedPort = createFocusPort(true, true, false)
    const unsupportedCoordinator = new TopologySelectionFocusCoordinator(unsupportedPort)
    await expect(unsupportedCoordinator.requestClearSelection()).resolves.toBe(false)
    expect(unsupportedPort.clearSelection).not.toHaveBeenCalled()

    const failedPort = createFocusPort(true, false, true)
    const failedCoordinator = new TopologySelectionFocusCoordinator(failedPort)
    await expect(failedCoordinator.requestClearSelection()).resolves.toBe(false)
    expect(failedPort.clearSelection).toHaveBeenCalledTimes(1)
  })
})

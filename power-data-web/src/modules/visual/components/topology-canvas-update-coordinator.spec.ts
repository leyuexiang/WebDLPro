import { describe, expect, it, vi } from 'vitest'
import { toProcessNodeId, toTopologyKey } from '@/config/process/identifiers'
import type { TopologyDefinition } from '@/config/process/types'
import { TopologyCanvasUpdateCoordinator } from '@/modules/visual/components/topology-canvas-update-coordinator'
import type { TopologyRenderer } from '@/services/topology/topology-renderer'

/** 最小受控拓扑夹具，仅验证更新通道，不引入图元、浏览器画布或燃气业务数据。 */
function createTopology(): TopologyDefinition {
  return {
    topologyKey: toTopologyKey('topology.update-coordinator'),
    title: '更新通道测试拓扑',
    configVersion: '2026.08.04.1' as never,
    nodes: [],
    edges: [],
  }
}

/** 端口替身记录四种调用，断言组件协调层不会以状态或选择更新替代拓扑更新。 */
function createRenderer(): TopologyRenderer {
  return {
    setTopology: vi.fn(),
    setSelection: vi.fn(),
    setNodeStatuses: vi.fn(),
    resize: vi.fn(),
    pickNodeAt: vi.fn(),
    dispose: vi.fn(),
  }
}

describe('TopologyCanvasUpdateCoordinator', () => {
  it('仅在拓扑引用变更时调用 setTopology，选择与状态更新不重建定义', () => {
    const renderer = createRenderer()
    const coordinator = new TopologyCanvasUpdateCoordinator(renderer)
    const topology = createTopology()

    coordinator.updateTopology(topology)
    coordinator.updateTopology(topology)
    coordinator.updateSelection([toProcessNodeId('update-node')], [])
    coordinator.updateNodeStatuses(new Map([[toProcessNodeId('update-node'), 'alarm' as const]]))

    expect(renderer.setTopology).toHaveBeenCalledTimes(1)
    expect(renderer.setSelection).toHaveBeenCalledWith([toProcessNodeId('update-node')], [])
    expect(renderer.setNodeStatuses).toHaveBeenCalledWith(new Map([[toProcessNodeId('update-node'), 'alarm']]))
  })

  it('尺寸变化只调用 resize，不改写定义、选择或状态通道', () => {
    const renderer = createRenderer()
    const coordinator = new TopologyCanvasUpdateCoordinator(renderer)

    coordinator.updateContainerSize(1280, 720)

    expect(renderer.resize).toHaveBeenCalledWith(1280, 720)
    expect(renderer.setTopology).not.toHaveBeenCalled()
    expect(renderer.setSelection).not.toHaveBeenCalled()
    expect(renderer.setNodeStatuses).not.toHaveBeenCalled()
  })
})

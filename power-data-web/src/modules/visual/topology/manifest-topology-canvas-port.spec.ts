import { describe, expect, it, vi } from 'vitest'
import { toProcessNodeId, toRouteId } from '@/config/process/identifiers'
import { toNodeId, toRouteId as toManifestRouteId } from '@/config/scene-topology/identifiers'
import type { TopologyCanvasController } from '@/modules/visual/components/topology-canvas-controller'
import { ManifestTopologyCanvasPort } from '@/modules/visual/topology/manifest-topology-canvas-port'

/** 创建只记录端口调用的画布替身，测试不依赖浏览器 Canvas（画布）实现或现有燃气配置。 */
function createCanvas(): TopologyCanvasController & {
  setTopology: ReturnType<typeof vi.fn>
  setSelection: ReturnType<typeof vi.fn>
  setNodeStatuses: ReturnType<typeof vi.fn>
  restoreViewState: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
} {
  return {
    setTopology: vi.fn(),
    setSelection: vi.fn(),
    setNodeStatuses: vi.fn(),
    getViewState: vi.fn(),
    restoreViewState: vi.fn(),
    dispose: vi.fn(),
    // 该对象仅作为端口测试替身；Vitest（测试框架）运行时函数满足端口调用，类型层由本断言隔离。
  } as unknown as TopologyCanvasController & {
    setTopology: ReturnType<typeof vi.fn>
    setSelection: ReturnType<typeof vi.fn>
    setNodeStatuses: ReturnType<typeof vi.fn>
    restoreViewState: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }
}

describe('正式清单单画布端口', () => {
  it('只投影已声明拓扑字段，并保持选择标识和值不变', () => {
    const canvas = createCanvas()
    const selectionChanged = vi.fn()
    const port = new ManifestTopologyCanvasPort(canvas, undefined, selectionChanged)

    port.setTopology({
      topologyId: 'test.overview' as never,
      sceneId: 'gas-power' as never,
      title: '测试总览',
      configVersion: 'test-version',
      nodes: [{ nodeId: toNodeId('test-node'), title: '测试节点', x: 50, y: 50, iconKey: 'not-registered', deviceStatus: 'offline', doubleClickBehavior: 'none' }],
      edges: [],
    })
    port.setSelection([toNodeId('test-node')], [toManifestRouteId('test-route')])

    expect(canvas.setTopology).toHaveBeenCalledWith(expect.objectContaining({
      topologyKey: 'test.overview',
      title: '测试总览',
      nodes: [expect.objectContaining({ nodeId: toProcessNodeId('test-node'), iconKey: 'generic' })],
    }))
    expect(canvas.setSelection).toHaveBeenCalledWith([toProcessNodeId('test-node')], [toRouteId('test-route')])
    expect(selectionChanged).toHaveBeenCalledWith([toProcessNodeId('test-node')], [toRouteId('test-route')])
  })

  it('恢复视图时只传递缩放与平移，并把释放转发到唯一画布', () => {
    const canvas = createCanvas()
    const port = new ManifestTopologyCanvasPort(canvas)

    port.restoreViewState({ zoom: 1.25, offsetX: 18, offsetY: -12, selectedNodeIds: [toNodeId('ignored-node')], selectedRouteIds: [toManifestRouteId('ignored-route')] })
    port.dispose()

    expect(canvas.restoreViewState).toHaveBeenCalledWith({ zoom: 1.25, offsetX: 18, offsetY: -12 })
    expect(canvas.dispose).toHaveBeenCalledTimes(1)
  })

  it('将正式节点状态转为旧画布标识并只更新声明快照，不重复直接写入画布', () => {
    const canvas = createCanvas()
    const statusesChanged = vi.fn()
    const port = new ManifestTopologyCanvasPort(canvas, undefined, undefined, statusesChanged)

    port.setNodeStatuses(new Map([[toNodeId('test-node'), 'alarm' as const]]))

    expect(statusesChanged).toHaveBeenCalledWith(new Map([[toProcessNodeId('test-node'), 'alarm']]))
    expect(canvas.setNodeStatuses).not.toHaveBeenCalled()
  })
})

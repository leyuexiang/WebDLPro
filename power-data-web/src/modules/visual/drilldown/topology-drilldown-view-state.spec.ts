import { describe, expect, it } from 'vitest'
import { toNodeId } from '@/config/scene-topology/identifiers'
import type { TopologyDrilldownContent } from '@/config/scene-topology/types'
import {
  createTopologyDrilldownRenderModel,
  TopologyDrilldownViewState,
} from '@/modules/visual/drilldown/topology-drilldown-view-state'

function createContent(duplicateSingleBranch: boolean): TopologyDrilldownContent {
  return {
    contentKey: 'test.drilldown',
    version: 'test-version',
    title: '测试下钻',
    sourceNodeId: toNodeId('source.formal'),
    duplicateSingleBranch,
    nodes: [
      { id: 'source', title: '来源', kind: 'source', x: 50, y: 14 },
      { id: 'logic.1', title: '直接子节点', kind: 'logic', x: 50, y: 53 },
      { id: 'boundary.1', title: '模型说明', kind: 'boundary', x: 50, y: 84 },
    ],
    edges: [
      { id: 'edge.source.1', fromId: 'source', toId: 'logic.1' },
      { id: 'edge.boundary.1', fromId: 'logic.1', toId: 'boundary.1' },
    ],
  }
}

describe('下钻说明图渲染状态', () => {
  it('单分支生成五个渲染实例，但仍只共享三个语义节点标识', () => {
    const model = createTopologyDrilldownRenderModel(createContent(true))
    expect(model.instances).toHaveLength(5)
    expect(model.edges).toHaveLength(4)
    expect(new Set(model.instances.map((instance) => instance.semanticNodeId))).toEqual(new Set(['source', 'logic.1', 'boundary.1']))
    expect(model.instances.filter((instance) => instance.semanticNodeId === 'logic.1').map((instance) => instance.instanceId)).toEqual([
      'logic.1::原始',
      'logic.1::复制',
    ])
    expect(model.instances.filter((instance) => instance.duplicate)).toHaveLength(2)
  })

  it('局部缩放和平移始终限幅，重置不会携带正式画布状态', () => {
    const state = new TopologyDrilldownViewState()
    for (let index = 0; index < 20; index += 1) state.zoomBy(0.15)
    expect(state.getSnapshot().zoom).toBe(2.25)
    expect(state.panBy(10_000, -10_000, 500, 300)).toEqual({ zoom: 2.25, offsetX: 1125, offsetY: -675 })
    expect(state.reset()).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 })
  })
})

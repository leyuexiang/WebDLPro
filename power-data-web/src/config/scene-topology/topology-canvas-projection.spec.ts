import { describe, expect, it } from 'vitest'
import { toNodeId, toRouteId, toSceneId, toTopologyId } from '@/config/scene-topology/identifiers'
import type { TopologyDefinition } from '@/config/scene-topology/types'
import { projectTopologyForCanvas } from '@/config/scene-topology/topology-canvas-projection'

/** 构造新清单拓扑片段；图元与连线仅用于证明投影规则，不代表正式燃气设备或场景映射。 */
function createManifestTopology(): TopologyDefinition {
  return {
    topologyId: toTopologyId('topology.wind.overview'),
    sceneId: toSceneId('wind-power'),
    title: '风电场总览',
    configVersion: 'test-manifest.1',
    nodes: [
      {
        nodeId: toNodeId('wind.controller'),
        title: '控制器',
        iconKey: 'plc',
        x: 20,
        y: 40,
        layerId: 'unit-control',
        deviceStatus: 'normal',
        doubleClickBehavior: 'none',
      },
      {
        nodeId: toNodeId('wind.unknown'),
        title: '待登记节点',
        iconKey: 'future-equipment',
        x: 80,
        y: 40,
        deviceStatus: 'offline',
        doubleClickBehavior: 'none',
      },
    ],
    edges: [
      {
        edgeId: toRouteId('route.wind.overview'),
        fromNodeId: toNodeId('wind.controller'),
        toNodeId: toNodeId('wind.unknown'),
        title: '拓扑关系',
        protocolLabel: '工业以太网',
        evidenceStatus: 'verified',
      },
    ],
    focusRegions: [{
      regionId: 'focus.wind-controller',
      anchorNodeId: toNodeId('wind.controller'),
      nodeIds: [toNodeId('wind.controller'), toNodeId('wind.unknown')],
      label: '风机控制区域',
    }],
  }
}

describe('新清单到单画布投影', () => {
  it('只投影清单明确声明的二维展示事实，未知图元不会伪造旧业务语义', () => {
    const projected = projectTopologyForCanvas(createManifestTopology())

    expect(projected.topologyKey).toBe('topology.wind.overview')
    expect(projected.layers).toBeUndefined()
    expect(projected.nodes.map((node) => node.iconKey)).toEqual(['plc', 'generic'])
    expect(projected.nodes[0]).toEqual(expect.objectContaining({ layerId: 'unit-control' }))
    expect(projected.nodes.every((node) => node.metricKeys.length === 0)).toBe(true)
    expect(projected.edges).toEqual([
      expect.objectContaining({
        edgeId: 'route.wind.overview',
        protocolLabel: '工业以太网',
        evidenceStatus: 'verified',
        sceneRouteIds: [],
      }),
    ])
    expect(projected.focusRegions).toEqual([{
      regionId: 'focus.wind-controller',
      anchorNodeId: 'wind.controller',
      nodeIds: ['wind.controller', 'wind.unknown'],
      label: '风机控制区域',
    }])
  })

  it('清单明确提供分层时完整投影，未声明的连线展示字段仍保持中性回退', () => {
    const manifestTopology = createManifestTopology()
    const topologyWithLayers: TopologyDefinition = {
      ...manifestTopology,
      layers: [{ layerId: 'unit-control', title: '单元控制层', y: 70, color: '#22c55e' }],
      edges: [{ ...manifestTopology.edges[0], protocolLabel: undefined, evidenceStatus: undefined }],
    }

    const projected = projectTopologyForCanvas(topologyWithLayers)

    expect(projected.layers).toEqual([{ layerId: 'unit-control', title: '单元控制层', y: 70, color: '#22c55e' }])
    expect(projected.edges[0]).toEqual(expect.objectContaining({ protocolLabel: undefined, evidenceStatus: 'unclassified' }))
  })
})

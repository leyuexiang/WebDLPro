import { describe, expect, it } from 'vitest'
import { toNodeId, toSceneId, toSceneNodeId, toTopologyId } from '@/config/scene-topology/identifiers'
import type { TopologyDefinition } from '@/config/scene-topology/types'
import { resolveTopologyNodeDoubleClick } from '@/modules/visual/topology/topology-node-interaction'

/** 构造不依赖业务场景资料的正式拓扑片段，仅验证显式双击声明的解析边界。 */
function createTopology(): TopologyDefinition {
  return {
    topologyId: toTopologyId('test.interaction.overview'),
    sceneId: toSceneId('wind-power'),
    title: '交互测试拓扑',
    configVersion: 'test-version',
    nodes: [
      {
        nodeId: toNodeId('test.device-node'),
        title: '已登记设备节点',
        sceneNodeId: toSceneNodeId('scene.test.01'),
        iconKey: 'plc',
        x: 30,
        y: 50,
        deviceStatus: 'normal',
        doubleClickBehavior: 'emit-node',
      },
      {
        nodeId: toNodeId('test.concept-node'),
        title: '概念节点',
        // 该节点具有三维节点标识但没有设备绑定；用于锁定“可选择和聚焦”与“可上报设备”两条链路的边界。
        sceneNodeId: toSceneNodeId('scene.test.passive'),
        iconKey: 'generic',
        x: 70,
        y: 50,
        deviceStatus: 'offline',
        doubleClickBehavior: 'none',
      },
    ],
    edges: [],
  }
}

describe('拓扑节点双击解析', () => {
  it('只返回已明确登记的节点和可选三维节点标识', () => {
    const intent = resolveTopologyNodeDoubleClick(createTopology(), toNodeId('test.device-node'))

    expect(intent).toEqual({
      sceneId: toSceneId('wind-power'),
      topologyId: toTopologyId('test.interaction.overview'),
      nodeId: toNodeId('test.device-node'),
    })
  })

  it('未允许上报的节点和未知节点不产生节点上报意图', () => {
    const topology = createTopology()

    // 选择层仍会读取该节点的 sceneNodeId（场景节点标识）触发三维聚焦；双击解析只负责节点事件，不能越权推断真实设备编号。
    expect(resolveTopologyNodeDoubleClick(topology, toNodeId('test.concept-node'))).toBeUndefined()
    expect(resolveTopologyNodeDoubleClick(topology, toNodeId('test.unknown-node'))).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { toDeviceId, toNodeId, toSceneId, toSceneNodeId, toTopologyId } from '@/config/scene-topology/identifiers'
import type { TopologyDefinition } from '@/config/scene-topology/types'
import { resolveTopologyDeviceDoubleClick } from '@/modules/visual/topology/topology-node-interaction'

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
        deviceId: toDeviceId('device.test.01'),
        sceneNodeId: toSceneNodeId('scene.test.01'),
        iconKey: 'plc',
        x: 30,
        y: 50,
        deviceStatus: 'normal',
        doubleClickBehavior: 'emit-device',
      },
      {
        nodeId: toNodeId('test.concept-node'),
        title: '概念节点',
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

describe('拓扑节点设备双击解析', () => {
  it('只返回已明确登记的节点、设备和可选三维节点标识', () => {
    const intent = resolveTopologyDeviceDoubleClick(createTopology(), toNodeId('test.device-node'))

    expect(intent).toEqual({
      sceneId: toSceneId('wind-power'),
      topologyId: toTopologyId('test.interaction.overview'),
      nodeId: toNodeId('test.device-node'),
      deviceId: toDeviceId('device.test.01'),
      sceneNodeId: toSceneNodeId('scene.test.01'),
    })
  })

  it('概念节点和未知节点不产生设备上报意图', () => {
    const topology = createTopology()

    expect(resolveTopologyDeviceDoubleClick(topology, toNodeId('test.concept-node'))).toBeUndefined()
    expect(resolveTopologyDeviceDoubleClick(topology, toNodeId('test.unknown-node'))).toBeUndefined()
  })
})

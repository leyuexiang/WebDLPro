import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toProcessNodeId } from '@/config/process/identifiers'
import {
  BUILDING_TOPOLOGY_NODE_IDS,
  BUILDING_TOPOLOGY_SYSTEM_NODE_IDS,
  BUILDING_TOPOLOGY_SCENE_NODE_ID_BY_NODE_ID,
  getBuildingTopologyRuntimeBindings,
  getBuildingTopologyStatusIconUrl,
} from './building-topology-runtime-bindings'
import { BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE } from './business-scene-topology'

const EXPECTED_BINDINGS_BY_VARIANT = new Map<string, readonly (readonly [string, string, string])[]>([
  ['architecture', [
    ['d0b75', 'system.building-hvac-building-automation', 'unit.building-hvac-automation.control'],
    ['42312320', 'asset.building-hvac-control', 'node.building-hvac-control'],
    ['8b80c2d', 'asset.building-smart-lighting', 'node.building-smart-lighting'],
    ['7ab900d7', 'system.building-smart-lighting-control', 'unit.building-smart-lighting.control'],
  ]],
  ['network', [
    ['73874ef9', 'system.building-hvac-building-automation', 'unit.building-hvac-automation.control'],
    ['340e210e', 'system.building-smart-lighting-control', 'unit.building-smart-lighting.control'],
  ]],
  ['business', []],
  ['key-process', [
    ['19302081', 'system.building-hvac-building-automation', 'unit.building-hvac-automation.control'],
    ['5a232852', 'asset.building-hvac-control', 'node.building-hvac-control'],
    ['7de351ce', 'asset.building-smart-lighting', 'node.building-smart-lighting'],
    ['491d605', 'system.building-smart-lighting-control', 'unit.building-smart-lighting.control'],
  ]],
  ['network-key-process', [
    ['3e24d70e', 'system.building-hvac-building-automation', 'unit.building-hvac-automation.control'],
    ['39eb5ed1', 'asset.building-hvac-control', 'node.building-hvac-control'],
    ['5890fe4f', 'asset.building-smart-lighting', 'node.building-smart-lighting'],
    ['eff5466', 'system.building-smart-lighting-control', 'unit.building-smart-lighting.control'],
  ]],
  ['network-business', [
    ['2ee5a087', 'system.building-hvac-building-automation', 'unit.building-hvac-automation.control'],
    ['736daf4', 'system.building-smart-lighting-control', 'unit.building-smart-lighting.control'],
  ]],
  ['business-key-process', [
    ['22063f6c', 'system.building-hvac-building-automation', 'unit.building-hvac-automation.control'],
    ['cf58f4e', 'asset.building-hvac-control', 'node.building-hvac-control'],
    ['ae15b2b', 'asset.building-smart-lighting', 'node.building-smart-lighting'],
    ['72130944', 'system.building-smart-lighting-control', 'unit.building-smart-lighting.control'],
  ]],
  ['network-business-key-process', [
    ['7101900b', 'system.building-hvac-building-automation', 'unit.building-hvac-automation.control'],
    ['f765f99', 'asset.building-hvac-control', 'node.building-hvac-control'],
    ['81a3de2', 'asset.building-access-control', 'node.building-access-control'],
    ['74365219', 'asset.building-smart-lighting', 'node.building-smart-lighting'],
    ['588de3c6', 'system.building-access-group-control-dispatch', 'unit.building-access-group-dispatch.control'],
    ['7338607a', 'system.building-smart-lighting-control', 'unit.building-smart-lighting.control'],
  ]],
])

describe('楼宇拓扑逐变体三维绑定', () => {
  it('每个完整筛选文件只使用经核对的 penId，且正反向编号唯一', () => {
    expect(() => getBuildingTopologyRuntimeBindings('unknown')).toThrow('楼宇拓扑版本缺少运行时绑定')
    for (const [variantId, expectedBindings] of EXPECTED_BINDINGS_BY_VARIANT) {
      const bindings = getBuildingTopologyRuntimeBindings(variantId)
      expect(bindings.map(({ penId, nodeId, sceneNodeId }) => [penId, nodeId, sceneNodeId])).toEqual(expectedBindings)

      const sceneNodeByNode = new Map<string, string>()
      const nodeBySceneNode = new Map<string, string>()
      for (const binding of bindings) {
        const nodeId = String(binding.nodeId)
        const sceneNodeId = String(binding.sceneNodeId)
        expect(sceneNodeByNode.has(nodeId)).toBe(false)
        expect(nodeBySceneNode.has(sceneNodeId)).toBe(false)
        sceneNodeByNode.set(nodeId, sceneNodeId)
        nodeBySceneNode.set(sceneNodeId, nodeId)
      }
      for (const [nodeId, sceneNodeId] of sceneNodeByNode) expect(nodeBySceneNode.get(sceneNodeId)).toBe(nodeId)
    }

    expect(BUILDING_TOPOLOGY_SCENE_NODE_ID_BY_NODE_ID.get(BUILDING_TOPOLOGY_NODE_IDS.hvac)).toBe('node.building-hvac-control')
    expect(BUILDING_TOPOLOGY_SCENE_NODE_ID_BY_NODE_ID.get(BUILDING_TOPOLOGY_NODE_IDS.access)).toBe('node.building-access-control')
    expect(BUILDING_TOPOLOGY_SCENE_NODE_ID_BY_NODE_ID.get(BUILDING_TOPOLOGY_NODE_IDS.lighting)).toBe('node.building-smart-lighting')
    expect(BUILDING_TOPOLOGY_SCENE_NODE_ID_BY_NODE_ID.get(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.hvacAutomation)).toBe('unit.building-hvac-automation.control')
    expect(BUILDING_TOPOLOGY_SCENE_NODE_ID_BY_NODE_ID.get(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.accessGroupDispatch)).toBe('unit.building-access-group-dispatch.control')
    expect(BUILDING_TOPOLOGY_SCENE_NODE_ID_BY_NODE_ID.get(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.lightingControl)).toBe('unit.building-smart-lighting.control')
  })

  it('最新版组合图完整保留46个图元、参考文件节点名称和本地WebP资源', () => {
    const variant = BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE.consumption.find(({ id }) => id === 'network-business-key-process')!
    const path = resolve(process.cwd(), 'public/topology/consumption-json-preview', variant.topologyPath)
    const data = JSON.parse(readFileSync(path, 'utf8')) as { pens: { id: string; name: string; text?: string; image?: string }[] }
    const penById = new Map(data.pens.map((pen) => [pen.id, pen]))

    expect(data.pens).toHaveLength(46)
    expect(data.pens.filter(({ name }) => name === 'combine')).toHaveLength(0)
    expect(penById.get('f765f99')?.text).toContain('暖通空调')
    expect(penById.get('81a3de2')?.text).toContain('门禁')
    expect(penById.get('74365219')?.text).toContain('智能照明')
    expect(penById.get('7101900b')?.text).toContain('DDC模块')
    expect(penById.get('588de3c6')?.text).toContain('DDC模块')
    expect(penById.get('7338607a')?.text).toContain('DDC模块')
    expect(penById.get('f765f99')?.image).toBe('icons/normal/building-hvac-control.webp')
    expect(penById.get('81a3de2')?.image).toBe('icons/normal/building-access-control.webp')
    expect(penById.get('74365219')?.image).toBe('icons/normal/building-smart-lighting.webp')
    expect(data.pens.filter(({ image }) => image).every(({ image }) => image?.endsWith('.webp'))).toBe(true)
  })

  it('三类设备的正常、告警、故障和离线资源均为共享目录中的WebP', () => {
    const states = ['normal', 'alarm', 'fault', 'offline'] as const
    const nodeIds = [BUILDING_TOPOLOGY_NODE_IDS.hvac, BUILDING_TOPOLOGY_NODE_IDS.access, BUILDING_TOPOLOGY_NODE_IDS.lighting]
    for (const nodeId of nodeIds) {
      for (const status of states) {
        const url = getBuildingTopologyStatusIconUrl(nodeId, status)
        expect(url).toMatch(/topology\/shared\/icons\/(normal|alarm|fault|offline)\/building-[a-z-]+\.webp$/)
        const relativePath = url!.slice(url!.indexOf('/topology/shared/') + '/topology/shared/'.length)
        const bytes = readFileSync(resolve(process.cwd(), 'public/topology/shared', relativePath))
        expect(existsSync(resolve(process.cwd(), 'public/topology/shared', relativePath))).toBe(true)
        expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
        expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP')
      }
    }
    expect(getBuildingTopologyStatusIconUrl(toProcessNodeId('asset.building-unregistered'), 'normal')).toBeUndefined()
    for (const nodeId of Object.values(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS)) {
      expect(getBuildingTopologyStatusIconUrl(nodeId, 'normal')).toBeUndefined()
    }
  })
})

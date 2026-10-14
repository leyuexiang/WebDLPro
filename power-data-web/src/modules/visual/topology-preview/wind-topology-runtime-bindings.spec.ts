import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Meta2dData } from '@meta2d/core'
import { describe, expect, it } from 'vitest'
import { toProcessNodeId } from '@/config/process/identifiers'
import { getWindTopologyResourceManifest } from './wind-topology-manifest'
import { WIND_TOPOLOGY_VARIANTS } from './wind-topology-variant-manifest'
import {
  createWindTopologyRuntimeBindingIndex,
  getWindTopologyRuntimeBindings,
} from './wind-topology-runtime-bindings'

const topologyRoot = resolve(process.cwd(), 'public/topology/wind-json-preview')

/** 十个风电二维节点与后续 Unity 场景配置共同使用的稳定编号契约。 */
const expectedNodeTargets = Object.freeze([
  ['system.wind-pitch-control', 'unit.wind-pitch.control'],
  ['system.wind-converter-control', 'unit.wind-converter.control'],
  ['system.wind-yaw-control', 'unit.wind-yaw.control'],
  ['system.wind-drivetrain-control', 'unit.wind-drivetrain.control'],
  ['system.wind-brake-control', 'unit.wind-brake.control'],
  ['asset.wind-pitch-system', 'node.wind-pitch-system'],
  ['asset.wind-converter-system', 'node.wind-converter-system'],
  ['asset.wind-yaw-system', 'node.wind-yaw-system'],
  ['asset.wind-drivetrain-system', 'node.wind-drivetrain-system'],
  ['asset.wind-brake-system', 'node.wind-brake-system'],
] as const)

function readVariant(variantPath: string): Meta2dData {
  return JSON.parse(readFileSync(resolve(topologyRoot, variantPath), 'utf8')) as Meta2dData
}

describe('风电拓扑逐版本二维与三维节点绑定', () => {
  it('八份已登记 JSON 的每个映射都命中本文件真实设备图元和稳定 Unity 目标', () => {
    for (const variant of WIND_TOPOLOGY_VARIANTS) {
      const penIds = new Set(readVariant(variant.topologyPath).pens.map((pen) => pen.id))
      const devicePenIds = getWindTopologyResourceManifest(variant.id).devicePenIds
      const bindings = getWindTopologyRuntimeBindings(variant.id)

      // 图元编号只在当前文件内有效；唯一性和真实资源约束阻止跨版本误映射及误绑背景图。
      expect(new Set(bindings.map((binding) => binding.penId)).size).toBe(bindings.length)
      for (const binding of bindings) {
        expect(penIds.has(binding.penId)).toBe(true)
        expect(devicePenIds.has(binding.penId)).toBe(true)
        expect(expectedNodeTargets).toContainEqual([binding.nodeId, binding.sceneNodeId])
      }
    }
  })

  it('默认三层组合的二十个图元归并为十个节点，三维反选可恢复全部同类图元', () => {
    const variantId = 'network-business-key-process'
    const index = createWindTopologyRuntimeBindingIndex(variantId)
    const bindings = getWindTopologyRuntimeBindings(variantId)

    expect(bindings).toHaveLength(20)
    expect(index.penIdsByNodeId.size).toBe(10)
    for (const [nodeId, sceneNodeId] of expectedNodeTargets) {
      const aliases = index.penIdsByNodeId.get(toProcessNodeId(nodeId))
      expect(aliases).toHaveLength(2)
      expect(aliases).toEqual(bindings
        .filter((binding) => binding.nodeId === nodeId && binding.sceneNodeId === sceneNodeId)
        .map((binding) => binding.penId))
    }
  })

  it('单层没有相应设备图元时不复用其他版本的图元编号或目标绑定', () => {
    const businessBindings = getWindTopologyRuntimeBindings('business')
    const architectureIndex = createWindTopologyRuntimeBindingIndex('architecture')

    expect(businessBindings).toEqual([])
    expect(architectureIndex.nodeIdByPenId.has('4996538')).toBe(false)
    expect(architectureIndex.penIdsByNodeId.has(toProcessNodeId('system.wind-converter-control'))).toBe(false)
  })
})

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { toProcessNodeId } from '@/config/process/identifiers'
import { toSceneNodeId } from '@/config/scene-topology/identifiers'
import { getCoalTopologyResourceManifest } from './coal-topology-manifest'
import { getCoalTopologyPreviewIconPath } from './coal-topology-preview-data'
import { COAL_TOPOLOGY_VARIANTS } from './coal-topology-variant-manifest'
import {
  createCoalTopologyRuntimeBindingIndex,
  getCoalTopologyRuntimeBindings,
} from './coal-topology-runtime-bindings'
import { createGasTopologyConnectedLineIndex } from './gas-topology-connection-highlight'

const topologyRoot = resolve(process.cwd(), 'public/topology/coal-json-preview')
const statuses: readonly TopologyDeviceStatus[] = ['normal', 'alarm', 'fault', 'offline']

function readVariant(variantPath: string): Meta2dData {
  return JSON.parse(readFileSync(resolve(topologyRoot, variantPath), 'utf8')) as Meta2dData
}

describe('燃煤拓扑逐文件运行时绑定', () => {
  it('全部绑定都指向对应文件的真实设备图元、正式业务节点和四态公共资源', () => {
    // 燃煤正式拓扑来自独立场景清单，不能用只覆盖默认进程的本地数据集代替验证。
    const formalNodeIds = new Set([
      toProcessNodeId('system.boiler-dcs'),
      toProcessNodeId('system.steam-turbine-dcs'),
      toProcessNodeId('system.generator-excitation-controller'),
    ])
    const formalSceneNodeIds = new Set([
      toSceneNodeId('node.coal-boiler'),
      toSceneNodeId('node.coal-steam-turbine'),
      toSceneNodeId('node.coal-generator'),
    ])
    for (const variant of COAL_TOPOLOGY_VARIANTS) {
      const data = readVariant(variant.topologyPath)
      const penIds = new Set(data.pens.map((pen) => pen.id))
      const resources = getCoalTopologyResourceManifest(variant.id)
      const bindings = getCoalTopologyRuntimeBindings(variant.id)
      expect(new Set(bindings.map((binding) => binding.penId)).size).toBe(bindings.length)
      for (const binding of bindings) {
        expect(penIds.has(binding.penId)).toBe(true)
        expect(resources.devicePenIds.has(binding.penId)).toBe(true)
        expect(formalNodeIds.has(binding.nodeId)).toBe(true)
        expect(binding.sceneNodeId && formalSceneNodeIds.has(binding.sceneNodeId)).toBe(true)
        for (const status of statuses) {
          const relativePath = getCoalTopologyPreviewIconPath(variant.id, binding.penId, status)
          expect(relativePath).toBeTruthy()
          expect(existsSync(resolve(process.cwd(), 'public/topology/shared', relativePath!))).toBe(true)
        }
      }
    }
  })

  it('各版本反向索引互相隔离，同一业务节点仍可映射多个视觉图元', () => {
    const fullIndex = createCoalTopologyRuntimeBindingIndex('network-business-key-process')
    const keyProcessIndex = createCoalTopologyRuntimeBindingIndex('key-process')
    const generatorNodeId = toProcessNodeId('system.generator-excitation-controller')
    expect(fullIndex.penIdsByNodeId.get(generatorNodeId)).toEqual(['c1ee89f'])
    expect(keyProcessIndex.penIdsByNodeId.get(generatorNodeId)).toEqual(['8e17c6'])
    expect(keyProcessIndex.nodeIdByPenId.has('c1ee89f')).toBe(false)
  })

  it('业务单层没有设备图片时不伪造状态绑定', () => {
    expect(getCoalTopologyResourceManifest('business').devicePenIds.size).toBe(0)
    expect(getCoalTopologyRuntimeBindings('business')).toEqual([])
  })

  it('网络层加业务层不含已确认现场设备时不伪造状态绑定', () => {
    const index = createCoalTopologyRuntimeBindingIndex('network-business')
    expect(index.nodeIdByPenId.size).toBe(0)
    expect(index.penIdsByNodeId.size).toBe(0)
  })

  it('完整输入文件继续过滤已删除连线的残留引用', () => {
    const full = COAL_TOPOLOGY_VARIANTS.find((variant) => variant.id === 'network-business-key-process')!
    const data = readVariant(full.topologyPath)
    const index = createGasTopologyConnectedLineIndex(data.pens)
    const indexedLineIds = new Set([...index.values()].flat())
    expect(indexedLineIds.has('48e8e8c')).toBe(false)
    expect(indexedLineIds.has('740778a2')).toBe(false)
    expect(indexedLineIds.has('274a3d60')).toBe(false)
    expect(index.get('4d87c9a3')).toEqual(['ab58061', '30df6fe'])
  })
})

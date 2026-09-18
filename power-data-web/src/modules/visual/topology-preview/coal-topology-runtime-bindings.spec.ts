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
      toProcessNodeId('system.coal-boiler-control'),
      toProcessNodeId('system.coal-steam-turbine-control'),
      toProcessNodeId('system.coal-generator-control'),
      toProcessNodeId('asset.coal-boiler'),
      toProcessNodeId('asset.coal-steam-turbine'),
      toProcessNodeId('asset.coal-generator'),
    ])
    const formalSceneNodeIds = new Set([
      toSceneNodeId('unit.coal-boiler.control'),
      toSceneNodeId('unit.coal-steam-turbine.control'),
      toSceneNodeId('unit.coal-generator.control'),
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

  it('蒸汽轮机关键环节新输入的三类设备均接入公共四态图标', () => {
    const bindings = getCoalTopologyRuntimeBindings('process-detail-steam-turbine')
    expect(bindings.map((binding) => binding.penId)).toEqual(['429749ea', '8be4fc2', '9533a1f'])
    for (const binding of bindings) {
      expect(getCoalTopologyResourceManifest('process-detail-steam-turbine').devicePenIds.has(binding.penId)).toBe(true)
      for (const status of statuses) {
        const relativePath = getCoalTopologyPreviewIconPath('process-detail-steam-turbine', binding.penId, status)
        expect(relativePath).toBeTruthy()
        expect(existsSync(resolve(process.cwd(), 'public/topology/shared', relativePath!))).toBe(true)
      }
    }
  })

  it('各版本反向索引互相隔离，同一业务节点仍可映射多个视觉图元', () => {
    const fullIndex = createCoalTopologyRuntimeBindingIndex('network-business-key-process')
    const keyProcessIndex = createCoalTopologyRuntimeBindingIndex('key-process')
    const generatorControlNodeId = toProcessNodeId('system.coal-generator-control')
    const generatorDeviceNodeId = toProcessNodeId('asset.coal-generator')
    expect(fullIndex.penIdsByNodeId.get(generatorControlNodeId)).toEqual(['11d93d44'])
    expect(fullIndex.penIdsByNodeId.get(generatorDeviceNodeId)).toEqual(['c1ee89f'])
    expect(keyProcessIndex.penIdsByNodeId.get(generatorControlNodeId)).toEqual(['61224818'])
    expect(keyProcessIndex.penIdsByNodeId.get(generatorDeviceNodeId)).toEqual(['8e17c6'])
    expect(keyProcessIndex.nodeIdByPenId.has('c1ee89f')).toBe(false)
  })

  it('业务单层没有设备图片时不伪造状态绑定', () => {
    expect(getCoalTopologyResourceManifest('business').devicePenIds.size).toBe(0)
    expect(getCoalTopologyRuntimeBindings('business')).toEqual([])
  })

  it('网络层加业务层只登记三个上层控制系统，不伪造现场设备图元', () => {
    const index = createCoalTopologyRuntimeBindingIndex('network-business')
    expect(index.penIdsByNodeId.get(toProcessNodeId('system.coal-boiler-control'))).toEqual(['28ad5ca'])
    expect(index.penIdsByNodeId.get(toProcessNodeId('system.coal-steam-turbine-control'))).toEqual(['6d7e2838'])
    expect(index.penIdsByNodeId.get(toProcessNodeId('system.coal-generator-control'))).toEqual(['b3d4c7b'])
    expect(index.penIdsByNodeId.has(toProcessNodeId('asset.coal-boiler'))).toBe(false)
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

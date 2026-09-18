import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { localProcessConfigDataset } from '@/config/process/local-process-config'
import { toProcessNodeId } from '@/config/process/identifiers'
import { getGasV3TopologyResourceManifest } from './gas-v3-topology-manifest'
import { getGasV3TopologyPreviewIconPath } from './gas-v3-topology-preview-data'
import { GAS_V3_TOPOLOGY_VARIANTS } from './gas-v3-topology-variant-manifest'
import {
  createGasV3TopologyRuntimeBindingIndex,
  getGasV3TopologyRuntimeBindings,
} from './gas-v3-topology-runtime-bindings'
import { createGasTopologyConnectedLineIndex } from './gas-topology-connection-highlight'

const topologyRoot = resolve(process.cwd(), 'public/topology/gas-v3-json-preview')
const statuses: readonly TopologyDeviceStatus[] = ['normal', 'alarm', 'fault', 'offline']

function readVariant(variantPath: string): Meta2dData {
  return JSON.parse(readFileSync(resolve(topologyRoot, variantPath), 'utf8')) as Meta2dData
}

describe('燃气拓扑逐文件运行时绑定', () => {
  it('全部绑定都指向对应文件的真实设备图元、正式业务节点和四态公共资源', () => {
    const formalNodeIds = new Set(localProcessConfigDataset.topologies.flatMap((topology) => (
      topology.nodes.map((node) => node.nodeId)
    )))
    for (const variant of GAS_V3_TOPOLOGY_VARIANTS) {
      const data = readVariant(variant.topologyPath)
      const penIds = new Set(data.pens.map((pen) => pen.id))
      const resources = getGasV3TopologyResourceManifest(variant.id)
      const bindings = getGasV3TopologyRuntimeBindings(variant.id)
      expect(new Set(bindings.map((binding) => binding.penId)).size).toBe(bindings.length)
      for (const binding of bindings) {
        expect(penIds.has(binding.penId)).toBe(true)
        expect(resources.devicePenIds.has(binding.penId)).toBe(true)
        expect(formalNodeIds.has(binding.nodeId)).toBe(true)
        for (const status of statuses) {
          const relativePath = getGasV3TopologyPreviewIconPath(variant.id, binding.penId, status)
          expect(relativePath).toBeTruthy()
          expect(existsSync(resolve(process.cwd(), 'public/topology/shared', relativePath!))).toBe(true)
        }
      }
    }
  })

  it('各版本反向索引互相隔离，同一业务节点仍可映射多个视觉图元', () => {
    const fullIndex = createGasV3TopologyRuntimeBindingIndex('network-business-key-process')
    const keyProcessIndex = createGasV3TopologyRuntimeBindingIndex('key-process')
    expect(fullIndex.penIdsByNodeId.get(toProcessNodeId('system.gas-generator-control'))).toEqual(['0f354e'])
    expect(fullIndex.penIdsByNodeId.get(toProcessNodeId('asset.gas-generator'))).toEqual(['29b5edb2'])
    expect(keyProcessIndex.penIdsByNodeId.get(toProcessNodeId('system.gas-generator-control'))).toEqual(['ca0550f'])
    expect(keyProcessIndex.penIdsByNodeId.get(toProcessNodeId('asset.gas-generator'))).toEqual(['ef84ff0'])
    expect(keyProcessIndex.nodeIdByPenId.has('29b5edb2')).toBe(false)
  })

  it('业务单层没有设备图片时不伪造状态绑定', () => {
    expect(getGasV3TopologyResourceManifest('business').devicePenIds.size).toBe(0)
    expect(getGasV3TopologyRuntimeBindings('business')).toEqual([])
  })

  it('网络层加业务层使用纠正文件的编号同步燃气中央状态', () => {
    const index = createGasV3TopologyRuntimeBindingIndex('network-business')
    expect(index.penIdsByNodeId.get(toProcessNodeId('plant-engineering-station')))
      .toEqual(['69b370e9', '68d2510', 'fcd4c1', 'd971830'])
    expect(index.penIdsByNodeId.get(toProcessNodeId('operator-station')))
      .toEqual(['c2b04d2', '503af85f', '4d7640b9', '7d762fc'])
    // 只有网络和业务层的版本不存在现场设备层，因此这里只登记上层控制系统图元。
    expect(index.penIdsByNodeId.get(toProcessNodeId('system.gas-turbine-control'))).toEqual(['1cff0ae6'])
    expect(index.penIdsByNodeId.get(toProcessNodeId('system.gas-hrsg-control'))).toEqual(['4ffe660d'])
    expect(index.penIdsByNodeId.get(toProcessNodeId('fuel-gas-pressure-valve'))).toEqual(['064d5de'])
    expect(index.penIdsByNodeId.get(toProcessNodeId('system.gas-generator-control'))).toEqual(['3ea7f2e1'])
    expect(index.nodeIdByPenId.has('4d47e500')).toBe(false)
  })

  it('完整输入文件继续过滤已删除连线的残留引用', () => {
    const full = GAS_V3_TOPOLOGY_VARIANTS.find((variant) => variant.id === 'network-business-key-process')!
    const data = readVariant(full.topologyPath)
    const index = createGasTopologyConnectedLineIndex(data.pens)
    const indexedLineIds = new Set([...index.values()].flat())
    expect(indexedLineIds.has('3eb3333a')).toBe(false)
    expect(indexedLineIds.has('a899ba3')).toBe(false)
    expect(indexedLineIds.has('fed06ff')).toBe(false)
    expect(index.get('29b5edb2')).toContain('286202c1')
  })
})

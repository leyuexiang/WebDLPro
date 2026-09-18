import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { toProcessNodeId } from '@/config/process/identifiers'
import { getGasV3TopologyRuntimeBindings } from './gas-v3-topology-runtime-bindings'
import { projectGasV3TopologyStatusesBeforeOpen } from './gas-v3-topology-runtime-state'

function readFullTopology(): Meta2dData {
  return JSON.parse(readFileSync(resolve(
    process.cwd(),
    'public/topology/gas-v3-json-preview/variants/network-business-key-process/topology.json',
  ), 'utf8')) as Meta2dData
}

describe('燃气拓扑切层前状态投影', () => {
  it('首次打开前把同一中央快照同步到目标文件的所有对应图元', () => {
    const data = readFullTopology()
    const generatorDeviceNodeId = toProcessNodeId('asset.gas-generator')
    const statuses = new Map([[generatorDeviceNodeId, 'alarm' as TopologyDeviceStatus]])
    const projected = projectGasV3TopologyStatusesBeforeOpen(
      data,
      'network-business-key-process',
      getGasV3TopologyRuntimeBindings('network-business-key-process'),
      () => true,
      // 快照未覆盖的节点必须保留正常发布基线，离线只能由外部状态明确给出。
      (nodeId) => statuses.get(nodeId) ?? 'normal',
    )

    expect(projected.get('29b5edb2')).toBe('alarm')
    expect(projected.get('0f354e')).toBe('normal')
    expect(data.pens.find((pen) => pen.id === '29b5edb2')?.image)
      .toContain('/topology/shared/icons/alarm/generator.webp')
    expect(data.pens.find((pen) => pen.id === '0f354e')?.image)
      .toContain('/topology/shared/icons/normal/dcs.webp')
  })

  it('当前正式拓扑不存在的业务节点回退正常态，且不存在图元不会进入缓存', () => {
    const data = readFullTopology()
    const bindings = [
      ...getGasV3TopologyRuntimeBindings('network-business-key-process'),
      { penId: '不存在的图元', nodeId: toProcessNodeId('asset.gas-generator') },
    ]
    const projected = projectGasV3TopologyStatusesBeforeOpen(
      data,
      'network-business-key-process',
      bindings,
      () => false,
      () => 'fault',
    )
    expect(projected.get('29b5edb2')).toBe('normal')
    expect(projected.has('不存在的图元')).toBe(false)
  })
})

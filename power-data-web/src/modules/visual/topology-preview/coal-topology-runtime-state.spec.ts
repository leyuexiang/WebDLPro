import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { toProcessNodeId } from '@/config/process/identifiers'
import { getCoalTopologyRuntimeBindings } from './coal-topology-runtime-bindings'
import { projectCoalTopologyStatusesBeforeOpen } from './coal-topology-runtime-state'

function readFullTopology(): Meta2dData {
  return JSON.parse(readFileSync(resolve(
    process.cwd(),
    'public/topology/coal-json-preview/variants/network-business-key-process/topology.json',
  ), 'utf8')) as Meta2dData
}

describe('燃煤拓扑切层前状态投影', () => {
  it('首次打开前把同一中央快照同步到目标文件的所有对应图元', () => {
    const data = readFullTopology()
    const generatorDeviceNodeId = toProcessNodeId('asset.coal-generator')
    const statuses = new Map([[generatorDeviceNodeId, 'alarm' as TopologyDeviceStatus]])
    const projected = projectCoalTopologyStatusesBeforeOpen(
      data,
      'network-business-key-process',
      getCoalTopologyRuntimeBindings('network-business-key-process'),
      () => true,
      // 快照未覆盖的节点必须保留正常发布基线，离线只能由外部状态明确给出。
      (nodeId) => statuses.get(nodeId) ?? 'normal',
    )

    expect(projected.get('c1ee89f')).toBe('alarm')
    expect(projected.get('11d93d44')).toBe('normal')
    expect([...projected.values()]).toContain('normal')
    expect(data.pens.find((pen) => pen.id === 'c1ee89f')?.image)
      .toContain('/topology/shared/icons/alarm/generator.webp')
  })

  it('当前正式拓扑不存在的业务节点回退正常态，且不存在图元不会进入缓存', () => {
    const data = readFullTopology()
    const bindings = [
      ...getCoalTopologyRuntimeBindings('network-business-key-process'),
      { penId: '不存在的图元', nodeId: toProcessNodeId('asset.coal-generator') },
    ]
    const projected = projectCoalTopologyStatusesBeforeOpen(
      data,
      'network-business-key-process',
      bindings,
      () => false,
      () => 'fault',
    )
    expect(projected.get('c1ee89f')).toBe('normal')
    expect(projected.has('不存在的图元')).toBe(false)
  })
})

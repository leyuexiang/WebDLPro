import { readFileSync } from 'node:fs'
import type { Meta2dData } from '@meta2d/core'
import { describe, expect, it } from 'vitest'
import {
  createGasTopologyConnectedLineIndex,
  resolveGasTopologyConnectedLineIds,
} from './gas-topology-connection-highlight'

/** 使用当前正式预览数据锁定图元与连线关系，防止更新 JSON 后高亮仍引用旧编号。 */
function loadTopologyFixture(): Meta2dData {
  const topologyUrl = new URL('../../../../public/topology/gas-json-preview/topology.json', import.meta.url)
  return JSON.parse(readFileSync(topologyUrl, 'utf8')) as Meta2dData
}

describe('燃气拓扑选中连线高亮', () => {
  it('按 connectedLines 明确映射选中设备的全部直接关联连线', () => {
    const index = createGasTopologyConnectedLineIndex(loadTopologyFixture().pens)

    expect(index.get('17723a9e')).toEqual(['1ee8f2a4', 'a05ca33'])
    expect(index.get('91493e5')).toEqual(['389c38d', '81006f9', 'a05ca33'])
    expect(resolveGasTopologyConnectedLineIds(['17723a9e', '91493e5'], index)).toEqual(new Set([
      '1ee8f2a4', 'a05ca33', '389c38d', '81006f9',
    ]))
  })

  it('过滤源数据中指向已删除连线的历史残留编号', () => {
    const index = createGasTopologyConnectedLineIndex(loadTopologyFixture().pens)

    expect(index.get('2b71305')).toEqual(['fab3076'])
    expect(index.get('5f3c5f1c')).toBeUndefined()
    expect(index.get('ea88a62')).toBeUndefined()
  })
})

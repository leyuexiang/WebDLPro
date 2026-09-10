import { readFileSync } from 'node:fs'
import type { Meta2dData } from '@meta2d/core'
import { describe, expect, it } from 'vitest'
import {
  createGasTopologyConnectedLineIndex,
  resolveGasTopologyConnectedLineIds,
} from './gas-topology-connection-highlight'

/** 使用当前默认组合文件锁定图元与连线关系，避免顶层旧副本继续成为测试依赖。 */
function loadTopologyFixture(): Meta2dData {
  const topologyUrl = new URL(
    '../../../../public/topology/gas-v3-json-preview/variants/network-business-key-process/topology.json',
    import.meta.url,
  )
  return JSON.parse(readFileSync(topologyUrl, 'utf8')) as Meta2dData
}

describe('燃气拓扑选中连线高亮', () => {
  it('按 connectedLines 明确映射选中设备的全部直接关联连线', () => {
    const index = createGasTopologyConnectedLineIndex(loadTopologyFixture().pens)

    expect(index.get('29b5edb2')).toEqual(['286202c1', '41b04fa'])
    expect(index.get('868df1f')).toEqual(['8ec756', 'd4f0661'])
    expect(resolveGasTopologyConnectedLineIds(['29b5edb2', '868df1f'], index)).toEqual(new Set([
      '286202c1', '41b04fa', '8ec756', 'd4f0661',
    ]))
  })

  it('过滤源数据中指向已删除连线的历史残留编号', () => {
    const index = createGasTopologyConnectedLineIndex(loadTopologyFixture().pens)

    expect(index.get('c2bd2d5')).toEqual(['818d35f', '6138c4c', '46e767f', '169f421'])
    expect(index.get('716def7b')).toEqual(['79be0126'])
    expect(index.get('15bf99f3')).toEqual(['5a88794a', 'ea557fd', '4bbcaa12', '6138c4c'])
  })
})

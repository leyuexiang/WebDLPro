import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Meta2dData } from '@meta2d/core'
import { describe, expect, it } from 'vitest'
import {
  createGasTopologyConnectedLineIndex,
  resolveGasTopologyConnectedLineIds,
} from './gas-topology-connection-highlight'

/** 读取燃煤默认完整输入，验证公共连线索引可以跨拓扑复用且不依赖燃气专属编号。 */
function readCoalFullTopology(): Meta2dData {
  return JSON.parse(readFileSync(resolve(
    process.cwd(),
    'public/topology/coal-json-preview/variants/network-business-key-process/topology.json',
  ), 'utf8')) as Meta2dData
}

describe('燃煤拓扑关联连线高亮', () => {
  it('按输入文件的已连接线路字段合并多个已选设备的真实连线', () => {
    const index = createGasTopologyConnectedLineIndex(readCoalFullTopology().pens)
    expect(index.get('4d87c9a3')).toEqual(['ab58061', '30df6fe'])
    expect(index.get('69d36f83')).toEqual(['7684686b', '4e00f03'])
    expect(resolveGasTopologyConnectedLineIds(['4d87c9a3', '69d36f83'], index)).toEqual(new Set([
      'ab58061', '30df6fe', '7684686b', '4e00f03',
    ]))
  })

  it('过滤输入文件中指向已删除连线的历史残留编号', () => {
    const index = createGasTopologyConnectedLineIndex(readCoalFullTopology().pens)
    const indexedLineIds = new Set([...index.values()].flat())
    expect(indexedLineIds.has('48e8e8c')).toBe(false)
    expect(indexedLineIds.has('740778a2')).toBe(false)
    expect(indexedLineIds.has('274a3d60')).toBe(false)
  })
})

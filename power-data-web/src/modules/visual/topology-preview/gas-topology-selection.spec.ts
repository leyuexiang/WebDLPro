import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Meta2dData } from '@meta2d/core'
import {
  applyGasTopologySelectionPolicy,
  GAS_TOPOLOGY_BACKGROUND_LOCK,
  GAS_TOPOLOGY_SELECTABLE_LOCK,
} from './gas-topology-selection'

/** 直接读取当前预览使用的真实数据，避免测试样例与后续拓扑文件更新脱节。 */
function loadTopologyFixture(): Meta2dData {
  const topologyUrl = new URL('../../../../public/topology/gas-json-preview/topology.json', import.meta.url)
  return JSON.parse(readFileSync(topologyUrl, 'utf8')) as Meta2dData
}

describe('燃气拓扑选择规则', () => {
  it('只允许设备图元和底部工艺流程小矩形进入选中态', () => {
    const data = loadTopologyFixture()

    const selectableIds = applyGasTopologySelectionPolicy(data.pens)
    const selectablePens = data.pens.filter((pen) => pen.locked !== GAS_TOPOLOGY_BACKGROUND_LOCK)
    const selectableImages = selectablePens.filter((pen) => Boolean(pen.image))
    const selectableProcessRectangles = selectablePens.filter((pen) => pen.name === 'rectangle')

    // 燃气（2）数据包含 128 个图元：54 个设备图片、11 个工艺流程小矩形可选，其余背景与连线禁用命中。
    expect(data.name).toBe('燃气')
    expect(data.pens).toHaveLength(128)
    expect(selectableIds.size).toBe(65)
    expect(selectablePens).toHaveLength(65)
    expect(selectableImages).toHaveLength(54)
    expect(selectableProcessRectangles).toHaveLength(11)
    expect(data.pens.find((pen) => pen.text?.trim() === '企业办公网')?.locked).toBe(GAS_TOPOLOGY_BACKGROUND_LOCK)
    expect(data.pens.find((pen) => pen.text?.trim() === '主控监控')?.locked).toBe(GAS_TOPOLOGY_BACKGROUND_LOCK)
    expect(data.pens.find((pen) => pen.text?.trim() === '高压天然气')?.locked).toBe(GAS_TOPOLOGY_SELECTABLE_LOCK)
    expect(data.pens.filter((pen) => pen.name === 'line')).toHaveLength(36)
    expect(data.pens.filter((pen) => pen.name === 'line').every((pen) => pen.locked === GAS_TOPOLOGY_BACKGROUND_LOCK)).toBe(true)
  })

  it('保留新版 JSON 中每条连线的双端节点映射', () => {
    const data = loadTopologyFixture()
    const penById = new Map(data.pens.map((pen) => [pen.id, pen]))
    const lines = data.pens.filter((pen) => pen.name === 'line')

    for (const line of lines) {
      // 组态连线首尾锚点必须落到真实图元，且端点图元须反向登记同一 lineId，二者共同构成可编辑的连接关系。
      const firstAnchor = line.anchors?.[0]
      const lastAnchor = line.anchors?.at(-1)
      expect(firstAnchor?.connectTo, `连线 ${line.id} 缺少起点映射`).toBeTruthy()
      expect(lastAnchor?.connectTo, `连线 ${line.id} 缺少终点映射`).toBeTruthy()

      for (const endpointId of [firstAnchor?.connectTo, lastAnchor?.connectTo]) {
        const endpoint = penById.get(endpointId)
        expect(endpoint, `连线 ${line.id} 指向不存在的图元 ${endpointId}`).toBeDefined()
        expect(endpoint?.connectedLines?.some((connection) => connection.lineId === line.id)).toBe(true)
      }
    }
  })
})

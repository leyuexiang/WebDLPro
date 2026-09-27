import type { Pen } from '@meta2d/core'
import { describe, expect, it } from 'vitest'
import { flattenSubstationTopologyCombines } from './substation-topology-combine-flattener'

function createPen(values: Partial<Pen>): Pen {
  return values as Pen
}

describe('变电站拓扑组合展开', () => {
  it('递归换算嵌套组合坐标并让所有子图元脱离组合', () => {
    const pens = [
      createPen({ id: 'root', name: 'combine', x: 100, y: 200, width: 100, height: 50, children: ['nested', 'sibling'] }),
      createPen({ id: 'nested', name: 'combine', parentId: 'root', x: 0.1, y: 0.2, width: 0.5, height: 0.5, children: ['device'] }),
      createPen({ id: 'device', name: 'gif', parentId: 'nested', x: 0.5, y: 0.5, width: 0.2, height: 0.4 }),
      createPen({ id: 'sibling', name: 'rectangle', parentId: 'root', x: 0.4, y: 0.4, width: 0.1, height: 0.1 }),
    ]

    expect(flattenSubstationTopologyCombines(pens, '测试场景/完整图')).toBe(2)
    expect(pens.map((pen) => pen.id)).toEqual(['device', 'sibling'])
    expect(pens.every((pen) => pen.parentId === undefined)).toBe(true)
    expect(pens[0]).toMatchObject({ x: 135, y: 222.5, width: 10, height: 10 })
    expect(pens[1]).toMatchObject({ x: 140, y: 220, width: 10, height: 5 })
  })

  it('组合边界无效时停止加载并给出图元编号', () => {
    const pens = [
      createPen({ id: 'invalid-root', name: 'combine', x: 0, y: 0, width: Number.NaN, height: 1 }),
    ]

    expect(() => flattenSubstationTopologyCombines(pens, '测试场景/网络图'))
      .toThrow('测试场景/网络图拓扑组合坐标无效：invalid-root。')
  })
})

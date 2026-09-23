import { describe, expect, it } from 'vitest'
import type { Pen } from '@meta2d/core'
import { getSubstationTopologySelectablePenIds } from './substation-topology-node-selection'

function pen(partial: Partial<Pen>): Pen {
  return { id: 'node', name: 'rectangle', x: 0, y: 0, width: 1, height: 1, ...partial } as Pen
}

describe('站类拓扑节点可选索引', () => {
  it('开放所有图片设备和连线端点，排除标题、连线及未连接装饰', () => {
    const pens = [
      pen({ id: 'device', name: 'gif', image: '/device.png' }),
      pen({ id: 'unbound-device', name: 'gif', image: '/unbound.png' }),
      pen({ id: 'process', text: '工艺节点' }),
      pen({ id: 'title', name: 'gif', image: '/title.png' }),
      pen({ id: 'ornament', name: 'rectangle', text: '···' }),
      pen({ id: 'line', name: 'line', anchors: [{ x: 0, y: 0, connectTo: 'process' }] }),
    ]
    const ids = getSubstationTopologySelectablePenIds(pens, {
      devicePenIds: new Set(['device']),
      processNodePenIds: new Set(),
      titleBackgroundPenIds: new Set(['title']),
    })

    expect([...ids]).toEqual(expect.arrayContaining(['device', 'unbound-device', 'process']))
    expect(ids.has('title')).toBe(false)
    expect(ids.has('ornament')).toBe(false)
    expect(ids.has('line')).toBe(false)
  })
})

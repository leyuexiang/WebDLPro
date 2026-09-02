import { describe, expect, it } from 'vitest'
import type { Pen } from '@meta2d/core'
import {
  applyGasTopologyLayerVisibility,
  createDefaultGasTopologyFilterSelection,
  createGasTopologyLayerBindingIndex,
  createGasTopologyVisibilityRuleIndex,
  isGasTopologyPenVisible,
  toggleGasTopologyFilter,
} from './gas-topology-layer-filter'

function rectangle(id: string, x: number, y: number, width: number, height: number, text?: string): Pen {
  return { id, name: 'rectangle', x, y, width, height, text } as Pen
}

describe('新版燃气拓扑分层筛选', () => {
  it('初始状态勾选四个顶层范围', () => {
    const selected = createDefaultGasTopologyFilterSelection()
    expect(selected.size).toBe(4)
    expect([...selected]).toEqual(['architecture', 'network', 'physical', 'business'])
  })

  it('四个顶层复选框彼此独立', () => {
    let selected = createDefaultGasTopologyFilterSelection()
    selected = toggleGasTopologyFilter(selected, 'network', false)
    expect(selected).toEqual(new Set(['physical', 'business']))
    selected = toggleGasTopologyFilter(selected, 'network', true)
    expect(selected.size).toBe(4)
  })

  it('取消任一内容层时取消架构层全选标记，重新选齐后恢复', () => {
    let selected = createDefaultGasTopologyFilterSelection()
    selected = toggleGasTopologyFilter(selected, 'network', false)
    expect(selected.has('architecture')).toBe(false)
    expect(selected).toEqual(new Set(['physical', 'business']))

    selected = toggleGasTopologyFilter(selected, 'network', true)
    expect(selected).toEqual(new Set(['architecture', 'network', 'physical', 'business']))
  })

  it('架构层是全部快捷开关，不会在部分层级开启时单独放行背景图元', () => {
    const pens = [
      rectangle('a3ccee3', 0, 0, 100, 10, '总边界'),
      rectangle('ba3df5b', 0, 10, 100, 20, '企业办公网'),
      rectangle('5381c5cc', 0, 30, 100, 20, '现场控制与保护区'),
    ]
    const index = createGasTopologyLayerBindingIndex(pens)
    const selected = new Set(['physical', 'business'] as const)
    expect(isGasTopologyPenVisible('a3ccee3', index, selected)).toBe(false)
    expect(isGasTopologyPenVisible('ba3df5b', index, selected)).toBe(false)
    expect(isGasTopologyPenVisible('5381c5cc', index, selected)).toBe(true)
  })

  it('工业非军事区外框内的节点和连线共享网络层标签', () => {
    const pens = [
      rectangle('ba3df5b', 0, 0, 100, 100, '企业办公网'),
      rectangle('193eacbe', 0, 100, 100, 100, '工业非军事区'),
      rectangle('mirror-server', 20, 120, 20, 10, '镜像服务器'),
      { id: 'dmz-line', name: 'line', x: 40, y: 145, width: 0, height: 40 } as Pen,
      rectangle('2ce9ba7c', 0, 200, 100, 100, '监控层'),
    ]
    const index = createGasTopologyLayerBindingIndex(pens)
    const selected = new Set(['network'] as const)

    expect(isGasTopologyPenVisible('193eacbe', index, selected)).toBe(true)
    expect(isGasTopologyPenVisible('mirror-server', index, selected)).toBe(true)
    expect(isGasTopologyPenVisible('dmz-line', index, selected)).toBe(true)
    expect(isGasTopologyPenVisible('2ce9ba7c', index, selected)).toBe(true)
  })

  it('跨区域连线在任一关联层打开时保持可见', () => {
    const pens = [
      rectangle('ba3df5b', 0, 0, 100, 100, '企业办公网'),
      rectangle('193eacbe', 0, 100, 100, 100, '工业非军事区'),
      { id: 'cross-line', name: 'line', x: 50, y: 90, width: 0, height: 30 } as Pen,
    ]
    const index = createGasTopologyLayerBindingIndex(pens)
    expect(index.get('cross-line')).toEqual(['network'])
  })

  it('监控层到现场控制与保护区的过渡连线只归属网络层', () => {
    const pens = [
      rectangle('2ce9ba7c', 0, 0, 100, 100, '监控层'),
      rectangle('5381c5cc', 0, 100, 100, 100, '现场控制与保护区'),
      { id: '3635ba34', name: 'line', x: 50, y: 80, width: 0, height: 40 } as Pen,
    ]
    const index = createGasTopologyLayerBindingIndex(pens)
    expect(index.get('3635ba34')).toEqual(['network'])
    const rules = createGasTopologyVisibilityRuleIndex(pens, index)
    expect(isGasTopologyPenVisible('3635ba34', index, new Set(['physical']), rules)).toBe(false)
    expect(isGasTopologyPenVisible('3635ba34', index, new Set(['network']), rules)).toBe(true)
  })

  it('监控设备到控制站群的跨区折线路径只归属网络层', () => {
    const pens = [
      rectangle('2ce9ba7c', 0, 0, 100, 100, '监控层'),
      rectangle('5381c5cc', 0, 100, 100, 100, '现场控制与保护区'),
      { id: '3635ba34', name: 'line', x: 10, y: 80, width: 1, height: 120 } as Pen,
      { id: '1128aba', name: 'line', x: 10, y: 80, width: 30, height: 120 } as Pen,
      { id: '8a7eebc', name: 'line', x: 40, y: 80, width: 30, height: 120 } as Pen,
      { id: '31f33786', name: 'line', x: 40, y: 120, width: 60, height: 60 } as Pen,
      { id: '88b5b81', name: 'line', x: 70, y: 80, width: 0, height: 120 } as Pen,
      { id: '6237dffb', name: 'line', x: 70, y: 80, width: 30, height: 120 } as Pen,
      { id: '6a5459ac', name: 'line', x: 90, y: 80, width: 10, height: 120 } as Pen,
    ]
    const index = createGasTopologyLayerBindingIndex(pens)
    const rules = createGasTopologyVisibilityRuleIndex(pens, index)
    const selected = new Set(['physical'] as const)

    for (const id of ['3635ba34', '1128aba', '8a7eebc', '31f33786', '88b5b81', '6237dffb', '6a5459ac']) {
      expect(index.get(id)).toEqual(['network'])
      expect(isGasTopologyPenVisible(id, index, selected, rules)).toBe(false)
    }
  })

  it('应用筛选时只改显隐字段，不改坐标和尺寸', () => {
    const pens = [
      rectangle('ba3df5b', 0, 0, 100, 100, '企业办公网'),
      rectangle('596a1783', 0, 100, 100, 100, '现场设备'),
    ]
    const index = createGasTopologyLayerBindingIndex(pens)
    const original = pens.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }))
    applyGasTopologyLayerVisibility(pens, index, new Set(['network']), createGasTopologyVisibilityRuleIndex(pens, index))
    expect(pens[0]?.visible).toBe(true)
    expect(pens[1]?.visible).toBe(false)
    expect(pens.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }))).toEqual(original)
  })

  it('现场设备到工艺流程的连线必须同时开启物理层和业务层', () => {
    const pens = [
      rectangle('596a1783', 0, 0, 100, 100, '现场设备'),
      rectangle('8a9dd95', 0, 100, 100, 100, '工艺流程'),
      { id: 'f31902e', name: 'line', x: 50, y: 90, width: 0, height: 30 } as Pen,
    ]
    const index = createGasTopologyLayerBindingIndex(pens)
    const rules = createGasTopologyVisibilityRuleIndex(pens, index)
    expect(isGasTopologyPenVisible('f31902e', index, new Set(['physical']), rules)).toBe(false)
    expect(isGasTopologyPenVisible('f31902e', index, new Set(['business']), rules)).toBe(false)
    expect(isGasTopologyPenVisible('f31902e', index, new Set(['physical', 'business']), rules)).toBe(true)
  })

  it('工艺流程内部虚线只需要业务层，物理层关闭时仍保持显示', () => {
    const pens = [
      rectangle('8a9dd95', 0, 0, 100, 100, '工艺流程'),
      { id: 'e6b42b6', name: 'line', x: 50, y: 20, width: 0, height: 30 } as Pen,
    ]
    const index = createGasTopologyLayerBindingIndex(pens)
    const rules = createGasTopologyVisibilityRuleIndex(pens, index)
    expect(isGasTopologyPenVisible('e6b42b6', index, new Set(['business']), rules)).toBe(true)
    expect(isGasTopologyPenVisible('e6b42b6', index, new Set(['physical']), rules)).toBe(false)
  })

  it('网络层关闭时监控区边框和监控连接线隐藏，物理区与业务区边框保留', () => {
    const pens = [
      rectangle('2ce9ba7c', 0, 0, 100, 100, '监控层'),
      rectangle('5381c5cc', 0, 100, 100, 100, '现场控制与保护区'),
      rectangle('596a1783', 0, 200, 100, 100, '现场设备'),
      rectangle('8a9dd95', 0, 300, 100, 100, '工艺流程'),
      { id: 'fab3076', name: 'line', x: 20, y: 80, width: 0, height: 20 } as Pen,
      { id: '60b2f0', name: 'line', x: 80, y: 80, width: 0, height: 20 } as Pen,
      { id: '3635ba34', name: 'line', x: 20, y: 180, width: 0, height: 20 } as Pen,
      { id: '1128aba', name: 'line', x: 80, y: 180, width: 0, height: 20 } as Pen,
    ]
    const index = createGasTopologyLayerBindingIndex(pens)
    const rules = createGasTopologyVisibilityRuleIndex(pens, index)
    const selected = new Set(['physical', 'business'] as const)

    expect(isGasTopologyPenVisible('2ce9ba7c', index, selected, rules)).toBe(false)
    expect(isGasTopologyPenVisible('fab3076', index, selected, rules)).toBe(false)
    expect(isGasTopologyPenVisible('60b2f0', index, selected, rules)).toBe(false)
    expect(isGasTopologyPenVisible('3635ba34', index, selected, rules)).toBe(false)
    expect(isGasTopologyPenVisible('1128aba', index, selected, rules)).toBe(false)
    expect(isGasTopologyPenVisible('5381c5cc', index, selected, rules)).toBe(true)
    expect(isGasTopologyPenVisible('596a1783', index, selected, rules)).toBe(true)
    expect(isGasTopologyPenVisible('8a9dd95', index, selected, rules)).toBe(true)
  })

  it('相邻分区的浮点边界不应让监控框误绑定到物理层', () => {
    const pens = [
      rectangle('2ce9ba7c', 0, 1884.015244715479, 100, 177.3314335091224, '监控层'),
      rectangle('5381c5cc', 0, 2061.3466782245996, 100, 183.75265684441263, '现场控制与保护区'),
    ]
    const index = createGasTopologyLayerBindingIndex(pens)

    expect(index.get('2ce9ba7c')).toEqual(['architecture', 'network'])
    expect(index.get('5381c5cc')).toEqual(['architecture', 'network', 'physical'])
  })

  it('监控组合中的相对坐标子图元继承父图元的网络层', () => {
    const pens = [
      rectangle('3a026d', 0, 0, 100, 100, '控制系统监控组合'),
      { id: 'child-image', parentId: '3a026d', name: 'image', x: 0.1, y: 0.2, width: 0.3, height: 0.4 } as Pen,
    ]
    const index = createGasTopologyLayerBindingIndex(pens)

    expect(index.get('3a026d')).toEqual(['network'])
    expect(index.get('child-image')).toEqual(['network'])
  })
})

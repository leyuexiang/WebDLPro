import type { LockState, Pen } from '@meta2d/core'
import { describe, expect, it } from 'vitest'
import { toProcessNodeId } from '@/config/process/identifiers'
import { resolveManifestTopologyClickSelection } from './manifest-topology-click-selection'

const SELECTABLE_LOCK = 1 as LockState
const DISABLED_LOCK = 10 as LockState

function createPen(id: string, locked: LockState, name = 'gif'): Pen {
  return { id, locked, name } as unknown as Pen
}

describe('清单拓扑统一点击选择', () => {
  it('有业务映射的可选图元继续提交节点编号', () => {
    const nodeId = toProcessNodeId('system.demo-control')
    const pen = createPen('mapped-device', SELECTABLE_LOCK)

    expect(resolveManifestTopologyClickSelection(pen, new Map([[pen.id!, nodeId]]))).toEqual({
      kind: 'select',
      pen,
      nodeId,
    })
  })

  it('没有业务或三维映射的可选图元仍作为拓扑节点选择提交', () => {
    const pen = createPen('unmapped-device', SELECTABLE_LOCK)

    expect(resolveManifestTopologyClickSelection(pen, new Map())).toEqual({ kind: 'select', pen })
  })

  it('禁用图元、连线和空白点击继续走清除选择分支', () => {
    expect(resolveManifestTopologyClickSelection(createPen('background', DISABLED_LOCK), new Map()))
      .toEqual({ kind: 'clear' })
    expect(resolveManifestTopologyClickSelection(createPen('wire', SELECTABLE_LOCK, 'line'), new Map()))
      .toEqual({ kind: 'clear' })
    expect(resolveManifestTopologyClickSelection(undefined, new Map())).toEqual({ kind: 'clear' })
  })
})

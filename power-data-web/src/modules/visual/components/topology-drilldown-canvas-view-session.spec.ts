import { describe, expect, it } from 'vitest'
import { toTopologyKey } from '@/config/process/identifiers'
import { TopologyDrilldownCanvasViewSession } from '@/modules/visual/components/topology-drilldown-canvas-view-session'

describe('拓扑下钻画布视图会话', () => {
  it('拓扑切换关闭下钻时丢弃旧拓扑视图，不把它恢复到新拓扑', () => {
    const session = new TopologyDrilldownCanvasViewSession()
    session.capture(toTopologyKey('topology.old'), { zoom: 1.6, offsetX: 42, offsetY: -18 })

    expect(session.finish('topology-change')).toBeUndefined()
    expect(session.finish('regular-close')).toBeUndefined()
  })

  it('普通关闭下钻时只返回一次原拓扑视图快照', () => {
    const session = new TopologyDrilldownCanvasViewSession()
    session.capture(toTopologyKey('topology.current'), { zoom: 1.25, offsetX: 18, offsetY: -12 })

    expect(session.finish('regular-close')).toEqual({
      topologyKey: 'topology.current',
      viewState: { zoom: 1.25, offsetX: 18, offsetY: -12 },
    })
    expect(session.finish('regular-close')).toBeUndefined()
  })
})

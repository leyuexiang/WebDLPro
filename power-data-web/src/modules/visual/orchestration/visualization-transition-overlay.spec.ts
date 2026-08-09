import { describe, expect, it } from 'vitest'
import { toSceneId, toTopologyId, toTransitionId } from '@/config/scene-topology/identifiers'
import { getVisualizationTransitionOverlayState } from '@/modules/visual/orchestration/visualization-transition-overlay'

describe('getVisualizationTransitionOverlayState', () => {
  it('只在完整准备事务期间显示脱敏遮罩', () => {
    const state = getVisualizationTransitionOverlayState({
      activeTransitionId: toTransitionId('transition.prepare'),
      targetSceneId: toSceneId('gas-power'),
      targetTopologyId: toTopologyId('topology.gas.overview'),
      runtimeStatus: 'preparing',
      sceneLoadProgress: null,
    })

    expect(state).toEqual({ visible: true, message: '正在准备拓扑视图，请稍候。', progressPercent: null })
    expect(state.message).not.toContain('gas-power')
  })

  it('跨场景切换时持续遮罩，直到协调器完成或失败清空目标字段', () => {
    expect(getVisualizationTransitionOverlayState({
      activeTransitionId: toTransitionId('transition.switch'),
      targetSceneId: toSceneId('wind-power'),
      targetTopologyId: toTopologyId('topology.wind.overview'),
      runtimeStatus: 'switching',
      sceneLoadProgress: { stageCode: 'loading-scene', progress: 0.6 },
    })).toEqual({ visible: true, message: '正在加载目标三维场景（60%），请稍候。', progressPercent: 60 })

    expect(getVisualizationTransitionOverlayState({
      activeTransitionId: null,
      targetSceneId: null,
      targetTopologyId: null,
      runtimeStatus: 'ready',
      sceneLoadProgress: null,
    })).toEqual({ visible: false, message: '', progressPercent: null })
  })

  it('不完整或迟到的事务状态不能锁住已恢复的稳定视图', () => {
    expect(getVisualizationTransitionOverlayState({
      activeTransitionId: toTransitionId('transition.stale'),
      targetSceneId: toSceneId('solar-power'),
      targetTopologyId: null,
      runtimeStatus: 'switching',
      sceneLoadProgress: { stageCode: 'loading-scene', progress: 0.5 },
    })).toEqual({ visible: false, message: '', progressPercent: null })
  })
})

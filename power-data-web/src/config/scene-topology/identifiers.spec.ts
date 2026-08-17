import { describe, expect, it } from 'vitest'
import {
  SCENE_IDS,
  isSceneId,
  toActionId,
  toNodeId,
  toSceneId,
  toSceneNodeId,
  toSelectionId,
  toSessionId,
  toTopologyId,
  toTransitionId,
  validateStableIdentifier,
} from './identifiers'
import type { ActionId, NodeId, SceneId, SceneNodeId, SelectionId, SessionId, TopologyId, TransitionId } from './identifiers'

/** 仅用于编译期断言：任意一类业务标识若可赋值给另一类，类型检查会立即失败。 */
type Expect<TValue extends true> = TValue
type IsAssignable<TSource, TTarget> = [TSource] extends [TTarget] ? true : false

/** 稳定标识的编译期领域隔离契约，保留导出以使类型检查始终覆盖这些断言。 */
export type StableIdentifierBrandContract = [
  Expect<IsAssignable<TopologyId, SceneId> extends false ? true : false>,
  Expect<IsAssignable<ActionId, NodeId> extends false ? true : false>,
  Expect<IsAssignable<NodeId, SceneNodeId> extends false ? true : false>,
  Expect<IsAssignable<SelectionId, TransitionId> extends false ? true : false>,
  Expect<IsAssignable<SessionId, TransitionId> extends false ? true : false>,
]

/** 任务-004回归：固定场景目录与三类不互换标识必须同时在运行时和类型层受到保护。 */
describe('场景拓扑稳定标识', () => {
  it('只发布九个固定场景标识', () => {
    expect(SCENE_IDS).toHaveLength(9)
    expect(toSceneId('gas-power')).toBe('gas-power')
    expect(isSceneId('gas-power')).toBe(true)
    expect(isSceneId('gas-overview')).toBe(false)
    expect(() => toSceneId('gas-overview')).toThrow('固定九场景目录')
    expect(() => toSceneId('SampleScene')).toThrow('固定九场景目录')
    expect(() => toSceneId('Assets/Scenes/SampleScene.unity')).toThrow('固定九场景目录')
  })

  it('拒绝标题、路径和资源文件名作为外部标识', () => {
    expect(validateStableIdentifier('燃气轮机')).not.toHaveLength(0)
    expect(validateStableIdentifier('Assets/Scenes/SampleScene.unity')).not.toHaveLength(0)
    expect(validateStableIdentifier('gas-turbine.fbx')).not.toHaveLength(0)
  })

  it('分别创建二维节点、三维节点和动作标识', () => {
    // 断言保留运行时字符串值；品牌隔离由 TypeScript 编译期检查，测试不使用不安全的强制转换。
    expect(toNodeId('gas-power.turbine-node')).toBe('gas-power.turbine-node')
    expect(toSceneNodeId('gas-turbine')).toBe('gas-turbine')
    expect(toSelectionId('selection.topology.01')).toBe('selection.topology.01')
    expect(toActionId('gas-power.turbine')).toBe('gas-power.turbine')
    expect(toTopologyId('gas-power.overview')).toBe('gas-power.overview')
    expect(toSessionId('session.embed.01')).toBe('session.embed.01')
    expect(toTransitionId('transition.open.01')).toBe('transition.open.01')
  })
})

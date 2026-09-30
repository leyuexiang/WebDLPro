// @vitest-environment happy-dom
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TopologyPanel from './TopologyPanel.vue'
import { toTopologyKey } from '@/config/process/identifiers'
import type { TopologyDefinition } from '@/config/process/types'
import { getProcessDetailTopologyDataContext } from '../topology/process-detail-topology-contexts'

const engine = vi.hoisted(() => ({ fit: vi.fn(), open: vi.fn(), destroy: vi.fn() }))
vi.mock('@meta2d/core', () => ({
  LockState: { DisableEdit: 1 },
  Meta2d: class {
    store = { data: { scale: 1 } }
    fitView = engine.fit
    open = engine.open
    destroy = engine.destroy
    on() {} off() {} lock() {} resize() {}
  },
}))
vi.mock('../topology-preview/solar-topology-preview-data', () => ({ loadSolarTopologyPreviewData: async () => ({ pens: [] }) }))
vi.mock('../topology-preview/wind-topology-preview-data', () => ({ loadWindTopologyPreviewData: async () => ({ pens: [], source: 'overview' }) }))
vi.mock('../topology-preview/wind-process-detail-topology-data', () => ({
  loadWindProcessDetailTopologyData: async (context: { contextId: string }) => ({ pens: [], source: context.contextId }),
}))
vi.mock('../topology-preview/step-up-substation-topology-preview-data', () => ({
  loadStepUpSubstationTopologyPreviewData: async () => ({ pens: [] }),
}))
vi.mock('../topology-preview/step-down-substation-topology-preview-data', () => ({
  loadStepDownSubstationTopologyPreviewData: async () => ({ pens: [] }),
}))
vi.mock('../topology-preview/converter-station-topology-preview-data', () => ({
  loadConverterStationTopologyPreviewData: async () => ({ pens: [] }),
}))
vi.mock('../topology-preview/switching-station-topology-preview-data', () => ({
  loadSwitchingStationTopologyPreviewData: async () => ({ pens: [] }),
}))
vi.mock('../topology-preview/CoalTopologyRuntimeCanvas.vue', () => ({ default: { render: () => null } }))
vi.mock('../topology-preview/GasV3TopologyRuntimeCanvas.vue', () => ({ default: { render: () => null } }))
// 面板契约测试验证公共入口与事件转发；光伏画布本身由其专项测试覆盖，替身暴露真实控制器所需的受控接口。
vi.mock('../topology-preview/SolarTopologyJsonPreview.vue', () => ({ default: {
  setup(_props: unknown, { expose }: { expose: (value: unknown) => void }) {
    // 光伏正式画布还暴露第三层上下文换源端口，面板转发测试需保留完整受控接口。
    expose({ ready: true, resetView: engine.fit, setSuspended() {}, setTopology() {}, setTopologyDataContext() {}, setNodeStatuses() {}, setSelection() {}, dispose() {} })
    return () => h('button', {
      class: 'topology-fullscreen-button',
      onClick: (event: { currentTarget: TestElement }) => {
        let node: TestElement | null = event.currentTarget
        while (node && node.props.class !== 'topology-panel') node = node.parent
        if (node) fullscreen(node)
      },
    })
  },
} }))
vi.mock('../topology-preview/BusinessSceneTopologyJsonPreview.vue', () => ({ default: {
  props: ['sceneId'],
  setup(props: { sceneId: string }) {
    return () => h('div', { class: 'business-scene-preview', 'data-scene-id': props.sceneId })
  },
} }))
// 空拓扑替身仍遵守真实控制器契约，避免把替身缺方法误判为正式面板错误。
vi.mock('./TopologyCanvas.vue', () => ({ default: {
  setup(_props: unknown, { expose }: { expose: (value: unknown) => void }) {
    expose({ setSuspended() {}, setTopology() {}, setNodeStatuses() {}, setSelection() {}, dispose() {} })
    return () => null
  },
} }))

/** 自定义宿主只替代浏览器和绘图库，实际挂载面板、风光组件及按钮，验证调用链而非源码字符串。 */
interface TestElement {
  tag: string; children: TestElement[]; parent: TestElement | null
  props: Record<string, any>; style: Record<string, any>
  clientWidth: number; clientHeight: number
  querySelectorAll: () => { complete: boolean }[]
  requestFullscreen: () => Promise<void>
}
const fullscreen = vi.fn()
function element(tag: string): TestElement {
  return markRaw({ tag, children: [], parent: null, props: {}, style: {}, clientWidth: 850, clientHeight: 420,
    querySelectorAll: () => [{ complete: true }], requestFullscreen: async function () { fullscreen(this) } })
}
const renderer = createRenderer<TestElement, TestElement>({
  createElement: element, createText: () => element('#text'), createComment: () => element('#comment'),
  setText() {}, setElementText() {}, patchProp: (node, key, _old, value) => { node.props[key] = value },
  insert(node, parent, anchor) { node.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1; if (index < 0) parent.children.push(node); else parent.children.splice(index, 0, node) },
  remove(node) { if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node) },
  parentNode: (node) => node.parent, nextSibling: () => null,
})
/** 查找全部匹配节点，验证本地测试期隐藏重置按钮时页面中没有残留副本。 */
function findAll(root: TestElement, predicate: (node: TestElement) => boolean): TestElement[] {
  const matches: TestElement[] = []
  const queue = [root]
  while (queue.length) {
    const node = queue.shift()!
    if (predicate(node)) matches.push(node)
    queue.push(...node.children)
  }
  return matches
}
let frames: Map<number, FrameRequestCallback>
let dispose: (() => void) | undefined
beforeEach(() => {
  vi.clearAllMocks()
  frames = new Map()
  let frameId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {}, fullscreenElement: null })
})
afterEach(() => { dispose?.(); dispose = undefined; vi.unstubAllGlobals() })
async function settle() {
  for (let i = 0; i < 8; i++) { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); await nextTick() }
}

describe('风电正式面板第三层拓扑', () => {
  it('风机、齿轮箱和总览在同一画布切换，暂停期间只恢复最后的上下文', async () => {
    const root = element('root')
    const state = reactive({ suspended: false })
    let panel: InstanceType<typeof TopologyPanel> | null = null
    const topology = { topologyKey: toTopologyKey('topology.wind-power.overview'), title: '风电', configVersion: 'test', nodes: [], edges: [] } as TopologyDefinition
    const app = renderer.createApp({ render: () => h(TopologyPanel, {
      ref: (value: unknown) => { panel = value as InstanceType<typeof TopologyPanel> },
      topology, selectedNodeIds: [], selectedRouteIds: [], suspended: state.suspended,
    }) })
    app.mount(root); dispose = () => app.unmount()
    await settle()
    const controller = panel!.getCanvasController()!
    expect(engine.open.mock.lastCall?.[0].source).toBe('overview')
    for (const detail of ['wind-turbine', 'gearbox', 'wind-turbine']) {
      const context = getProcessDetailTopologyDataContext(`process-detail.wind-power.${detail}`)!
      controller.setTopologyDataContext!(context)
      await settle()
      expect(engine.open.mock.lastCall?.[0].source).toBe(context.contextId)
    }
    state.suspended = true; await settle()
    const opened = engine.open.mock.calls.length
    controller.setTopologyDataContext!(getProcessDetailTopologyDataContext('process-detail.wind-power.gearbox'))
    await settle()
    expect(engine.open).toHaveBeenCalledTimes(opened)
    state.suspended = false; await settle()
    expect(engine.open.mock.lastCall?.[0].source).toBe('process-detail.wind-power.gearbox')
    controller.setTopologyDataContext!(undefined)
    await settle()
    expect(engine.open.mock.lastCall?.[0].source).toBe('overview')
    expect(engine.destroy).not.toHaveBeenCalled()
  })
})

describe.each([
  ['microgrid', '微电网'],
  ['distribution', '配电站'],
  ['consumption', '楼宇'],
])('%s 新业务场景正式面板', (sceneId, title) => {
  it('按稳定总览拓扑键挂载对应共享 JSON 画布', async () => {
    const root = element('root')
    const topology = {
      topologyKey: toTopologyKey(`topology.${sceneId}.overview`),
      title,
      configVersion: 'test',
      nodes: [],
      edges: [],
    } as TopologyDefinition
    const app = renderer.createApp({
      render: () => h(TopologyPanel, { topology, selectedNodeIds: [], selectedRouteIds: [] }),
    })
    app.mount(root); dispose = () => app.unmount()
    await settle()

    /** 每个稳定拓扑键只应挂载自己的公共包装器，不能退回空的通用画布。 */
    expect(findAll(root, (node) => node.props.class === 'business-scene-preview')
      .map((node) => node.props['data-scene-id'])).toEqual([sceneId])
  })
})

describe.each(['wind-power', 'solar-power', 'step-up-substation', 'step-down-substation', 'converter-station', 'switching-station'])('%s 正式面板公共入口', (scene) => {
  it('遵守本地测试期隐藏重置入口的约定，并保留公共全屏入口', async () => {
    const root = element('root')
    const topology = { topologyKey: toTopologyKey(`topology.${scene}.overview`), title: scene, configVersion: 'test', nodes: [], edges: [] } as TopologyDefinition
    const app = renderer.createApp({ render: () => h(TopologyPanel, { topology, selectedNodeIds: [], selectedRouteIds: [] }) })
    app.mount(root); dispose = () => app.unmount()
    await settle()
    expect(findAll(root, (node) => node.props.class === 'topology-panel__reset')).toHaveLength(0)
    expect(findAll(root, (node) => node.props.class === 'topology-fullscreen-button')).toHaveLength(1)
  })
})

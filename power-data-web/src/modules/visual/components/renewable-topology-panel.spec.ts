// @vitest-environment happy-dom
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TopologyPanel from './TopologyPanel.vue'
import { toTopologyKey } from '@/config/process/identifiers'
import type { TopologyDefinition } from '@/config/process/types'

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
vi.mock('../topology-preview/wind-topology-preview-data', () => ({ loadWindTopologyPreviewData: async () => ({ pens: [] }) }))
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
// 面板契约测试只验证公共重置与事件转发；光伏画布本身由其专项测试覆盖，替身暴露真实控制器所需的就绪与重置端口。
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
function find(root: TestElement, predicate: (node: TestElement) => boolean): TestElement {
  const queue = [root]
  while (queue.length) { const node = queue.shift()!; if (predicate(node)) return node; queue.push(...node.children) }
  throw new Error('未找到测试控件')
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

describe.each(['wind-power', 'solar-power', 'step-up-substation', 'step-down-substation', 'converter-station', 'switching-station'])('%s 正式面板重置', (scene) => {
  it('空业务清单不妨碍真实数据重置，暂停时仍禁止操作，且不重新加载图元', async () => {
    const state = reactive({ suspended: false })
    const root = element('root')
    const topology = { topologyKey: toTopologyKey(`topology.${scene}.overview`), title: scene, configVersion: 'test', nodes: [], edges: [] } as TopologyDefinition
    const app = renderer.createApp({ render: () => h(TopologyPanel, { topology, selectedNodeIds: [], selectedRouteIds: [], suspended: state.suspended }) })
    app.mount(root); dispose = () => app.unmount()
    await settle()
    const reset = find(root, (node) => node.props.class === 'topology-panel__reset')
    expect(reset.props.disabled).toBe(false)
    const opened = engine.open.mock.calls.length
    engine.fit.mockClear()
    reset.props.onClick()
    expect(engine.fit).toHaveBeenCalledTimes(1)
    expect(engine.open).toHaveBeenCalledTimes(opened)
    state.suspended = true; await nextTick()
    expect(reset.props.disabled).toBe(true)
    reset.props.onClick()
    expect(engine.fit).toHaveBeenCalledTimes(1)
    state.suspended = false; await settle()
    expect(reset.props.disabled).toBe(false)
    const button = find(root, (node) => node.props.class === 'topology-fullscreen-button')
    await button.props.onClick({ currentTarget: button })
    const panel = find(root, (node) => node.props.class === 'topology-panel')
    expect(fullscreen).toHaveBeenCalledWith(panel)
    expect(find(panel, (node) => node === reset)).toBe(reset)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { toProcessNodeId, toTopologyKey } from '@/config/process/identifiers'
import type { TopologyDefinition, TopologyDeviceStatus, TopologyNodeDefinition } from '@/config/process/types'
import { CanvasTopologyAdapter } from '@/services/topology/canvas-topology-adapter'
import { MAXIMUM_TOPOLOGY_ICON_ASSETS, REGISTERED_TOPOLOGY_ICON_KEYS } from '@/services/topology/topology-icon-registry'

/** 仅暴露断言所需的内部缓存视图，用于证明状态更新不会使路径缓存重新进入脏状态。 */
interface AdapterCacheInspection {
  routesDirty: boolean
  routeByEdgeId: Map<string, unknown>
  nodeStatusOverrideById: ReadonlyMap<string, string>
  /** 图元图片缓存仅在测试中观察，生产代码仍保持私有，避免业务层绕过受控资源登记。 */
  iconImageByUrl: Map<string, { image: { onload: unknown; onerror: unknown }; status: string }>
  /** 私有加载入口仅由回归测试调用，用于证明已登记资源的缓存容量与释放边界。 */
  getIconImage(node: TopologyNodeDefinition, deviceStatus: TopologyDeviceStatus): HTMLImageElement | undefined
}

/** 测试只读观察的矩形结构，与生产适配器缓存的画布坐标一一对应。 */
interface BoundsInspection {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 布局与路由属于适配器内部缓存，测试通过结构化只读视图核对几何结果，不把调试接口暴露给业务代码。
 */
interface AdapterGeometryInspection extends AdapterCacheInspection {
  layoutByNodeId: Map<string, {
    node: TopologyNodeDefinition
    x: number
    y: number
    width: number
    height: number
    titleBounds: BoundsInspection
    hitBounds: BoundsInspection
    routeBounds: BoundsInspection
  }>
  routeByEdgeId: Map<string, { points: readonly { x: number; y: number }[] }>
  createNodeLayouts(): void
  rebuildEdgeRoutesIfNeeded(): void
  findAvailableEdgeLabelPlacement(
    route: { points: readonly { x: number; y: number }[] },
    labelWidth: number,
    labelHeight: number,
  ): { x: number; y: number; width: number; height: number } | undefined
}

/**
 * 测试替身完整保留画布适配器会写入的图片字段，却不触发网络请求或真实 SVG 解码。
 * 因此能稳定检查加载回调是否在释放时断开，且不会让测试环境的 DOM（文档对象模型）状态影响结果。
 */
class TestImage {
  public decoding = ''
  public src = ''
  public onload: (() => void) | null = null
  public onerror: (() => void) | null = null
}

/** 四态顺序固定为发布规范中的状态全集，避免测试遗漏某一资源分支。 */
const topologyDeviceStatuses: readonly TopologyDeviceStatus[] = ['normal', 'alarm', 'fault', 'offline']

/** 最小画布不触发实际绘制；动画帧被替身拦截后，测试只验证状态更新边界。 */
function createCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
  } as unknown as HTMLCanvasElement
}

/** 使用两个节点的已发布拓扑，避免测试依赖燃气配置或文档目录图元。 */
function createTopology(): TopologyDefinition {
  return {
    topologyKey: toTopologyKey('topology.status-regression'),
    title: '状态更新回归拓扑',
    configVersion: '2026.08.04.1' as never,
    nodes: [
      { nodeId: toProcessNodeId('status-node-a'), title: '节点甲', x: 25, y: 50, iconKey: 'plc', deviceStatus: 'offline', metricKeys: [] },
      { nodeId: toProcessNodeId('status-node-b'), title: '节点乙', x: 75, y: 50, iconKey: 'plc', deviceStatus: 'normal', metricKeys: [] },
    ],
    edges: [],
  }
}

/** 五层坐标与正式燃气发布一致，用来验证低矮画布中最容易重叠的底部两层。 */
function createFiveLayerTopology(): TopologyDefinition {
  const layers = [
    { layerId: 'layer-enterprise', title: '企业层', y: 8, color: '#7dd3fc' },
    { layerId: 'layer-dmz', title: '隔离区层', y: 28, color: '#60a5fa' },
    { layerId: 'layer-plant', title: '厂级层', y: 50, color: '#38bdf8' },
    { layerId: 'layer-unit', title: '单元层', y: 69, color: '#22c55e' },
    { layerId: 'layer-field', title: '现场层', y: 88, color: '#fb923c' },
  ] as const

  return {
    topologyKey: toTopologyKey('topology.geometry-regression'),
    title: '响应式几何回归拓扑',
    configVersion: '2026.08.13.1' as never,
    layers,
    nodes: layers.map((layer, index) => ({
      nodeId: toProcessNodeId(`geometry-node-${index}`),
      title: `第${index + 1}层完整节点名称`,
      x: 50,
      y: layer.y,
      layerId: layer.layerId,
      iconKey: 'plc' as const,
      deviceStatus: 'offline' as const,
      metricKeys: [],
    })),
    edges: [],
  }
}

/** 生成最小路由拓扑，调用方只需给出百分比坐标和边端点。 */
function createRouteTopology(
  nodes: ReadonlyArray<{ id: string; x: number; y: number }>,
  edges: ReadonlyArray<{ id: string; from: string; to: string; protocolLabel?: string }>,
): TopologyDefinition {
  return {
    topologyKey: toTopologyKey('topology.route-regression'),
    title: '连线路由回归拓扑',
    configVersion: '2026.08.13.1' as never,
    nodes: nodes.map((node) => ({
      nodeId: toProcessNodeId(node.id),
      title: node.id,
      x: node.x,
      y: node.y,
      iconKey: 'plc',
      deviceStatus: 'offline',
      metricKeys: [],
    })),
    edges: edges.map((edge) => ({
      edgeId: edge.id as never,
      fromNodeId: toProcessNodeId(edge.from),
      toNodeId: toProcessNodeId(edge.to),
      title: edge.id,
      protocolLabel: edge.protocolLabel,
      evidenceStatus: 'verified',
      sceneRouteIds: [],
    })),
  }
}

/** 手动驱动布局与路由，避免单元测试依赖动画帧和真实浏览器 Canvas（画布）。 */
function prepareGeometry(adapter: CanvasTopologyAdapter, topology: TopologyDefinition, width: number, height: number): AdapterGeometryInspection {
  adapter.resize(width, height)
  adapter.setTopology(topology)
  const inspection = adapter as unknown as AdapterGeometryInspection
  inspection.layoutByNodeId.clear()
  inspection.createNodeLayouts()
  inspection.rebuildEdgeRoutesIfNeeded()
  return inspection
}

/** 根据受控图元键构造最小节点；该节点不进入业务清单，只用于驱动登记资源的缓存验证。 */
function createRegisteredIconNode(iconKey: TopologyNodeDefinition['iconKey']): TopologyNodeDefinition {
  return {
    nodeId: toProcessNodeId(`icon-cache-${iconKey}`),
    title: `${iconKey}图元缓存节点`,
    x: 50,
    y: 50,
    iconKey,
    deviceStatus: 'offline',
    metricKeys: [],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CanvasTopologyAdapter 节点状态增量', () => {
  it('状态快照不重建路径缓存，并将同一帧内连续更新合并为一次绘制', () => {
    const requestAnimationFrame = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const adapter = new CanvasTopologyAdapter(createCanvas())
    const cache = adapter as unknown as AdapterCacheInspection
    adapter.setTopology(createTopology())

    // 模拟已完成一次路径计算后的稳定缓存；状态变化后该标记与缓存条目必须原样保留。
    cache.routesDirty = false
    cache.routeByEdgeId.set('route-cache-sentinel', { immutable: true })

    adapter.setNodeStatuses(new Map([[toProcessNodeId('status-node-a'), 'fault' as const]]))
    adapter.setNodeStatuses(new Map([[toProcessNodeId('status-node-a'), 'alarm' as const]]))

    expect(cache.routesDirty).toBe(false)
    expect(cache.routeByEdgeId.get('route-cache-sentinel')).toEqual({ immutable: true })
    expect(cache.nodeStatusOverrideById.get(toProcessNodeId('status-node-a'))).toBe('alarm')
    // setTopology 已登记一个待绘制帧；两个状态快照不应再叠加新的动画帧任务。
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)

    adapter.dispose()
  })

  it('状态快照撤销覆盖值后回退到拓扑配置基线，不缓存未知节点', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const adapter = new CanvasTopologyAdapter(createCanvas())
    const cache = adapter as unknown as AdapterCacheInspection
    adapter.setTopology(createTopology())

    adapter.setNodeStatuses(new Map([
      [toProcessNodeId('status-node-a'), 'fault' as const],
      [toProcessNodeId('unknown-node'), 'alarm' as const],
    ]))
    expect(cache.nodeStatusOverrideById.size).toBe(1)

    adapter.setNodeStatuses(new Map())
    expect(cache.nodeStatusOverrideById.size).toBe(0)

    adapter.dispose()
  })

  it('视图快照可恢复缩放和平移，并拒绝无效数值带来的越界视图', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const adapter = new CanvasTopologyAdapter(createCanvas())
    adapter.resize(400, 240)
    adapter.zoomBy(0.4)
    adapter.panBy(80, -40)
    const snapshot = adapter.getViewState()

    adapter.resetZoom()
    adapter.restoreViewState(snapshot)
    expect(adapter.getViewState()).toEqual(snapshot)

    adapter.restoreViewState({ zoom: Number.NaN, offsetX: Number.POSITIVE_INFINITY, offsetY: Number.NEGATIVE_INFINITY })
    expect(adapter.getViewState()).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 })

    adapter.dispose()
  })

  it('受控图元在重复拓扑切换后只保留键目录允许的有限图片缓存', () => {
    const imageInstances: TestImage[] = []
    /** Image（图片）在生产代码中通过 new 调用，测试替身也必须是可构造类而非普通函数。 */
    class TrackingImage extends TestImage {
      public constructor() {
        super()
        imageInstances.push(this)
      }
    }

    vi.stubGlobal('Image', TrackingImage)
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const adapter = new CanvasTopologyAdapter(createCanvas())
    const cache = adapter as unknown as AdapterCacheInspection

    // 连续三次模拟“同一画布切换多个拓扑”。同一 URL 已进入缓存后不能再次创建图片对象。
    for (let switchRound = 0; switchRound < 3; switchRound += 1) {
      for (const iconKey of REGISTERED_TOPOLOGY_ICON_KEYS) {
        const node = createRegisteredIconNode(iconKey)
        for (const status of topologyDeviceStatuses) cache.getIconImage(node, status)
      }
    }

    expect(cache.iconImageByUrl.size).toBe(MAXIMUM_TOPOLOGY_ICON_ASSETS)
    expect(imageInstances).toHaveLength(MAXIMUM_TOPOLOGY_ICON_ASSETS)

    adapter.dispose()
  })

  it('释放会断开图元回调、清空图片缓存并归零高分屏画布缓冲区', () => {
    const imageInstances: TestImage[] = []
    /** 与真实 Image 构造方式一致地追踪实例，确保适配器释放的是实际缓存对象。 */
    class TrackingImage extends TestImage {
      public constructor() {
        super()
        imageInstances.push(this)
      }
    }

    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal('Image', TrackingImage)
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 7))
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
    vi.stubGlobal('devicePixelRatio', 2)

    const canvas = createCanvas()
    const adapter = new CanvasTopologyAdapter(canvas)
    const cache = adapter as unknown as AdapterCacheInspection
    const node = createRegisteredIconNode('plc')

    adapter.resize(800, 450)
    for (const status of topologyDeviceStatuses) cache.getIconImage(node, status)
    const cachedImages = [...cache.iconImageByUrl.values()].map((entry) => entry.image)

    expect(canvas.width).toBe(1600)
    expect(canvas.height).toBe(900)
    expect(imageInstances).toHaveLength(4)
    expect(cachedImages).toHaveLength(4)
    expect(cachedImages.every((image) => typeof image.onload === 'function' && typeof image.onerror === 'function')).toBe(true)

    adapter.dispose()

    expect(cancelAnimationFrame).toHaveBeenCalledWith(7)
    expect(cache.iconImageByUrl.size).toBe(0)
    expect(cachedImages.every((image) => image.onload === null && image.onerror === null)).toBe(true)
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
    expect(canvas.style.width).toBe('')
    expect(canvas.style.height).toBe('')
  })
})

describe('CanvasTopologyAdapter 响应式布局与直线优先路由', () => {
  it.each([
    [500, 108],
    [677, 188],
    [600, 240],
    [770, 336],
    [942, 257],
    [1280, 720],
    [3440, 1440],
  ])('%d×%d 下完整节点边界不与相邻层重叠', (width, height) => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const adapter = new CanvasTopologyAdapter(createCanvas())
    const inspection = prepareGeometry(adapter, createFiveLayerTopology(), width, height)
    const layouts = [...inspection.layoutByNodeId.values()].sort((left, right) => left.y - right.y)

    const expectedMinimumNodeSize = height < 160 ? 8 : height < 240 ? 18 : 28
    expect(layouts.every((layout) => layout.width >= expectedMinimumNodeSize && layout.width <= 40 && layout.width === layout.height)).toBe(true)
    expect(layouts.every((layout) => layout.hitBounds.right - layout.hitBounds.left >= 40)).toBe(true)
    for (let index = 1; index < layouts.length; index += 1) {
      expect(layouts[index]?.routeBounds.top).toBeGreaterThanOrEqual(layouts[index - 1]?.routeBounds.bottom ?? 0)
    }

    adapter.dispose()
  })

  it('图标缩小后标题仍可命中，缩放和平移时使用相同逆变换', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const adapter = new CanvasTopologyAdapter(createCanvas())
    const inspection = prepareGeometry(adapter, createFiveLayerTopology(), 600, 240)
    const layout = inspection.layoutByNodeId.get('geometry-node-2')
    expect(layout).toBeDefined()
    if (!layout) return

    adapter.zoomBy(0.4)
    adapter.panBy(30, -15)
    const state = adapter.getViewState()
    const contentX = (layout.titleBounds.left + layout.titleBounds.right) / 2
    const contentY = (layout.titleBounds.top + layout.titleBounds.bottom) / 2
    const screenX = 600 / 2 + (contentX - 600 / 2) * state.zoom + state.offsetX
    const screenY = 240 / 2 + (contentY - 240 / 2) * state.zoom + state.offsetY

    expect(adapter.pickNodeAt(screenX, screenY)).toBe(toProcessNodeId('geometry-node-2'))
    expect(adapter.pickNodeAt(2, 2)).toBeUndefined()
    adapter.dispose()
  })

  it('进入全屏展示时将图元与文字几何放大为常规态两倍，退出后可恢复常规尺寸', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const adapter = new CanvasTopologyAdapter(createCanvas())
    const topology = createTopology()
    const normalInspection = prepareGeometry(adapter, topology, 1280, 720)
    const normalLayout = normalInspection.layoutByNodeId.get('status-node-a')

    expect(normalLayout).toBeDefined()
    if (!normalLayout) return

    // 全屏倍率必须使节点盒、标题宽度与标题高度同步翻倍，保证图元、文字和碰撞边界不发生脱节。
    adapter.setPresentationScale(2)
    normalInspection.layoutByNodeId.clear()
    normalInspection.createNodeLayouts()
    const fullscreenLayout = normalInspection.layoutByNodeId.get('status-node-a')

    expect(fullscreenLayout).toBeDefined()
    if (!fullscreenLayout) return
    expect(fullscreenLayout.width).toBeGreaterThanOrEqual(normalLayout.width * 2 - 1)
    expect(fullscreenLayout.width).toBeLessThanOrEqual(normalLayout.width * 2 + 1)
    expect(fullscreenLayout.titleBounds.right - fullscreenLayout.titleBounds.left)
      .toBeCloseTo((normalLayout.titleBounds.right - normalLayout.titleBounds.left) * 2)
    expect(fullscreenLayout.titleBounds.bottom - fullscreenLayout.titleBounds.top)
      .toBeCloseTo((normalLayout.titleBounds.bottom - normalLayout.titleBounds.top) * 2)

    adapter.setPresentationScale(1)
    normalInspection.layoutByNodeId.clear()
    normalInspection.createNodeLayouts()
    expect(normalInspection.layoutByNodeId.get('status-node-a')?.width).toBe(normalLayout.width)
    adapter.dispose()
  })

  it('无障碍斜向关系直接使用两点直线，并能在法线方向放置水平协议标签', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const adapter = new CanvasTopologyAdapter(createCanvas())
    const topology = createRouteTopology(
      [{ id: 'route-a', x: 20, y: 20 }, { id: 'route-b', x: 80, y: 70 }],
      [{ id: 'edge.diagonal', from: 'route-a', to: 'route-b', protocolLabel: 'DNP3' }],
    )
    const inspection = prepareGeometry(adapter, topology, 800, 480)
    const route = inspection.routeByEdgeId.get('edge.diagonal')

    expect(route?.points).toHaveLength(2)
    expect(route?.points[0]?.x).not.toBe(route?.points[1]?.x)
    expect(route?.points[0]?.y).not.toBe(route?.points[1]?.y)
    expect(route && inspection.findAvailableEdgeLabelPlacement(route, 40, 12)).toBeDefined()
    adapter.dispose()
  })

  it('直线穿过第三方节点时改用最少拐点绕行', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const adapter = new CanvasTopologyAdapter(createCanvas())
    const topology = createRouteTopology(
      [
        { id: 'obstacle-a', x: 20, y: 50 },
        { id: 'obstacle-middle', x: 50, y: 50 },
        { id: 'obstacle-b', x: 80, y: 50 },
      ],
      [{ id: 'edge.obstacle', from: 'obstacle-a', to: 'obstacle-b' }],
    )
    const inspection = prepareGeometry(adapter, topology, 800, 480)

    expect(inspection.routeByEdgeId.get('edge.obstacle')?.points.length).toBeGreaterThan(2)
    adapter.dispose()
  })

  it('后计算的直线与已接受路径非端点交叉时自动绕行', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const adapter = new CanvasTopologyAdapter(createCanvas())
    const topology = createRouteTopology(
      [
        { id: 'cross-left', x: 20, y: 50 }, { id: 'cross-right', x: 80, y: 50 },
        { id: 'cross-top', x: 50, y: 15 }, { id: 'cross-bottom', x: 50, y: 85 },
      ],
      [
        { id: 'edge.a-horizontal', from: 'cross-left', to: 'cross-right' },
        { id: 'edge.b-vertical', from: 'cross-top', to: 'cross-bottom' },
      ],
    )
    const inspection = prepareGeometry(adapter, topology, 800, 480)

    expect(inspection.routeByEdgeId.get('edge.a-horizontal')?.points).toHaveLength(2)
    expect(inspection.routeByEdgeId.get('edge.b-vertical')?.points.length).toBeGreaterThan(2)
    adapter.dispose()
  })
})

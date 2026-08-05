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

import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition, TopologyDeviceStatus, TopologyEdgeDefinition, TopologyNodeDefinition } from '@/config/process/types'
import { getTopologyIconUrl, MAXIMUM_TOPOLOGY_ICON_ASSETS } from '@/services/topology/topology-icon-registry'
import type { TopologyRenderer } from '@/services/topology/topology-renderer'

/** Canvas 绘制所需的缓存布局，命中测试直接复用，避免点击时再次遍历计算坐标。 */
interface NodeLayout {
  node: TopologyNodeDefinition
  x: number
  y: number
  width: number
  height: number
  /** 标题虽绘制在图元边框外，仍属于节点的完整视觉边界，供命中、连线和标签避让统一使用。 */
  titleBounds: RectangleBounds
  /** 命中范围独立于视觉尺寸，保证图标缩小后鼠标和触屏仍有至少 40 像素的可操作区域。 */
  hitBounds: RectangleBounds
  /** 路由边界包含图元、标题与选中框安全区，连线不得穿过该矩形。 */
  routeBounds: RectangleBounds
}

/** 画布坐标中的轴对齐矩形，统一承载标题、命中和路由碰撞边界。 */
interface RectangleBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 同一画布尺寸只计算一次的响应式度量。
 * 图元、文字、选中框和碰撞算法共享这些值，避免视觉缩小后命中区或连线仍沿用旧尺寸。
 */
interface ResponsiveTopologyMetrics {
  /** 常规态为 1、全屏态为 2；所有图元与文字几何均共享该倍率。 */
  presentationScale: 1 | 2
  scale: number
  nodeTitleFontSize: number
  nodeTitleMaxWidth: number
  nodeTitleGap: number
  nodeTitleHeight: number
  layerTitleFontSize: number
  edgeLabelFontSize: number
  selectionExpansion: number
  minimumHitSize: number
}

/** 已请求图元的加载状态缓存，防止每次重绘重复创建 Image 或重复请求同一 SVG。 */
interface IconImageCacheEntry {
  image: HTMLImageElement
  status: 'loading' | 'ready' | 'error'
}

/**
 * 单画布可保存的最小视图快照。
 *
 * 快照只包含缩放与平移数值，不包含 Canvas（画布）、图片、事件回调或拓扑配置；
 * 因此多拓扑运行时可以在切换后恢复用户视图，同时不会把浏览器资源写入可序列化状态。
 */
export interface CanvasTopologyViewState {
  zoom: number
  offsetX: number
  offsetY: number
}

/** 任意角度线路中的单个端点或拐点；点序列同时支持直线、少量拐点和最终通道回退。 */
interface EdgeRoutePoint {
  x: number
  y: number
}

/**
 * 预计算后的任意角度连线路径。
 * 最后两个点始终表示箭头朝向，全部点同时供协议标签挑选最长可读线段。
 */
interface EdgeRoute {
  points: readonly EdgeRoutePoint[]
}

/** 路由与所属边一并保存，使交叉检测可以只放行真正共享的端点。 */
interface AcceptedEdgeRoute {
  request: EdgeRoutingRequest
  route: EdgeRoute
}

/** 节点边缘的端口方位；同侧多条边会分配到不同端口，防止在节点出口处堆叠。 */
type EdgePortSide = 'top' | 'right' | 'bottom' | 'left'

/** 线路主方向决定采用水平通道还是垂直通道。 */
type EdgeRouteOrientation = 'horizontal' | 'vertical'

/**
 * 一条边在全局路由计算期间的临时信息。
 * 端口先按节点侧边统一分配，通道再按层级走向统一分配，避免逐边计算导致的公共主干。
 */
interface EdgeRoutingRequest {
  edge: TopologyEdgeDefinition
  fromLayout: NodeLayout
  toLayout: NodeLayout
  orientation: EdgeRouteOrientation
  startSide: EdgePortSide
  endSide: EdgePortSide
  corridorKey: string
  startPort?: EdgeRoutePoint
  endPort?: EdgeRoutePoint
  laneCoordinate?: number
  /** 无障碍的同层或同列关系预先固化为直连，不参与后续通道分配。 */
  directRoute?: EdgeRoute
}

/** 节点侧边上的待分配端口引用，统一排序后写回对应连线请求。 */
interface EdgePortAssignment {
  request: EdgeRoutingRequest
  layout: NodeLayout
  side: EdgePortSide
  endpoint: 'start' | 'end'
}

/** 协议标签使用画布坐标记录中心点与实际尺寸，供节点避让校验与最终绘制共用。 */
interface EdgeLabelPlacement {
  x: number
  y: number
  width: number
  height: number
}

/** 深色工业控制画布中的连接色与设备状态色严格分层，选中态不会改写设备图元。 */
const edgeColorByEvidence = {
  verified: '#22d3ee',
  'pending-confirmation': '#f59e0b',
  conceptual: '#64748b',
  // 新清单未携带连线证据时使用中性灰，避免渲染器把未知关系伪装为任何已知业务语义。
  unclassified: '#94a3b8',
} as const

/**
 * 路由规则变更时递增该版本号，使开发热更新中的既有画布实例自动丢弃旧路径缓存。
 * 正式运行时版本恒定，仍只在尺寸或拓扑变化后重算，不增加实时重绘成本。
 */
const EDGE_ROUTE_LAYOUT_VERSION = 4

/**
 * 轻量 Canvas 二维拓扑适配器。
 * 它只维护当前画布的运行时缓存：布局和图片按帧合并绘制、命中测试复用布局缓存，
 * 像素比限制为 2；销毁时会取消帧、解除图元回调并清空引用，避免页面切换后的泄漏。
 */
export class CanvasTopologyAdapter implements TopologyRenderer {
  private topology: TopologyDefinition | undefined
  private readonly nodeById = new Map<string, TopologyNodeDefinition>()
  private readonly selectedNodeIds = new Set<string>()
  private readonly selectedRouteIds = new Set<string>()
  /** 实时状态覆盖值独立于拓扑定义；仅保存与配置状态不同的节点，容量天然受当前拓扑节点数限制。 */
  private readonly nodeStatusOverrideById = new Map<ProcessNodeId, TopologyDeviceStatus>()
  private readonly layoutByNodeId = new Map<string, NodeLayout>()
  /** 连线路径只在拓扑定义或画布尺寸变化时重建，选中态重绘直接复用，避免重复分组排序。 */
  private readonly routeByEdgeId = new Map<string, EdgeRoute>()
  /** 协议标签按边绘制时登记已占区域，后续标签会主动避让，避免直线路由增加后标签彼此覆盖。 */
  private readonly drawnEdgeLabelBounds: RectangleBounds[] = []
  private readonly iconImageByUrl = new Map<string, IconImageCacheEntry>()
  private frameHandle: number | undefined
  private width = 1
  private height = 1
  private pixelRatio = 1
  /** 尺寸、拓扑变化后才重新计算端口与通道；缩放和平移不改变画布坐标，因此无需置脏。 */
  private routesDirty = true
  /** 与当前实例缓存对应的路由规则版本，解决开发热更新后仍展示旧折线路径的问题。 */
  private routeLayoutVersion = -1
  /** 缩放仅影响分层、连线和图元；深色底图保持固定，避免缩小时网格密度突变。 */
  private viewScale = 1
  /** 平移以 CSS 像素记录，和缩放共同组成内容视图变换；背景始终保持固定。 */
  private viewOffsetX = 0
  private viewOffsetY = 0
  /**
   * 展示倍率独立于用户缩放：全屏切换只放大图元、文字和对应的碰撞几何，
   * 不修改用户保存的缩放和平移快照，退出全屏后可无损恢复原有视图。
   */
  private presentationScale: 1 | 2 = 1

  private readonly minimumViewScale = 0.55
  private readonly maximumViewScale = 2.25

  public constructor(private readonly canvas: HTMLCanvasElement) {}

  /** 缓存节点索引以实现边绘制和命中测试的常数时间查找。 */
  public setTopology(topology: TopologyDefinition): void {
    this.topology = topology
    this.nodeById.clear()
    this.nodeStatusOverrideById.clear()
    this.routeByEdgeId.clear()
    this.routesDirty = true
    this.routeLayoutVersion = -1

    for (const node of topology.nodes) {
      this.nodeById.set(node.nodeId, node)
    }

    this.scheduleDraw()
  }

  /** 更新局部选中集合后合并到下一帧重绘，不重建画布、图片缓存或事件监听器。 */
  public setSelection(nodeIds: readonly ProcessNodeId[], routeIds: readonly RouteId[]): void {
    this.selectedNodeIds.clear()
    this.selectedRouteIds.clear()

    for (const nodeId of nodeIds) this.selectedNodeIds.add(nodeId)
    for (const routeId of routeIds) this.selectedRouteIds.add(routeId)

    this.scheduleDraw()
  }

  /**
   * 使用不可变状态快照增量更新当前节点图元。
   * 只遍历输入快照和已有覆盖项，不触碰节点索引、布局、路径缓存或 ResizeObserver（尺寸观察器），
   * 同一动画帧内的多次更新仍由 scheduleDraw 合并为一次重绘。
   */
  public setNodeStatuses(statusByNodeId: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>): void {
    if (!this.topology) return

    let changed = false

    // 先移除新快照未再声明的旧覆盖值，使节点安全回退到拓扑发布时的基线状态。
    for (const nodeId of this.nodeStatusOverrideById.keys()) {
      if (!statusByNodeId.has(nodeId)) {
        this.nodeStatusOverrideById.delete(nodeId)
        changed = true
      }
    }

    // 每个输入节点仅常数时间查询配置索引和已有覆盖值，未知节点不会被缓存或触发全图扫描。
    for (const [nodeId, nextStatus] of statusByNodeId) {
      const configuredNode = this.nodeById.get(nodeId)
      if (!configuredNode) continue

      const currentStatus = this.nodeStatusOverrideById.get(nodeId) ?? configuredNode.deviceStatus
      if (currentStatus === nextStatus) continue

      if (nextStatus === configuredNode.deviceStatus) this.nodeStatusOverrideById.delete(nodeId)
      else this.nodeStatusOverrideById.set(nodeId, nextStatus)
      changed = true
    }

    if (changed) this.scheduleDraw()
  }

  /** 依据容器 CSS 尺寸重设画布；像素比上限为 2，避免高分屏无界放大内存。 */
  public resize(width: number, height: number): void {
    this.width = Math.max(1, Math.round(width))
    this.height = Math.max(1, Math.round(height))
    this.pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2)
    // 端口和通道使用画布坐标，任一尺寸改变都必须在下次绘制前重新分配。
    this.routesDirty = true
    this.routeLayoutVersion = -1

    const bufferWidth = Math.round(this.width * this.pixelRatio)
    const bufferHeight = Math.round(this.height * this.pixelRatio)

    if (this.canvas.width !== bufferWidth || this.canvas.height !== bufferHeight) {
      this.canvas.width = bufferWidth
      this.canvas.height = bufferHeight
    }

    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.scheduleDraw()
  }

  /**
   * 切换常规与全屏展示倍率。倍率变化会改变节点边界、文字宽高和连线避让范围，
   * 因此只标记布局/路由缓存失效并合并到下一动画帧；不会创建第二个画布、重置用户缩放或清空选择。
   */
  public setPresentationScale(nextPresentationScale: 1 | 2): void {
    if (nextPresentationScale === this.presentationScale) return

    this.presentationScale = nextPresentationScale
    this.routesDirty = true
    this.routeLayoutVersion = -1
    this.scheduleDraw()
  }

  /**
   * 在受控范围内增减拓扑缩放倍数并返回生效值。
   * 缩放状态保留在当前画布实例内，选择、实时状态或尺寸刷新不会意外重置用户视图。
   */
  public zoomBy(delta: number): number {
    const nextScale = Math.min(this.maximumViewScale, Math.max(this.minimumViewScale, this.viewScale + delta))

    if (nextScale === this.viewScale) return this.viewScale
    this.viewScale = nextScale
    this.scheduleDraw()
    return this.viewScale
  }

  /**
   * 平移当前拓扑视图，用于在固定容器内检查放大后的局部控制关系。
   * 位移按当前可视区域限幅，避免拖拽到无法恢复的无限远位置；用户仍可通过重置快速归位。
   */
  public panBy(deltaX: number, deltaY: number): void {
    const maximumOffsetX = this.width * this.viewScale
    const maximumOffsetY = this.height * this.viewScale
    const nextOffsetX = Math.min(maximumOffsetX, Math.max(-maximumOffsetX, this.viewOffsetX + deltaX))
    const nextOffsetY = Math.min(maximumOffsetY, Math.max(-maximumOffsetY, this.viewOffsetY + deltaY))

    if (nextOffsetX === this.viewOffsetX && nextOffsetY === this.viewOffsetY) return
    this.viewOffsetX = nextOffsetX
    this.viewOffsetY = nextOffsetY
    this.scheduleDraw()
  }

  /** 将当前视图恢复到完整拓扑比例，方便用户从局部设备查看返回全局层级关系。 */
  public resetZoom(): number {
    if (this.viewScale === 1 && this.viewOffsetX === 0 && this.viewOffsetY === 0) return this.viewScale
    this.viewScale = 1
    this.viewOffsetX = 0
    this.viewOffsetY = 0
    this.scheduleDraw()
    return this.viewScale
  }

  /**
   * 返回当前视图的值副本，调用方无法通过修改返回对象影响画布。
   * 该读取不触发绘制、布局或路径重建，供拓扑运行时在真正切换前保存活动视图。
   */
  public getViewState(): CanvasTopologyViewState {
    return {
      zoom: this.viewScale,
      offsetX: this.viewOffsetX,
      offsetY: this.viewOffsetY,
    }
  }

  /**
   * 恢复已保存的缩放和平移；即使上层误传非有限数值，也会回退到安全默认值。
   * 平移重新按当前画布尺寸和缩放上限裁剪，避免旧拓扑在不同容器尺寸下把视图带到不可见区域。
   */
  public restoreViewState(state: CanvasTopologyViewState): void {
    const requestedScale = Number.isFinite(state.zoom) ? state.zoom : 1
    const nextScale = Math.min(this.maximumViewScale, Math.max(this.minimumViewScale, requestedScale))
    const maximumOffsetX = this.width * nextScale
    const maximumOffsetY = this.height * nextScale
    const requestedOffsetX = Number.isFinite(state.offsetX) ? state.offsetX : 0
    const requestedOffsetY = Number.isFinite(state.offsetY) ? state.offsetY : 0
    const nextOffsetX = Math.min(maximumOffsetX, Math.max(-maximumOffsetX, requestedOffsetX))
    const nextOffsetY = Math.min(maximumOffsetY, Math.max(-maximumOffsetY, requestedOffsetY))

    if (nextScale === this.viewScale && nextOffsetX === this.viewOffsetX && nextOffsetY === this.viewOffsetY) return
    this.viewScale = nextScale
    this.viewOffsetX = nextOffsetX
    this.viewOffsetY = nextOffsetY
    this.scheduleDraw()
  }

  /**
   * 使用绘制期缓存的完整命中矩形完成命中测试，点击操作不触发布局或配置扫描。
   * 多个命中区在紧凑画布中相交时选择中心点最近的节点，避免结果依赖清单插入顺序。
   */
  public pickNodeAt(x: number, y: number): ProcessNodeId | undefined {
    // Canvas 绘制以中心点缩放，命中坐标必须逆变换后才能复用逻辑布局缓存。
    const contentX = this.width / 2 + (x - this.width / 2 - this.viewOffsetX) / this.viewScale
    const contentY = this.height / 2 + (y - this.height / 2 - this.viewOffsetY) / this.viewScale

    let nearestLayout: NodeLayout | undefined
    let nearestDistanceSquared = Number.POSITIVE_INFINITY

    for (const layout of this.layoutByNodeId.values()) {
      const bounds = layout.hitBounds
      const isInside = contentX >= bounds.left && contentX <= bounds.right && contentY >= bounds.top && contentY <= bounds.bottom
      if (!isInside) continue

      const centerX = layout.x + layout.width / 2
      const centerY = layout.y + layout.height / 2
      const distanceSquared = (contentX - centerX) ** 2 + (contentY - centerY) ** 2

      if (distanceSquared < nearestDistanceSquared) {
        nearestLayout = layout
        nearestDistanceSquared = distanceSquared
      }
    }

    return nearestLayout?.node.nodeId
  }

  /** 取消待绘制任务、解除图元回调并释放引用，确保离开工艺页后不再访问旧 Canvas。 */
  public dispose(): void {
    if (this.frameHandle !== undefined) {
      cancelAnimationFrame(this.frameHandle)
      this.frameHandle = undefined
    }

    for (const entry of this.iconImageByUrl.values()) {
      entry.image.onload = null
      entry.image.onerror = null
    }

    this.topology = undefined
    this.nodeById.clear()
    this.selectedNodeIds.clear()
    this.selectedRouteIds.clear()
    this.nodeStatusOverrideById.clear()
    this.layoutByNodeId.clear()
    this.routeByEdgeId.clear()
    this.drawnEdgeLabelBounds.length = 0
    this.routesDirty = true
    this.routeLayoutVersion = -1
    this.iconImageByUrl.clear()
    /*
     * Canvas（画布）元素可能在 Vue（渐进式网页框架）卸载前短暂保留于 DOM（文档对象模型）。
     * 主动归零内部像素缓冲可立即释放高分屏缓冲区；随后组件卸载移除元素，不会留下上一拓扑的大尺寸位图。
     */
    this.canvas.width = 0
    this.canvas.height = 0
    this.canvas.style.width = ''
    this.canvas.style.height = ''
    this.viewScale = 1
    this.viewOffsetX = 0
    this.viewOffsetY = 0
  }

  /** 任何连续状态变化最多触发一次下一帧绘制，压缩实时状态合并成本。 */
  private scheduleDraw(): void {
    if (this.frameHandle !== undefined) return

    this.frameHandle = requestAnimationFrame(() => {
      this.frameHandle = undefined
      this.draw()
    })
  }

  /** 绘制深色工业控制底图、分层边界、正交连接和设备图元。 */
  private draw(): void {
    const context = this.canvas.getContext('2d')

    if (!context) return

    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0)
    context.clearRect(0, 0, this.width, this.height)
    this.layoutByNodeId.clear()

    if (!this.topology || this.topology.nodes.length === 0) return

    this.drawIndustrialBackground(context)

    // 只有拓扑内容应用缩放，背景始终覆盖固定容器，保持清晰且避免露出空白边缘。
    context.save()
    context.translate(this.width / 2 + this.viewOffsetX, this.height / 2 + this.viewOffsetY)
    context.scale(this.viewScale, this.viewScale)
    context.translate(-this.width / 2, -this.height / 2)
    this.drawLayerBands(context)
    this.createNodeLayouts()
    this.rebuildEdgeRoutesIfNeeded()
    this.drawnEdgeLabelBounds.length = 0

    for (const edge of this.topology.edges) {
      this.drawEdge(context, edge)
    }

    for (const layout of this.layoutByNodeId.values()) {
      this.drawNode(context, layout)
    }

    context.restore()
  }

  /** 绘制低对比网格和冷色渐变，使画布在无外部图片时仍具备工业控制视觉层次。 */
  private drawIndustrialBackground(context: CanvasRenderingContext2D): void {
    const glow = context.createRadialGradient(this.width * 0.52, this.height * 0.44, 0, this.width * 0.52, this.height * 0.44, this.width * 0.76)
    glow.addColorStop(0, '#0b3a52')
    glow.addColorStop(0.52, '#061f31')
    glow.addColorStop(1, '#03111d')
    context.fillStyle = glow
    context.fillRect(0, 0, this.width, this.height)

    context.save()
    context.strokeStyle = 'rgba(56, 189, 248, 0.08)'
    context.lineWidth = 1
    const gridGap = Math.max(24, Math.min(42, Math.round(this.width / 28)))

    for (let x = gridGap; x < this.width; x += gridGap) {
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, this.height)
      context.stroke()
    }

    for (let y = gridGap; y < this.height; y += gridGap) {
      context.beginPath()
      context.moveTo(0, y)
      context.lineTo(this.width, y)
      context.stroke()
    }

    context.restore()
  }

  /** 按配置层级绘制带色彩边界的隔离带，未声明层级的通用拓扑不会受影响。 */
  private drawLayerBands(context: CanvasRenderingContext2D): void {
    const layers = this.topology?.layers

    if (!layers || layers.length === 0) return
    const orderedLayers = [...layers].sort((left, right) => left.y - right.y)

    for (let index = 0; index < orderedLayers.length; index += 1) {
      const layer = orderedLayers[index]
      const currentY = (layer.y / 100) * this.height
      const previousY = index === 0 ? 0 : ((orderedLayers[index - 1]?.y ?? 0) / 100) * this.height
      const nextY = index === orderedLayers.length - 1 ? this.height : ((orderedLayers[index + 1]?.y ?? 100) / 100) * this.height
      const top = index === 0 ? 0 : (previousY + currentY) / 2
      const bottom = index === orderedLayers.length - 1 ? this.height : (currentY + nextY) / 2

      context.save()
      context.fillStyle = `${layer.color}0d`
      context.fillRect(0, top, this.width, Math.max(1, bottom - top))
      context.strokeStyle = `${layer.color}88`
      context.lineWidth = 1
      context.setLineDash([4, 5])
      context.beginPath()
      // 左侧导视区不绘制分隔线，确保层级标题与拓扑内容在视觉上完全分离。
      context.moveTo(this.getLayerLabelGutter(), top + 4)
      context.lineTo(this.width - 12, top + 4)
      context.stroke()
      context.setLineDash([])
      context.fillStyle = layer.color
      const metrics = this.getResponsiveMetrics()
      context.font = `700 ${metrics.layerTitleFontSize}px Microsoft YaHei, sans-serif`
      context.textAlign = 'left'
      context.textBaseline = 'top'
      context.fillText(layer.title, 16, Math.min(top + 10, Math.max(4, currentY - 30)))
      context.restore()
    }
  }

  /**
   * 根据画布宽高、最密集层和最小层间距共同计算图元尺寸。
   * 常规画布为 28 至 40 像素；极低嵌入画布可进一步缩小，避免旧固定下限挤占五层纵向空间。
   */
  private createNodeLayouts(): void {
    if (!this.topology) return
    const countByLayer = new Map<string, number>()

    for (const node of this.topology.nodes) {
      const layerId = node.layerId ?? '__ungrouped__'
      countByLayer.set(layerId, (countByLayer.get(layerId) ?? 0) + 1)
    }

    const densestLayerCount = Math.max(1, ...countByLayer.values())
    const metrics = this.getResponsiveMetrics()
    const isCompactViewport = this.width < 1000 || this.height < 320
    // 密集画布仅压缩额外间隔，不再以中文标题宽度撑大图元；完整名称仍由受控提示层展示。
    const layoutGapWeight = isCompactViewport ? 1.15 : 2.2
    const availableSlotWidth = Math.floor(this.width / (densestLayerCount + layoutGapWeight))
    const legacyNodeWidth = Math.min(44, Math.max(36, Math.floor(availableSlotWidth * 0.48)))
    const orderedLayerCenters = [...new Set((this.topology.layers ?? []).map((layer) => layer.y))]
      .sort((left, right) => left - right)
      .map((percentage) => (percentage / 100) * this.height)
    const minimumLayerDistance = orderedLayerCenters.length > 1
      ? Math.min(...orderedLayerCenters.slice(1).map((center, index) => center - (orderedLayerCenters[index] ?? center)))
      : this.height
    // 标题、间隔和选中安全区必须留在相邻层之间；该高度约束只会进一步缩小，不会放大密集节点。
    // 额外保留 1 像素处理百分比中心映射后的亚像素舍入，最小画布也不得让相邻安全区刚好相触。
    // 最小 600×600 外层视口实测只给拓扑画布约 108 像素；此时图元允许缩至 8 像素，
    // 用户可用既有缩放查看细节。160 至 239 像素画布使用 18 像素下限，240 像素以上保持 28 像素。
    const minimumNodeSize = (this.height < 160 ? 8 : this.height < 240 ? 18 : 28) * metrics.presentationScale
    const maximumNodeSize = 40 * metrics.presentationScale
    const maximumNodeHeightByLayers = Math.max(minimumNodeSize, minimumLayerDistance - metrics.nodeTitleHeight - metrics.nodeTitleGap - metrics.selectionExpansion * 2 - 3)
    const nodeWidth = Math.min(maximumNodeSize, Math.max(minimumNodeSize, Math.floor(Math.min(legacyNodeWidth * metrics.scale, maximumNodeHeightByLayers))))
    const nodeHeight = nodeWidth
    const layerLabelGutter = this.getLayerLabelGutter()
    const rightPadding = Math.max(14, Math.round(this.width * 0.02))
    // 节点横坐标只在层级标题右侧的内容区内映射，避免最低坐标设备侵入左侧导视文字。
    // 右侧保留与左侧相对较小的安全边距，保证最右设备完整显示且不浪费可用宽度。
    const topologyContentWidth = Math.max(1, this.width - layerLabelGutter - rightPadding)

    for (const node of this.topology.nodes) {
      const requestedX = Math.round(layerLabelGutter + (node.x / 100) * topologyContentWidth - nodeWidth / 2)
      const requestedY = Math.round((node.y / 100) * this.height - nodeHeight / 2)
      // 顶层与现场层都采用中心坐标；限制卡片边界后可防止 y=8 和 y=94 的标签被 Canvas（画布）裁掉。
      const x = Math.min(this.width - rightPadding - nodeWidth, Math.max(layerLabelGutter, requestedX))
      // 底部额外保留一行小字，文字虽在图元边框外，仍不能被画布裁切。
      const titleSpace = metrics.nodeTitleGap + metrics.nodeTitleHeight
      const y = Math.min(this.height - nodeHeight - titleSpace - 1, Math.max(0, requestedY))
      const centerX = x + nodeWidth / 2
      const titleTop = y + nodeHeight + metrics.nodeTitleGap
      const titleBounds = this.createBoundsFromCenter(centerX, titleTop + metrics.nodeTitleHeight / 2, metrics.nodeTitleMaxWidth, metrics.nodeTitleHeight)
      const visualBounds = this.unionBounds({ left: x, top: y, right: x + nodeWidth, bottom: y + nodeHeight }, titleBounds)
      const hitBounds = this.expandBoundsToMinimumSize(visualBounds, centerX, y + nodeHeight / 2, metrics.minimumHitSize)
      const routeBounds = this.expandBounds(visualBounds, metrics.selectionExpansion + 1)
      this.layoutByNodeId.set(node.nodeId, { node, x, y, width: nodeWidth, height: nodeHeight, titleBounds, hitBounds, routeBounds })
    }
  }

  /**
   * 宽度与高度各自归一化后取较小值，保证带鱼屏和低矮嵌入容器都按受限维度缩放。
   * 188 像素及以上画布使用 0.8 至 0.9；108 至 188 像素按 0.55 至 0.8 连续插值，
   * 让真实最小外层视口中的五层结构仍不重叠，用户可通过既有缩放恢复细节。
   */
  private getResponsiveMetrics(): ResponsiveTopologyMetrics {
    const widthProgress = Math.min(1, Math.max(0, (this.width - 600) / (1280 - 600)))
    const heightProgress = Math.min(1, Math.max(0, (this.height - 240) / (720 - 240)))
    const regularScale = 0.8 + Math.min(widthProgress, heightProgress) * 0.1
    const extremeHeightProgress = Math.min(1, Math.max(0, (this.height - 108) / (188 - 108)))
    const baseScale = this.height < 188 ? 0.55 + extremeHeightProgress * 0.25 : regularScale
    const presentationScale = this.presentationScale
    const scale = baseScale * presentationScale
    const isExtremelyLow = this.height < 160

    return {
      presentationScale,
      scale,
      nodeTitleFontSize: 8 * scale,
      nodeTitleMaxWidth: (this.width < 1000 || this.height < 320 ? 60 : 68) * scale,
      nodeTitleGap: (isExtremelyLow ? 1 : 2) * presentationScale,
      nodeTitleHeight: 9 * scale,
      layerTitleFontSize: 11 * scale,
      edgeLabelFontSize: 9 * scale,
      selectionExpansion: (isExtremelyLow ? 1 : 2) * presentationScale,
      minimumHitSize: 40,
    }
  }

  /** 由中心点和尺寸创建矩形，集中处理命中与视觉边界的坐标换算。 */
  private createBoundsFromCenter(centerX: number, centerY: number, width: number, height: number): RectangleBounds {
    return { left: centerX - width / 2, top: centerY - height / 2, right: centerX + width / 2, bottom: centerY + height / 2 }
  }

  /** 合并两个矩形为最小包围盒，确保图元与下方标题被视为一个完整节点。 */
  private unionBounds(left: RectangleBounds, right: RectangleBounds): RectangleBounds {
    return {
      left: Math.min(left.left, right.left),
      top: Math.min(left.top, right.top),
      right: Math.max(left.right, right.right),
      bottom: Math.max(left.bottom, right.bottom),
    }
  }

  /** 从四边等距扩展矩形，供选中框和连线安全区共用。 */
  private expandBounds(bounds: RectangleBounds, amount: number): RectangleBounds {
    return { left: bounds.left - amount, top: bounds.top - amount, right: bounds.right + amount, bottom: bounds.bottom + amount }
  }

  /** 保留原矩形内容并补足最小点击尺寸，图标缩小不会牺牲触屏与鼠标可用性。 */
  private expandBoundsToMinimumSize(bounds: RectangleBounds, centerX: number, centerY: number, minimumSize: number): RectangleBounds {
    const minimumBounds = this.createBoundsFromCenter(centerX, centerY, minimumSize, minimumSize)
    return this.unionBounds(bounds, minimumBounds)
  }

  /**
   * 为层级导视文本预留固定但可随画布变宽的左侧空间。
   * 该值同时参与分隔线起点与节点坐标映射，避免两套边距规则随尺寸变化失去同步。
   */
  private getLayerLabelGutter(): number {
    return Math.min(124, Math.max(88, Math.round(this.width * 0.13)))
  }

  /**
   * 在全部节点完成布局后统一预计算连线。
   * 先准备稳定端口与最终回退通道，再按“直线、一个拐点、两个拐点”选择最短无碰撞路径；
   * 只有简洁候选全部失败时才使用通道，避免逐边从节点中心出发形成重叠主干。
   */
  private rebuildEdgeRoutesIfNeeded(): void {
    if ((!this.routesDirty && this.routeLayoutVersion === EDGE_ROUTE_LAYOUT_VERSION) || !this.topology) return

    const requests = this.createEdgeRoutingRequests().sort((left, right) => left.edge.edgeId.localeCompare(right.edge.edgeId))
    this.assignEndpointPorts(requests)
    // 先为全部边准备稳定通道坐标；只有更简洁候选全部失败时才实际采用该兜底路径。
    this.assignRouteLanes(requests)
    this.assignPreferredRoutes(requests)
    this.routeByEdgeId.clear()

    for (const request of requests) {
      const route = request.directRoute ?? this.createRouteFromRequest(request)

      if (route) this.routeByEdgeId.set(request.edge.edgeId, route)
    }

    this.routesDirty = false
    this.routeLayoutVersion = EDGE_ROUTE_LAYOUT_VERSION
  }

  /** 将拓扑边转换为可批量分组的路由请求，并根据层级与几何关系确定连线主方向。 */
  private createEdgeRoutingRequests(): EdgeRoutingRequest[] {
    const topology = this.topology

    if (!topology) return []

    const layerIndexById = new Map((topology.layers ?? []).map((layer, index) => [layer.layerId, index]))
    const requests: EdgeRoutingRequest[] = []

    for (const edge of topology.edges) {
      const fromLayout = this.layoutByNodeId.get(edge.fromNodeId)
      const toLayout = this.layoutByNodeId.get(edge.toNodeId)

      if (!fromLayout || !toLayout) continue

      const fromLayerIndex = layerIndexById.get(fromLayout.node.layerId ?? '') ?? -1
      const toLayerIndex = layerIndexById.get(toLayout.node.layerId ?? '') ?? -1
      const fromCenterX = fromLayout.x + fromLayout.width / 2
      const fromCenterY = fromLayout.y + fromLayout.height / 2
      const toCenterX = toLayout.x + toLayout.width / 2
      const toCenterY = toLayout.y + toLayout.height / 2
      // 跨层关系优先沿层级纵向布线；同层关系再依据实际相对位置选择最短主方向。
      const isCrossLayer = fromLayerIndex !== toLayerIndex
      const isVertical = isCrossLayer || Math.abs(toCenterY - fromCenterY) > Math.abs(toCenterX - fromCenterX) * 0.58
      const orientation: EdgeRouteOrientation = isVertical ? 'vertical' : 'horizontal'
      const isForward = isVertical ? toCenterY >= fromCenterY : toCenterX >= fromCenterX
      const startSide: EdgePortSide = isVertical ? (isForward ? 'bottom' : 'top') : (isForward ? 'right' : 'left')
      const endSide: EdgePortSide = isVertical ? (isForward ? 'top' : 'bottom') : (isForward ? 'left' : 'right')
      // 相同层对的边共享通道池；同一池内会按稳定坐标顺序分配不同车道。
      const corridorKey = isVertical
        ? `vertical:${fromLayout.node.layerId ?? 'ungrouped'}:${toLayout.node.layerId ?? 'ungrouped'}:${isForward ? 'forward' : 'reverse'}`
        : `horizontal:${fromLayout.node.layerId ?? 'ungrouped'}`

      requests.push({ edge, fromLayout, toLayout, orientation, startSide, endSide, corridorKey })
    }

    return requests
  }

  /**
   * 同一节点同一侧的端口按对端坐标稳定排序并均匀分散。
   * 端口位置一旦分配，所有扇入、扇出边都不会再从卡片中心共用一条竖线或横线。
   */
  private assignEndpointPorts(requests: readonly EdgeRoutingRequest[]): void {
    const groups = new Map<string, EdgePortAssignment[]>()

    for (const request of requests) {
      this.pushPortAssignment(groups, request, request.fromLayout, request.startSide, 'start')
      this.pushPortAssignment(groups, request, request.toLayout, request.endSide, 'end')
    }

    for (const assignments of groups.values()) {
      assignments.sort((left, right) => this.comparePortAssignments(left, right))

      for (let index = 0; index < assignments.length; index += 1) {
        const assignment = assignments[index]
        const port = this.createEndpointPort(assignment.layout, assignment.side, index, assignments.length, assignment.endpoint)

        if (assignment.endpoint === 'start') assignment.request.startPort = port
        else assignment.request.endPort = port
      }
    }
  }

  /** 以节点标识和侧边建立端口分配池；入边、出边共享池，避免同侧端口重合。 */
  private pushPortAssignment(
    groups: Map<string, EdgePortAssignment[]>,
    request: EdgeRoutingRequest,
    layout: NodeLayout,
    side: EdgePortSide,
    endpoint: 'start' | 'end',
  ): void {
    const key = `${layout.node.nodeId}:${side}`
    const assignments = groups.get(key) ?? []
    assignments.push({ request, layout, side, endpoint })
    groups.set(key, assignments)
  }

  /** 端口排序使用对端主坐标和边标识作为稳定次序，重绘、缩放后线路不会随机交换位置。 */
  private comparePortAssignments(left: EdgePortAssignment, right: EdgePortAssignment): number {
    const leftPeer = left.endpoint === 'start' ? left.request.toLayout : left.request.fromLayout
    const rightPeer = right.endpoint === 'start' ? right.request.toLayout : right.request.fromLayout
    const usesHorizontalAxis = left.side === 'top' || left.side === 'bottom'
    const leftCoordinate = usesHorizontalAxis ? leftPeer.x + leftPeer.width / 2 : leftPeer.y + leftPeer.height / 2
    const rightCoordinate = usesHorizontalAxis ? rightPeer.x + rightPeer.width / 2 : rightPeer.y + rightPeer.height / 2

    return leftCoordinate - rightCoordinate || left.request.edge.edgeId.localeCompare(right.request.edge.edgeId)
  }

  /**
   * 将同侧端口置于卡片有效边缘内，保留圆角与状态点空间，避免出口贴住卡片角落。
   * 单条跨层出边与入边分别使用上下边缘的 38% 与 62% 位置，防止上下两层同列设备的
   * “上一节点出口”与“下一节点入口”恰好在同一 X 坐标上重叠成一段假直线；左右边则保留
   * 卡片中线，使无障碍的同层相邻节点可以直接水平连接。
   */
  private createEndpointPort(
    layout: NodeLayout,
    side: EdgePortSide,
    index: number,
    total: number,
    endpoint: 'start' | 'end',
  ): EdgeRoutePoint {
    const isHorizontalSide = side === 'top' || side === 'bottom'
    const edgeLength = isHorizontalSide ? layout.width : layout.height
    const inset = Math.min(12, Math.max(4, edgeLength * 0.12))
    const availableLength = Math.max(1, edgeLength - inset * 2)
    // 多条边仍保持均分；只有上下边的单边使用不同进出槽位，左右边单边固定中线以支持直连。
    const slotRatio = total === 1 && isHorizontalSide ? (endpoint === 'start' ? 0.38 : 0.62) : (index + 1) / (total + 1)
    const offset = inset + availableLength * slotRatio

    if (side === 'top') return { x: layout.x + offset, y: layout.y }
    if (side === 'bottom') return { x: layout.x + offset, y: layout.y + layout.height }
    if (side === 'left') return { x: layout.x, y: layout.y + offset }

    return { x: layout.x + layout.width, y: layout.y + offset }
  }

  /**
   * 按“直线、一个拐点、两个拐点”的顺序为每条边挑选首个无冲突路径。
   * 已接受路径立即参与后续碰撞检测，因此同一拓扑每次都得到稳定且不共线复用的结果。
   */
  private assignPreferredRoutes(requests: readonly EdgeRoutingRequest[]): void {
    const acceptedRoutes: AcceptedEdgeRoute[] = []

    for (const request of requests) {
      const candidates = [
        this.createArbitraryDirectRoute(request),
        ...this.createOneBendRouteCandidates(request),
        ...this.createTwoBendRouteCandidates(request),
      ].filter((route): route is EdgeRoute => Boolean(route))

      const preferredRoute = candidates.find((candidate) => this.isRouteAvailable(request, candidate, acceptedRoutes))
      const route = preferredRoute ?? this.createRouteFromRequest(request)
      if (!route) continue

      // directRoute 字段现表示“已经选定的缓存路径”；名称为兼容既有结构保留，路径本身可能是最终通道兜底。
      request.directRoute = route
      acceptedRoutes.push({ request, route })
    }
  }

  /** 任意角度直线从两个图元的真实边框出发，不再限制为同层同高或跨层同列。 */
  private createArbitraryDirectRoute(request: EdgeRoutingRequest): EdgeRoute | undefined {
    const fromCenter = this.getLayoutCenter(request.fromLayout)
    const toCenter = this.getLayoutCenter(request.toLayout)
    if (this.pointsEqual(fromCenter, toCenter)) return undefined

    return {
      points: [
        this.getRectangleBoundaryPoint(request.fromLayout, toCenter),
        this.getRectangleBoundaryPoint(request.toLayout, fromCenter),
      ],
    }
  }

  /** 一个拐点只有两种正交组合；短路径优先，稳定次序由坐标字符串兜底。 */
  private createOneBendRouteCandidates(request: EdgeRoutingRequest): EdgeRoute[] {
    const start = request.startPort
    const end = request.endPort
    if (!start || !end) return []

    return this.sortRouteCandidates([
      { points: this.removeDuplicateRoutePoints([start, { x: end.x, y: start.y }, end]) },
      { points: this.removeDuplicateRoutePoints([start, { x: start.x, y: end.y }, end]) },
    ])
  }

  /**
   * 两拐点候选从中线、节点安全边界和画布安全边缘生成，不做像素级搜索。
   * 候选数量为 O(N)，而全套计算只在尺寸或拓扑变化时执行，避免把路径搜索带入实时重绘。
   */
  private createTwoBendRouteCandidates(request: EdgeRoutingRequest): EdgeRoute[] {
    const start = request.startPort
    const end = request.endPort
    if (!start || !end) return []
    const clearance = 4
    const verticalLanes = new Set<number>([(start.x + end.x) / 2, this.getLayerLabelGutter() + clearance, this.width - clearance])
    const horizontalLanes = new Set<number>([(start.y + end.y) / 2, clearance, this.height - clearance])

    for (const layout of this.layoutByNodeId.values()) {
      verticalLanes.add(layout.routeBounds.left - clearance)
      verticalLanes.add(layout.routeBounds.right + clearance)
      horizontalLanes.add(layout.routeBounds.top - clearance)
      horizontalLanes.add(layout.routeBounds.bottom + clearance)
    }

    const candidates: EdgeRoute[] = []
    for (const x of verticalLanes) {
      if (x < this.getLayerLabelGutter() || x > this.width) continue
      candidates.push({ points: this.removeDuplicateRoutePoints([start, { x, y: start.y }, { x, y: end.y }, end]) })
    }
    for (const y of horizontalLanes) {
      if (y < 0 || y > this.height) continue
      candidates.push({ points: this.removeDuplicateRoutePoints([start, { x: start.x, y }, { x: end.x, y }, end]) })
    }

    return this.sortRouteCandidates(candidates)
  }

  /** 路径先按总长度排序，再按坐标串稳定排序，同一配置不会因集合迭代顺序改变走向。 */
  private sortRouteCandidates(routes: readonly EdgeRoute[]): EdgeRoute[] {
    return [...routes]
      .filter((route) => route.points.length >= 2)
      .sort((left, right) => this.getRouteLength(left) - this.getRouteLength(right)
        || JSON.stringify(left.points).localeCompare(JSON.stringify(right.points)))
  }

  /** 候选路径不得穿过第三方完整节点边界，也不得复用或非端点交叉已接受路径。 */
  private isRouteAvailable(request: EdgeRoutingRequest, route: EdgeRoute, acceptedRoutes: readonly AcceptedEdgeRoute[]): boolean {
    for (let index = 1; index < route.points.length; index += 1) {
      const start = route.points[index - 1]
      const end = route.points[index]
      if (!start || !end || this.pointsEqual(start, end)) continue

      for (const layout of this.layoutByNodeId.values()) {
        if (layout.node.nodeId === request.fromLayout.node.nodeId || layout.node.nodeId === request.toLayout.node.nodeId) continue
        if (this.segmentIntersectsRectangle(start, end, layout.routeBounds)) return false
      }
    }

    return acceptedRoutes.every((accepted) => !this.routesConflict(request, route, accepted))
  }

  /** 检查两条多段路径的共线重叠或非端点交叉；共享业务节点时仅放行双方端点的单点接触。 */
  private routesConflict(request: EdgeRoutingRequest, route: EdgeRoute, accepted: AcceptedEdgeRoute): boolean {
    const sharesNode = request.fromLayout.node.nodeId === accepted.request.fromLayout.node.nodeId
      || request.fromLayout.node.nodeId === accepted.request.toLayout.node.nodeId
      || request.toLayout.node.nodeId === accepted.request.fromLayout.node.nodeId
      || request.toLayout.node.nodeId === accepted.request.toLayout.node.nodeId

    for (let leftIndex = 1; leftIndex < route.points.length; leftIndex += 1) {
      const leftStart = route.points[leftIndex - 1]
      const leftEnd = route.points[leftIndex]
      if (!leftStart || !leftEnd) continue

      for (let rightIndex = 1; rightIndex < accepted.route.points.length; rightIndex += 1) {
        const rightStart = accepted.route.points[rightIndex - 1]
        const rightEnd = accepted.route.points[rightIndex]
        if (!rightStart || !rightEnd) continue
        if (this.segmentsConflict(leftStart, leftEnd, rightStart, rightEnd, sharesNode)) return true
      }
    }

    return false
  }

  /** 线段与矩形使用参数裁剪检测，可覆盖水平、垂直和斜线，且不会按像素逐点扫描。 */
  private segmentIntersectsRectangle(start: EdgeRoutePoint, end: EdgeRoutePoint, bounds: RectangleBounds): boolean {
    const deltaX = end.x - start.x
    const deltaY = end.y - start.y
    let minimum = 0
    let maximum = 1
    const constraints = [
      [-deltaX, start.x - bounds.left],
      [deltaX, bounds.right - start.x],
      [-deltaY, start.y - bounds.top],
      [deltaY, bounds.bottom - start.y],
    ] as const

    for (const [direction, distance] of constraints) {
      if (Math.abs(direction) < 1e-6) {
        if (distance < 0) return false
        continue
      }
      const ratio = distance / direction
      if (direction < 0) minimum = Math.max(minimum, ratio)
      else maximum = Math.min(maximum, ratio)
      if (minimum > maximum) return false
    }

    return true
  }

  /**
   * 叉积判定支持任意角度。共线线段只要存在有效重叠即冲突；单点接触仅在共享节点且双方都是端点时放行。
   */
  private segmentsConflict(
    firstStart: EdgeRoutePoint,
    firstEnd: EdgeRoutePoint,
    secondStart: EdgeRoutePoint,
    secondEnd: EdgeRoutePoint,
    allowSharedEndpoint: boolean,
  ): boolean {
    const cross = (origin: EdgeRoutePoint, left: EdgeRoutePoint, right: EdgeRoutePoint) =>
      (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x)
    const firstDirection = { x: firstEnd.x - firstStart.x, y: firstEnd.y - firstStart.y }
    const secondDirection = { x: secondEnd.x - secondStart.x, y: secondEnd.y - secondStart.y }
    const denominator = firstDirection.x * secondDirection.y - firstDirection.y * secondDirection.x
    const offset = { x: secondStart.x - firstStart.x, y: secondStart.y - firstStart.y }

    if (Math.abs(denominator) < 1e-6) {
      if (Math.abs(cross(firstStart, firstEnd, secondStart)) >= 1e-6) return false
      const useX = Math.abs(firstDirection.x) >= Math.abs(firstDirection.y)
      const firstRange = useX ? [firstStart.x, firstEnd.x] : [firstStart.y, firstEnd.y]
      const secondRange = useX ? [secondStart.x, secondEnd.x] : [secondStart.y, secondEnd.y]
      const overlapStart = Math.max(Math.min(...firstRange), Math.min(...secondRange))
      const overlapEnd = Math.min(Math.max(...firstRange), Math.max(...secondRange))
      if (overlapEnd < overlapStart - 1e-6) return false
      if (overlapEnd - overlapStart > 1e-6) return true
      return !allowSharedEndpoint
    }

    const firstRatio = (offset.x * secondDirection.y - offset.y * secondDirection.x) / denominator
    const secondRatio = (offset.x * firstDirection.y - offset.y * firstDirection.x) / denominator
    if (firstRatio < -1e-6 || firstRatio > 1 + 1e-6 || secondRatio < -1e-6 || secondRatio > 1 + 1e-6) return false
    const bothAtEndpoints = (firstRatio < 1e-6 || firstRatio > 1 - 1e-6) && (secondRatio < 1e-6 || secondRatio > 1 - 1e-6)
    return !(allowSharedEndpoint && bothAtEndpoints)
  }

  /** 从图元中心朝目标点投射，返回射线与方形图元边框的交点。 */
  private getRectangleBoundaryPoint(layout: NodeLayout, target: EdgeRoutePoint): EdgeRoutePoint {
    const center = this.getLayoutCenter(layout)
    const deltaX = target.x - center.x
    const deltaY = target.y - center.y
    const divisor = Math.max(Math.abs(deltaX) / Math.max(1, layout.width / 2), Math.abs(deltaY) / Math.max(1, layout.height / 2), 1e-6)
    return { x: center.x + deltaX / divisor, y: center.y + deltaY / divisor }
  }

  /** 读取图元中心，集中避免各路由分支重复坐标公式。 */
  private getLayoutCenter(layout: NodeLayout): EdgeRoutePoint {
    return { x: layout.x + layout.width / 2, y: layout.y + layout.height / 2 }
  }

  /** 浮点坐标使用小容差比较，防止几何计算误差产生零长度伪线段。 */
  private pointsEqual(left: EdgeRoutePoint, right: EdgeRoutePoint): boolean {
    return Math.abs(left.x - right.x) < 1e-6 && Math.abs(left.y - right.y) < 1e-6
  }

  /** 累加真实线段长度用于在同拐点数量内选择最短绕行候选。 */
  private getRouteLength(route: EdgeRoute): number {
    let total = 0
    for (let index = 1; index < route.points.length; index += 1) {
      const previous = route.points[index - 1]
      const current = route.points[index]
      if (previous && current) total += Math.hypot(current.x - previous.x, current.y - previous.y)
    }
    return total
  }

  /**
   * 每个层级走廊内的边使用独立通道坐标。
   * 通道即使在窄容器中被压缩也保持不同坐标，用户可通过既有缩放查看，不会退化为重叠主干。
   */
  private assignRouteLanes(requests: readonly EdgeRoutingRequest[]): void {
    const groups = new Map<string, EdgeRoutingRequest[]>()

    for (const request of requests) {
      const group = groups.get(request.corridorKey) ?? []
      group.push(request)
      groups.set(request.corridorKey, group)
    }

    for (const group of groups.values()) {
      group.sort((left, right) => this.compareRoutingRequests(left, right))

      if (group[0]?.orientation === 'vertical') this.assignVerticalLanes(group)
      else this.assignHorizontalLanes(group)
    }
  }

  /** 通道路由顺序依次看起点、终点及边标识，确保同一配置得到稳定且易追踪的线路排列。 */
  private compareRoutingRequests(left: EdgeRoutingRequest, right: EdgeRoutingRequest): number {
    const leftStart = left.startPort
    const rightStart = right.startPort
    const leftEnd = left.endPort
    const rightEnd = right.endPort

    if (!leftStart || !rightStart || !leftEnd || !rightEnd) return left.edge.edgeId.localeCompare(right.edge.edgeId)

    const primaryLeft = left.orientation === 'vertical' ? leftStart.x : leftStart.y
    const primaryRight = right.orientation === 'vertical' ? rightStart.x : rightStart.y
    const secondaryLeft = left.orientation === 'vertical' ? leftEnd.x : leftEnd.y
    const secondaryRight = right.orientation === 'vertical' ? rightEnd.x : rightEnd.y

    return primaryLeft - primaryRight || secondaryLeft - secondaryRight || left.edge.edgeId.localeCompare(right.edge.edgeId)
  }

  /** 在起止节点之间均匀分配水平通道，消除多条跨层边共享中点横线的问题。 */
  private assignVerticalLanes(requests: readonly EdgeRoutingRequest[]): void {
    const sample = requests[0]
    const startPort = sample?.startPort
    const endPort = sample?.endPort

    if (!sample || !startPort || !endPort) return

    // 同走廊来自相同层对，端口边界相同；首个样本足以给该池建立稳定通道范围。
    const firstY = Math.min(startPort.y, endPort.y)
    const lastY = Math.max(startPort.y, endPort.y)
    const span = Math.max(1, lastY - firstY)

    for (let index = 0; index < requests.length; index += 1) {
      const request = requests[index]
      // 从目标侧反向分配车道：前一条边的终点竖段会先在靠近目标的位置收束，
      // 后一条边的起点竖段则停在更靠近来源的位置，避免同列上下节点的两段竖线相互穿过。
      // 空间不足时仍压缩为不同坐标，不会回退为复用同一条公共主干。
      request.laneCoordinate = firstY + (span * (requests.length - index)) / (requests.length + 1)
    }
  }

  /** 同层横向边沿节点上方或下方分别布线，避免多个相邻设备之间出现一条难以辨识的公共直线。 */
  private assignHorizontalLanes(requests: readonly EdgeRoutingRequest[]): void {
    const minimumTop = Math.min(...requests.flatMap((request) => [request.fromLayout.y, request.toLayout.y]))
    const maximumBottom = Math.max(...requests.flatMap((request) => [request.fromLayout.y + request.fromLayout.height, request.toLayout.y + request.toLayout.height]))
    const preferredAbove = minimumTop - 7
    const preferredBelow = maximumBottom + 7
    // 顶部空间不足时统一改走下侧，保证首条横线也不会压住企业层节点或画布边缘。
    const useAbove = preferredAbove >= 7 || this.height - preferredBelow < preferredAbove
    const laneStep = Math.max(5, Math.min(12, Math.round(this.height / 48)))

    for (let index = 0; index < requests.length; index += 1) {
      requests[index].laneCoordinate = (useAbove ? preferredAbove : preferredBelow) + (useAbove ? -index : index) * laneStep
    }
  }

  /** 根据已分配的端口和通道生成正交点序列；不再回退到中心点路径，以保证无公共主干。 */
  private createRouteFromRequest(request: EdgeRoutingRequest): EdgeRoute | undefined {
    const startPort = request.startPort
    const endPort = request.endPort
    const laneCoordinate = request.laneCoordinate

    if (!startPort || !endPort) return undefined

    if (laneCoordinate === undefined) return undefined

    // 水平与纵向主关系都以“先垂直到专属高度、再水平穿过通道、最后垂直接入”组成。
    // laneCoordinate 始终表示 Y 坐标；此前同层分支误将它用作 X 坐标，导致线路异常绕向左侧。
    const points = [startPort, { x: startPort.x, y: laneCoordinate }, { x: endPort.x, y: laneCoordinate }, endPort]

    return { points: this.removeDuplicateRoutePoints(points) }
  }

  /** 删除零长度拐点，确保箭头方向和标签扫描始终基于真实线段。 */
  private removeDuplicateRoutePoints(points: readonly EdgeRoutePoint[]): EdgeRoutePoint[] {
    return points.filter((point, index) => {
      const previous = points[index - 1]

      return !previous || previous.x !== point.x || previous.y !== point.y
    })
  }

  /** 根据证据状态和选中状态绘制路径；协议标识仅作可读提示，不产生运行时通信。 */
  private drawEdge(context: CanvasRenderingContext2D, edge: TopologyEdgeDefinition): void {
    const fromLayout = this.layoutByNodeId.get(edge.fromNodeId)
    const toLayout = this.layoutByNodeId.get(edge.toNodeId)

    if (!fromLayout || !toLayout) return
    const isSelected = this.selectedRouteIds.has(edge.edgeId) || edge.sceneRouteIds.some((routeId) => this.selectedRouteIds.has(routeId))
    // 资料线色只覆盖普通态；选中态仍使用统一高亮色，保证节点选择反馈清晰且不改变业务数据。
    const color = isSelected ? '#e0f2fe' : edge.lineColor ?? edgeColorByEvidence[edge.evidenceStatus]
    const route = this.routeByEdgeId.get(edge.edgeId)

    if (!route || route.points.length < 2) return

    context.save()
    context.strokeStyle = color
    context.lineWidth = isSelected ? 3 : 1.45
    // 显式线型优先于证据状态；旧清单没有 lineStyle（线型）时保持历史“已确认实线、其他虚线”规则。
    const isDashed = edge.lineStyle !== undefined
      ? edge.lineStyle === 'dashed'
      : edge.evidenceStatus !== 'verified'
    context.setLineDash(isDashed ? [6, 5] : [])
    context.shadowColor = color
    context.shadowBlur = isSelected ? 12 : 5
    context.beginPath()
    const [firstPoint, ...remainingPoints] = route.points
    context.moveTo(firstPoint.x, firstPoint.y)

    for (const point of remainingPoints) context.lineTo(point.x, point.y)

    context.stroke()
    context.setLineDash([])
    const targetPoint = route.points[route.points.length - 1]
    const previousPoint = route.points[route.points.length - 2]

    if (targetPoint && previousPoint) this.drawArrow(context, targetPoint.x, targetPoint.y, previousPoint.x, previousPoint.y, color)

    // 协议标签是否可见完全由节点避让结果决定，不再用画布宽度阈值粗暴隐藏。
    // 这样中等宽度页面也能保留通信语义，同时不会引入文字与设备卡片重叠。
    if (edge.protocolLabel) {
      this.drawEdgeLabel(context, edge.protocolLabel, route, color)
    }

    context.restore()
  }

  /** 以路径最后一段确定箭头方向，避免折线路由中箭头始终指向右侧的误导。 */
  private drawArrow(context: CanvasRenderingContext2D, endX: number, endY: number, previousX: number, previousY: number, color: string): void {
    const angle = Math.atan2(endY - previousY, endX - previousX)
    const size = 5
    context.fillStyle = color
    context.beginPath()
    context.moveTo(endX, endY)
    context.lineTo(endX - Math.cos(angle - Math.PI / 6) * size, endY - Math.sin(angle - Math.PI / 6) * size)
    context.lineTo(endX - Math.cos(angle + Math.PI / 6) * size, endY - Math.sin(angle + Math.PI / 6) * size)
    context.closePath()
    context.fill()
  }

  /**
   * 将协议标签放在折线路径中可容纳文本的最长空闲线段上，并与全部节点进行矩形碰撞检测。
   * 线段空间不足时宁可不显示标签，也不让文字压住设备名称或层级导视内容。
   */
  private drawEdgeLabel(context: CanvasRenderingContext2D, label: string, route: EdgeRoute, color: string): void {
    const metrics = this.getResponsiveMetrics()
    context.font = `600 ${metrics.edgeLabelFontSize}px Microsoft YaHei, sans-serif`
    const labelWidth = Math.min(68 * metrics.scale, Math.ceil(context.measureText(label).width + 8 * metrics.scale))
    // 高度随画布连续缩放，最低仍可完整容纳 7.2 像素协议文字。
    const labelHeight = 14 * metrics.scale
    const placement = this.findAvailableEdgeLabelPlacement(route, labelWidth, labelHeight)

    if (!placement) return

    context.fillStyle = '#061923'
    context.strokeStyle = `${color}aa`
    context.lineWidth = 1
    this.roundRect(context, placement.x - labelWidth / 2, placement.y - labelHeight / 2, labelWidth, labelHeight, 4)
    context.fill()
    context.stroke()
    context.fillStyle = '#d9f8ff'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(label, placement.x, placement.y, labelWidth - 8 * metrics.scale)
    this.drawnEdgeLabelBounds.push(this.createBoundsFromCenter(placement.x, placement.y, placement.width, placement.height))
  }

  /**
   * 扫描任意角度点序列中的每一段，标签沿线段法线向两侧偏移并保持文字水平。
   * 候选按线段长度排序，既支持斜直线，也兼容水平、垂直和多拐点兜底路径。
   */
  private findAvailableEdgeLabelPlacement(route: EdgeRoute, labelWidth: number, labelHeight: number): EdgeLabelPlacement | undefined {
    const candidates: Array<EdgeLabelPlacement & { segmentLength: number }> = []
    const lineClearance = 4

    for (let index = 1; index < route.points.length; index += 1) {
      const previous = route.points[index - 1]
      const current = route.points[index]

      if (!previous || !current) continue

      const deltaX = current.x - previous.x
      const deltaY = current.y - previous.y

      const segmentLength = Math.hypot(deltaX, deltaY)
      if (segmentLength < Math.max(labelWidth, labelHeight) + 6) continue
      const middleX = (previous.x + current.x) / 2
      const middleY = (previous.y + current.y) / 2
      const normalX = -deltaY / segmentLength
      const normalY = deltaX / segmentLength
      const offset = Math.abs(normalX) * (labelWidth / 2 + lineClearance) + Math.abs(normalY) * (labelHeight / 2 + lineClearance)

      candidates.push({ x: middleX + normalX * offset, y: middleY + normalY * offset, width: labelWidth, height: labelHeight, segmentLength })
      candidates.push({ x: middleX - normalX * offset, y: middleY - normalY * offset, width: labelWidth, height: labelHeight, segmentLength })
    }

    candidates.sort((left, right) => right.segmentLength - left.segmentLength)
    return candidates.find((candidate) => this.isEdgeLabelPlacementAvailable(candidate))
  }

  /** 标签周围额外保留 2 像素安全区，既避免描边粘连，也能利用紧凑层之间的有效空隙。 */
  private isEdgeLabelPlacementAvailable(placement: EdgeLabelPlacement): boolean {
    const safeGap = 2
    const left = placement.x - placement.width / 2 - safeGap
    const right = placement.x + placement.width / 2 + safeGap
    const top = placement.y - placement.height / 2 - safeGap
    const bottom = placement.y + placement.height / 2 + safeGap

    // 标签不得回流到左侧层级导视区或越过画布边缘，避免缩放后出现半截文字。
    if (left < this.getLayerLabelGutter() || right > this.width - safeGap || top < safeGap || bottom > this.height - safeGap) return false

    for (const layout of this.layoutByNodeId.values()) {
      const bounds = layout.routeBounds
      const overlaps = left < bounds.right && right > bounds.left && top < bounds.bottom && bottom > bounds.top

      if (overlaps) return false
    }

    if (this.drawnEdgeLabelBounds.some((bounds) => left < bounds.right && right > bounds.left && top < bounds.bottom && bottom > bounds.top)) return false

    return true
  }

  /**
   * 设备以状态 SVG 为主体，层级色仅用于卡片边界；选中时增加青色外框和光晕，
   * 绝不替换设备图元或状态圆点，因此不会把离线节点伪装成正常节点。
   */
  private drawNode(context: CanvasRenderingContext2D, layout: NodeLayout): void {
    const isSelected = this.selectedNodeIds.has(layout.node.nodeId)
    const layerColor = this.getLayerColor(layout.node.layerId)
    const deviceStatus = this.nodeStatusOverrideById.get(layout.node.nodeId) ?? layout.node.deviceStatus

    context.save()
    const metrics = this.getResponsiveMetrics()
    if (isSelected) {
      context.strokeStyle = '#67e8f9'
      context.lineWidth = 2
      context.shadowColor = '#22d3ee'
      context.shadowBlur = 10
      const expansion = metrics.selectionExpansion
      this.roundRect(context, layout.x - expansion, layout.y - expansion, layout.width + expansion * 2, layout.height + expansion * 2, 7)
      context.stroke()
    }

    // 普通节点不再绘制大于图元的卡片底板；层级描边覆盖在图元盒内侧，不额外扩大视觉边界。
    context.fillStyle = 'transparent'
    context.strokeStyle = `${layerColor}cc`
    context.lineWidth = 1

    // SVG 图元直接铺满 28 至 40 像素的响应式节点盒；内侧描边不会形成比图标大一圈的普通卡片。
    const iconSize = Math.max(1, Math.min(layout.height, layout.width))
    const iconX = layout.x + (layout.width - iconSize) / 2
    const iconY = layout.y + (layout.height - iconSize) / 2
    const image = this.getIconImage(layout.node, deviceStatus)

    if (image) {
      context.drawImage(image, iconX, iconY, iconSize, iconSize)
    } else {
      // 图元加载前仅绘制中性占位框，不以字符或临时图标替代正式设备图元。
      context.strokeStyle = 'rgba(148, 163, 184, 0.65)'
      context.setLineDash([2, 2])
      this.roundRect(context, iconX + 2, iconY + 2, iconSize - 4, iconSize - 4, 4)
      context.stroke()
      context.setLineDash([])
    }

    // 重新建立边框路径后覆盖在图元边缘内侧；图片加载与占位路径不会污染该描边。
    this.roundRect(context, layout.x + 0.5, layout.y + 0.5, layout.width - 1, layout.height - 1, 5)
    context.stroke()

    // 四态已经由受控 SVG 图元和完整提示共同表达，不再叠加右上角状态圆点，避免遮挡放大的设备图标。
    this.drawNodeTitle(context, layout, metrics)
    context.restore()
  }

  /**
   * 常驻节点名在图元边框外下方显示一行更小的辅助文字，完整标题由画布外的受控提示层展示。
   * 这里仍按实测像素宽度截断，避免中文、字母和数字宽度差异造成相邻节点文字碰撞。
   */
  private drawNodeTitle(context: CanvasRenderingContext2D, layout: NodeLayout, metrics: ResponsiveTopologyMetrics): void {
    const availableWidth = metrics.nodeTitleMaxWidth
    context.fillStyle = '#e2f7ff'
    context.font = `600 ${metrics.nodeTitleFontSize}px Microsoft YaHei, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'top'
    const [label = ''] = this.wrapText(context, layout.node.title, availableWidth, 1)
    context.fillText(label, layout.x + layout.width / 2, layout.titleBounds.top, availableWidth)
  }

  /** 基于 Canvas 实测宽度拆分文本，末行超出时追加省略号而非让标签穿透相邻节点。 */
  private wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
    const lines: string[] = []
    let currentLine = ''

    for (const character of Array.from(text)) {
      const candidate = `${currentLine}${character}`

      if (currentLine && context.measureText(candidate).width > maxWidth) {
        lines.push(currentLine)
        currentLine = character

        if (lines.length === maxLines) break
      } else {
        currentLine = candidate
      }
    }

    if (lines.length < maxLines && currentLine) lines.push(currentLine)
    const visibleLength = lines.join('').length

    if (visibleLength < text.length && lines.length > 0) {
      const lastIndex = lines.length - 1
      let lastLine = lines[lastIndex] ?? ''

      while (lastLine && context.measureText(`${lastLine}…`).width > maxWidth) {
        lastLine = lastLine.slice(0, -1)
      }

      lines[lastIndex] = `${lastLine}…`
    }

    return lines
  }

  /** 通过受控图元键与设备状态取得图片；同一地址只加载一次，完成后合并为下一帧重绘。 */
  private getIconImage(node: TopologyNodeDefinition, deviceStatus: TopologyDeviceStatus): HTMLImageElement | undefined {
    const iconUrl = getTopologyIconUrl(node.iconKey, deviceStatus)

    // 中性图元没有资源地址；直接使用既有轮廓占位，不能根据外部图元键推测或请求图片。
    if (!iconUrl) return undefined
    const cached = this.iconImageByUrl.get(iconUrl)

    if (cached) return cached.status === 'ready' ? cached.image : undefined
    // URL 只能来自冻结的“图元键 × 四态”登记表；仍保留显式上限，防御未来错误扩展造成图片缓存无界增长。
    if (this.iconImageByUrl.size >= MAXIMUM_TOPOLOGY_ICON_ASSETS) return undefined
    const image = new Image()
    const entry: IconImageCacheEntry = { image, status: 'loading' }
    image.decoding = 'async'
    image.onload = () => {
      entry.status = 'ready'
      this.scheduleDraw()
    }
    image.onerror = () => {
      entry.status = 'error'
      this.scheduleDraw()
    }
    image.src = iconUrl
    this.iconImageByUrl.set(iconUrl, entry)
    return undefined
  }

  /** 从可选层定义读取边界色；未分层的通用拓扑使用稳定的中性青色。 */
  private getLayerColor(layerId: string | undefined): string {
    return this.topology?.layers?.find((layer) => layer.layerId === layerId)?.color ?? '#38bdf8'
  }

  /** 兼容旧浏览器的圆角矩形路径，避免依赖 CanvasRenderingContext2D.roundRect 支持度。 */
  private roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
    const safeRadius = Math.min(radius, width / 2, height / 2)
    context.beginPath()
    context.moveTo(x + safeRadius, y)
    context.lineTo(x + width - safeRadius, y)
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
    context.lineTo(x + width, y + height - safeRadius)
    context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
    context.lineTo(x + safeRadius, y + height)
    context.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
    context.lineTo(x, y + safeRadius)
    context.quadraticCurveTo(x, y, x + safeRadius, y)
    context.closePath()
  }
}

import type { ProcessNodeId, RouteId } from '@/config/process/identifiers'
import type { TopologyDefinition, TopologyEdgeDefinition, TopologyNodeDefinition } from '@/config/process/types'
import { getTopologyIconUrl } from '@/services/topology/topology-icon-registry'
import type { TopologyRenderer } from '@/services/topology/topology-renderer'

/** Canvas 绘制所需的缓存布局，命中测试直接复用，避免点击时再次遍历计算坐标。 */
interface NodeLayout {
  node: TopologyNodeDefinition
  x: number
  y: number
  width: number
  height: number
}

/** 已请求图元的加载状态缓存，防止每次重绘重复创建 Image 或重复请求同一 SVG。 */
interface IconImageCacheEntry {
  image: HTMLImageElement
  status: 'loading' | 'ready' | 'error'
}

/** 正交线路中的单个拐点；点序列支持多端口和多通道，避免固定四点折线被迫重叠。 */
interface EdgeRoutePoint {
  x: number
  y: number
}

/**
 * 预计算后的正交连线路径。
 * 最后两个点始终表示箭头朝向，全部点则同时供协议标签挑选最长可读线段。
 */
interface EdgeRoute {
  points: readonly EdgeRoutePoint[]
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
} as const

const deviceStatusColor = {
  normal: '#22c55e',
  alarm: '#facc15',
  fault: '#ef4444',
  offline: '#94a3b8',
} as const

/**
 * 路由规则变更时递增该版本号，使开发热更新中的既有画布实例自动丢弃旧路径缓存。
 * 正式运行时版本恒定，仍只在尺寸或拓扑变化后重算，不增加实时重绘成本。
 */
const EDGE_ROUTE_LAYOUT_VERSION = 3

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
  private readonly layoutByNodeId = new Map<string, NodeLayout>()
  /** 连线路径只在拓扑定义或画布尺寸变化时重建，选中态重绘直接复用，避免重复分组排序。 */
  private readonly routeByEdgeId = new Map<string, EdgeRoute>()
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

  private readonly minimumViewScale = 0.55
  private readonly maximumViewScale = 2.25

  public constructor(private readonly canvas: HTMLCanvasElement) {}

  /** 缓存节点索引以实现边绘制和命中测试的常数时间查找。 */
  public setTopology(topology: TopologyDefinition): void {
    this.topology = topology
    this.nodeById.clear()
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

  /** 使用绘制期缓存的节点矩形完成命中测试，点击操作不触发布局或配置扫描。 */
  public pickNodeAt(x: number, y: number): ProcessNodeId | undefined {
    // Canvas 绘制以中心点缩放，命中坐标必须逆变换后才能复用逻辑布局缓存。
    const contentX = this.width / 2 + (x - this.width / 2 - this.viewOffsetX) / this.viewScale
    const contentY = this.height / 2 + (y - this.height / 2 - this.viewOffsetY) / this.viewScale

    for (const layout of this.layoutByNodeId.values()) {
      const isInside = contentX >= layout.x && contentX <= layout.x + layout.width && contentY >= layout.y && contentY <= layout.y + layout.height

      if (isInside) return layout.node.nodeId
    }

    return undefined
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
    this.layoutByNodeId.clear()
    this.routeByEdgeId.clear()
    this.routesDirty = true
    this.routeLayoutVersion = -1
    this.iconImageByUrl.clear()
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
      context.font = '700 11px Microsoft YaHei, sans-serif'
      context.textAlign = 'left'
      context.textBaseline = 'top'
      context.fillText(layer.title, 16, Math.min(top + 10, Math.max(4, currentY - 30)))
      context.restore()
    }
  }

  /** 根据最密集层的节点数量计算卡片尺寸，保证多层拓扑在中窄屏下尽量避免横向覆盖。 */
  private createNodeLayouts(): void {
    if (!this.topology) return
    const countByLayer = new Map<string, number>()

    for (const node of this.topology.nodes) {
      const layerId = node.layerId ?? '__ungrouped__'
      countByLayer.set(layerId, (countByLayer.get(layerId) ?? 0) + 1)
    }

    const densestLayerCount = Math.max(1, ...countByLayer.values())
    // 密集层额外预留 2.4 个节点宽度作为间隔，优先保证同层设备卡片之间始终有可见留白。
    // 下限同步收窄，避免窄视口中七个现场设备再次挤压成连续块。
    const nodeWidth = Math.min(118, Math.max(40, Math.floor(this.width / (densestLayerCount + 2.4))))
    // 卡片高度必须小于相邻层节点的最小纵向距离，才能在固定视口内保留层间留白。
    // 通过较小下限兼顾低高度容器，细节由容器内缩放功能补足。
    const nodeHeight = Math.min(42, Math.max(28, Math.floor(this.height / 10.5)))
    const layerLabelGutter = this.getLayerLabelGutter()
    const rightPadding = Math.max(14, Math.round(this.width * 0.02))
    // 节点横坐标只在层级标题右侧的内容区内映射，避免最低坐标设备侵入左侧导视文字。
    // 右侧保留与左侧相对较小的安全边距，保证最右设备完整显示且不浪费可用宽度。
    const topologyContentWidth = Math.max(1, this.width - layerLabelGutter - rightPadding)

    for (const node of this.topology.nodes) {
      const x = Math.round(layerLabelGutter + (node.x / 100) * topologyContentWidth - nodeWidth / 2)
      const y = Math.round((node.y / 100) * this.height - nodeHeight / 2)
      this.layoutByNodeId.set(node.nodeId, { node, x, y, width: nodeWidth, height: nodeHeight })
    }
  }

  /**
   * 为层级导视文本预留固定但可随画布变宽的左侧空间。
   * 该值同时参与分隔线起点与节点坐标映射，避免两套边距规则随尺寸变化失去同步。
   */
  private getLayerLabelGutter(): number {
    return Math.min(124, Math.max(88, Math.round(this.width * 0.13)))
  }

  /**
   * 在全部节点完成布局后，统一预计算连线端口和通道。
   * 旧实现逐边从节点中心出发，扇入、扇出关系会复用同一段主干；这里通过“先端口、后通道”
   * 的两阶段分配，使每条关系都有可辨识的入口、出口和水平/垂直通道。
   */
  private rebuildEdgeRoutesIfNeeded(): void {
    if ((!this.routesDirty && this.routeLayoutVersion === EDGE_ROUTE_LAYOUT_VERSION) || !this.topology) return

    const requests = this.createEdgeRoutingRequests()
    this.assignEndpointPorts(requests)
    this.assignDirectRoutes(requests)
    this.assignRouteLanes(requests.filter((request) => !request.directRoute))
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
   * 在通道分配前识别并固定可直连关系。
   * 直连边不占用绕行通道，优先还原“同层横向设备”“同列上下设备”的自然阅读路径；
   * 若直线会穿过第三方节点或与已确认直线重合，则安全降级为通道路由。
   */
  private assignDirectRoutes(requests: readonly EdgeRoutingRequest[]): void {
    const acceptedRoutes: EdgeRoute[] = []

    for (const request of requests) {
      const directRoute = this.createDirectRoute(request)

      if (!directRoute || this.overlapsAcceptedDirectRoute(directRoute, acceptedRoutes)) continue

      request.directRoute = directRoute
      acceptedRoutes.push(directRoute)
    }
  }

  /** 依据关系主方向构造直连候选；只有端口已完成分配后，才能可靠判断其是否处于同一水平线。 */
  private createDirectRoute(request: EdgeRoutingRequest): EdgeRoute | undefined {
    const startPort = request.startPort
    const endPort = request.endPort

    if (!startPort || !endPort) return undefined

    if (request.orientation === 'horizontal') {
      return this.canUseDirectHorizontalRoute(request, startPort, endPort) ? { points: [startPort, endPort] } : undefined
    }

    return this.createDirectVerticalRoute(request)
  }

  /**
   * 防止两条同向直线复用同一段路径；交叉直线也会降级为通道，以保持上下游箭头清楚可辨。
   * 当前拓扑边数很小，仅在拓扑或尺寸变化时执行，O(E²) 的一次性检查不会影响实时重绘性能。
   */
  private overlapsAcceptedDirectRoute(candidate: EdgeRoute, acceptedRoutes: readonly EdgeRoute[]): boolean {
    const candidateStart = candidate.points[0]
    const candidateEnd = candidate.points[1]

    if (!candidateStart || !candidateEnd) return true

    const candidateHorizontal = Math.abs(candidateStart.y - candidateEnd.y) < 0.5

    for (const acceptedRoute of acceptedRoutes) {
      const acceptedStart = acceptedRoute.points[0]
      const acceptedEnd = acceptedRoute.points[1]

      if (!acceptedStart || !acceptedEnd) continue

      const acceptedHorizontal = Math.abs(acceptedStart.y - acceptedEnd.y) < 0.5

      if (candidateHorizontal === acceptedHorizontal) {
        const sharesAxis = candidateHorizontal
          ? Math.abs(candidateStart.y - acceptedStart.y) < 0.5
          : Math.abs(candidateStart.x - acceptedStart.x) < 0.5

        if (!sharesAxis) continue

        const candidateRange = candidateHorizontal
          ? [Math.min(candidateStart.x, candidateEnd.x), Math.max(candidateStart.x, candidateEnd.x)]
          : [Math.min(candidateStart.y, candidateEnd.y), Math.max(candidateStart.y, candidateEnd.y)]
        const acceptedRange = acceptedHorizontal
          ? [Math.min(acceptedStart.x, acceptedEnd.x), Math.max(acceptedStart.x, acceptedEnd.x)]
          : [Math.min(acceptedStart.y, acceptedEnd.y), Math.max(acceptedStart.y, acceptedEnd.y)]

        if (candidateRange[0] < acceptedRange[1] && candidateRange[1] > acceptedRange[0]) return true
        continue
      }

      const horizontalStart = candidateHorizontal ? candidateStart : acceptedStart
      const horizontalEnd = candidateHorizontal ? candidateEnd : acceptedEnd
      const verticalStart = candidateHorizontal ? acceptedStart : candidateStart
      const verticalEnd = candidateHorizontal ? acceptedEnd : candidateEnd
      const intersectsX = verticalStart.x > Math.min(horizontalStart.x, horizontalEnd.x) && verticalStart.x < Math.max(horizontalStart.x, horizontalEnd.x)
      const intersectsY = horizontalStart.y > Math.min(verticalStart.y, verticalEnd.y) && horizontalStart.y < Math.max(verticalStart.y, verticalEnd.y)

      if (intersectsX && intersectsY) return true
    }

    return false
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

  /**
   * 对同列上下节点优先建立一条直接竖线，例如控制器至同列现场执行设备。
   * 直连使用卡片中线而非扇出端口，既符合工艺阅读方向，也不会受其他分支端口的偏移影响。
   */
  private createDirectVerticalRoute(request: EdgeRoutingRequest): EdgeRoute | undefined {
    const fromCenterX = request.fromLayout.x + request.fromLayout.width / 2
    const toCenterX = request.toLayout.x + request.toLayout.width / 2

    // 仅在严格同列时直连；跨列关系仍必须使用独立通道，避免重新制造交叉与重叠。
    if (Math.abs(fromCenterX - toCenterX) > 0.5) return undefined

    const isDownward = request.toLayout.y >= request.fromLayout.y
    const startPoint = {
      x: fromCenterX,
      y: isDownward ? request.fromLayout.y + request.fromLayout.height : request.fromLayout.y,
    }
    const endPoint = {
      x: toCenterX,
      y: isDownward ? request.toLayout.y : request.toLayout.y + request.toLayout.height,
    }

    return this.canUseDirectVerticalRoute(request, startPoint, endPoint) ? { points: [startPoint, endPoint] } : undefined
  }

  /**
   * 判断同层边能否直连：端口必须处于同一高度，且两端之间不能穿过第三方节点。
   * 不满足任一条件时继续使用独立通道，以避免直线穿卡或重新引入公共主干重叠。
   */
  private canUseDirectHorizontalRoute(request: EdgeRoutingRequest, startPort: EdgeRoutePoint, endPort: EdgeRoutePoint): boolean {
    if (Math.abs(startPort.y - endPort.y) > 0.5) return false

    const safeGap = 2
    const left = Math.min(startPort.x, endPort.x)
    const right = Math.max(startPort.x, endPort.x)

    for (const layout of this.layoutByNodeId.values()) {
      if (layout.node.nodeId === request.fromLayout.node.nodeId || layout.node.nodeId === request.toLayout.node.nodeId) continue

      const intersectsHorizontalRange = left < layout.x + layout.width + safeGap && right > layout.x - safeGap
      const intersectsVerticalRange = startPort.y > layout.y - safeGap && startPort.y < layout.y + layout.height + safeGap

      if (intersectsHorizontalRange && intersectsVerticalRange) return false
    }

    return true
  }

  /**
   * 同列直线只允许穿过两端节点之间的空白区域；若中途存在其他卡片，继续使用通道折线避让。
   * 这样现场层的垂直控制关系会保持直接、清晰，同时不让跨越多层的关系误穿中间设备。
   */
  private canUseDirectVerticalRoute(request: EdgeRoutingRequest, startPoint: EdgeRoutePoint, endPoint: EdgeRoutePoint): boolean {
    const safeGap = 2
    const top = Math.min(startPoint.y, endPoint.y)
    const bottom = Math.max(startPoint.y, endPoint.y)

    for (const layout of this.layoutByNodeId.values()) {
      if (layout.node.nodeId === request.fromLayout.node.nodeId || layout.node.nodeId === request.toLayout.node.nodeId) continue

      const intersectsHorizontalRange = startPoint.x > layout.x - safeGap && startPoint.x < layout.x + layout.width + safeGap
      const intersectsVerticalRange = top < layout.y + layout.height + safeGap && bottom > layout.y - safeGap

      if (intersectsHorizontalRange && intersectsVerticalRange) return false
    }

    return true
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
    const color = isSelected ? '#e0f2fe' : edgeColorByEvidence[edge.evidenceStatus]
    const route = this.routeByEdgeId.get(edge.edgeId)

    if (!route || route.points.length < 2) return

    context.save()
    context.strokeStyle = color
    context.lineWidth = isSelected ? 3 : 1.45
    context.setLineDash(edge.evidenceStatus === 'verified' ? [] : [6, 5])
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
    context.font = '600 9px Microsoft YaHei, sans-serif'
    const labelWidth = Math.min(74, Math.ceil(context.measureText(label).width + 10))
    // 紧凑层间仅保留约 18 像素空隙，标签高度压缩为 14 像素后仍可完整显示“4-20mA”。
    const labelHeight = 14
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
    context.fillText(label, placement.x, placement.y, labelWidth - 8)
  }

  /**
   * 扫描正交点序列中的每一段，横线标签固定浮在连线上方，竖线标签置于线侧。
   * 路由升级为多点通道后仍能从最长可读段挑选标签，且不会让发光线穿过协议文字。
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

      if (Math.abs(deltaX) >= labelWidth + 8 && Math.abs(deltaY) < 0.5) {
        // 标签底部与横线保留 4 像素距离，确保连线不会穿过文字或标签底色。
        candidates.push({
          x: (previous.x + current.x) / 2,
          y: previous.y - labelHeight / 2 - lineClearance,
          width: labelWidth,
          height: labelHeight,
          segmentLength: Math.abs(deltaX),
        })
      }

      if (Math.abs(deltaY) >= labelHeight + 2 && Math.abs(deltaX) < 0.5) {
        // 竖线无法使用“上方”布局，标签改为左右两侧候选，避免竖线从文字中间穿过。
        candidates.push({
          x: previous.x + labelWidth / 2 + lineClearance,
          y: (previous.y + current.y) / 2,
          width: labelWidth,
          height: labelHeight,
          segmentLength: Math.abs(deltaY),
        })
        candidates.push({
          x: previous.x - labelWidth / 2 - lineClearance,
          y: (previous.y + current.y) / 2,
          width: labelWidth,
          height: labelHeight,
          segmentLength: Math.abs(deltaY),
        })
      }
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
      const overlaps = left < layout.x + layout.width && right > layout.x && top < layout.y + layout.height && bottom > layout.y

      if (overlaps) return false
    }

    return true
  }

  /**
   * 设备以状态 SVG 为主体，层级色仅用于卡片边界；选中时增加青色外框和光晕，
   * 绝不替换设备图元或状态圆点，因此不会把离线节点伪装成正常节点。
   */
  private drawNode(context: CanvasRenderingContext2D, layout: NodeLayout): void {
    const isSelected = this.selectedNodeIds.has(layout.node.nodeId)
    const layerColor = this.getLayerColor(layout.node.layerId)
    const statusColor = deviceStatusColor[layout.node.deviceStatus]

    context.save()
    if (isSelected) {
      context.strokeStyle = '#67e8f9'
      context.lineWidth = 2
      context.shadowColor = '#22d3ee'
      context.shadowBlur = 14
      this.roundRect(context, layout.x - 3, layout.y - 3, layout.width + 6, layout.height + 6, 8)
      context.stroke()
    }

    context.fillStyle = 'rgba(4, 29, 44, 0.92)'
    context.strokeStyle = `${layerColor}cc`
    context.lineWidth = 1
    this.roundRect(context, layout.x, layout.y, layout.width, layout.height, 6)
    context.fill()
    context.stroke()

    const iconSize = Math.min(layout.height - 10, Math.max(18, Math.floor(layout.width * 0.3)))
    const iconX = layout.x + 5
    const iconY = layout.y + (layout.height - iconSize) / 2
    const image = this.getIconImage(layout.node)

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

    context.fillStyle = statusColor
    context.strokeStyle = '#03111d'
    context.lineWidth = 1.5
    context.beginPath()
    context.arc(layout.x + layout.width - 7, layout.y + 7, 4, 0, Math.PI * 2)
    context.fill()
    context.stroke()
    this.drawNodeTitle(context, layout, iconX + iconSize + 4)
    context.restore()
  }

  /** 将中文设备名按可用像素宽度截断为最多两行，避免密集现场层在中窄屏相互覆盖。 */
  private drawNodeTitle(context: CanvasRenderingContext2D, layout: NodeLayout, startX: number): void {
    const availableWidth = layout.x + layout.width - startX - 6

    if (availableWidth < 12) return
    const fontSize = this.width < 640 ? 9 : 10
    context.fillStyle = '#e2f7ff'
    context.font = `600 ${fontSize}px Microsoft YaHei, sans-serif`
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    const lines = this.wrapText(context, layout.node.title, availableWidth, 2)
    const lineHeight = fontSize + 2
    const firstLineY = layout.y + layout.height / 2 - ((lines.length - 1) * lineHeight) / 2

    for (let index = 0; index < lines.length; index += 1) {
      context.fillText(lines[index] ?? '', startX, firstLineY + index * lineHeight, availableWidth)
    }
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
  private getIconImage(node: TopologyNodeDefinition): HTMLImageElement | undefined {
    const iconUrl = getTopologyIconUrl(node.iconKey, node.deviceStatus)
    const cached = this.iconImageByUrl.get(iconUrl)

    if (cached) return cached.status === 'ready' ? cached.image : undefined
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

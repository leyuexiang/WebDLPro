import type { TopologyDrilldownContent, TopologyDrilldownNode } from '@/config/scene-topology/types'

export interface TopologyDrilldownRenderInstance {
  instanceId: string
  semanticNodeId: string
  title: string
  kind: TopologyDrilldownNode['kind']
  x: number
  y: number
  description?: string
  duplicate: boolean
}

export interface TopologyDrilldownRenderEdge {
  instanceId: string
  fromInstanceId: string
  toInstanceId: string
  duplicate: boolean
}

export interface TopologyDrilldownRenderModel {
  instances: readonly TopologyDrilldownRenderInstance[]
  edges: readonly TopologyDrilldownRenderEdge[]
}

const originalSuffix = '::原始'
const duplicateSuffix = '::复制'

/**
 * 将语义内容转换为纯视觉实例。单分支仅在这里复制 logic（直接子节点）和 boundary（模型说明）
 * 的实例，两个副本继续引用相同 semanticNodeId；正式内容、统计、状态和订阅均不会增加。
 */
export function createTopologyDrilldownRenderModel(content: TopologyDrilldownContent): TopologyDrilldownRenderModel {
  const duplicateSingleBranch = content.duplicateSingleBranch === true
  const instances: TopologyDrilldownRenderInstance[] = []
  const instanceIdsBySemanticNodeId = new Map<string, readonly string[]>()

  for (const node of content.nodes) {
    if (!duplicateSingleBranch || node.kind === 'source') {
      const instanceId = `${node.id}${originalSuffix}`
      instances.push(createRenderInstance(node, instanceId, node.x, false))
      instanceIdsBySemanticNodeId.set(node.id, [instanceId])
      continue
    }

    const originalInstanceId = `${node.id}${originalSuffix}`
    const duplicateInstanceId = `${node.id}${duplicateSuffix}`
    // 复制分支在现场设备层内左右对称排列，纵坐标和语义节点完全复用正式说明内容。
    instances.push(
      createRenderInstance(node, originalInstanceId, 34, false),
      createRenderInstance(node, duplicateInstanceId, 66, true),
    )
    instanceIdsBySemanticNodeId.set(node.id, [originalInstanceId, duplicateInstanceId])
  }

  const edges: TopologyDrilldownRenderEdge[] = []
  for (const edge of content.edges) {
    const fromInstances = instanceIdsBySemanticNodeId.get(edge.fromId) ?? []
    const toInstances = instanceIdsBySemanticNodeId.get(edge.toId) ?? []
    const instanceCount = Math.max(fromInstances.length, toInstances.length)
    for (let index = 0; index < instanceCount; index += 1) {
      const fromInstanceId = fromInstances[Math.min(index, fromInstances.length - 1)]
      const toInstanceId = toInstances[Math.min(index, toInstances.length - 1)]
      if (!fromInstanceId || !toInstanceId) continue
      const duplicate = index > 0
      edges.push({
        instanceId: `${edge.id}${duplicate ? duplicateSuffix : originalSuffix}`,
        fromInstanceId,
        toInstanceId,
        duplicate,
      })
    }
  }

  return { instances, edges }
}

function createRenderInstance(node: TopologyDrilldownNode, instanceId: string, x: number, duplicate: boolean): TopologyDrilldownRenderInstance {
  return {
    instanceId,
    semanticNodeId: node.id,
    title: node.title,
    kind: node.kind,
    x,
    y: node.y,
    description: node.description,
    duplicate,
  }
}

export interface TopologyDrilldownViewSnapshot {
  zoom: number
  offsetX: number
  offsetY: number
}

/**
 * 覆盖层视图状态与正式 Canvas（画布）完全隔离；缩放和平移只修改三个有限数值，
 * 不保存内容节点、文档对象、动画帧或监听器，因此关闭时可直接丢弃且不会形成资源环。
 */
export class TopologyDrilldownViewState {
  private zoom = 1
  private offsetX = 0
  private offsetY = 0
  private readonly minimumZoom = 0.7
  private readonly maximumZoom = 2.25

  public zoomBy(delta: number): TopologyDrilldownViewSnapshot {
    this.zoom = Math.min(this.maximumZoom, Math.max(this.minimumZoom, this.zoom + delta))
    return this.getSnapshot()
  }

  public panBy(deltaX: number, deltaY: number, width: number, height: number): TopologyDrilldownViewSnapshot {
    const maximumOffsetX = Math.max(0, width) * this.zoom
    const maximumOffsetY = Math.max(0, height) * this.zoom
    this.offsetX = Math.min(maximumOffsetX, Math.max(-maximumOffsetX, this.offsetX + deltaX))
    this.offsetY = Math.min(maximumOffsetY, Math.max(-maximumOffsetY, this.offsetY + deltaY))
    return this.getSnapshot()
  }

  public reset(): TopologyDrilldownViewSnapshot {
    this.zoom = 1
    this.offsetX = 0
    this.offsetY = 0
    return this.getSnapshot()
  }

  public getSnapshot(): TopologyDrilldownViewSnapshot {
    return { zoom: this.zoom, offsetX: this.offsetX, offsetY: this.offsetY }
  }
}

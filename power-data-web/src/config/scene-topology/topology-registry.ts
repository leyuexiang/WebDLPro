import type { ActionId, NodeId, SceneId, SceneNodeId, TopologyId } from '@/config/scene-topology/identifiers'
import type { ActionDefinition, SceneDefinition, SceneTopologyManifest, SceneTopologyManifestValidationIssue, TopologyDefinition, TopologyNodeDefinition } from '@/config/scene-topology/types'
import { validateSceneTopologyManifest } from '@/config/scene-topology/validator'
import { TopologyDrilldownRegistry, type TopologyDrilldownLookupResult } from '@/config/scene-topology/topology-drilldown-registry'

/** 设备状态投影到单个二维节点所需的最小预计算信息。 */
export interface RegisteredNodeTopologyTarget {
  topologyId: TopologyId
  nodeId: NodeId
  configuredStatus: TopologyNodeDefinition['deviceStatus']
}

/**
 * 结构清单加载时由来源节点一次性派生的状态投影。
 * 状态热路径只读取该索引，不重复扫描拓扑节点；过滤视图和总图共享同一个逻辑 nodeId。
 */
export interface RegisteredNodeStateProjection {
  nodeId: NodeId
  sceneId: SceneId
  topologyTargets: readonly RegisteredNodeTopologyTarget[]
  sceneNodeIds: readonly SceneNodeId[]
}

/** 注册失败时只返回清单校验问题，禁止从半份配置构建临时拓扑索引。 */
export type TopologyRegistryLoadResult =
  | { status: 'ready'; registry: TopologyRegistry; issues: readonly [] }
  | { status: 'invalid'; issues: readonly SceneTopologyManifestValidationIssue[] }

/**
 * 将经过清单门禁验证的流程过滤规则投影为可直接交给画布的拓扑。
 *
 * 此处只在注册表创建时执行一次，画布渲染、命中检测和设备状态热路径均只读取结果；
 * 因此流程切换不会重复扫描总图，也不会维护与总图脱节的节点或连线副本。
 */
function resolveTopologyViews(topologies: readonly TopologyDefinition[]): readonly TopologyDefinition[] {
  const sourceTopologyById = new Map(topologies.map((topology) => [topology.topologyId, topology]))

  return topologies.map((topology) => {
    if (!topology.filter) return topology

    // 过滤规则已由 validator（清单校验器）保证来源存在、同场景且非嵌套；保留防御分支避免未来错误调用产生半份视图。
    const sourceTopology = sourceTopologyById.get(topology.filter.sourceTopologyId)
    if (!sourceTopology) return topology
    const sourceNodesById = new Map(sourceTopology.nodes.map((node) => [node.nodeId, node]))
    const sourceEdgesById = new Map(sourceTopology.edges.map((edge) => [edge.edgeId, edge]))
    const layoutByNodeId = new Map(topology.filter.nodeLayoutOverrides.map((override) => [override.nodeId, override]))

    const nodes = topology.filter.visibleNodeIds.flatMap((nodeId) => {
      const sourceNode = sourceNodesById.get(nodeId)
      const layout = layoutByNodeId.get(nodeId)
      if (!sourceNode || !layout) return []
      // 仅覆盖二维坐标，标题、图元、设备号和三维节点标识继续复用来源总图的已发布事实。
      return [Object.freeze({ ...sourceNode, x: layout.x, y: layout.y })]
    })
    const edges = topology.filter.visibleEdgeIds.flatMap((edgeId) => {
      const sourceEdge = sourceEdgesById.get(edgeId)
      return sourceEdge ? [sourceEdge] : []
    })

    return Object.freeze({
      ...topology,
      // 子流程仍使用来源总图的同一套分层语义，避免重复维护层标题、颜色和高度。
      layers: sourceTopology.layers,
      nodes: Object.freeze(nodes),
      edges: Object.freeze(edges),
      // 关键环节是总图的过滤视图，不展示总览重点区域，避免区域框与子图语义错位。
      focusRegions: undefined,
    })
  })
}

/**
 * 多拓扑注册表由同一份已验证场景清单构造。
 * 它只维护轻量索引：场景到可切换拓扑、默认拓扑和拓扑定义；不创建画布、图片或隐藏渲染实例。
 */
export class TopologyRegistry {
  private readonly sceneById: ReadonlyMap<SceneId, SceneDefinition>
  private readonly topologyById: ReadonlyMap<TopologyId, TopologyDefinition>
  /** 动作与场景、拓扑同属一份原子清单；事务处理器只能从这里读取已校验映射。 */
  private readonly actionById: ReadonlyMap<ActionId, ActionDefinition>
  /** 每个逻辑节点的二维目标和可选三维目标在加载时派生，避免每份状态快照重复解析拓扑。 */
  private readonly nodeStateProjectionByNodeId: ReadonlyMap<NodeId, RegisteredNodeStateProjection>
  /** 三维反向选择使用“场景 + 三维节点”复合键一次索引，禁止按对象名称或设备编号猜测。 */
  private readonly nodeIdBySceneNodeReference: ReadonlyMap<string, NodeId>
  /** 状态更新的节点查询使用复合稳定键建立一次索引，避免每条节点状态反复扫描整套拓扑。 */
  private readonly nodeByTopologyReference: ReadonlyMap<string, TopologyNodeDefinition>
  /** 说明内容使用独立有限索引，不进入可切换拓扑、节点状态和三维映射集合。 */
  private readonly drilldownRegistry: TopologyDrilldownRegistry

  private constructor(manifest: SceneTopologyManifest) {
    const resolvedTopologies = resolveTopologyViews(manifest.topologies)
    this.sceneById = new Map(manifest.scenes.map((scene) => [scene.sceneId, scene]))
    this.topologyById = new Map(resolvedTopologies.map((topology) => [topology.topologyId, topology]))
    this.actionById = new Map(manifest.actions.map((action) => [action.actionId, action]))
    this.drilldownRegistry = new TopologyDrilldownRegistry(manifest.drilldowns ?? [])
    this.nodeByTopologyReference = new Map(
      resolvedTopologies.flatMap((topology) => topology.nodes.map((node) => [this.createTopologyNodeReference(topology.topologyId, node.nodeId), node] as const)),
    )
    /*
     * 一个逻辑节点只在来源拓扑定义一次，但流程视图会复用它。这里预先把 nodeId 展开为全部画布目标，
     * 状态快照只需常数时间读取数组，不会在每次外部数据到达时重复扫描整份清单。
     */
    const topologyTargetsByNodeId = new Map<NodeId, RegisteredNodeTopologyTarget[]>()
    for (const topology of resolvedTopologies) {
      for (const node of topology.nodes) {
        const targets = topologyTargetsByNodeId.get(node.nodeId) ?? []
        targets.push({
          topologyId: topology.topologyId,
          nodeId: node.nodeId,
          configuredStatus: node.deviceStatus,
        })
        topologyTargetsByNodeId.set(node.nodeId, targets)
      }
    }

    const projections = manifest.topologies.flatMap((topology) => topology.filter
      ? []
      : topology.nodes.map((node): readonly [NodeId, RegisteredNodeStateProjection] => [node.nodeId, {
          nodeId: node.nodeId,
          sceneId: topology.sceneId,
          topologyTargets: topologyTargetsByNodeId.get(node.nodeId) ?? [],
          sceneNodeIds: node.sceneNodeId ? [node.sceneNodeId] : [],
        }]))
    this.nodeStateProjectionByNodeId = new Map(projections)
    this.nodeIdBySceneNodeReference = new Map(
      projections.flatMap(([nodeId, projection]) => projection.sceneNodeIds.map((sceneNodeId) => [
        this.createSceneNodeReference(projection.sceneId, sceneNodeId),
        nodeId,
      ] as const)),
    )
  }

  /**
   * 注册表只接收我方不可变结构清单。清单门禁已校验节点全局唯一、过滤引用闭环和三维反向唯一，
   * 因此状态缓存与三维投影不需要等待平台设备绑定。
   */
  public static create(input: unknown): TopologyRegistryLoadResult {
    const issues = validateSceneTopologyManifest(input)
    if (issues.length > 0) return { status: 'invalid', issues }
    return { status: 'ready', registry: new TopologyRegistry(input as SceneTopologyManifest), issues: [] }
  }

  /** 返回场景默认拓扑；缺失时返回 undefined，调用方不得回退猜测名称相近的拓扑。 */
  public getDefaultTopology(sceneId: SceneId): TopologyDefinition | undefined {
    const scene = this.sceneById.get(sceneId)
    return scene ? this.topologyById.get(scene.defaultTopologyId) : undefined
  }

  /** 仅返回固定目录中已登记的场景；未知场景不会由标题或数组位置回退补全。 */
  public getScene(sceneId: SceneId): SceneDefinition | undefined {
    return this.sceneById.get(sceneId)
  }

  /** 查询单份全局唯一拓扑定义，不因当前场景或 UI 标题做模糊匹配。 */
  public getTopology(topologyId: TopologyId): TopologyDefinition | undefined {
    return this.topologyById.get(topologyId)
  }

  /**
   * 在明确场景边界内查询拓扑；拓扑属于其他场景时返回 undefined，
   * 让协调器以 topology.scene.mismatch 处理，而不是把错误图直接交给画布。
   */
  public getTopologyForScene(sceneId: SceneId, topologyId: TopologyId): TopologyDefinition | undefined {
    const scene = this.sceneById.get(sceneId)
    if (!scene || !scene.topologyIds.includes(topologyId)) return undefined
    return this.topologyById.get(topologyId)
  }

  /** 返回已通过发布校验的动作定义；调用方仍须核对其目标场景和拓扑是否匹配当前事务。 */
  public getAction(actionId: ActionId): ActionDefinition | undefined {
    return this.actionById.get(actionId)
  }

  /**
   * 返回逻辑节点的预计算状态投影；同一 nodeId 可命中总图及多个过滤视图，并最多映射一个三维节点。
   * 未知节点明确返回 undefined，调用方不得扫描标题或回退到字符串相似匹配。
   */
  public getNodeStateProjection(nodeId: NodeId): RegisteredNodeStateProjection | undefined {
    return this.nodeStateProjectionByNodeId.get(nodeId)
  }

  /** 按入口引用和当前拓扑版本精确读取说明内容；缺失或旧版本不会静默回退。 */
  public getDrilldownContent(contentKey: string, version: string): TopologyDrilldownLookupResult {
    return this.drilldownRegistry.get(contentKey, version)
  }

  /**
   * 只按当前场景和已发布三维节点精确反查逻辑节点。
   * 清单校验已禁止同一场景三维节点指向多个 nodeId；找不到即表示该对象不能映射当前二维拓扑，
   * 调用方必须保留受控诊断而不是用 Unity 对象名称、坐标或节点前缀猜测。
   */
  public getNodeIdForSceneNode(sceneId: SceneId, sceneNodeId: SceneNodeId): NodeId | undefined {
    return this.nodeIdBySceneNodeReference.get(this.createSceneNodeReference(sceneId, sceneNodeId))
  }

  /** 以拓扑标识和二维节点标识精确读取节点定义，供实时状态路径以常数时间取得发布基线状态。 */
  public getTopologyNode(topologyId: TopologyId, nodeId: NodeId): TopologyNodeDefinition | undefined {
    return this.nodeByTopologyReference.get(this.createTopologyNodeReference(topologyId, nodeId))
  }

  /** 返回场景已声明的所有拓扑，顺序严格沿用清单，不由组件按标题重新排序。 */
  public listTopologiesForScene(sceneId: SceneId): readonly TopologyDefinition[] {
    const scene = this.sceneById.get(sceneId)
    if (!scene) return []
    return scene.topologyIds.flatMap((topologyId) => {
      const topology = this.topologyById.get(topologyId)
      return topology ? [topology] : []
    })
  }

  /** 只返回当前已登记场景，不泄露内部 Map，调用方无法修改注册表。 */
  public listScenes(): readonly SceneDefinition[] {
    return [...this.sceneById.values()]
  }

  /** 复合键仅拼接已经过清单校验的稳定标识，调用方永远不能传入路径、标题或资源名。 */
  private createTopologyNodeReference(topologyId: TopologyId, nodeId: NodeId): string {
    return `${topologyId}:${nodeId}`
  }

  /** 场景和三维节点均为已验证稳定标识，复合键只作常数时间索引，不保存 Unity 路径或对象引用。 */
  private createSceneNodeReference(sceneId: SceneId, sceneNodeId: SceneNodeId): string {
    return `${sceneId}:${sceneNodeId}`
  }
}

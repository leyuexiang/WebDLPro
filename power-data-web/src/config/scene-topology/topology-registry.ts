import type { ActionId, DeviceId, NodeId, SceneId, SceneNodeId, TopologyId } from '@/config/scene-topology/identifiers'
import type { ActionDefinition, DeviceMappingDefinition, SceneDefinition, SceneTopologyManifest, SceneTopologyManifestValidationIssue, TopologyDefinition, TopologyNodeDefinition } from '@/config/scene-topology/types'
import { validateSceneTopologyManifest } from '@/config/scene-topology/validator'

/** 注册失败时只返回清单校验问题，禁止从半份配置构建临时拓扑索引。 */
export type TopologyRegistryLoadResult =
  | { status: 'ready'; registry: TopologyRegistry; issues: readonly [] }
  | { status: 'invalid'; issues: readonly SceneTopologyManifestValidationIssue[] }

/**
 * 多拓扑注册表由同一份已验证场景清单构造。
 * 它只维护轻量索引：场景到可切换拓扑、默认拓扑和拓扑定义；不创建画布、图片或隐藏渲染实例。
 */
export class TopologyRegistry {
  private readonly sceneById: ReadonlyMap<SceneId, SceneDefinition>
  private readonly topologyById: ReadonlyMap<TopologyId, TopologyDefinition>
  /** 动作与场景、拓扑同属一份原子清单；事务处理器只能从这里读取已校验映射。 */
  private readonly actionById: ReadonlyMap<ActionId, ActionDefinition>
  /** 设备状态只能经原子清单的显式设备映射路由，禁止用节点标题或同名字符串查询。 */
  private readonly deviceMappingByDeviceId: ReadonlyMap<DeviceId, DeviceMappingDefinition>
  /** 三维反向选择使用“场景 + 三维节点”复合键一次索引，禁止遍历全部设备映射或按对象名称匹配。 */
  private readonly deviceMappingBySceneNodeReference: ReadonlyMap<string, DeviceMappingDefinition>
  /** 状态更新的节点查询使用复合稳定键建立一次索引，避免每条设备状态反复扫描整套拓扑。 */
  private readonly nodeByTopologyReference: ReadonlyMap<string, TopologyNodeDefinition>

  private constructor(manifest: SceneTopologyManifest) {
    this.sceneById = new Map(manifest.scenes.map((scene) => [scene.sceneId, scene]))
    this.topologyById = new Map(manifest.topologies.map((topology) => [topology.topologyId, topology]))
    this.actionById = new Map(manifest.actions.map((action) => [action.actionId, action]))
    this.deviceMappingByDeviceId = new Map(manifest.deviceMappings.map((mapping) => [mapping.deviceId, mapping]))
    this.deviceMappingBySceneNodeReference = new Map(
      manifest.deviceMappings.flatMap((mapping) => mapping.sceneNodeId
        ? [[this.createSceneNodeReference(mapping.sceneId, mapping.sceneNodeId), mapping] as const]
        : []),
    )
    this.nodeByTopologyReference = new Map(
      manifest.topologies.flatMap((topology) => topology.nodes.map((node) => [this.createTopologyNodeReference(topology.topologyId, node.nodeId), node] as const)),
    )
  }

  /** 清单必须先通过跨引用、版本和九场景校验，注册表才会公开给运行时使用。 */
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

  /** 返回已发布设备的唯一映射；未知设备明确返回 undefined，状态适配器不得回退到标题或坐标匹配。 */
  public getDeviceMapping(deviceId: DeviceId): DeviceMappingDefinition | undefined {
    return this.deviceMappingByDeviceId.get(deviceId)
  }

  /**
   * 只按当前场景和已发布三维节点精确反查设备映射。
   * 清单校验已禁止同一场景三维节点指向多个设备；找不到即表示该对象不能映射当前二维拓扑，
   * 调用方必须保留受控诊断而不是用 Unity 对象名称、坐标或节点前缀猜测设备。
   */
  public getDeviceMappingForSceneNode(sceneId: SceneId, sceneNodeId: SceneNodeId): DeviceMappingDefinition | undefined {
    return this.deviceMappingBySceneNodeReference.get(this.createSceneNodeReference(sceneId, sceneNodeId))
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

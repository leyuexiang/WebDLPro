import type {
  ActionId,
  DeviceId,
  NodeId,
  ProcessId,
  RouteId,
  SceneId,
  SceneNodeId,
  StepId,
  TopologyId,
  UnityRuntimeKey,
  UnitySceneKey,
} from '@/config/scene-topology/identifiers'

/** 四态设备视觉与旧拓扑保持一致，但状态来源改由外层父页面的受控消息提供。 */
export type DeviceVisualStatus = 'normal' | 'alarm' | 'fault' | 'offline'

/** 场景切换默认先卸载旧资源，只有经过内存验证的场景才可提高峰值内存预加载。 */
export type SceneSwitchStrategy = 'unload-first' | 'preload-then-unload'

/** 设备双击仅能上报正式设备标识；概念节点必须明确声明为不产生外部事件。 */
export type DoubleClickBehavior = 'emit-device' | 'none'

/** 已受控的 Unity 动作；外部父页面永远只能传动作标识，不能传 Unity 方法名称。 */
export type UnityActionDefinition =
  | { type: 'none' }
  | { type: 'enterProcessStep'; processId: ProcessId; stepId: StepId; defaultUnitId?: string; isolate: boolean }
  | { type: 'focusNode'; sceneNodeId: SceneNodeId; isolate: boolean }
  | { type: 'resetScene' }
  | { type: 'setRouteFlow'; routeId: RouteId; enabled: boolean }

/** 单个 Unity 场景的能力映射，专供发布校验动作引用，绝不暴露层级路径或资源路径。 */
export interface UnitySceneMappingDefinition {
  sceneId: SceneId
  mappingVersion: string
  processSteps: readonly { processId: ProcessId; stepId: StepId }[]
  sceneNodeIds: readonly SceneNodeId[]
  routeIds: readonly RouteId[]
}

/** 九个场景的基础登记；每个场景必须独立声明资源和映射版本，防止跨版本缓存混用。 */
export interface SceneDefinition {
  sceneId: SceneId
  title: string
  unitySceneKey: UnitySceneKey
  defaultTopologyId: TopologyId
  topologyIds: readonly TopologyId[]
  supportedActionIds: readonly ActionId[]
  sceneMappingVersion: string
  resourceVersion: string
  switchStrategy: SceneSwitchStrategy
}

/**
 * 二维展示层级只描述网络分区与绘制位置，不能据此推断设备、三维节点或权限关系。
 * 它以可选字段进入正式清单，使已有分层拓扑在迁入原子清单后仍可保留经过确认的视觉语义。
 */
export interface TopologyPresentationLayerDefinition {
  layerId: string
  title: string
  y: number
  color: string
}

/** 二维节点显式保存二维、外部设备及三维节点三种不同标识，禁止根据同名默认关联。 */
export interface TopologyNodeDefinition {
  nodeId: NodeId
  title: string
  deviceId?: DeviceId
  sceneNodeId?: SceneNodeId
  iconKey: string
  x: number
  y: number
  /**
   * 仅关联二维展示层级；未声明时渲染器必须按无分层通用拓扑处理，
   * 不得依据坐标、标题或图元键猜测所属控制网络层。
   */
  layerId?: string
  deviceStatus: DeviceVisualStatus
  doubleClickBehavior: DoubleClickBehavior
}

/**
 * 拓扑边描述二维连接及可选的只读展示信息；协议标签和证据状态不代表运行时消息协议或三维路由。
 * 设备、动作和 Unity（统一引擎）路由仍必须经各自的正式映射字段登记。
 */
export interface TopologyEdgeDefinition {
  edgeId: RouteId
  fromNodeId: NodeId
  toNodeId: NodeId
  title: string
  /** 仅用于二维线路标签；没有该字段时画布不显示协议名称。 */
  protocolLabel?: string
  /** 已核验、待确认或概念性关系只影响二维视觉表达，不创建额外业务副作用。 */
  evidenceStatus?: 'verified' | 'pending-confirmation' | 'conceptual'
}

/**
 * 一套拓扑严格归属于一个场景，同一设备出现在多图时由设备映射清单显式登记。
 * `layers`（展示层级）是纯二维展示数据，保留它不会放宽设备或三维映射的显式登记规则。
 */
export interface TopologyDefinition {
  topologyId: TopologyId
  sceneId: SceneId
  title: string
  configVersion: string
  layers?: readonly TopologyPresentationLayerDefinition[]
  nodes: readonly TopologyNodeDefinition[]
  edges: readonly TopologyEdgeDefinition[]
}

/** 外部动作到场景、拓扑和 Unity 动作的唯一受控映射。 */
export interface ActionDefinition {
  actionId: ActionId
  title: string
  targetSceneId: SceneId
  targetTopologyId: TopologyId
  allowedParameters: readonly string[]
  unityAction: UnityActionDefinition
  failurePolicy: 'keep-current-context' | 'commit-view-with-warning'
  configVersion: string
}

/** 外部设备、二维节点和三维节点的显式关联；同一设备可出现于当前场景的多套拓扑。 */
export interface DeviceMappingDefinition {
  deviceId: DeviceId
  sceneId: SceneId
  topologyNodeRefs: readonly { topologyId: TopologyId; nodeId: NodeId }[]
  sceneNodeId?: SceneNodeId
  configVersion: string
}

/**
 * 场景、拓扑、动作、设备映射和 Unity 场景映射的原子发布单元。
 * 任何字段缺失、跨引用失效或版本不一致都会阻止加载，调用方不得拼接旧缓存降级运行。
 */
export interface SceneTopologyManifest {
  manifestVersion: string
  unityBuildId: string
  unityRuntimeKey: UnityRuntimeKey
  scenes: readonly SceneDefinition[]
  topologies: readonly TopologyDefinition[]
  actions: readonly ActionDefinition[]
  deviceMappings: readonly DeviceMappingDefinition[]
  unitySceneMappings: readonly UnitySceneMappingDefinition[]
}

/** 校验问题使用稳定代码，便于后续外层协议直接映射为不泄露载荷的错误态。 */
export interface SceneTopologyManifestValidationIssue {
  code: string
  message: string
}

/** 加载器只暴露经校验的清单快照；无效输入绝不会以部分配置进入运行时。 */
export interface SceneTopologyManifestLoadResult {
  status: 'ready' | 'invalid'
  manifest?: SceneTopologyManifest
  issues: readonly SceneTopologyManifestValidationIssue[]
}

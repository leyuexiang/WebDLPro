import type {
  ActionId,
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
import type { TopologyIconKey } from '@/config/process/types'

/** 四态设备视觉与旧拓扑保持一致，但状态来源改由外层父页面的受控消息提供。 */
export type DeviceVisualStatus = 'normal' | 'alarm' | 'fault' | 'offline'

/** 场景切换默认先卸载旧资源，只有经过内存验证的场景才可提高峰值内存预加载。 */
export type SceneSwitchStrategy = 'unload-first' | 'preload-then-unload'

/** 业务节点双击只上报我方稳定节点编号；说明类节点必须明确声明为不产生外部事件。 */
export type DoubleClickBehavior = 'emit-node' | 'none'

/**
 * 正式拓扑节点只保存说明层内容引用，不内嵌说明节点或复用双击行为。
 * 独立按钮是当前唯一允许的触发方式，避免下钻覆盖单击聚焦和双击上报语义。
 */
export interface TopologyNodeDrilldownReference {
  readonly enabled: true
  readonly contentKey: string
  readonly trigger: 'button'
}

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

/** 二维节点只保存逻辑节点编号和可选三维节点编号；平台真实设备编号不得进入我方清单。 */
export interface TopologyNodeDefinition {
  nodeId: NodeId
  title: string
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
  /** 可选说明层入口；没有明确业务资料的节点必须省略，渲染器不得按标题猜测。 */
  drilldown?: TopologyNodeDrilldownReference
}

/** 说明节点只在单份内容内部唯一，不拥有正式节点标识、设备状态或三维映射。 */
export interface TopologyDrilldownNode {
  readonly id: string
  readonly title: string
  readonly kind: 'source' | 'logic' | 'boundary'
  /**
   * 下钻说明节点沿用正式拓扑图元登记表中的受控键，只用于静态图标展示。
   * 这里禁止使用 generic（中性占位），也不保存图片路径；说明节点仍不拥有正式节点编号、状态或三维映射。
   */
  readonly iconKey: Exclude<TopologyIconKey, 'generic'>
  readonly x: number
  readonly y: number
  readonly description?: string
}

/** 说明连线只表达同一内容内的静态关联，不进入正式拓扑边和三维路径集合。 */
export interface TopologyDrilldownEdge {
  readonly id: string
  readonly fromId: string
  readonly toId: string
  readonly label?: string
}

/**
 * 下钻内容与正式拓扑同版本原子发布，但保持独立只读数据块。
 * duplicateSingleBranch 只允许渲染层复制视觉实例，语义节点数组仍保持三个唯一节点。
 */
export interface TopologyDrilldownContent {
  readonly contentKey: string
  readonly version: string
  readonly title: string
  readonly sourceNodeId: NodeId
  readonly duplicateSingleBranch?: boolean
  readonly nodes: readonly TopologyDrilldownNode[]
  readonly edges: readonly TopologyDrilldownEdge[]
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
  /**
   * 原始拓扑图中连线的六位十六进制颜色；这是二维资料复现字段，不代表实时状态或协议语义。
   * 未声明时由画布按 evidenceStatus（证据状态）使用中性色，避免从标题猜测颜色。
   */
  lineColor?: string
  /** 原始拓扑图中的线型；未声明时由证据状态保持既有默认线型。 */
  lineStyle?: 'solid' | 'dashed'
  /** 已核验、待确认或概念性关系只影响二维视觉表达，不创建额外业务副作用。 */
  evidenceStatus?: 'verified' | 'pending-confirmation' | 'conceptual'
}

/**
 * 总览拓扑的三维重点区域声明。所有成员节点均来自同一张总图，渲染器只依据该集合绘制区域框。
 */
export interface TopologyFocusRegionDefinition {
  regionId: string
  anchorNodeId: NodeId
  nodeIds: readonly NodeId[]
  label?: string
}

/**
 * 过滤拓扑中单个节点的画布坐标覆盖。
 *
 * 子视图复用总拓扑的节点、连线及三维关联事实，只允许为已显式选中的节点提供另一套二维排布，
 * 从而避免把同一设备、标题或 sceneNodeId（场景三维节点标识）复制到多份配置后发生漂移。
 */
export interface TopologyNodeLayoutOverride {
  nodeId: NodeId
  x: number
  y: number
}

/**
 * 从一张同场景总拓扑派生流程视图的显式过滤规则。
 *
 * `visibleNodeIds` 与 `visibleEdgeIds` 都是来源总图的稳定标识；运行时仅绘制它们，
 * 不得根据标题、图元、坐标或三维模型名称猜测应隐藏的对象。
 */
export interface TopologyFilterDefinition {
  sourceTopologyId: TopologyId
  visibleNodeIds: readonly NodeId[]
  visibleEdgeIds: readonly RouteId[]
  /**
   * 资料明确要求展示、但在来源总图筛选后没有任何可见连线的节点。
   * 该字段只豁免“孤立节点”校验，不创建连线；发布校验会要求声明集合与实际孤立集合完全一致，
   * 防止遗漏合法连线或用宽泛豁免掩盖错误配置。
   */
  allowedOrphanNodeIds?: readonly NodeId[]
  nodeLayoutOverrides: readonly TopologyNodeLayoutOverride[]
}

/**
 * 一套拓扑严格归属于一个场景；过滤视图复用来源总图的同一逻辑节点编号。
 * `layers`（展示层级）是纯二维展示数据，保留它不会放宽节点或三维映射的显式登记规则。
 */
export interface TopologyDefinition {
  topologyId: TopologyId
  sceneId: SceneId
  title: string
  configVersion: string
  layers?: readonly TopologyPresentationLayerDefinition[]
  nodes: readonly TopologyNodeDefinition[]
  edges: readonly TopologyEdgeDefinition[]
  /** 重点区域只允许出现在总览来源图；过滤拓扑必须省略该字段。 */
  focusRegions?: readonly TopologyFocusRegionDefinition[]
  /**
   * 存在时表示当前拓扑是来源总图的只读流程视图。
   * 过滤视图的 nodes 与 edges 必须为空，所有实际图元由 sourceTopologyId 投影而来。
   */
  filter?: TopologyFilterDefinition
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

/**
 * 场景、拓扑、动作和 Unity 场景映射的原子发布单元。
 * 任何字段缺失、跨引用失效或版本不一致都会阻止加载，调用方不得拼接旧缓存降级运行。
 */
export interface SceneTopologyManifest {
  manifestVersion: string
  unityBuildId: string
  unityRuntimeKey: UnityRuntimeKey
  scenes: readonly SceneDefinition[]
  topologies: readonly TopologyDefinition[]
  /** 说明内容不属于可切换拓扑集合，也不参与设备状态、动作或三维映射投影。 */
  drilldowns?: readonly TopologyDrilldownContent[]
  actions: readonly ActionDefinition[]
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

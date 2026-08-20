import type {
  DetailBlockId,
  DetailKey,
  GuideKey,
  MetricKey,
  PermissionCode,
  ProcessDomainId,
  ProcessId,
  ProcessNodeId,
  ProcessPageId,
  ProcessStepId,
  RouteId,
  RuntimeKey,
  TopicId,
  TopologyKey,
} from '@/config/process/identifiers'
import type { WebglCommandType, WebglEventType } from '@/services/webgl/protocol'

/** 所有可组合配置必须使用同一发布版本，避免页面、拓扑和三维映射错配。 */
export type ConfigVersion = string

/** 页面期望模式与最终生效模式分离，校验失败时只能向更安全的非三维模式降级。 */
export type ProcessRuntimeMode = 'webgl' | 'static-preview' | 'empty'

/**
 * 拓扑连线证据状态。
 * `unclassified`（未分类）专供新原子清单投影到旧画布时使用：新清单尚未提供连线证据字段，
 * 因而不能把它误标为“已确认”“待确认”或“概念连接”，更不能由此驱动三维流动效果。
 */
export type TopologyEvidenceStatus = 'verified' | 'pending-confirmation' | 'conceptual' | 'unclassified'

/** 设备运行状态与用户选中状态分离；缺少、非法或超时状态必须归一为离线。 */
export type TopologyDeviceStatus = 'normal' | 'alarm' | 'fault' | 'offline'

/**
 * 受控图元键只描述设备类别，具体 SVG 由图元登记表按四态解析。
 * 业务配置禁止保存图片路径，避免把外部输入直接变成静态资源请求。
 */
export type TopologyIconKey =
  | 'core-switch'
  | 'firewall'
  | 'server'
  | 'workstation'
  | 'data-gateway'
  | 'dcs'
  | 'plc'
  | 'gas-turbine'
  | 'steam-turbine'
  | 'excitation-system'
  | 'sis-system'
  | 'instrument'
  | 'circuit-breaker'
  /** 未登记图元键的中性占位；画布只绘制轮廓，不按名称猜测设备类别或加载动态资源。 */
  | 'generic'

/** 分层背景只表达网络边界与显示顺序，不参与节点、三维对象或权限的稳定关联。 */
export interface TopologyLayerDefinition {
  layerId: string
  title: string
  y: number
  color: string
}

/** 工艺域及其页面顺序是导航唯一来源，页面组件不再硬编码模块或菜单。 */
export interface ProcessDomainDefinition {
  domainId: ProcessDomainId
  title: string
  order: number
  pageIds: readonly ProcessPageId[]
}

/** 工艺页声明只引用受控运行时键，不携带 iframe 地址、Origin 或协议细节。 */
export interface ProcessPageDefinition {
  processPageId: ProcessPageId
  processId: ProcessId
  domainId: ProcessDomainId
  title: string
  description: string
  order: number
  configVersion: ConfigVersion
  permissionCode: PermissionCode
  runtimeMode: ProcessRuntimeMode
  runtimeFallbackMode: Exclude<ProcessRuntimeMode, 'webgl'>
  runtimeKey?: RuntimeKey
  topologyKey: TopologyKey
  guideKey: GuideKey
  detailKey: DetailKey
  defaultStepId?: ProcessStepId
}

/** 流程步骤同时为二维拓扑、右侧导览和受控三维命令提供同一份稳定业务引用。 */
export interface ProcessGuideStepDefinition {
  stepId: ProcessStepId
  title: string
  description: string
  nodeIds: readonly ProcessNodeId[]
  activeRouteIds: readonly RouteId[]
  order: number
}

/** 导览定义可独立发布，步骤顺序由 order 确定而不是数组偶然顺序。 */
export interface ProcessGuideDefinition {
  guideKey: GuideKey
  configVersion: ConfigVersion
  steps: readonly ProcessGuideStepDefinition[]
}

/**
 * 二维节点的布局坐标为归一化百分比，画布适配器据此适配任意容器尺寸。
 * 图元和状态由受控登记表驱动；没有实时状态时明确传入 offline，不能默认渲染为正常。
 */
export interface TopologyNodeDefinition {
  nodeId: ProcessNodeId
  title: string
  x: number
  y: number
  layerId?: string
  iconKey: TopologyIconKey
  deviceStatus: TopologyDeviceStatus
  statusUpdatedAt?: string
  detailKey?: DetailKey
  metricKeys: readonly MetricKey[]
}

/** 仅 verified 连线可引用已确认三维路由；其他连线保留二维说明，不产生三维控制。 */
export interface TopologyEdgeDefinition {
  edgeId: RouteId
  fromNodeId: ProcessNodeId
  toNodeId: ProcessNodeId
  title: string
  /** 协议或链路名称仅作二维标注，不能据此推断三维路径或消息协议。 */
  protocolLabel?: string
  /** 原始拓扑图线色的二维展示字段；不参与三维路由或状态判断。 */
  lineColor?: string
  /** 原始拓扑图线型；未提供时由证据状态沿用历史默认规则。 */
  lineStyle?: 'solid' | 'dashed'
  evidenceStatus: TopologyEvidenceStatus
  sceneRouteIds: readonly RouteId[]
}

/**
 * 拓扑定义与页面严格同版本发布，图形适配器只消费这份纯数据模型。
 * title（标题）属于拓扑配置而非组件常量，使九个场景和同场景多图能够复用同一个面板。
 */
export interface TopologyDefinition {
  topologyKey: TopologyKey
  title: string
  configVersion: ConfigVersion
  layers?: readonly TopologyLayerDefinition[]
  nodes: readonly TopologyNodeDefinition[]
  edges: readonly TopologyEdgeDefinition[]
}

/** 数据绑定仅描述指标语义与可用性，当前未接实时契约时不填造指标数值。 */
export interface MetricBindingDefinition {
  metricKey: MetricKey
  title: string
  unit: string
  availability: 'pending' | 'available'
  dataPermissionCode?: PermissionCode
}

/** 详情块以可插拔形式注册，右侧面板按权限与数据可用性决定是否渲染。 */
export interface DetailBlockDefinition {
  blockId: DetailBlockId
  title: string
  kind: 'basic' | 'metrics' | 'alarms' | 'communication' | 'maintenance'
  pagePermissionCode?: PermissionCode
  dataPermissionCode?: PermissionCode
  metricKeys: readonly MetricKey[]
}

/** 设备详情配置按节点索引，未选中设备时不会创建无意义的详情请求。 */
export interface DetailDefinition {
  detailKey: DetailKey
  configVersion: ConfigVersion
  blocksByNodeId: Readonly<Record<string, readonly DetailBlockDefinition[]>>
  metrics: readonly MetricBindingDefinition[]
}

/** 场景映射只包含稳定 ID；真实 Unity 层级和资源引用只能留在受控运行时内部。 */
export interface SceneMappingDefinition {
  processId: ProcessId
  configVersion: ConfigVersion
  mappedNodeIds: readonly ProcessNodeId[]
  mappedRouteIds: readonly RouteId[]
}

/** 资源预算在运行时登记中审核，避免业务页面以配置绕过单实例和缓存上限。 */
export interface WebglRuntimeRegistration {
  runtimeKey: RuntimeKey
  buildId: string
  configVersion: ConfigVersion
  sceneMappingVersion: ConfigVersion
  protocolVersion: number
  resourceDigest: string
  entryUrl: string
  childOrigin: string
  allowedParentOrigin: string
  capabilities: readonly WebglCommandType[]
  eventCapabilities: readonly WebglEventType[]
  resourceBudget: {
    initialMemoryMb: number
    maxConcurrentInstances: 1
    cacheMode: 'none' | 'versioned'
  }
  rollbackRuntimeKey?: RuntimeKey
}

/** 页面加载后的原子配置包；任一必需件缺失即不能尝试启动网页图形。 */
export interface ProcessConfigurationBundle {
  page: ProcessPageDefinition
  topology: TopologyDefinition
  guide: ProcessGuideDefinition
  details: DetailDefinition
  sceneMapping: SceneMappingDefinition
  runtime?: WebglRuntimeRegistration
}

/** 配置校验问题具备稳定编码，可供后续发布平台、日志与用户态诊断共用。 */
export interface ProcessConfigValidationIssue {
  code: string
  message: string
}

/** 加载器只给出可安全渲染的结果；降级并不伪装为网页图形已启动。 */
export interface ProcessConfigLoadResult {
  status: 'ready' | 'degraded' | 'missing'
  effectiveRuntimeMode: Exclude<ProcessRuntimeMode, 'webgl'> | 'webgl'
  bundle?: ProcessConfigurationBundle
  issues: readonly ProcessConfigValidationIssue[]
}

/** 专题入口配置独立于工艺页，避免将页面名称散落在路由和组件中。 */
export interface TopicDefinition {
  topicId: TopicId
  title: string
  description: string
  permissionCode: PermissionCode
  configVersion: ConfigVersion
}

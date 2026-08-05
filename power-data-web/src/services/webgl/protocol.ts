import { validateStableIdentifier } from '@/config/scene-topology/identifiers'

/** 网页图形通信的固定通道与协议版本；业务模块不能覆盖这些安全边界。 */
export const WEBGL_PROTOCOL_CHANNEL = 'power3d-unity' as const
export const WEBGL_PROTOCOL_VERSION = 1 as const

/**
 * 前端可下发的命令白名单。
 * dispose 用于可确认释放运行时，只有受控宿主与连接器可以发送，业务页面不能直接操作窗口消息。
 */
export const WEBGL_COMMAND_TYPES = [
  'init',
  'resize',
  'switchScene',
  'enterProcessStep',
  'resetScene',
  'focusNode',
  'setNodeVisualState',
  'setRouteFlow',
  'setNodeVisibility',
  'dispose',
] as const

export type WebglCommandType = (typeof WEBGL_COMMAND_TYPES)[number]

/**
 * 子页面可回传的事件白名单。
 * commandResult、ack 与 disposed 必须在 payload.requestId 回填原命令 messageId，
 * 前端绝不使用回包自身的 messageId 关联待确认命令。
 */
export const WEBGL_EVENT_TYPES = [
  'ready',
  'ack',
  'commandResult',
  'sceneLoadProgress',
  'sceneChanged',
  'objectSelected',
  'disposed',
] as const

export type WebglEventType = (typeof WEBGL_EVENT_TYPES)[number]

/** 就绪消息的强制元数据，运行时必须显式声明命令与事件能力，前端不会从事件反推命令能力。 */
export interface WebglReadyPayload {
  runtimeKey: string
  buildId: string
  sceneMappingVersion: string
  protocolVersion: number
  resourceDigest: string
  commandCapabilities: readonly WebglCommandType[]
  eventCapabilities: readonly WebglEventType[]
}

/** 通用确认类载荷；requestId 必须等于被确认原命令的 messageId。 */
export interface WebglRequestAcknowledgementPayload {
  requestId: string
  success?: boolean
  message?: string
  errorCode?: string
  sceneState?: string
}

/**
 * 场景切换命令载荷同时绑定目标场景、外层已生成的切换事务与场景映射版本。
 * 协议版本由信封的 version 表达；映射版本单独校验，避免同一协议下新旧场景目录混用。
 */
export interface WebglSwitchScenePayload {
  sceneId: string
  transitionId: string
  sceneMappingVersion: string
}

/**
 * 流程、聚焦、状态和路径命令只接受发布清单中登记的稳定标识。
 * 该类型不携带 Unity 方法名、层级路径、材质参数或任意颜色，
 * 因而外层动作映射只能描述业务意图，不能借由 iframe 执行任意引擎操作。
 */
export interface WebglEnterProcessStepPayload {
  processId: string
  stepId: string
  unitId?: string
  isolate: boolean
}

/** 聚焦和显隐都使用独立的三维节点标识，禁止误把二维 nodeId 透传给 Unity。 */
export interface WebglSceneNodeCommandPayload {
  sceneNodeId: string
  isolate?: boolean
}

/** 与拓扑状态保持一致的四态字符串；浏览器端和 Unity 端均拒绝未知状态。 */
export type WebglNodeVisualState = 'normal' | 'alarm' | 'fault' | 'offline'

/** 设备状态增量只指定映射节点和固定四态，具体材质或材质属性由 Unity 场景控制器内部决定。 */
export interface WebglSetNodeVisualStatePayload {
  sceneNodeId: string
  visualState: WebglNodeVisualState
}

/** 路径动作仅允许受控路径标识与开关值；速度、着色器与资源参数不得由网页下发。 */
export interface WebglSetRouteFlowPayload {
  routeId: string
  enabled: boolean
}

/** 显隐命令与聚焦同样使用三维节点标识，避免二维拓扑节点与三维对象发生隐式混用。 */
export interface WebglSetNodeVisibilityPayload {
  sceneNodeId: string
  enabled: boolean
}

/**
 * 场景加载进度必须回填原 switchScene 的请求标识，并携带同一事务和场景。
 * 前端据此拒绝旧事务、错误请求或越界进度，进度本身不能作为场景切换完成条件。
 */
export interface WebglSceneLoadProgressPayload {
  requestId: string
  sceneId: string
  transitionId: string
  stageCode: 'unloading-scene' | 'loading-scene' | 'initializing-scene' | 'restoring-scene'
  progress: number
}

/**
 * 场景已切换事件仅表示 Unity 已完成加载、初始化和原子提交。
 * requestId 保留原始命令关联，sceneState 只可包含受控摘要，不能泄露引擎层级或资源路径。
 */
export interface WebglSceneChangedPayload {
  requestId: string
  sceneId: string
  transitionId: string
  success: true
  sceneState?: string
}

/** 对象选中事件只传回稳定业务节点标识和可选场景状态，不传 Unity 层级或任意对象引用。 */
export interface WebglObjectSelectedPayload {
  nodeId: string
  nodeName?: string
  sceneState?: string
}

/** 统一信封将通道、版本、实例、消息、类型、载荷和时间戳绑定，避免跨 iframe 与跨版本串扰。 */
export interface WebglMessageEnvelope<TType extends string = string, TPayload = unknown> {
  channel: typeof WEBGL_PROTOCOL_CHANNEL
  version: typeof WEBGL_PROTOCOL_VERSION
  instanceId: string
  messageId: string
  type: TType
  payload: TPayload
  timestamp: number
}

/** 创建受控命令信封；调用端必须注入关联消息标识，保证确认、超时和重试可追踪。 */
export function createWebglCommand<TPayload>(
  instanceId: string,
  messageId: string,
  type: WebglCommandType,
  payload: TPayload,
): WebglMessageEnvelope<WebglCommandType, TPayload> {
  return {
    channel: WEBGL_PROTOCOL_CHANNEL,
    version: WEBGL_PROTOCOL_VERSION,
    instanceId,
    messageId,
    type,
    payload,
    timestamp: Date.now(),
  }
}

/** 判断下行命令是否在协议白名单内，防止调用方将任意字符串写入 postMessage。 */
export function isWebglCommandType(value: unknown): value is WebglCommandType {
  return typeof value === 'string' && WEBGL_COMMAND_TYPES.includes(value as WebglCommandType)
}

/** 判断上行事件是否在协议白名单内，未知类型不能进入场景或业务协调逻辑。 */
export function isWebglEventType(value: unknown): value is WebglEventType {
  return typeof value === 'string' && WEBGL_EVENT_TYPES.includes(value as WebglEventType)
}

/**
 * 验证来自窗口消息的完整基础信封。
 * payload 必须作为字段存在但允许其具体形态由事件类型二次校验；基础守卫不信任 unknown 输入。
 */
export function isWebglMessageEnvelope(value: unknown): value is WebglMessageEnvelope {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    candidate.channel === WEBGL_PROTOCOL_CHANNEL &&
    candidate.version === WEBGL_PROTOCOL_VERSION &&
    typeof candidate.instanceId === 'string' &&
    candidate.instanceId.length > 0 &&
    typeof candidate.messageId === 'string' &&
    candidate.messageId.length > 0 &&
    typeof candidate.type === 'string' &&
    Object.hasOwn(candidate, 'payload') &&
    typeof candidate.timestamp === 'number' &&
    Number.isFinite(candidate.timestamp)
  )
}

/** 验证就绪载荷的版本、资源摘要及显式能力声明字段是否齐全。 */
export function isWebglReadyPayload(value: unknown): value is WebglReadyPayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  const hasIdentifiers =
    typeof candidate.runtimeKey === 'string' &&
    candidate.runtimeKey.length > 0 &&
    typeof candidate.buildId === 'string' &&
    candidate.buildId.length > 0 &&
    typeof candidate.sceneMappingVersion === 'string' &&
    candidate.sceneMappingVersion.length > 0 &&
    typeof candidate.protocolVersion === 'number' &&
    typeof candidate.resourceDigest === 'string' &&
    candidate.resourceDigest.length > 0

  return (
    hasIdentifiers &&
    Array.isArray(candidate.commandCapabilities) &&
    candidate.commandCapabilities.every(isWebglCommandType) &&
    Array.isArray(candidate.eventCapabilities) &&
    candidate.eventCapabilities.every(isWebglEventType)
  )
}

/** 确认、结果和释放事件都必须携带原命令标识，以安全地从有限待确认表中移除。 */
export function isWebglRequestAcknowledgementPayload(value: unknown): value is WebglRequestAcknowledgementPayload {
  return Boolean(value && typeof value === 'object' && typeof (value as Record<string, unknown>).requestId === 'string')
}

/** 验证 switchScene 的稳定标识与映射版本；空标识不得进入受控 iframe 命令通道。 */
export function isWebglSwitchScenePayload(value: unknown): value is WebglSwitchScenePayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    isBoundedIdentifier(candidate.sceneId) &&
    isBoundedIdentifier(candidate.transitionId) &&
    isBoundedIdentifier(candidate.sceneMappingVersion)
  )
}

/** 验证流程命令的受控标识和布尔隔离开关；unitId 可以省略，由发布动作映射提供默认值。 */
export function isWebglEnterProcessStepPayload(value: unknown): value is WebglEnterProcessStepPayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    isBoundedIdentifier(candidate.processId) &&
    isBoundedIdentifier(candidate.stepId) &&
    (candidate.unitId === undefined || isBoundedIdentifier(candidate.unitId)) &&
    typeof candidate.isolate === 'boolean'
  )
}

/** 验证聚焦载荷中的三维节点标识，避免把空值或二维 nodeId 作为隐式兼容输入。 */
export function isWebglSceneNodeCommandPayload(value: unknown): value is WebglSceneNodeCommandPayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return isBoundedIdentifier(candidate.sceneNodeId) &&
    (candidate.isolate === undefined || typeof candidate.isolate === 'boolean')
}

/** 验证四态视觉更新，状态值必须是有限枚举而非可写材质或颜色。 */
export function isWebglSetNodeVisualStatePayload(value: unknown): value is WebglSetNodeVisualStatePayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return isBoundedIdentifier(candidate.sceneNodeId) && isWebglNodeVisualState(candidate.visualState)
}

/** 验证路径流动命令；只允许稳定路径标识与布尔开关。 */
export function isWebglSetRouteFlowPayload(value: unknown): value is WebglSetRouteFlowPayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return isBoundedIdentifier(candidate.routeId) && typeof candidate.enabled === 'boolean'
}

/** 验证显隐命令；它和聚焦共享三维节点标识而不复用二维拓扑标识。 */
export function isWebglSetNodeVisibilityPayload(value: unknown): value is WebglSetNodeVisibilityPayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return isBoundedIdentifier(candidate.sceneNodeId) && typeof candidate.enabled === 'boolean'
}

/**
 * 进度必须属于有限生命周期阶段并保持 0 至 1 的有限数值。
 * 这层只验证线上的数据形态；同一请求内不倒退的顺序约束由连接器保存的有限状态进一步校验。
 */
export function isWebglSceneLoadProgressPayload(value: unknown): value is WebglSceneLoadProgressPayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    isBoundedIdentifier(candidate.requestId) &&
    isBoundedIdentifier(candidate.sceneId) &&
    isBoundedIdentifier(candidate.transitionId) &&
    isSceneLoadStageCode(candidate.stageCode) &&
    typeof candidate.progress === 'number' &&
    Number.isFinite(candidate.progress) &&
    candidate.progress >= 0 &&
    candidate.progress <= 1
  )
}

/** 场景完成事件只能报告成功；失败必须通过 commandResult 回填明确错误码和原始 requestId。 */
export function isWebglSceneChangedPayload(value: unknown): value is WebglSceneChangedPayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    isBoundedIdentifier(candidate.requestId) &&
    isBoundedIdentifier(candidate.sceneId) &&
    isBoundedIdentifier(candidate.transitionId) &&
    candidate.success === true &&
    (candidate.sceneState === undefined || typeof candidate.sceneState === 'string')
  )
}

/** 对象选中事件必须提供稳定节点标识；缺失节点标识的事件不允许联动二维拓扑和详情。 */
export function isWebglObjectSelectedPayload(value: unknown): value is WebglObjectSelectedPayload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  // 三维反向选择会以 nodeId 映射正式 sceneNodeId（三维节点标识），因此此处必须与清单标识规则一致；
  // 不接受对象名称、层级路径、空格或超长字符串，避免其进入选择诊断、状态仓库和外层事件。
  return isBoundedIdentifier(candidate.nodeId) && validateStableIdentifier(candidate.nodeId).length === 0
}

/**
 * 仅接受精确 HTTP 或 HTTPS 来源，拒绝路径、查询、片段和用户信息。
 * 返回规范化来源字符串可直接作为 postMessage 的 targetOrigin，禁止退化为通配来源。
 */
export function parseExactOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    const isHttpOrigin = url.protocol === 'http:' || url.protocol === 'https:'
    const hasOnlyOrigin = url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password
    return isHttpOrigin && hasOnlyOrigin ? url.origin : null
  } catch {
    return null
  }
}

/** 所有跨窗口稳定标识限定长度，避免异常页面用超长字符串放大待确认表和诊断日志。 */
function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

/** 统一识别四态，避免各调用方各自维护字符串集合而导致跨端协议漂移。 */
function isWebglNodeVisualState(value: unknown): value is WebglNodeVisualState {
  return value === 'normal' || value === 'alarm' || value === 'fault' || value === 'offline'
}

/** 场景加载生命周期只允许协调器实际产生的固定阶段，未知阶段不能影响宿主进度展示。 */
function isSceneLoadStageCode(value: unknown): value is WebglSceneLoadProgressPayload['stageCode'] {
  return value === 'unloading-scene' || value === 'loading-scene' || value === 'initializing-scene' || value === 'restoring-scene'
}

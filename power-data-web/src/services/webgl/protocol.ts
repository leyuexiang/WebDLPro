import { isSceneId, validateStableIdentifier } from '@/config/scene-topology/identifiers'

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
  'clearSelection',
  'setNodeVisualState',
  'clearNodeVisualState',
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
  'selectionCleared',
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
  /** 仅场景切换失败但 Unity 已自动恢复旧场景时出现，表示恢复后的新物理场景实例。 */
  sceneActivationId?: string
}

/**
 * 场景切换命令载荷同时绑定目标场景、外层已生成的切换事务、场景映射版本与物理重载语义。
 * 协议版本由信封的 version 表达；映射版本单独校验，避免同一协议下新旧场景目录混用。
 */
export interface WebglSwitchScenePayload {
  sceneId: string
  transitionId: string
  sceneMappingVersion: string
  /** 为 true 时禁止 Unity 使用同场景快速完成路径，必须卸载并重建物理场景实例。 */
  forceReload: boolean
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

/**
 * 聚焦命令同时携带三维节点、选择事务和明确隔离开关。
 * Unity 使用 selectionId（选择标识）进行幂等处理；它不能由消息标识或场景切换事务隐式替代。
 */
export interface WebglFocusNodePayload {
  sceneNodeId: string
  selectionId: string
  isolate: boolean
}

/** 与拓扑状态保持一致的四态字符串；浏览器端和 Unity 端均拒绝未知状态。 */
export type WebglNodeVisualState = 'normal' | 'alarm' | 'fault' | 'offline'

/**
 * 节点状态命令只指定已静态映射的三维节点、固定四态、壳内快照序号和两个诊断字段，具体材质由 Unity 场景控制器决定。
 * `snapshotSequence` 是唯一迟到门禁；平台状态时间和来源修订不得参与 Unity 覆盖顺序。
 */
export interface WebglSetNodeVisualStatePayload {
  sceneNodeId: string
  visualState: WebglNodeVisualState
  snapshotSequence: number
  statusUpdatedAt: string
  sourceRevision: number
}

/**
 * 完整快照中节点消失时使用独立清除命令恢复模型基础视觉。
 * 该命令不能复用 `normal`：正常是平台明确下发的实时四态之一，而清除表示撤销动态覆盖。
 */
export interface WebglClearNodeVisualStatePayload {
  sceneNodeId: string
  snapshotSequence: number
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
  /** Unity 每次真实提交或恢复业务场景时生成的新实例标识；同场景拓扑切换保持不变。 */
  sceneActivationId: string
  success: true
  sceneState?: string
}

/**
 * 对象选中事件只传回场景、稳定三维节点和物理场景激活标识，不传名称、状态、层级或任意对象引用。
 * `sceneActivationId`（物理场景激活标识）用于阻断“场景 A → B → 场景 A”中的首个 A 迟到事件；
 * 它与普通 `transitionId`（视图切换事务标识）不同，同场景拓扑切换不会改变它。二维 `nodeId`
 * （拓扑节点标识）仍只能由前端通过已发布的 `nodeId ↔ sceneNodeId` 静态映射反查，禁止 Unity 隐式写入或互换。
 */
export interface WebglObjectSelectedPayload {
  sceneId: string
  sceneNodeId: string
  sceneActivationId: string
}

/** 三维空白点击只回传场景与物理实例标识，禁止用空 sceneNodeId 伪造对象选择事件。 */
export interface WebglSelectionClearedPayload {
  sceneId: string
  sceneActivationId: string
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
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return isBoundedIdentifier(candidate.requestId) &&
    (candidate.sceneActivationId === undefined || (
      isBoundedIdentifier(candidate.sceneActivationId) &&
      validateStableIdentifier(candidate.sceneActivationId).length === 0
    ))
}

/** 验证 switchScene 的稳定标识、映射版本和明确重载开关；缺省布尔值不得跨协议边界。 */
export function isWebglSwitchScenePayload(value: unknown): value is WebglSwitchScenePayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    isBoundedIdentifier(candidate.sceneId) &&
    isBoundedIdentifier(candidate.transitionId) &&
    isBoundedIdentifier(candidate.sceneMappingVersion) &&
    typeof candidate.forceReload === 'boolean'
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

/** 验证聚焦载荷的三维节点、选择标识和隔离开关，缺失字段不能进入 Unity 幂等执行链。 */
export function isWebglFocusNodePayload(value: unknown): value is WebglFocusNodePayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return isBoundedIdentifier(candidate.sceneNodeId) &&
    isBoundedIdentifier(candidate.selectionId) &&
    typeof candidate.isolate === 'boolean'
}

/**
 * 验证四态视觉更新。快照序号必须为正安全整数，零只会由 Unity JSON 缺省产生，因此可可靠拒绝旧载荷；
 * 状态时间和来源修订继续严格校验，但只允许进入诊断，不能替代本地序号做因果判断。
 */
export function isWebglSetNodeVisualStatePayload(value: unknown): value is WebglSetNodeVisualStatePayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return isBoundedIdentifier(candidate.sceneNodeId) &&
    isWebglNodeVisualState(candidate.visualState) &&
    isPositiveSafeInteger(candidate.snapshotSequence) &&
    isWebglStatusUpdatedAt(candidate.statusUpdatedAt) &&
    isNonNegativeSafeInteger(candidate.sourceRevision)
}

/** 清除命令与设置命令共享本地序号门禁，确保迟到设置不能重新写回已经消失的设备状态。 */
export function isWebglClearNodeVisualStatePayload(value: unknown): value is WebglClearNodeVisualStatePayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  const keys = Object.keys(candidate)
  return keys.length === 2 &&
    keys.includes('sceneNodeId') &&
    keys.includes('snapshotSequence') &&
    isBoundedIdentifier(candidate.sceneNodeId) &&
    isPositiveSafeInteger(candidate.snapshotSequence)
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
    isBoundedIdentifier(candidate.sceneActivationId) &&
    validateStableIdentifier(candidate.sceneActivationId).length === 0 &&
    candidate.success === true &&
    (candidate.sceneState === undefined || typeof candidate.sceneState === 'string')
  )
}

/**
 * 对象选中事件必须提供固定目录内的场景标识、稳定三维节点标识与物理激活标识；缺失、混入旧字段
 * 或误传二维节点标识的事件不允许联动二维拓扑和详情。
 * 此处不保留旧 `nodeId`（二维节点标识）兼容分支，避免旧 Unity 构建在未完成协议升级时被误解释为三维选择。
 */
export function isWebglObjectSelectedPayload(value: unknown): value is WebglObjectSelectedPayload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  // 协议升级后只接受这三个字段。拒绝对象名称、场景状态、层级路径、旧二维字段和任意扩展字段，
  // 避免旧构建或不可信子页面把未经映射的数据带入诊断、状态仓库或外层事件。
  const allowedKeys = new Set(['sceneId', 'sceneNodeId', 'sceneActivationId'])
  return isSceneId(candidate.sceneId) &&
    isBoundedIdentifier(candidate.sceneNodeId) &&
    validateStableIdentifier(candidate.sceneNodeId).length === 0 &&
    isBoundedIdentifier(candidate.sceneActivationId) &&
    validateStableIdentifier(candidate.sceneActivationId).length === 0 &&
    Object.keys(candidate).every((key) => allowedKeys.has(key))
}

/** 验证三维空白清除事件，只允许场景和当前物理实例两个字段。 */
export function isWebglSelectionClearedPayload(value: unknown): value is WebglSelectionClearedPayload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  const allowedKeys = new Set(['sceneId', 'sceneActivationId'])
  return isSceneId(candidate.sceneId) &&
    isBoundedIdentifier(candidate.sceneActivationId) &&
    validateStableIdentifier(candidate.sceneActivationId).length === 0 &&
    Object.keys(candidate).every((key) => allowedKeys.has(key))
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

/**
 * 内层状态时间沿用外层的受限 ISO 语义：只允许有界、可解析的时间文本。
 * 此处不接受数值秒数或任意日期对象，确保 iframe 消息可序列化、可比较且不会成为绕过字段校验的旁路。
 */
function isWebglStatusUpdatedAt(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && Number.isFinite(Date.parse(value))
}

/** 统一识别四态，避免各调用方各自维护字符串集合而导致跨端协议漂移。 */
function isWebglNodeVisualState(value: unknown): value is WebglNodeVisualState {
  return value === 'normal' || value === 'alarm' || value === 'fault' || value === 'offline'
}

/** 来源修订号与外层协议共用 JavaScript 安全整数边界，避免跨语言传输后发生精度截断。 */
function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** 壳内快照序号从一开始单调递增；拒绝零可防止 Unity JSON 缺省字段绕过新协议。 */
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** 场景加载生命周期只允许协调器实际产生的固定阶段，未知阶段不能影响宿主进度展示。 */
function isSceneLoadStageCode(value: unknown): value is WebglSceneLoadProgressPayload['stageCode'] {
  return value === 'unloading-scene' || value === 'loading-scene' || value === 'initializing-scene' || value === 'restoring-scene'
}

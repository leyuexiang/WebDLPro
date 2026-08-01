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
  'enterProcessStep',
  'resetScene',
  'focusNode',
  'setNodeVisibility',
  'setRouteFlow',
  'dispose',
] as const

export type WebglCommandType = (typeof WEBGL_COMMAND_TYPES)[number]

/**
 * 子页面可回传的事件白名单。
 * commandResult、ack 与 disposed 必须在 payload.requestId 回填原命令 messageId，
 * 前端绝不使用回包自身的 messageId 关联待确认命令。
 */
export const WEBGL_EVENT_TYPES = ['ready', 'ack', 'commandResult', 'objectSelected', 'disposed'] as const

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

/** 对象选中事件必须提供稳定节点标识；缺失节点标识的事件不允许联动二维拓扑和详情。 */
export function isWebglObjectSelectedPayload(value: unknown): value is WebglObjectSelectedPayload {
  return Boolean(value && typeof value === 'object' && typeof (value as Record<string, unknown>).nodeId === 'string')
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

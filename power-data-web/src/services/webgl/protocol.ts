/** 网页图形通信的固定通道与初始协议版本，业务页面不得自行修改。 */
export const WEBGL_PROTOCOL_CHANNEL = 'power3d-unity' as const
export const WEBGL_PROTOCOL_VERSION = 1 as const

/**
 * 前端可向已登记网页图形运行时发送的命令白名单。
 * 命令参数的具体业务标识由后续运行时配置和工艺配置共同校验。
 */
export type WebglCommandType =
  | 'init'
  | 'resize'
  | 'enterProcessStep'
  | 'resetScene'
  | 'focusNode'
  | 'setNodeVisibility'
  | 'setRouteFlow'

/** 当前 Unity 桥接协议会回传的事件类型。 */
export type WebglEventType = 'ready' | 'ack' | 'commandResult' | 'objectSelected'

/** 统一信封将通道、版本和实例标识与消息负载绑定，避免跨 iframe 或跨版本串扰。 */
export interface WebglMessageEnvelope<TType extends string = string, TPayload = unknown> {
  channel: typeof WEBGL_PROTOCOL_CHANNEL
  version: typeof WEBGL_PROTOCOL_VERSION
  instanceId: string
  messageId: string
  type: TType
  payload: TPayload
  timestamp: number
}

/** 创建命令信封；消息标识由调用端注入，便于与协调器的关联标识一一对应。 */
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

/**
 * 验证来自窗口消息的最小信封结构。
 * 具体事件负载仍需由连接器按照事件类型做二次校验，基础类型守卫不信任 unknown 输入。
 */
export function isWebglMessageEnvelope(value: unknown): value is WebglMessageEnvelope {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    candidate.channel === WEBGL_PROTOCOL_CHANNEL &&
    candidate.version === WEBGL_PROTOCOL_VERSION &&
    typeof candidate.instanceId === 'string' &&
    typeof candidate.messageId === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.timestamp === 'number'
  )
}

/**
 * 仅接受精确 HTTP 或 HTTPS 来源，拒绝路径、查询、片段和用户信息。
 * 返回规范化来源字符串可直接用于 postMessage 的 targetOrigin，禁止退化为通配来源。
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

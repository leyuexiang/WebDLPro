import { SCENE_IDS, isSceneId, validateStableIdentifier } from '@/config/scene-topology/identifiers'
import type { ActionId, DeviceId, NodeId, SceneId, SceneNodeId, SessionId, TopologyId, TransitionId } from '@/config/scene-topology/identifiers'
import type { DeviceVisualStatus } from '@/config/scene-topology/types'

/** 外层父页面与可视化子应用的固定通道；禁止与 Unity 内层通道混用。 */
export const HOST_PROTOCOL_CHANNEL = 'power-scene-topology-shell' as const
export const HOST_PROTOCOL_VERSION = 1 as const

/** 协议中的所有容量上限集中声明，窗口桥不得自行扩大数组、缓存或消息大小。 */
export const HOST_PROTOCOL_LIMITS = Object.freeze({
  messageBytes: 256 * 1024,
  identifierLength: 128,
  stringLength: 512,
  descriptionLength: 1024,
  pendingCommands: 64,
  recentMessageIds: 256,
  deviceStateItems: 500,
  workflowParameters: 32,
  selectionNodeIds: 64,
})

/** 父页面下行命令白名单；任何 Unity 方法名或资源地址都不在此集合内。 */
export const HOST_COMMAND_TYPES = [
  'system.init',
  'view.open',
  'workflow.trigger',
  'device.states.update',
  'state.get',
  'system.dispose',
] as const

/**
 * 初始化命令由握手状态机单独消费；其余五项由任务-012的命令分派器处理。
 * 将两类命令显式拆分，避免分派器绕过握手直接接纳尚未初始化的业务请求。
 */
export const HOST_DISPATCHABLE_COMMAND_TYPES = [
  'view.open',
  'workflow.trigger',
  'device.states.update',
  'state.get',
  'system.dispose',
] as const

/** 子应用上行事件白名单；事件必须在发送前由同一校验器验证。 */
export const HOST_EVENT_TYPES = [
  'system.ready',
  'system.ack',
  'command.result',
  'view.changed',
  'topology.node.dblclick',
  'scene.object.selected',
  'state.snapshot',
  'system.error',
] as const

export type HostCommandType = (typeof HOST_COMMAND_TYPES)[number]
export type HostDispatchableCommandType = (typeof HOST_DISPATCHABLE_COMMAND_TYPES)[number]
export type HostEventType = (typeof HOST_EVENT_TYPES)[number]
export type HostMessageType = HostCommandType | HostEventType

/** 所有外层消息唯一使用此信封；业务字段必须保存在已校验的 payload 中。 */
export interface HostMessageEnvelope<TType extends HostMessageType, TPayload> {
  channel: typeof HOST_PROTOCOL_CHANNEL
  version: typeof HOST_PROTOCOL_VERSION
  instanceId: string
  sessionId: SessionId
  messageId: string
  replyTo?: string
  type: TType
  timestamp: number
  payload: TPayload
}

/** 初始视图只引用稳定场景、拓扑与动作标识，不接收路径、模型名或 Unity 方法名。 */
export interface SystemInitPayload {
  sceneId: SceneId
  topologyId: TopologyId
  actionId?: ActionId | null
  expectedManifestVersion?: string
}

/** 直接打开场景和拓扑的受控命令；上下文版本可用于拒绝父页面的旧操作。 */
export interface ViewOpenPayload {
  sceneId: SceneId
  topologyId: TopologyId
  actionId?: ActionId | null
  expectedContextRevision?: number
}

/** 触发动作时只允许有限的标量参数，禁止对象嵌套、函数与任意资源地址。 */
export interface WorkflowTriggerPayload {
  actionId: ActionId
  parameters?: Readonly<Record<string, string | number | boolean | null>>
  expectedContextRevision?: number
}

/** 父页面设备状态更新中的单条四态记录。 */
export interface DeviceStateUpdateItem {
  deviceId: DeviceId
  deviceStatus: DeviceVisualStatus
  statusUpdatedAt: string
}

/** 批量状态更新受 500 条上限约束，防止外部消息一次占用无界内存。 */
export interface DeviceStatesUpdatePayload {
  sourceRevision?: number
  items: readonly DeviceStateUpdateItem[]
}

/** 状态查询没有参数，空对象之外的字段一律拒绝。 */
export type StateGetPayload = Readonly<Record<string, never>>

/** 释放说明仅用于受控诊断，不能携带完整父页面载荷。 */
export interface SystemDisposePayload {
  reason?: string
}

export type HostCommandMessage =
  | HostMessageEnvelope<'system.init', SystemInitPayload>
  | HostMessageEnvelope<'view.open', ViewOpenPayload>
  | HostMessageEnvelope<'workflow.trigger', WorkflowTriggerPayload>
  | HostMessageEnvelope<'device.states.update', DeviceStatesUpdatePayload>
  | HostMessageEnvelope<'state.get', StateGetPayload>
  | HostMessageEnvelope<'system.dispose', SystemDisposePayload>

/** 外层状态快照与结果共享的稳定上下文，不保存窗口、画布或 Unity 对象。 */
export interface HostVisualizationContext {
  sceneId: SceneId
  topologyId: TopologyId
  actionId: ActionId | null
  contextRevision: number
  status: 'initializing' | 'ready' | 'error' | 'released'
}

/** 首版错误码与协议规范一一对应；调用方不能将 Error.message 原样回传。 */
export type HostProtocolErrorCode =
  | 'protocol.origin.rejected'
  | 'protocol.source.rejected'
  | 'protocol.envelope.invalid'
  | 'protocol.payload.invalid'
  | 'protocol.capability.undeclared'
  | 'protocol.message.duplicate'
  | 'protocol.capacity.exceeded'
  | 'manifest.version.mismatch'
  | 'scene.unknown'
  | 'topology.unknown'
  | 'topology.scene.mismatch'
  | 'action.unknown'
  | 'action.context.mismatch'
  | 'context.revision.conflict'
  | 'scene.switch.failed'
  | 'action.execute.failed'
  | 'topology.prepare.failed'
  | 'topology.activate.failed'
  | 'command.timeout'
  | 'command.superseded'
  | 'runtime.disposed'

/** 结构化错误只包含稳定领域标识和受控说明，不允许 Unity 层级、凭据或原始消息。 */
export interface HostProtocolError {
  code: HostProtocolErrorCode
  message: string
  stage: 'handshake' | 'validation' | 'preparing-topology' | 'switching-scene' | 'executing-action' | 'activating-topology' | 'disposing'
  recoverable: boolean
  sceneId?: SceneId
  topologyId?: TopologyId
  actionId?: ActionId
  transitionId?: TransitionId
}

/** 准备就绪事件只暴露发布能力和固定场景目录，不暴露内部资源位置。 */
export interface SystemReadyPayload {
  manifestVersion: string
  sceneIds: readonly SceneId[]
  commandCapabilities: readonly HostCommandType[]
  eventCapabilities: readonly HostEventType[]
}

/** 初始化确认包含唯一稳定上下文；失败时上下文可缺失但错误必须受控。 */
export interface SystemAcknowledgementPayload {
  success: boolean
  context?: HostVisualizationContext
  error?: HostProtocolError | null
}

/** 命令结果只给出完成状态、事务、上下文版本和受控错误。 */
export interface CommandResultPayload {
  success: boolean
  status: 'completed' | 'failed' | 'superseded' | 'disposed'
  transitionId?: TransitionId
  contextRevision?: number
  error: HostProtocolError | null
}

/** 只有全部场景、动作和拓扑完成提交后才能发送的稳定视图上下文。 */
export interface ViewChangedPayload {
  sceneId: SceneId
  topologyId: TopologyId
  actionId: ActionId | null
  contextRevision: number
  transitionId?: TransitionId
}

/** 设备双击事件强制携带设备标识；没有设备标识的概念节点不得发送该事件。 */
export interface TopologyNodeDoubleClickPayload {
  sceneId: SceneId
  topologyId: TopologyId
  nodeId: NodeId
  deviceId: DeviceId
  sceneNodeId?: SceneNodeId
  deviceType?: string
  contextRevision: number
  correlationId: string
}

/** Unity 反向选择只使用映射得到的稳定标识，不透出 Unity 对象层级路径。 */
export interface SceneObjectSelectedPayload {
  sceneId: SceneId
  sceneNodeId: SceneNodeId
  deviceId?: DeviceId
  topologyId?: TopologyId
  nodeIds: readonly NodeId[]
  contextRevision: number
  correlationId: string
}

/** 当前状态快照不保存设备全量状态或原始消息，仅包含有限的运行阶段。 */
export interface StateSnapshotPayload {
  manifestVersion: string
  context: HostVisualizationContext
  unityStatus: 'idle' | 'initializing' | 'ready' | 'failed' | 'disposed'
  topologyStatus: 'idle' | 'preparing' | 'ready' | 'failed' | 'disposed'
}

export interface SystemErrorPayload {
  error: HostProtocolError
}

export type HostEventMessage =
  | HostMessageEnvelope<'system.ready', SystemReadyPayload>
  | HostMessageEnvelope<'system.ack', SystemAcknowledgementPayload>
  | HostMessageEnvelope<'command.result', CommandResultPayload>
  | HostMessageEnvelope<'view.changed', ViewChangedPayload>
  | HostMessageEnvelope<'topology.node.dblclick', TopologyNodeDoubleClickPayload>
  | HostMessageEnvelope<'scene.object.selected', SceneObjectSelectedPayload>
  | HostMessageEnvelope<'state.snapshot', StateSnapshotPayload>
  | HostMessageEnvelope<'system.error', SystemErrorPayload>

/** 校验器返回的最小诊断不引用完整输入，便于有限日志安全记录。 */
export interface HostProtocolValidationIssue {
  code: 'protocol.envelope.invalid' | 'protocol.payload.invalid' | 'protocol.capacity.exceeded'
  message: string
}

export type HostProtocolValidationResult<TMessage> =
  | { status: 'valid'; message: TMessage; issues: readonly [] }
  | { status: 'invalid'; issues: readonly HostProtocolValidationIssue[] }

type UnknownRecord = Record<string, unknown>

/** 校验父页面命令的完整信封、类型白名单和对应载荷。 */
export function validateHostCommandMessage(input: unknown): HostProtocolValidationResult<HostCommandMessage> {
  const envelope = validateEnvelope(input, HOST_COMMAND_TYPES, 'command')
  if (!envelope) return invalidResult(input)

  const payloadValid =
    (envelope.type === 'system.init' && isSystemInitPayload(envelope.payload)) ||
    (envelope.type === 'view.open' && isViewOpenPayload(envelope.payload)) ||
    (envelope.type === 'workflow.trigger' && isWorkflowTriggerPayload(envelope.payload)) ||
    (envelope.type === 'device.states.update' && isDeviceStatesUpdatePayload(envelope.payload)) ||
    (envelope.type === 'state.get' && isStateGetPayload(envelope.payload)) ||
    (envelope.type === 'system.dispose' && isSystemDisposePayload(envelope.payload))

  if (!payloadValid) return invalidPayloadResult()
  return { status: 'valid', message: envelope as unknown as HostCommandMessage, issues: [] }
}

/** 校验子应用准备发送给父页面的事件，防止内部代码意外拼入未受控字段。 */
export function validateHostEventMessage(input: unknown): HostProtocolValidationResult<HostEventMessage> {
  const envelope = validateEnvelope(input, HOST_EVENT_TYPES, 'event')
  if (!envelope) return invalidResult(input)

  const replyToRequired = envelope.type === 'system.ack' || envelope.type === 'command.result' || envelope.type === 'state.snapshot'
  if (replyToRequired && !isOpaqueIdentifier(envelope.replyTo)) return invalidEnvelopeResult()

  const payloadValid =
    (envelope.type === 'system.ready' && isSystemReadyPayload(envelope.payload)) ||
    (envelope.type === 'system.ack' && isSystemAcknowledgementPayload(envelope.payload)) ||
    (envelope.type === 'command.result' && isCommandResultPayload(envelope.payload)) ||
    (envelope.type === 'view.changed' && isViewChangedPayload(envelope.payload)) ||
    (envelope.type === 'topology.node.dblclick' && isTopologyNodeDoubleClickPayload(envelope.payload)) ||
    (envelope.type === 'scene.object.selected' && isSceneObjectSelectedPayload(envelope.payload)) ||
    (envelope.type === 'state.snapshot' && isStateSnapshotPayload(envelope.payload)) ||
    (envelope.type === 'system.error' && isSystemErrorPayload(envelope.payload))

  if (!payloadValid) return invalidPayloadResult()
  return { status: 'valid', message: envelope as unknown as HostEventMessage, issues: [] }
}

/** 类型守卫让桥接层无需二次断言即可安全访问父页面命令。 */
export function isHostCommandMessage(input: unknown): input is HostCommandMessage {
  return validateHostCommandMessage(input).status === 'valid'
}

/** 类型守卫让事件发送器在出站前进行最后一道受控校验。 */
export function isHostEventMessage(input: unknown): input is HostEventMessage {
  return validateHostEventMessage(input).status === 'valid'
}

/** 验证通用信封，并先做序列化大小检查以防止后续字段遍历处理超大对象。 */
function validateEnvelope<TType extends string>(input: unknown, allowedTypes: readonly TType[], direction: 'command' | 'event'): UnknownRecord | undefined {
  if (!isMessageWithinSizeLimit(input) || !isRecord(input)) return undefined
  if (input.channel !== HOST_PROTOCOL_CHANNEL || input.version !== HOST_PROTOCOL_VERSION) return undefined
  if (!isOpaqueIdentifier(input.instanceId) || !isOpaqueIdentifier(input.sessionId) || !isOpaqueIdentifier(input.messageId)) return undefined
  if (input.replyTo !== undefined && !isOpaqueIdentifier(input.replyTo)) return undefined
  if (direction === 'command' && input.replyTo !== undefined) return undefined
  if (!allowedTypes.includes(input.type as TType) || !isTimestamp(input.timestamp) || !Object.hasOwn(input, 'payload')) return undefined
  return input
}

/** 字符串标识同时满足稳定格式和 128 字符上限，避免日志或缓存键被无限放大。 */
function isOpaqueIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= HOST_PROTOCOL_LIMITS.identifierLength && validateStableIdentifier(value).length === 0
}

/** 标准业务标识与外层信封标识共用严格格式，不允许标题、路径或资源文件名进入协议。 */
function isStableIdentifier(value: unknown): value is string {
  return isOpaqueIdentifier(value)
}

/** 普通版本与设备类型等显示字段也有长度限制，但不要求它们符合业务标识格式。 */
function isBoundedString(value: unknown, maximumLength: number = HOST_PROTOCOL_LIMITS.stringLength): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength
}

/** 上下文和来源版本只能使用安全整数，负数、浮点和无穷值都不能进入协调器。 */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** 时间戳仅用于诊断和过期判断，仍要求是正的安全整数。 */
function isTimestamp(value: unknown): value is number {
  return isNonNegativeInteger(value)
}

/** JSON 序列化失败或超过 256 KiB 的消息立即拒绝，且不会把原始内容写入诊断。 */
function isMessageWithinSizeLimit(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' && new TextEncoder().encode(serialized).byteLength <= HOST_PROTOCOL_LIMITS.messageBytes
  } catch {
    return false
  }
}

/** 普通记录守卫拒绝数组、空值和原型不明对象，避免把函数或容器误当作业务载荷。 */
function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype)
}

/** 初始化载荷校验场景、拓扑、可选动作和清单版本，所有关系校验留给后续协调器。 */
function isSystemInitPayload(value: unknown): value is SystemInitPayload {
  if (!isRecord(value) || !isSceneId(value.sceneId) || !isStableIdentifier(value.topologyId)) return false
  if (value.actionId !== undefined && value.actionId !== null && !isStableIdentifier(value.actionId)) return false
  return value.expectedManifestVersion === undefined || isBoundedString(value.expectedManifestVersion)
}

/** 直接打开载荷不允许额外资源字段；上下文版本若存在必须可安全比较。 */
function isViewOpenPayload(value: unknown): value is ViewOpenPayload {
  if (!isRecord(value) || !isSceneId(value.sceneId) || !isStableIdentifier(value.topologyId)) return false
  if (value.actionId !== undefined && value.actionId !== null && !isStableIdentifier(value.actionId)) return false
  return value.expectedContextRevision === undefined || isNonNegativeInteger(value.expectedContextRevision)
}

/** 动作参数使用一层标量字典，避免父页面构造深层对象绕过动作白名单。 */
function isWorkflowTriggerPayload(value: unknown): value is WorkflowTriggerPayload {
  if (!isRecord(value) || !isStableIdentifier(value.actionId)) return false
  if (value.expectedContextRevision !== undefined && !isNonNegativeInteger(value.expectedContextRevision)) return false
  if (value.parameters === undefined) return true
  if (!isRecord(value.parameters) || Object.keys(value.parameters).length > HOST_PROTOCOL_LIMITS.workflowParameters) return false

  return Object.entries(value.parameters).every(([key, parameter]) =>
    isStableIdentifier(key) && (parameter === null || typeof parameter === 'boolean' || (typeof parameter === 'number' && Number.isFinite(parameter)) || isBoundedString(parameter)),
  )
}

/** 批量设备状态拒绝空数组、超过 500 条记录、重复格式错误和无效 ISO 时间。 */
function isDeviceStatesUpdatePayload(value: unknown): value is DeviceStatesUpdatePayload {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length === 0 || value.items.length > HOST_PROTOCOL_LIMITS.deviceStateItems) return false
  if (value.sourceRevision !== undefined && !isNonNegativeInteger(value.sourceRevision)) return false
  return value.items.every(isDeviceStateUpdateItem)
}

/** 设备状态项仅允许协议定义的四态与有效时间字符串。 */
function isDeviceStateUpdateItem(value: unknown): value is DeviceStateUpdateItem {
  return isRecord(value) && isStableIdentifier(value.deviceId) && isDeviceVisualStatus(value.deviceStatus) && isIsoTimestamp(value.statusUpdatedAt)
}

/** 设备状态严格收敛为协议定义四态，不能把数据源的未知枚举直接传入画布或 Unity。 */
function isDeviceVisualStatus(value: unknown): value is DeviceVisualStatus {
  return value === 'normal' || value === 'alarm' || value === 'fault' || value === 'offline'
}

/** 状态查询不得夹带未定义字段，防止将查询命令变成任意对象透传入口。 */
function isStateGetPayload(value: unknown): value is StateGetPayload {
  return isRecord(value) && Object.keys(value).length === 0
}

/** 释放原因只接受短文本，不能作为传送完整异常或上下文对象的侧信道。 */
function isSystemDisposePayload(value: unknown): value is SystemDisposePayload {
  return isRecord(value) && (value.reason === undefined || isBoundedString(value.reason, HOST_PROTOCOL_LIMITS.descriptionLength))
}

/** ready 必须发布九个固定场景且命令、事件能力均来自协议白名单。 */
function isSystemReadyPayload(value: unknown): value is SystemReadyPayload {
  if (!isRecord(value) || !isBoundedString(value.manifestVersion)) return false
  const sceneIds = value.sceneIds
  if (!Array.isArray(sceneIds) || sceneIds.length !== SCENE_IDS.length || !sceneIds.every(isSceneId)) return false
  if (new Set(sceneIds).size !== SCENE_IDS.length || !SCENE_IDS.every((sceneId) => sceneIds.includes(sceneId))) return false
  return isCapabilityArray(value.commandCapabilities, HOST_COMMAND_TYPES) && isCapabilityArray(value.eventCapabilities, HOST_EVENT_TYPES)
}

/** 初始化确认的成功分支必须有上下文，失败分支必须有受控错误，杜绝半结构化响应。 */
function isSystemAcknowledgementPayload(value: unknown): value is SystemAcknowledgementPayload {
  if (!isRecord(value) || typeof value.success !== 'boolean') return false
  if (value.success) return isHostVisualizationContext(value.context) && (value.error === undefined || value.error === null)
  return value.context === undefined && isHostProtocolError(value.error)
}

/** 命令结果的成功状态与错误字段必须保持一致，避免父页面收到自相矛盾的响应。 */
function isCommandResultPayload(value: unknown): value is CommandResultPayload {
  if (!isRecord(value) || typeof value.success !== 'boolean' || !['completed', 'failed', 'superseded', 'disposed'].includes(String(value.status))) return false
  if (value.transitionId !== undefined && !isStableIdentifier(value.transitionId)) return false
  if (value.contextRevision !== undefined && !isNonNegativeInteger(value.contextRevision)) return false
  if (value.success) return value.status === 'completed' || value.status === 'disposed' ? value.error === null : false
  return (value.status === 'failed' || value.status === 'superseded') && isHostProtocolError(value.error)
}

/** 视图变更必须引用固定场景和稳定拓扑，动作可明确为空。 */
function isViewChangedPayload(value: unknown): value is ViewChangedPayload {
  return isRecord(value) && isSceneId(value.sceneId) && isStableIdentifier(value.topologyId) && (value.actionId === null || isStableIdentifier(value.actionId)) && isNonNegativeInteger(value.contextRevision) && (value.transitionId === undefined || isStableIdentifier(value.transitionId))
}

/** 双击事件必须携带 deviceId；可选三维节点和设备类型仍受长度与格式限制。 */
function isTopologyNodeDoubleClickPayload(value: unknown): value is TopologyNodeDoubleClickPayload {
  return isRecord(value) && isSceneId(value.sceneId) && isStableIdentifier(value.topologyId) && isStableIdentifier(value.nodeId) && isStableIdentifier(value.deviceId) && (value.sceneNodeId === undefined || isStableIdentifier(value.sceneNodeId)) && (value.deviceType === undefined || isBoundedString(value.deviceType)) && isNonNegativeInteger(value.contextRevision) && isOpaqueIdentifier(value.correlationId)
}

/** 三维选择最多回传 64 个二维节点，避免异常映射输出无界选择集合。 */
function isSceneObjectSelectedPayload(value: unknown): value is SceneObjectSelectedPayload {
  return isRecord(value) && isSceneId(value.sceneId) && isStableIdentifier(value.sceneNodeId) && (value.deviceId === undefined || isStableIdentifier(value.deviceId)) && (value.topologyId === undefined || isStableIdentifier(value.topologyId)) && Array.isArray(value.nodeIds) && value.nodeIds.length <= HOST_PROTOCOL_LIMITS.selectionNodeIds && value.nodeIds.every(isStableIdentifier) && isNonNegativeInteger(value.contextRevision) && isOpaqueIdentifier(value.correlationId)
}

/** 状态快照仅回传受控上下文与有限运行状态，不能包含场景对象或设备原始状态。 */
function isStateSnapshotPayload(value: unknown): value is StateSnapshotPayload {
  return isRecord(value) && isBoundedString(value.manifestVersion) && isHostVisualizationContext(value.context) && ['idle', 'initializing', 'ready', 'failed', 'disposed'].includes(String(value.unityStatus)) && ['idle', 'preparing', 'ready', 'failed', 'disposed'].includes(String(value.topologyStatus))
}

/** 无法归属的系统错误仍必须使用受控 HostProtocolError（外层协议错误）结构。 */
function isSystemErrorPayload(value: unknown): value is SystemErrorPayload {
  return isRecord(value) && isHostProtocolError(value.error)
}

/** 稳定上下文不能省略场景、拓扑和版本；动作必须显式为空或稳定动作标识。 */
function isHostVisualizationContext(value: unknown): value is HostVisualizationContext {
  return isRecord(value) && isSceneId(value.sceneId) && isStableIdentifier(value.topologyId) && (value.actionId === null || isStableIdentifier(value.actionId)) && isNonNegativeInteger(value.contextRevision) && ['initializing', 'ready', 'error', 'released'].includes(String(value.status))
}

/** 错误校验只允许规范列出的代码与阶段，且可选关联字段都必须是稳定标识。 */
function isHostProtocolError(value: unknown): value is HostProtocolError {
  return isRecord(value) && isHostProtocolErrorCode(value.code) && isBoundedString(value.message, HOST_PROTOCOL_LIMITS.descriptionLength) && ['handshake', 'validation', 'preparing-topology', 'switching-scene', 'executing-action', 'activating-topology', 'disposing'].includes(String(value.stage)) && typeof value.recoverable === 'boolean' && (value.sceneId === undefined || isSceneId(value.sceneId)) && (value.topologyId === undefined || isStableIdentifier(value.topologyId)) && (value.actionId === undefined || isStableIdentifier(value.actionId)) && (value.transitionId === undefined || isStableIdentifier(value.transitionId))
}

/** 首版错误码集合集中在此处，避免桥接各处以任意字符串拼装错误。 */
function isHostProtocolErrorCode(value: unknown): value is HostProtocolErrorCode {
  return typeof value === 'string' && [
    // 未声明能力是协议规范定义的首版拒绝原因；必须与 HostProtocolErrorCode（外层协议错误码）保持一一对应，
    // 否则命令分派器返回的受控错误会在出站校验阶段被误判为无效载荷。
    'protocol.origin.rejected', 'protocol.source.rejected', 'protocol.envelope.invalid', 'protocol.payload.invalid', 'protocol.capability.undeclared', 'protocol.message.duplicate', 'protocol.capacity.exceeded', 'manifest.version.mismatch', 'scene.unknown', 'topology.unknown', 'topology.scene.mismatch', 'action.unknown', 'action.context.mismatch', 'context.revision.conflict', 'scene.switch.failed', 'action.execute.failed', 'topology.prepare.failed', 'topology.activate.failed', 'command.timeout', 'command.superseded', 'runtime.disposed',
  ].includes(value as HostProtocolErrorCode)
}

/** 能力数组去重并限制在白名单内；重复能力没有表达新增权限的意义。 */
function isCapabilityArray<TCapability extends string>(value: unknown, allowedCapabilities: readonly TCapability[]): value is readonly TCapability[] {
  return Array.isArray(value) && value.length <= allowedCapabilities.length && value.every((item) => typeof item === 'string' && allowedCapabilities.includes(item as TCapability)) && new Set(value).size === value.length
}

/** ISO 时间必须可被解析且不超长，防止状态更新缓存使用无效时间作为排序依据。 */
function isIsoTimestamp(value: unknown): value is string {
  return isBoundedString(value) && Number.isFinite(Date.parse(value))
}

/** 基础信封失败时按容量与结构分别返回稳定错误，不保留或展示原始消息。 */
function invalidResult(input: unknown): HostProtocolValidationResult<never> {
  return isMessageWithinSizeLimit(input) ? invalidEnvelopeResult() : {
    status: 'invalid',
    issues: [{ code: 'protocol.capacity.exceeded', message: '外层消息超过协议允许的最大体积。' }],
  }
}

/** 信封字段、通道、会话或消息类型无效时统一返回受控诊断。 */
function invalidEnvelopeResult(): HostProtocolValidationResult<never> {
  return { status: 'invalid', issues: [{ code: 'protocol.envelope.invalid', message: '外层消息信封、通道、版本、实例、会话或类型无效。' }] }
}

/** 具体命令或事件载荷无效时不返回未通过字段的原始值。 */
function invalidPayloadResult(): HostProtocolValidationResult<never> {
  return { status: 'invalid', issues: [{ code: 'protocol.payload.invalid', message: '外层消息载荷未通过对应类型的字段校验。' }] }
}

/**
 * 场景拓扑模块的稳定标识类型。
 * 每个标识都携带不可互换的品牌标记，避免调用方将二维节点和 Unity 三维节点
 * 误传到同一个接口；所有工厂函数同时执行运行时格式校验，不仅依赖编译期类型。
 */
declare const sceneTopologyIdentifierBrand: unique symbol

/** 使用品牌类型隔离不同领域标识，底层值仍保持可序列化字符串。 */
export type StableIdentifier<TKind extends string> = string & {
  readonly [sceneTopologyIdentifierBrand]: TKind
}

/** 九个业务场景是固定闭集，外部输入不能注册第十个场景或传入 Unity 文件名。 */
const sceneIdValues = [
  'coal-power',
  'gas-power',
  'wind-power',
  'solar-power',
  'substation',
  'distribution',
  'consumption',
  'microgrid',
  'dispatch',
] as const

/** 固定场景值与品牌共同保证原始字符串、错误场景和其他标识类型均不可直接替换。 */
export type SceneId = (typeof sceneIdValues)[number] & StableIdentifier<'scene'>
/** 平台总览是独立视图场景，不属于九项业务场景闭集，也不参与业务清单拓扑校验。 */
export type OverviewSceneId = 'overview' & StableIdentifier<'overview-scene'>
/** 所有可由 system.init/view.open 打开的场景联合；业务清单仍只接受 SceneId。 */
export type ViewSceneId = SceneId | OverviewSceneId
export type TopologyId = StableIdentifier<'topology'>
export type ActionId = StableIdentifier<'action'>
export type NodeId = StableIdentifier<'topology-node'>
export type SceneNodeId = StableIdentifier<'scene-node'>
/** 一次二维选择事务的稳定关联标识；它与场景切换事务、消息标识均不可互换。 */
export type SelectionId = StableIdentifier<'selection'>
export type SessionId = StableIdentifier<'session'>
export type TransitionId = StableIdentifier<'transition'>
/**
 * 物理场景激活标识与视图切换事务标识不能混用。
 * 同一场景的拓扑切换不会重建 Unity 场景，而失败恢复会重建旧场景；该标识只描述后者的真实实例。
 */
export type SceneActivationId = StableIdentifier<'scene-activation'>
export type ProcessId = StableIdentifier<'process'>
export type StepId = StableIdentifier<'step'>
export type RouteId = StableIdentifier<'route'>
export type UnitySceneKey = StableIdentifier<'unity-scene-key'>
export type UnityRuntimeKey = StableIdentifier<'unity-runtime-key'>

/** 固定平台总览标识独立导出，禁止调用方将其追加到 SCENE_IDS。 */
export const OVERVIEW_SCENE_ID = 'overview' as OverviewSceneId

/** 仅导出完成品牌转换的固定场景数组，组件不应自行复制或排序场景目录。 */
export const SCENE_IDS: readonly SceneId[] = sceneIdValues.map((value) => value as SceneId)

/** 业务标识允许的小写字符集；路径、空白、中文标题和资源文件后缀都不属于接口标识。 */
const stableIdentifierPattern = /^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/
const resourceFileSuffixPattern = /\.(?:png|jpe?g|webp|svg|fbx|gltf|glb|unity)$/i

/** 运行时校验错误提供稳定编码，发布校验和外部协议可据此返回结构化错误。 */
export interface IdentifierValidationIssue {
  code: 'identifier.empty' | 'identifier.format' | 'identifier.file-reference' | 'scene.unsupported'
  message: string
}

/**
 * 检查通用稳定标识的格式。
 * 验证失败不会返回原始不可信值，避免错误日志或状态页将外部完整载荷继续传播。
 */
export function validateStableIdentifier(value: unknown): readonly IdentifierValidationIssue[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [{ code: 'identifier.empty', message: '稳定业务标识不能为空。' }]
  }

  if (resourceFileSuffixPattern.test(value)) {
    return [{ code: 'identifier.file-reference', message: '稳定业务标识不能使用资源文件名。' }]
  }

  if (!stableIdentifierPattern.test(value)) {
    return [{ code: 'identifier.format', message: '稳定业务标识只能使用小写字母、数字、下划线、连字符和点号。' }]
  }

  return []
}

/**
 * 将已验证字符串转换为指定领域的品牌类型。
 * 此函数只服务非固定目录的标识；`sceneId` 必须通过 `toSceneId` 进入系统。
 */
function createStableIdentifier<TKind extends string>(kind: TKind, value: string): StableIdentifier<TKind> {
  const issues = validateStableIdentifier(value)

  if (issues.length > 0) {
    throw new Error(`${kind} 标识无效：${issues[0]?.message ?? '格式错误。'}`)
  }

  return value as StableIdentifier<TKind>
}

/** 仅接受固定九场景之一；禁止由标题、路径或模型名称推断场景标识。 */
export function toSceneId(value: string): SceneId {
  if (!sceneIdValues.includes(value as (typeof sceneIdValues)[number])) {
    throw new Error('场景标识不在固定九场景目录中。')
  }

  return value as SceneId
}

/** 用于不可信外部输入的非抛出式场景判断，成功后可安全窄化为品牌场景标识。 */
export function isSceneId(value: unknown): value is SceneId {
  return typeof value === 'string' && sceneIdValues.includes(value as (typeof sceneIdValues)[number])
}

/** 平台总览只接受唯一固定值，不能用标题、别名或业务场景标识替代。 */
export function isOverviewSceneId(value: unknown): value is OverviewSceneId {
  return value === OVERVIEW_SCENE_ID
}

/** system.init/view.open 与 Unity 场景事件共用的完整视图场景守卫。 */
export function isViewSceneId(value: unknown): value is ViewSceneId {
  return isSceneId(value) || isOverviewSceneId(value)
}

/** 在已验证的视图场景联合中收窄为九项业务场景，供需要拓扑清单的调用方使用。 */
export function isBusinessViewSceneId(value: ViewSceneId): value is SceneId {
  return isSceneId(value)
}

/** 将已验证的业务或平台总览字符串转换为视图场景标识。 */
export function toViewSceneId(value: string): ViewSceneId {
  if (isOverviewSceneId(value)) return OVERVIEW_SCENE_ID
  return toSceneId(value)
}

/** 以下工厂函数分别创建严格隔离的稳定标识。 */
export const toTopologyId = (value: string): TopologyId => createStableIdentifier('topology', value)
export const toActionId = (value: string): ActionId => createStableIdentifier('action', value)
export const toNodeId = (value: string): NodeId => createStableIdentifier('topology-node', value)
export const toSceneNodeId = (value: string): SceneNodeId => createStableIdentifier('scene-node', value)
export const toSelectionId = (value: string): SelectionId => createStableIdentifier('selection', value)
export const toSessionId = (value: string): SessionId => createStableIdentifier('session', value)
export const toTransitionId = (value: string): TransitionId => createStableIdentifier('transition', value)
export const toSceneActivationId = (value: string): SceneActivationId => createStableIdentifier('scene-activation', value)
export const toProcessId = (value: string): ProcessId => createStableIdentifier('process', value)
export const toStepId = (value: string): StepId => createStableIdentifier('step', value)
export const toRouteId = (value: string): RouteId => createStableIdentifier('route', value)
export const toUnitySceneKey = (value: string): UnitySceneKey => createStableIdentifier('unity-scene-key', value)
export const toUnityRuntimeKey = (value: string): UnityRuntimeKey => createStableIdentifier('unity-runtime-key', value)

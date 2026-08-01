/**
 * 工艺配置中的稳定业务标识。
 *
 * 标识只允许小写英文、数字、下划线、连字符和点号；中文标题、Unity 层级路径、
 * 图片或模型文件名均不能通过该校验，从类型和运行时两个层面阻止它们进入接口参数。
 */
declare const stableIdentifierBrand: unique symbol

/** 为不同业务对象保留不可互换的类型标记，避免把页面标识误传给节点或运行时。 */
export type StableIdentifier<TKind extends string> = string & {
  readonly [stableIdentifierBrand]: TKind
}

export type ProcessPageId = StableIdentifier<'process-page'>
export type ProcessDomainId = StableIdentifier<'process-domain'>
export type ProcessId = StableIdentifier<'process'>
export type ProcessStepId = StableIdentifier<'process-step'>
export type ProcessNodeId = StableIdentifier<'process-node'>
export type TopologyKey = StableIdentifier<'topology'>
export type GuideKey = StableIdentifier<'guide'>
export type DetailKey = StableIdentifier<'detail'>
export type RuntimeKey = StableIdentifier<'runtime'>
export type RouteId = StableIdentifier<'route'>
export type PermissionCode = StableIdentifier<'permission'>
export type MetricKey = StableIdentifier<'metric'>
export type TopicId = StableIdentifier<'topic'>
export type DetailBlockId = StableIdentifier<'detail-block'>

/** 统一的运行时校验错误，便于配置发布工具直接定位问题字段。 */
export interface IdentifierValidationIssue {
  code: 'identifier.empty' | 'identifier.format' | 'identifier.file-reference'
  value: unknown
  message: string
}

/** 稳定标识允许以英文开头的点号或连字符分段，不允许空格、路径分隔符或中文。 */
const stableIdentifierPattern = /^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/

/** 这些后缀通常是资源名；即使格式满足标识规则，也必须拒绝作为业务接口参数。 */
const resourceFileSuffixPattern = /\.(?:png|jpe?g|webp|svg|fbx|gltf|glb|unity)$/i

/** 返回单个标识的校验问题；合法时返回空数组，方便批量发布校验复用。 */
export function validateStableIdentifier(value: unknown): IdentifierValidationIssue[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [{ code: 'identifier.empty', value, message: '稳定业务标识不能为空。' }]
  }

  if (resourceFileSuffixPattern.test(value)) {
    return [{ code: 'identifier.file-reference', value, message: '稳定业务标识不能使用图片或模型资源文件名。' }]
  }

  if (!stableIdentifierPattern.test(value)) {
    return [
      {
        code: 'identifier.format',
        value,
        message: '稳定业务标识只能使用小写英文、数字、下划线、连字符和点号，且不能包含路径或中文标题。',
      },
    ]
  }

  return []
}

/**
 * 将已校验的字符串提升为带业务类别的稳定标识。
 * 配置模块加载期立即失败，可防止错误标识在路由、拓扑或三维消息之间继续传播。
 */
export function createStableIdentifier<TKind extends string>(kind: TKind, value: string): StableIdentifier<TKind> {
  const issues = validateStableIdentifier(value)

  if (issues.length > 0) {
    throw new Error(`${kind} 标识无效：${issues[0]?.message ?? value}`)
  }

  return value as StableIdentifier<TKind>
}

/** 以下工厂函数让配置声明保持简洁，同时保留各业务 ID 之间的类型隔离。 */
export const toProcessPageId = (value: string): ProcessPageId => createStableIdentifier('process-page', value)
export const toProcessDomainId = (value: string): ProcessDomainId => createStableIdentifier('process-domain', value)
export const toProcessId = (value: string): ProcessId => createStableIdentifier('process', value)
export const toProcessStepId = (value: string): ProcessStepId => createStableIdentifier('process-step', value)
export const toProcessNodeId = (value: string): ProcessNodeId => createStableIdentifier('process-node', value)
export const toTopologyKey = (value: string): TopologyKey => createStableIdentifier('topology', value)
export const toGuideKey = (value: string): GuideKey => createStableIdentifier('guide', value)
export const toDetailKey = (value: string): DetailKey => createStableIdentifier('detail', value)
export const toRuntimeKey = (value: string): RuntimeKey => createStableIdentifier('runtime', value)
export const toRouteId = (value: string): RouteId => createStableIdentifier('route', value)
export const toPermissionCode = (value: string): PermissionCode => createStableIdentifier('permission', value)
export const toMetricKey = (value: string): MetricKey => createStableIdentifier('metric', value)
export const toTopicId = (value: string): TopicId => createStableIdentifier('topic', value)
export const toDetailBlockId = (value: string): DetailBlockId => createStableIdentifier('detail-block', value)

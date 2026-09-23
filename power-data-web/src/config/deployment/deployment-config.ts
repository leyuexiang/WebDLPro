/**
 * 部署配置只保存可公开的地址和尺寸边界，不保存访问令牌、密码或任何业务消息内容。
 *
 * 独立服务包支持固定来源和运行时同源来源两种模式。运行时模式不要求构建时知道服务器
 * IP，而是由当前网页来源派生 Unity 与结构清单地址，由 iframe 查询参数提供平台父来源。
 * `0.0.0.0` 只属于服务监听地址，绝不会进入浏览器地址或 postMessage 目标来源。
 */
export const RUNTIME_SELF_ORIGIN = '__RUNTIME_SELF_ORIGIN__'
export const RUNTIME_PARENT_ORIGIN = '__RUNTIME_PARENT_ORIGIN__'

export type DeploymentAddressMode = 'fixed-origin' | 'runtime-self-origin'

/** 运行时地址来源由浏览器环境注入，测试可传入纯数据而不依赖真实 window。 */
export interface DeploymentRuntimeContext {
  selfOrigin?: string
  parentOrigin?: string
}

export interface DeploymentConfiguration {
  /** 外层宿主页的精确来源，仅用于 power-scene-topology-shell（外层协议）安全边界。 */
  parentOrigin: string
  /** 嵌入壳自身的精确来源，是 Unity iframe 的直接父页面来源，不能与外层宿主页混用。 */
  unityParentOrigin: string
  unityEntryUrl: string
  unityChildOrigin: string
  manifestUrl: string
  minimumViewportWidth: number
  minimumViewportHeight: number
  /** 地址是否由构建配置固定，或在当前 iframe 页面运行时派生。 */
  addressMode: DeploymentAddressMode
}

/** 配置问题不包含原始环境变量值，避免将部署细节显示给最终用户。 */
export interface DeploymentConfigurationIssue {
  code: 'deployment.parent-origin' | 'deployment.unity-parent-origin' | 'deployment.unity-entry' | 'deployment.manifest-url' | 'deployment.minimum-viewport'
  message: string
}

/** 读取结果将可用配置和失败原因分开，调用方只能在 ready 时启动运行时。 */
export interface DeploymentConfigurationLoadResult {
  status: 'ready' | 'invalid'
  configuration?: DeploymentConfiguration
  issues: readonly DeploymentConfigurationIssue[]
}

/** 测试可传入最小环境对象；生产代码默认读取 Vite（快速构建工具）暴露的构建环境。 */
export type DeploymentEnvironment = Readonly<Record<string, string | boolean | undefined>>

/**
 * 读取并校验部署配置。
 *
 * 固定来源模式仍要求显式地址；运行时同源模式只接受当前页面精确来源、固定 Unity 路径、
 * 固定结构清单路径和 iframe 查询参数中的精确父来源，不能从监听地址猜测浏览器来源。
 */
export function readDeploymentConfiguration(
  environment: DeploymentEnvironment = import.meta.env,
  runtimeContext: DeploymentRuntimeContext = readBrowserRuntimeContext(),
): DeploymentConfigurationLoadResult {
  const issues: DeploymentConfigurationIssue[] = []
  const runtimeSelfOrigin = resolveRuntimeOrigin(environment.VITE_POWER_UNITY_PARENT_ORIGIN, runtimeContext.selfOrigin)
  const runtimeParentOrigin = resolveRuntimeOrigin(environment.VITE_POWER_PARENT_ORIGIN, runtimeContext.parentOrigin)
  const addressMode: DeploymentAddressMode = hasRuntimeAddressMarker(environment) ? 'runtime-self-origin' : 'fixed-origin'
  // 独立打开时没有父页面查询参数，运行时模式允许把当前页面来源作为本地回环父源；
  // 此时不会创建外层桥，只有带完整参数的 iframe 嵌入才进入 postMessage（跨窗口消息）会话。
  const effectiveParentOrigin = runtimeParentOrigin ?? (addressMode === 'runtime-self-origin' ? runtimeContext.selfOrigin : undefined)
  const parentOrigin = readExactOrigin(effectiveParentOrigin, 'deployment.parent-origin', '父页面来源必须是精确的 HTTP(S) 来源。', issues)
  // Unity iframe 的直接 parent 是当前嵌入壳，而不是再上一层业务宿主页；两者跨域部署时尤其不能复用。
  const unityParentOrigin = readExactOrigin(runtimeSelfOrigin, 'deployment.unity-parent-origin', 'Unity 直接父页面来源必须是精确的 HTTP(S) 来源。', issues)
  const unityEntryUrl = readHttpUrl(
    resolveRuntimeUrl(environment.VITE_POWER_UNITY_ENTRY_URL, '/unity/index.html', runtimeContext.selfOrigin),
    'deployment.unity-entry',
    'Unity 子页入口必须是有效的 HTTP(S) 地址。',
    issues,
  )
  const manifestUrl = readHttpUrl(
    resolveRuntimeUrl(environment.VITE_POWER_MANIFEST_URL, '/scene-topology-manifest.json', runtimeContext.selfOrigin),
    'deployment.manifest-url',
    '场景拓扑清单地址必须是有效的 HTTP(S) 地址。',
    issues,
  )
  const minimumViewportWidth = readPositiveInteger(environment.VITE_POWER_MINIMUM_VIEWPORT_WIDTH, 'deployment.minimum-viewport', '最小容器宽高必须是正整数。', issues)
  const minimumViewportHeight = readPositiveInteger(environment.VITE_POWER_MINIMUM_VIEWPORT_HEIGHT, 'deployment.minimum-viewport', '最小容器宽高必须是正整数。', issues)

  if (!parentOrigin || !unityParentOrigin || !unityEntryUrl || !manifestUrl || !minimumViewportWidth || !minimumViewportHeight) {
    return { status: 'invalid', issues }
  }

  return {
    status: 'ready',
    configuration: {
      parentOrigin,
      unityParentOrigin,
      unityEntryUrl,
      unityChildOrigin: new URL(unityEntryUrl).origin,
      manifestUrl,
      minimumViewportWidth,
      minimumViewportHeight,
      addressMode,
    },
    issues,
  }
}

/** 浏览器运行时默认读取当前页面和平台传入的父来源；Node 测试可显式注入同样的纯数据。 */
function readBrowserRuntimeContext(): DeploymentRuntimeContext {
  if (typeof window === 'undefined') return {}

  return {
    selfOrigin: window.location.origin,
    parentOrigin: new URLSearchParams(window.location.search).get('parentOrigin') ?? undefined,
  }
}

/** 只有发布脚本明确注入哨兵时才进入运行时同源模式，避免空环境意外降级成宽松地址。 */
function hasRuntimeAddressMarker(environment: DeploymentEnvironment): boolean {
  return [
    environment.VITE_POWER_PARENT_ORIGIN,
    environment.VITE_POWER_UNITY_PARENT_ORIGIN,
    environment.VITE_POWER_UNITY_ENTRY_URL,
    environment.VITE_POWER_MANIFEST_URL,
  ].some((value) => typeof value === 'string' && value.includes('__RUNTIME_'))
}

/** 将地址哨兵解析为运行时注入值；固定地址原样返回，缺失值仍由统一校验报告。 */
function resolveRuntimeOrigin(value: string | boolean | undefined, runtimeOrigin: string | undefined): string | boolean | undefined {
  if (value === RUNTIME_SELF_ORIGIN || value === RUNTIME_PARENT_ORIGIN) return runtimeOrigin
  return value
}

/** 将同源哨兵派生为固定路径 URL，禁止把任意查询参数或外部来源带入清单和 Unity。 */
function resolveRuntimeUrl(value: string | boolean | undefined, pathname: string, selfOrigin: string | undefined): string | boolean | undefined {
  if (value === RUNTIME_SELF_ORIGIN || value === `${RUNTIME_SELF_ORIGIN}${pathname}`) {
    if (!selfOrigin) return undefined
    try {
      const originUrl = new URL(selfOrigin)
      if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') return undefined
      return new URL(pathname, originUrl.origin).href
    } catch {
      return undefined
    }
  }
  return value
}

/** 仅接受浏览器可安全用于 postMessage（跨窗口消息）的精确 HTTP(S) 来源。 */
function readExactOrigin(
  value: string | boolean | undefined,
  code: DeploymentConfigurationIssue['code'],
  message: string,
  issues: DeploymentConfigurationIssue[],
): string | undefined {
  const url = parseHttpUrl(value)
  if (!url || url.origin !== String(value)) {
    issues.push({ code, message })
    return undefined
  }

  return url.origin
}

/** 入口和清单允许包含路径与查询参数，但必须使用 HTTP(S) 协议。 */
function readHttpUrl(
  value: string | boolean | undefined,
  code: DeploymentConfigurationIssue['code'],
  message: string,
  issues: DeploymentConfigurationIssue[],
): string | undefined {
  const url = parseHttpUrl(value)
  if (!url) {
    issues.push({ code, message })
    return undefined
  }

  return url.toString()
}

/** 容器下限来自部署参数而非组件猜测，避免不同父页面把推荐尺寸误当成固定像素。 */
function readPositiveInteger(
  value: string | boolean | undefined,
  code: DeploymentConfigurationIssue['code'],
  message: string,
  issues: DeploymentConfigurationIssue[],
): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    if (!issues.some((issue) => issue.code === code)) issues.push({ code, message })
    return undefined
  }

  return parsed
}

/** 统一拒绝非字符串、非 HTTP(S) 和无法解析的地址。 */
function parseHttpUrl(value: string | boolean | undefined): URL | undefined {
  if (typeof value !== 'string') return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

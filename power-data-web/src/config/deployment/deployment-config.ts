/**
 * 部署配置只保存可公开的地址和尺寸边界，不保存访问令牌、密码或任何业务消息内容。
 * 正式环境必须在构建时显式注入这些字段；缺失时返回稳定错误码并阻止 iframe 创建。
 */
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
 * 开发与生产环境都必须显式提供地址；读取器没有任何本机端口回退，
 * 因而发布产物不会包含本地端口，也不会在部署遗漏时意外请求错误的 Unity 地址。
 */
export function readDeploymentConfiguration(environment: DeploymentEnvironment = import.meta.env): DeploymentConfigurationLoadResult {
  const issues: DeploymentConfigurationIssue[] = []
  const parentOrigin = readExactOrigin(environment.VITE_POWER_PARENT_ORIGIN, 'deployment.parent-origin', '父页面来源必须是精确的 HTTP(S) 来源。', issues)
  // Unity iframe 的直接 parent 是当前嵌入壳，而不是再上一层业务宿主页；两者跨域部署时尤其不能复用。
  const unityParentOrigin = readExactOrigin(environment.VITE_POWER_UNITY_PARENT_ORIGIN, 'deployment.unity-parent-origin', 'Unity 直接父页面来源必须是精确的 HTTP(S) 来源。', issues)
  const unityEntryUrl = readHttpUrl(environment.VITE_POWER_UNITY_ENTRY_URL, 'deployment.unity-entry', 'Unity 子页入口必须是有效的 HTTP(S) 地址。', issues)
  const manifestUrl = readHttpUrl(environment.VITE_POWER_MANIFEST_URL, 'deployment.manifest-url', '场景拓扑清单地址必须是有效的 HTTP(S) 地址。', issues)
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
    },
    issues,
  }
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

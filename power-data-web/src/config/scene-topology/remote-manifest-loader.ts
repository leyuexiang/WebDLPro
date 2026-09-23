import { SceneTopologyManifestLoader } from '@/config/scene-topology/loader'
import type { SceneTopologyManifest, SceneTopologyManifestValidationIssue } from '@/config/scene-topology/types'

/** 清单请求采用有限等待时间，避免部署地址失效时让嵌入壳永久停留在初始化态。 */
export const SCENE_TOPOLOGY_MANIFEST_TIMEOUT_MS = 10_000

/** 将浏览器请求能力收窄为本模块实际需要的方法，便于单元测试注入受控实现。 */
export interface SceneTopologyManifestFetch {
  (input: string, init: Readonly<{
    signal: AbortSignal
    credentials: 'omit'
    /** 结构清单可能随不可变发布版本切换，客户端不得跨发布复用旧响应。 */
    cache: 'no-store'
    headers: Readonly<Record<string, string>>
  }>): Promise<{
    ok: boolean
    /** Fetch（浏览器请求）响应状态码，用于区分合作方约定的两类404。 */
    status: number
    /** 只读取合作方已约定的缓存策略响应头，不保留其他响应头或服务端诊断内容。 */
    headers: Readonly<Pick<Headers, 'get'>>
    json(): Promise<unknown>
  }>
}

/** 远程清单失败只暴露固定诊断码，不包含地址、响应正文或底层异常。 */
export type SceneTopologyManifestRequestFailureCode =
  | 'manifest.http-status'
  | 'manifest.package-not-found'
  | 'manifest.file-missing'
  | 'manifest.payload'
  | 'manifest.timeout'
  | 'manifest.aborted'
  | 'manifest.network'
  | 'manifest.cache-policy'
  | 'manifest.invalid'

/** 请求结果区分已校验清单和有限失败信息，调用方不能把未知输入继续交给运行时。 */
export type SceneTopologyManifestRequestResult =
  | { status: 'ready'; manifest: SceneTopologyManifest; issues: readonly [] }
  | { status: 'failed'; code: SceneTopologyManifestRequestFailureCode; issues: readonly SceneTopologyManifestValidationIssue[] }

/**
 * 从部署清单地址读取一次原子场景拓扑清单。
 * 每次调用均创建独立取消控制器；调用方取消、页面卸载和本地超时会合并到同一信号，
 * 因而不会遗留网络请求、计时器或跨页面回调。请求不携带凭据，避免当前子应用把宿主会话
 * 无意转发给清单服务。
 */
export class RemoteSceneTopologyManifestLoader {
  public constructor(
    private readonly fetchManifest: SceneTopologyManifestFetch = globalThis.fetch.bind(globalThis) as SceneTopologyManifestFetch,
    private readonly timeoutMs: number = SCENE_TOPOLOGY_MANIFEST_TIMEOUT_MS,
  ) {}

  /** 读取、解析并校验清单；任何网络或内容失败都转换为固定失败码。 */
  public async load(url: string, externalSignal?: AbortSignal): Promise<SceneTopologyManifestRequestResult> {
    const controller = new AbortController()
    let timedOut = false
    const abortFromExternalSignal = (): void => controller.abort()
    externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true })
    const timeoutId = globalThis.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timeoutMs)

    try {
      const response = await this.fetchManifest(url, {
        signal: controller.signal,
        credentials: 'omit',
        // 服务端仍必须返回 Cache-Control: no-cache；客户端同时禁用缓存，避免旧结构在发布切换边界被浏览器复用。
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) {
        if (response.status === 404) {
          const notFoundCode = await readNotFoundFailureCode(response)
          if (notFoundCode) return { status: 'failed', code: notFoundCode, issues: [] }
        }
        return { status: 'failed', code: 'manifest.http-status', issues: [] }
      }
      // 清单版本随包原子发布，仍验证响应禁止缓存，避免浏览器在壳重载时保留旧结构事实。
      if (!hasNoCacheDirective(response.headers.get('cache-control'))) {
        return { status: 'failed', code: 'manifest.cache-policy', issues: [] }
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        return { status: 'failed', code: 'manifest.payload', issues: [] }
      }

      // 壳只消费我方不可变结构清单；平台真实设备绑定不会进入该响应或改变清单版本。
      const result = new SceneTopologyManifestLoader().load(payload)
      if (result.status === 'invalid' || !result.manifest) return { status: 'failed', code: 'manifest.invalid', issues: result.issues }
      return { status: 'ready', manifest: result.manifest, issues: [] }
    } catch {
      if (timedOut) return { status: 'failed', code: 'manifest.timeout', issues: [] }
      if (externalSignal?.aborted || controller.signal.aborted) return { status: 'failed', code: 'manifest.aborted', issues: [] }
      return { status: 'failed', code: 'manifest.network', issues: [] }
    } finally {
      globalThis.clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', abortFromExternalSignal)
    }
  }
}

/**
 * 缓存指令按 HTTP（超文本传输协议）令牌规则比较：名称和分隔空白不敏感，
 * 但必须存在明确的 no-cache（禁止缓存）令牌，不能以 no-store（不存储）等其他策略替代合作方契约。
 */
function hasNoCacheDirective(cacheControl: string | null): boolean {
  return cacheControl?.split(',').some((directive) => directive.trim().toLowerCase() === 'no-cache') ?? false
}

/**
 * 仅识别合作方约定的两个固定404错误标识；读取失败、未知值和额外字段均回退为通用HTTP错误。
 * 响应正文不会进入结果、诊断或日志，避免把平台内部路径和实现细节泄露到嵌入壳。
 */
async function readNotFoundFailureCode(response: { json(): Promise<unknown> }): Promise<'manifest.package-not-found' | 'manifest.file-missing' | undefined> {
  try {
    const payload = await response.json()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
    const error = (payload as Record<string, unknown>).error
    if (error === 'package not found') return 'manifest.package-not-found'
    if (error === 'manifest file missing') return 'manifest.file-missing'
  } catch {
    // 非JSON 404只保留通用状态码，不把原始正文或解析异常交给调用方。
  }
  return undefined
}

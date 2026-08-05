import { SceneTopologyManifestLoader } from '@/config/scene-topology/loader'
import type { SceneTopologyManifest, SceneTopologyManifestValidationIssue } from '@/config/scene-topology/types'

/** 清单请求采用有限等待时间，避免部署地址失效时让嵌入壳永久停留在初始化态。 */
export const SCENE_TOPOLOGY_MANIFEST_TIMEOUT_MS = 10_000

/** 将浏览器请求能力收窄为本模块实际需要的方法，便于单元测试注入受控实现。 */
export interface SceneTopologyManifestFetch {
  (input: string, init: Readonly<{ signal: AbortSignal; credentials: 'omit'; headers: Readonly<Record<string, string>> }>): Promise<{
    ok: boolean
    json(): Promise<unknown>
  }>
}

/** 远程清单失败只暴露固定诊断码，不包含地址、响应正文或底层异常。 */
export type SceneTopologyManifestRequestFailureCode =
  | 'manifest.http-status'
  | 'manifest.payload'
  | 'manifest.timeout'
  | 'manifest.aborted'
  | 'manifest.network'
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
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return { status: 'failed', code: 'manifest.http-status', issues: [] }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        return { status: 'failed', code: 'manifest.payload', issues: [] }
      }

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

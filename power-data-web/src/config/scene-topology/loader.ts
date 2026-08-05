import { validateSceneTopologyManifest } from '@/config/scene-topology/validator'
import type { SceneTopologyManifest, SceneTopologyManifestLoadResult } from '@/config/scene-topology/types'

/**
 * 原子清单加载器只缓存最后一次通过校验的只读快照。
 * 无效更新不会覆盖已验证结果，避免父页面在发布竞争期间读取半份新清单；任务-006接入远程来源时
 * 只需替换数据获取层，仍可复用本加载器的本地校验与有限缓存边界。
 */
export class SceneTopologyManifestLoader {
  private lastValidManifest: SceneTopologyManifest | undefined

  /** 加载外部输入；无论成功或失败都返回结构化结果，不抛出原始载荷或网络异常。 */
  public load(input: unknown): SceneTopologyManifestLoadResult {
    const issues = validateSceneTopologyManifest(input)
    if (issues.length > 0) return { status: 'invalid', issues }

    const manifest = input as SceneTopologyManifest
    this.lastValidManifest = manifest
    return { status: 'ready', manifest, issues: [] }
  }

  /** 返回最近一次验证成功的清单，不生成可写副本或无界版本历史。 */
  public getLastValidManifest(): SceneTopologyManifest | undefined {
    return this.lastValidManifest
  }

  /** 子应用释放时主动清空缓存，避免已销毁实例继续保留旧发布版本。 */
  public dispose(): void {
    this.lastValidManifest = undefined
  }
}

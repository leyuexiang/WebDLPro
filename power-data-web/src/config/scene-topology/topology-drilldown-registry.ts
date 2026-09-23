import type { TopologyDrilldownContent } from '@/config/scene-topology/types'

/** 说明内容总量远小于正式拓扑；固定容量阻止未来远程清单把只读索引无界扩大。 */
export const MAX_TOPOLOGY_DRILLDOWN_CONTENT_COUNT = 64

export type TopologyDrilldownLookupResult =
  | { status: 'ready'; content: TopologyDrilldownContent }
  | { status: 'missing' }
  | { status: 'version-mismatch' }

/**
 * 只读说明内容索引按“内容键 + 版本”建立一次，打开、悬浮和缩放期间均为常数时间查询。
 * 它不持有组件、画布、三维引擎或外层消息引用，随结构注册表一起释放即可。
 */
export class TopologyDrilldownRegistry {
  private readonly contentByVersionedKey: ReadonlyMap<string, TopologyDrilldownContent>
  private readonly versionsByContentKey: ReadonlyMap<string, ReadonlySet<string>>

  public constructor(contents: readonly TopologyDrilldownContent[]) {
    if (contents.length > MAX_TOPOLOGY_DRILLDOWN_CONTENT_COUNT) {
      throw new Error('下钻说明内容数量超过固定容量。')
    }

    const contentByVersionedKey = new Map<string, TopologyDrilldownContent>()
    const mutableVersionsByContentKey = new Map<string, Set<string>>()
    for (const content of contents) {
      contentByVersionedKey.set(this.createVersionedKey(content.contentKey, content.version), content)
      const versions = mutableVersionsByContentKey.get(content.contentKey) ?? new Set<string>()
      versions.add(content.version)
      mutableVersionsByContentKey.set(content.contentKey, versions)
    }
    this.contentByVersionedKey = contentByVersionedKey
    this.versionsByContentKey = mutableVersionsByContentKey
  }

  /** 缺失和版本不匹配使用不同固定状态，调用方不得回退到相似标题或旧版本内容。 */
  public get(contentKey: string, version: string): TopologyDrilldownLookupResult {
    const content = this.contentByVersionedKey.get(this.createVersionedKey(contentKey, version))
    if (content) return { status: 'ready', content }
    return this.versionsByContentKey.has(contentKey) ? { status: 'version-mismatch' } : { status: 'missing' }
  }

  public get size(): number {
    return this.contentByVersionedKey.size
  }

  /** 复合键只拼接已通过清单门禁的稳定内容键和同版本字符串，不用于文件路径或网络请求。 */
  private createVersionedKey(contentKey: string, version: string): string {
    return `${contentKey}\u0000${version}`
  }
}

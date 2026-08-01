import type { RuntimeKey } from '@/config/process/identifiers'
import { localWebglRuntimeRegistry, type ReadonlyWebglRuntimeRegistry } from '@/config/process/runtime-registry'
import type {
  DetailDefinition,
  ProcessConfigLoadResult,
  ProcessDomainDefinition,
  ProcessGuideDefinition,
  ProcessPageDefinition,
  SceneMappingDefinition,
  TopologyDefinition,
} from '@/config/process/types'
import { validateProcessConfiguration } from '@/config/process/validator'

/** 本地配置集合仅承载声明数据；加载器按页面键查询，绝不预取其他工艺页的资源。 */
export interface ProcessConfigDataset {
  domains: readonly ProcessDomainDefinition[]
  pages: readonly ProcessPageDefinition[]
  topologies: readonly TopologyDefinition[]
  guides: readonly ProcessGuideDefinition[]
  details: readonly DetailDefinition[]
  sceneMappings: readonly SceneMappingDefinition[]
}

/**
 * 工艺配置原子加载器。
 * 每次仅汇集当前页面的五类配置及其受控运行时，再做统一校验；任何缺失或版本冲突都会
 * 将网页图形模式降级，二维拓扑和导览仍可继续工作。
 */
export class ProcessConfigLoader {
  private readonly pageById: ReadonlyMap<string, ProcessPageDefinition>
  private readonly topologyByKey: ReadonlyMap<string, TopologyDefinition>
  private readonly guideByKey: ReadonlyMap<string, ProcessGuideDefinition>
  private readonly detailByKey: ReadonlyMap<string, DetailDefinition>
  private readonly sceneMappingByProcessId: ReadonlyMap<string, SceneMappingDefinition>
  private readonly cachedResults = new Map<string, ProcessConfigLoadResult>()

  public constructor(
    private readonly dataset: ProcessConfigDataset,
    private readonly runtimeRegistry: ReadonlyWebglRuntimeRegistry = localWebglRuntimeRegistry,
  ) {
    this.pageById = new Map(dataset.pages.map((page) => [page.processPageId, page]))
    this.topologyByKey = new Map(dataset.topologies.map((topology) => [topology.topologyKey, topology]))
    this.guideByKey = new Map(dataset.guides.map((guide) => [guide.guideKey, guide]))
    this.detailByKey = new Map(dataset.details.map((detail) => [detail.detailKey, detail]))
    this.sceneMappingByProcessId = new Map(dataset.sceneMappings.map((mapping) => [mapping.processId, mapping]))
  }

  /** 获取单页定义，供路由守卫以常数时间检查路由存在性与页面权限。 */
  public getPage(processPageId: string): ProcessPageDefinition | undefined {
    return this.pageById.get(processPageId)
  }

  /** 返回导航顺序已声明的工艺域；调用端无需再次排序或硬编码域列表。 */
  public listDomains(): readonly ProcessDomainDefinition[] {
    return this.dataset.domains
  }

  /** 当前页的配置结果按“页面 ID + 发布版本”缓存，配置版本改变时自然生成新快照。 */
  public load(processPageId: string): ProcessConfigLoadResult {
    const page = this.pageById.get(processPageId)

    if (!page) {
      return { status: 'missing', effectiveRuntimeMode: 'empty', issues: [{ code: 'page.missing', message: '未找到对应的工艺页面配置。' }] }
    }

    const cacheKey = `${page.processPageId}:${page.configVersion}`
    const cachedResult = this.cachedResults.get(cacheKey)

    if (cachedResult) {
      return cachedResult
    }

    const topology = this.topologyByKey.get(page.topologyKey)
    const guide = this.guideByKey.get(page.guideKey)
    const details = this.detailByKey.get(page.detailKey)
    const sceneMapping = this.sceneMappingByProcessId.get(page.processId)

    if (!topology || !guide || !details || !sceneMapping) {
      const result: ProcessConfigLoadResult = {
        status: 'missing',
        effectiveRuntimeMode: page.runtimeFallbackMode,
        issues: [{ code: 'config.atom-missing', message: '页面依赖的拓扑、导览、详情或场景映射配置不完整。' }],
      }
      this.cachedResults.set(cacheKey, result)
      return result
    }

    const runtime = page.runtimeKey ? this.runtimeRegistry.get(page.runtimeKey as RuntimeKey) : undefined
    const bundle = { page, topology, guide, details, sceneMapping, runtime }
    const issues = validateProcessConfiguration(bundle)
    const hasBlockingIssue = issues.length > 0
    const result: ProcessConfigLoadResult = {
      status: hasBlockingIssue ? 'degraded' : 'ready',
      effectiveRuntimeMode: hasBlockingIssue && page.runtimeMode === 'webgl' ? page.runtimeFallbackMode : page.runtimeMode,
      bundle,
      issues,
    }

    this.cachedResults.set(cacheKey, result)
    return result
  }
}

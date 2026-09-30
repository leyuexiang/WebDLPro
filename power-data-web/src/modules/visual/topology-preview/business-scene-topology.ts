import type { LockState, Meta2dData, Pen } from '@meta2d/core'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { getTopologySharedPublicAssetUrl } from './topology-shared-assets'
import type {
  ManifestTopologyPreviewProfile,
} from './manifest-topology-preview-profile'
import { BUSINESS_SCENE_TOPOLOGY_SOURCE_MANIFEST } from './business-scene-topology-source-manifest'
import {
  formatWindTopologyFilterSelection,
  toggleWindTopologyFilter,
  WIND_TOPOLOGY_FILTER_GROUPS,
  type WindTopologyFilterId,
} from './wind-topology-layer-filter'

/** 三个 Unity（统一引擎）新场景在前端拓扑中的稳定场景键。 */
export const BUSINESS_SCENE_TOPOLOGY_SCENE_IDS = ['microgrid', 'distribution', 'consumption'] as const

export type BusinessSceneTopologySceneId = (typeof BUSINESS_SCENE_TOPOLOGY_SCENE_IDS)[number]

interface BusinessSceneTopologyFlattenedCombine {
  readonly id: string
  readonly directChildCount: number
}

interface BusinessSceneTopologyVariantManifestEntry {
  readonly id: string
  readonly combinationKey: string
  readonly layerIds: readonly string[]
  readonly topologyPath: string
  readonly sourceSha256: string
  readonly expectedPenCount: number
  readonly expectedRuntimePenCount: number
  readonly flattenedCombines: readonly BusinessSceneTopologyFlattenedCombine[]
  readonly processPenIds: readonly string[]
  readonly isDefault?: true
}

export type BusinessSceneTopologyVariantId = (typeof BUSINESS_SCENE_TOPOLOGY_SOURCE_MANIFEST.microgrid)[number]['id']
export type BusinessSceneTopologyVariant = BusinessSceneTopologyVariantManifestEntry

/** 正式场景路由只接受已登记的总览拓扑键，标题和页面名称不会触发外部 JSON 画布。 */
const SCENE_ID_BY_TOPOLOGY_KEY: ReadonlyMap<string, BusinessSceneTopologySceneId> = new Map([
  ['topology.microgrid.overview', 'microgrid'],
  ['topology.distribution.overview', 'distribution'],
  ['topology.consumption.overview', 'consumption'],
])

/** 供公共面板按稳定拓扑编号路由到新场景画布。 */
export function resolveBusinessSceneTopologySceneId(topologyKey: string): BusinessSceneTopologySceneId | undefined {
  return SCENE_ID_BY_TOPOLOGY_KEY.get(topologyKey)
}

/** 源清单保持与每个场景包一一对应；筛选画布按独立文件切换，不生成并集。 */
export const BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE: Readonly<Record<
  BusinessSceneTopologySceneId,
  readonly BusinessSceneTopologyVariant[]
>> = BUSINESS_SCENE_TOPOLOGY_SOURCE_MANIFEST as unknown as Readonly<Record<
  BusinessSceneTopologySceneId,
  readonly BusinessSceneTopologyVariant[]
>>

/** 筛选轨样式与既有第二层一致，状态机继续复用成熟的架构层互斥规则。 */
const FILTER_GROUPS = WIND_TOPOLOGY_FILTER_GROUPS

/** 首次加载的安全原始副本仅按“场景 + 文件版本”缓存，绝不缓存 Meta2D 运行时对象。 */
const sourceDataCache = new Map<string, Meta2dData>()

/** Meta2D（二维组态引擎）可单独选择的业务图元锁定值。 */
const SELECTABLE_PEN_LOCK = 1 as LockState
/** 背景、组合容器和连线禁用命中；画布仍允许这些图元正常绘制。 */
const BACKGROUND_PEN_LOCK = 10 as LockState

/** 预览无实时状态映射，因此图片保持源清单登记的正常资源并标注“预览默认态”。 */
const PREVIEW_STATUS_LABEL: Readonly<Record<TopologyDeviceStatus, string>> = Object.freeze({
  normal: '预览默认态',
  alarm: '预览默认态',
  fault: '预览默认态',
  offline: '预览默认态',
})

/** 读取某场景的固定变体集合；构建索引只遍历一次，热路径为常数时间查询。 */
const variantsByScene = new Map<BusinessSceneTopologySceneId, ReadonlyMap<string, BusinessSceneTopologyVariant>>(
  BUSINESS_SCENE_TOPOLOGY_SCENE_IDS.map((sceneId) => [
    sceneId,
    new Map<string, BusinessSceneTopologyVariant>(BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE[sceneId].map((variant) => [variant.id, variant])),
  ]),
)

const variantsByCombinationByScene = new Map<BusinessSceneTopologySceneId, ReadonlyMap<string, BusinessSceneTopologyVariant>>(
  BUSINESS_SCENE_TOPOLOGY_SCENE_IDS.map((sceneId) => [
    sceneId,
    new Map<string, BusinessSceneTopologyVariant>(BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE[sceneId].map((variant) => [variant.combinationKey, variant])),
  ]),
)

/** 校验源文件自身的数量、编号与几何字段，在任何组合展平之前运行。 */
function validateSourcePens(
  pens: readonly Pen[],
  variant: BusinessSceneTopologyVariant,
): void {
  if (pens.length !== variant.expectedPenCount) {
    throw new Error(`拓扑 ${variant.id} 源图元数量异常：应为 ${variant.expectedPenCount}，实际为 ${pens.length}。`)
  }

  const penById = new Map<string, Pen>()
  for (const pen of pens) {
    if (!pen.id) throw new Error(`拓扑 ${variant.id} 存在无编号图元。`)
    if (penById.has(pen.id)) throw new Error(`拓扑 ${variant.id} 图元编号重复：${pen.id}。`)
    if (![pen.x, pen.y, pen.width, pen.height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`拓扑 ${variant.id} 图元 ${pen.id} 含非有限坐标或尺寸。`)
    }
    penById.set(pen.id, pen)
  }

  for (const pen of pens) {
    if (pen.parentId && !penById.has(pen.parentId)) {
      throw new Error(`拓扑 ${variant.id} 图元 ${pen.id} 的父图元不存在：${pen.parentId}。`)
    }
  }
}

/**
 * 展平清单显式登记的全图组合父级。子图元坐标按父级宽高换算到画布坐标，
 * 再清除被删除父级的编号；未登记的局部组合及其相对坐标保持不变。
 */
export function flattenBusinessSceneTopologyPens(
  pens: Pen[],
  variant: BusinessSceneTopologyVariant,
): Pen[] {
  validateSourcePens(pens, variant)

  const combineIdsToFlatten = new Set(variant.flattenedCombines.map((item) => item.id))
  const penById = new Map<string, Pen>(pens.map((pen) => [pen.id!, pen]))
  const childrenByParentId = new Map<string, Pen[]>()
  for (const pen of pens) {
    if (!pen.parentId) continue
    const children = childrenByParentId.get(pen.parentId)
    if (children) children.push(pen)
    else childrenByParentId.set(pen.parentId, [pen])
  }

  const rootCombine = pens.filter((pen) => pen.name === 'combine' && !pen.parentId)
  if (rootCombine.length !== 1 || !rootCombine[0]?.id || !combineIdsToFlatten.has(rootCombine[0].id)) {
    throw new Error(`拓扑 ${variant.id} 缺少唯一登记的全图组合父级。`)
  }

  for (const item of variant.flattenedCombines) {
    const combine = penById.get(item.id)
    if (!combine || combine.name !== 'combine') {
      throw new Error(`拓扑 ${variant.id} 展平清单编号无效：${item.id}。`)
    }
    const directChildren = childrenByParentId.get(item.id) ?? []
    if (directChildren.length !== item.directChildCount) {
      throw new Error(`拓扑 ${variant.id} 组合 ${item.id} 子图元数量异常：清单 ${item.directChildCount}，实际 ${directChildren.length}。`)
    }
    if (combine.id !== rootCombine[0].id && (!combine.parentId || !combineIdsToFlatten.has(combine.parentId))) {
      throw new Error(`拓扑 ${variant.id} 组合 ${item.id} 不在已登记全图父级链上。`)
    }
  }

  const visitedFlattenedIds = new Set<string>()
  const visitFullCanvasCombine = (parent: Pen): void => {
    if (!parent.id || visitedFlattenedIds.has(parent.id)) {
      throw new Error(`拓扑 ${variant.id} 全图组合父级存在循环引用：${parent.id ?? '无编号'}。`)
    }
    visitedFlattenedIds.add(parent.id)

    for (const child of childrenByParentId.get(parent.id) ?? []) {
      // 源图子项坐标表示父图元内部的比例；转换后才可安全脱离父级坐标系。
      child.x = parent.x! + child.x! * parent.width!
      child.y = parent.y! + child.y! * parent.height!
      child.width = child.width! * parent.width!
      child.height = child.height! * parent.height!
      if (![child.x, child.y, child.width, child.height].every(Number.isFinite)) {
        throw new Error(`拓扑 ${variant.id} 展平图元 ${child.id} 后得到非有限坐标。`)
      }
      delete child.parentId

      if (child.id && combineIdsToFlatten.has(child.id)) visitFullCanvasCombine(child)
    }
  }

  visitFullCanvasCombine(rootCombine[0])
  if (visitedFlattenedIds.size !== combineIdsToFlatten.size) {
    const unvisited = [...combineIdsToFlatten].filter((id) => !visitedFlattenedIds.has(id))
    throw new Error(`拓扑 ${variant.id} 全图组合清单存在不可达父级：${unvisited.join(', ')}。`)
  }

  const runtimePens = pens.filter((pen) => !combineIdsToFlatten.has(pen.id!))
  if (runtimePens.length !== variant.expectedRuntimePenCount) {
    throw new Error(`拓扑 ${variant.id} 展平后图元数量异常：应为 ${variant.expectedRuntimePenCount}，实际 ${runtimePens.length}。`)
  }
  return runtimePens
}

/** 图元中的图片值已经按 penId 审核为共享相对路径；拒绝任何远端地址及目录上溯。 */
function resolveSharedImagePath(image: string, sceneId: BusinessSceneTopologySceneId, penId: string): string {
  if (!/^(assets|background|icons)\/[a-zA-Z0-9_./-]+$/.test(image) || image.includes('..')) {
    throw new Error(`${sceneId} 拓扑图元 ${penId} 的公共图片路径不安全：${image}。`)
  }
  return getTopologySharedPublicAssetUrl(image)
}

/** 只允许源清单中显式登记的设备图片和工艺矩形单独选中，区域底图不会拦截命中。 */
function applySelectionPolicy(
  pens: Pen[],
  variant: BusinessSceneTopologyVariant,
): void {
  const processPenIds = new Set<string>(variant.processPenIds)
  const idsInFile = new Set(pens.flatMap((pen) => pen.id ? [pen.id] : []))
  for (const processPenId of processPenIds) {
    if (!idsInFile.has(processPenId)) throw new Error(`拓扑 ${variant.id} 工艺图元未找到：${processPenId}。`)
  }

  for (const pen of pens) {
    const isDeviceImage = Boolean(pen.image && !pen.image.startsWith('background/'))
    const isSelectable = Boolean(pen.id && (isDeviceImage || processPenIds.has(pen.id)))
    pen.locked = isSelectable ? SELECTABLE_PEN_LOCK : BACKGROUND_PEN_LOCK
  }
}

/** JSON 原始副本不能携带模拟、网络或启动脚本；只清空已知执行入口，不执行输入代码。 */
function sanitizeTopologyData(data: Meta2dData): void {
  const safeData = data as Meta2dData & {
    enableMock?: boolean
    dataPoints?: unknown[]
    networks?: unknown[]
    initJs?: string
  }
  safeData.enableMock = false
  safeData.dataPoints = []
  safeData.networks = []
  safeData.initJs = ''
}

/** 深克隆避免筛选切换、选中高亮或组态引擎字段回写污染下次复用的缓存。 */
function cloneTopologyData(data: Meta2dData): Meta2dData {
  return structuredClone(data)
}

/** 生成相对 Vite 公共根目录或嵌入壳入口的场景 JSON 地址。 */
export function getBusinessSceneTopologyPublicAssetUrl(
  sceneId: BusinessSceneTopologySceneId,
  relativePath: string,
  viteBaseUrl = import.meta.env.BASE_URL,
  entryModuleScriptUrl = typeof document === 'undefined'
    ? undefined
    : document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src || undefined,
): string {
  const assetRelativePath = `topology/${sceneId}-json-preview/${relativePath}`
  if ((viteBaseUrl === './' || viteBaseUrl === '.') && entryModuleScriptUrl) {
    return new URL(`../${assetRelativePath}`, entryModuleScriptUrl).toString()
  }
  const basePath = viteBaseUrl.endsWith('/') ? viteBaseUrl : `${viteBaseUrl}/`
  return `${basePath}${assetRelativePath}`
}

/** 加载指定场景的一份完整输入文件；每个层级组合都从自己的 JSON 独立还原。 */
export async function loadBusinessSceneTopologyPreviewData(
  sceneId: BusinessSceneTopologySceneId,
  variantId: BusinessSceneTopologyVariantId,
  signal?: AbortSignal,
): Promise<Meta2dData> {
  const variant = variantsByScene.get(sceneId)?.get(variantId)
  if (!variant) throw new Error(`${sceneId} 拓扑版本未登记：${variantId}。`)

  const cacheKey = `${sceneId}/${variantId}`
  let sourceData = sourceDataCache.get(cacheKey)
  if (!sourceData) {
    const response = await fetch(getBusinessSceneTopologyPublicAssetUrl(sceneId, variant.topologyPath), {
      signal,
      cache: import.meta.env.DEV ? 'no-store' : 'force-cache',
    })
    if (!response.ok) throw new Error(`${sceneId} 拓扑 ${variantId} 加载失败：${response.status}。`)
    const fetchedData = await response.json() as Partial<Meta2dData>
    if (!Array.isArray(fetchedData.pens)) throw new Error(`${sceneId} 拓扑 ${variantId} 缺少图元数组。`)
    const source = fetchedData as Meta2dData
    validateSourcePens(source.pens, variant)
    sanitizeTopologyData(source)
    sourceData = cloneTopologyData(source)
    sourceDataCache.set(cacheKey, sourceData)
  }

  const data = cloneTopologyData(sourceData)
  data.pens = flattenBusinessSceneTopologyPens(data.pens, variant)
  for (const pen of data.pens) {
    if (pen.image?.trim() && pen.id) pen.image = resolveSharedImagePath(pen.image, sceneId, pen.id)
  }
  applySelectionPolicy(data.pens, variant)
  // 清理导出编辑器画布固定尺寸，视口由实际图元边界适配，源坐标与绘制顺序保留。
  data.width = undefined
  data.height = undefined
  return data
}

/** 设备提示只由带共享设备图元的源 pen 提供，不按标题或坐标补造三维绑定。 */
function getDeviceTooltipContent(pen: Pen) {
  if (pen.locked !== SELECTABLE_PEN_LOCK || !pen.id || !pen.image || pen.image.includes('/background/')) return undefined
  const title = pen.text?.replace(/\r?\n/g, '').replace(/[ \t]+/g, ' ').trim() ?? ''
  return title ? { penId: pen.id, title, status: PREVIEW_STATUS_LABEL.normal } : undefined
}

/** 选中和组合解析所依赖的非架构层顺序固定，和变体清单的组合键排序一致。 */
const FILTER_ORDER = ['network', 'business', 'key-process'] as const

/** 使用架构互斥规则后精确解析该场景唯一登记的完整 JSON 文件。 */
function resolveVariant(
  sceneId: BusinessSceneTopologySceneId,
  selected: ReadonlySet<string>,
): BusinessSceneTopologyVariant | undefined {
  let combinationKey: string
  if (selected.has('architecture')) {
    if (selected.size !== 1) return undefined
    combinationKey = 'architecture'
  } else {
    const layers = FILTER_ORDER.filter((layerId) => selected.has(layerId))
    if (layers.length === 0 || layers.length !== selected.size) return undefined
    combinationKey = layers.join('+')
  }
  return variantsByCombinationByScene.get(sceneId)?.get(combinationKey)
}

/** 每个新场景只改变数据清单和地址，共用同一筛选轨、Meta2D 画布和交互处理。 */
function createPreviewProfile(sceneId: BusinessSceneTopologySceneId): ManifestTopologyPreviewProfile {
  const defaultVariant = BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE[sceneId].find((variant) => variant.isDefault)
  if (!defaultVariant) throw new Error(`${sceneId} 拓扑必须且只能登记一个默认版本。`)

  return Object.freeze({
    sceneLabel: sceneId === 'microgrid' ? '微电网' : sceneId === 'distribution' ? '配电站' : '楼宇',
    defaultVariantId: defaultVariant.id,
    filterGroups: FILTER_GROUPS,
    createDefaultSelection: () => new Set<string>(defaultVariant.layerIds),
    toggleFilter: (current: ReadonlySet<string>, filterId: string, checked: boolean) => toggleWindTopologyFilter(
      current as ReadonlySet<WindTopologyFilterId>,
      filterId as WindTopologyFilterId,
      checked,
    ),
    resolveVariant: (selected: ReadonlySet<string>) => resolveVariant(sceneId, selected),
    formatSelection: (selected: ReadonlySet<string>) => formatWindTopologyFilterSelection(
      selected as ReadonlySet<WindTopologyFilterId>,
    ),
    loadData: (variantId: string, signal?: AbortSignal) => loadBusinessSceneTopologyPreviewData(
      sceneId,
      variantId as BusinessSceneTopologyVariantId,
      signal,
    ),
    getTooltipContent: getDeviceTooltipContent,
  })
}

/** 预先构建每个场景唯一 profile，避免视图重渲染反复分配清单和索引。 */
const PREVIEW_PROFILE_BY_SCENE: Readonly<Record<BusinessSceneTopologySceneId, ManifestTopologyPreviewProfile>> = Object.freeze({
  microgrid: createPreviewProfile('microgrid'),
  distribution: createPreviewProfile('distribution'),
  consumption: createPreviewProfile('consumption'),
})

/** 新场景正式面板通过稳定键读取预构建 profile，不回退到运行时标题识别。 */
export function getBusinessSceneTopologyPreviewProfile(
  sceneId: BusinessSceneTopologySceneId,
): ManifestTopologyPreviewProfile {
  return PREVIEW_PROFILE_BY_SCENE[sceneId]
}

/** 仅供契约测试隔离不可变原始数据缓存，正式运行不会主动清空共享缓存。 */
export function clearBusinessSceneTopologyPreviewDataCacheForTests(): void {
  sourceDataCache.clear()
}

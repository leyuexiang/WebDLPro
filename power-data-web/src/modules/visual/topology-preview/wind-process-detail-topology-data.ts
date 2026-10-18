import { LockState, type Meta2dData } from '@meta2d/core'
import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'
import { getTopologySharedPublicAssetUrl } from './topology-shared-assets'

const PATH_BY_CONTEXT = new Map([
  ['process-detail.wind-power.wind-turbine', 'process-detail/wind-power/wind-turbine/topology.json'],
  ['process-detail.wind-power.gearbox', 'process-detail/wind-power/gearbox/topology.json'],
  ['process-detail.wind-power.yaw-system', 'process-detail/wind-power/yaw-system/topology.json'],
])
/**
 * 按当前完整文件登记可单独命中的设备和工艺节点；相同图元编号跨文件不代表同一业务设备。
 * 风机十一设备及三个工艺节点、齿轮箱七项和偏航六项只开放二维交互，不推测子设备三维编号。
 * 公共提示层还会检查图片字段，因此三个工艺矩形可选、高亮但不会生成设备状态提示。
 */
const SELECTABLE_PEN_IDS_BY_CONTEXT: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['process-detail.wind-power.wind-turbine', new Set([
    '0ac4afe', '3e288cbd', '43a646d3', 'f0f2767', '271b18a0', '7cd2eb0',
    '10fa25ae', '25ed876', 'bb18bd', 'c236be3', '777c77b',
    '2513e8', 'cacede1', 'bc1e364',
  ])],
  ['process-detail.wind-power.gearbox', new Set(['57e6a4bd', '310a9d42', 'a7d5ad8', '229c868c', '127fdca', '3e772cb3', '778ca658'])],
  ['process-detail.wind-power.yaw-system', new Set(['35d10e8d', '3a61df5', '5221dc0', 'b6b1b5', '64b6ac4b', '7675822'])],
])
/** 缓存最多覆盖登记的三份源文件；返回前始终克隆，防止引擎或选择状态污染源数据。 */
const sourceCache = new Map<string, { readonly sourceSha256: string; readonly data: Meta2dData }>()
const imageUrlCache = new Map<string, string>()
/**
 * 按 JSON 源图记录的原始图片地址逐项本地化到公共 WebP（网页图片格式）资源。
 * PNG（便携式网络图形）只作为来源键参与查表；未登记地址会立即失败，不会请求或打包历史 PNG。
 */
const IMAGE_MAP: Readonly<Record<string, string>> = Object.freeze({
  '/v/material/装饰/流光3.png': 'background/flow-light-3.webp',
  '/cloud/2026/09/09/19/01a085ee-550a-730f-88af-d790f1148bcd.png': 'icons/normal/plc.webp',
  '/cloud/2026/09/09/19/01a085ee-07b2-7487-a60f-a54b4ebc048c.png': 'icons/normal/plc.webp',
  '/cloud/2026/09/09/19/01a085ee-352c-7587-ba00-b77266e4aaf6.png': 'icons/normal/plc.webp',
  '/cloud/2026/09/01/22/01a05d75-b20c-7e1f-9f04-6f70a3344851.png': 'icons/normal/dcs.webp',
  '/cloud/2026/09/15/17/01a0a44f-adaf-7ebf-b5e5-46566af514d0.png': 'icons/normal/gearbox.webp',
  '/cloud/2026/09/15/17/01a0a44e-c9b0-74d9-9ef4-69fdd545759b.png': 'icons/static/def6155598057373934ea3668fa58a2ed4cf26f9d1722fae22f6a06af732859a.webp',
  '/cloud/2026/09/15/17/01a0a44f-0f9d-7d98-bf20-22d7f35114f5.png': 'icons/static/3f298fdca1e67c404570bede325564faebedad1ef887ad355bca07ee0be56767.webp',
  '/cloud/2026/09/09/20/01a08639-799b-7a65-8a8f-e31e02cb35fe.png': 'icons/static/e2e275e4a94ef6d9f2313aee8ee7857b2ba21ac4d323bd53378144dc47169f7f.webp',
  '/cloud/2026/09/09/20/01a08639-15ae-7ed0-9ab4-539dee85ade1.png': 'icons/static/cd8655f8bcede28c1a381160c4a696c93556459006d8fd8c2583a261b312d755.webp',
})

/**
 * 相对发布时由入口脚本定位 shell 目录；附带原文件散列作为缓存版本，
 * 避免新前端在第三层仍读取旧 JSON，或在 /shell/embed/ 下错误请求嵌套路径。
 */
export function getWindProcessDetailTopologyUrl(
  context: TopologyDataContext,
  viteBaseUrl = import.meta.env.BASE_URL,
  entryModuleScriptUrl = typeof document === 'undefined'
    ? undefined
    : document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src || undefined,
): string {
  if (!context.sourceSha256) throw new Error(`风电关键环节缺少源文件版本：${context.contextId}`)
  const relativePath = `topology/${context.topologyPath}`
  const base = viteBaseUrl.endsWith('/') ? viteBaseUrl : `${viteBaseUrl}/`
  const url = (viteBaseUrl === './' || viteBaseUrl === '.') && entryModuleScriptUrl
    ? new URL(`../${relativePath}`, entryModuleScriptUrl).toString()
    : `${base}${relativePath}`
  return `${url}?v=${context.sourceSha256}`
}

/** 风电第三层只读取显式登记的完整文件，复用公共 WebP、画布和选择协调器。 */
export async function loadWindProcessDetailTopologyData(context: TopologyDataContext, signal?: AbortSignal): Promise<Meta2dData> {
  const path = PATH_BY_CONTEXT.get(context.contextId)
  if (context.renderer !== 'manifest-json' || !path || path !== context.topologyPath) throw new Error(`风电关键环节上下文未登记：${context.contextId}`)
  let cached = sourceCache.get(path)
  if (!cached || cached.sourceSha256 !== context.sourceSha256) {
    const response = await fetch(getWindProcessDetailTopologyUrl(context), { signal, cache: import.meta.env.DEV ? 'no-store' : 'force-cache' })
    if (!response.ok) throw new Error(`风电关键环节拓扑加载失败：${context.contextId}`)
    const source = await response.json() as Meta2dData
    if (!Array.isArray(source.pens) || source.pens.length !== context.expectedPenCount) {
      throw new Error(`风电关键环节源图元数量异常：应为 ${context.expectedPenCount}，实际为 ${source.pens?.length ?? 0}。`)
    }
    const penIds = new Set<string>()
    for (const pen of source.pens) {
      if (!pen.id || penIds.has(pen.id)) throw new Error(`风电关键环节图元编号缺失或重复：${context.contextId}`)
      penIds.add(pen.id)
      if (![pen.x, pen.y, pen.width, pen.height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
        throw new Error(`风电关键环节图元几何值无效：${context.contextId}`)
      }
    }
    // 源文件仅作为展示数据，不执行其模拟数据、联网配置或初始化脚本。
    const safeSource = source as Meta2dData & { enableMock?: boolean; dataPoints?: unknown[]; networks?: unknown[]; initJs?: string; image?: string }
    safeSource.enableMock = false
    safeSource.dataPoints = []
    safeSource.networks = []
    safeSource.initJs = ''
    // 顶层 image 是导出平台的预览缩略图，不属于画布图元；保留原文件审计，运行副本不携带远端缩略图。
    safeSource.image = undefined
    cached = { sourceSha256: context.sourceSha256!, data: source }
    sourceCache.set(path, cached)
  }
  const source = cached.data
  const data = structuredClone(source)
  // 每次装载只建一次绑定集合，图元热路径不嵌套扫描业务绑定。
  const boundPenIds = new Set(context.bindings.map((binding) => binding.penId))
  const selectablePenIds = SELECTABLE_PEN_IDS_BY_CONTEXT.get(context.contextId)
  for (const pen of data.pens) {
    if (pen.image) {
      const sharedPath = IMAGE_MAP[pen.image]
      if (!sharedPath) throw new Error(`风电关键环节图片未登记：${pen.image}`)
      let imageUrl = imageUrlCache.get(sharedPath)
      if (!imageUrl) {
        imageUrl = getTopologySharedPublicAssetUrl(sharedPath)
        imageUrlCache.set(sharedPath, imageUrl)
      }
      pen.image = imageUrl
    }
    pen.locked = pen.id && (boundPenIds.has(pen.id) || selectablePenIds?.has(pen.id))
      ? LockState.DisableEdit
      : LockState.Disable
    // 纯视觉动画字段保留；来源文件的事件脚本不会进入只读拓扑运行时。
    pen.events = []
  }
  data.width = undefined
  data.height = undefined
  return data
}

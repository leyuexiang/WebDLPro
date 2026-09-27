import type { Meta2dData, Pen } from '@meta2d/core'
import { getTopologySharedPublicAssetUrl } from './topology-shared-assets'
import { getStepUpSubstationTopologyResourceManifest } from './step-up-substation-topology-manifest'
import { flattenSubstationTopologyCombines } from './substation-topology-combine-flattener'
import { applyStepUpSubstationTopologySelectionPolicy } from './step-up-substation-topology-selection'
import {
  STEP_UP_SUBSTATION_TOPOLOGY_VARIANT_BY_ID,
  type StepUpSubstationTopologyVariantId,
} from './step-up-substation-topology-variant-manifest'

/** 未交给二维组态引擎的安全源副本按版本缓存；再次切回不重复请求或解析。 */
const sourceDataCache = new Map<StepUpSubstationTopologyVariantId, Meta2dData>()

/** 生成升压站版本数据地址；图片始终通过公共资源工具生成，不访问源包站点路径。 */
export function getStepUpSubstationTopologyPublicAssetUrl(
  relativePath: string,
  viteBaseUrl = import.meta.env.BASE_URL,
  entryModuleScriptUrl = typeof document === 'undefined'
    ? undefined
    : document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src || undefined,
): string {
  const assetRelativePath = `topology/step-up-substation-json-preview/${relativePath}`
  if ((viteBaseUrl === './' || viteBaseUrl === '.') && entryModuleScriptUrl) {
    return new URL(`../${assetRelativePath}`, entryModuleScriptUrl).toString()
  }
  const basePath = viteBaseUrl.endsWith('/') ? viteBaseUrl : `${viteBaseUrl}/`
  return `${basePath}${assetRelativePath}`
}

/** 每次打开前深拷贝缓存，隔离引擎计算字段、临时选择和连线高亮。 */
function cloneTopologyData(data: Meta2dData): Meta2dData {
  return structuredClone(data)
}

/**
 * 图片必须命中当前文件的显式图元清单。设备和区域标题分别替换为经散列核对的公共资源，
 * 任何遗漏都会中止加载，避免浏览器请求压缩包原路径或误用其他场景图片。
 */
function localizePenImage(pen: Pen, variantId: StepUpSubstationTopologyVariantId): void {
  if (!pen.image?.trim() || !pen.id) return
  const manifest = getStepUpSubstationTopologyResourceManifest(variantId)
  if (manifest.titleBackgroundPenIds.has(pen.id)) {
    pen.image = getTopologySharedPublicAssetUrl('assets/ba8187270926d7debab4e2073959d603c10b126425efc533883ac60c4579130e.png')
    return
  }
  const staticPath = manifest.staticImagePathByPenId.get(pen.id)
  if (!staticPath) throw new Error(`升压站拓扑图片图元未登记：${variantId}/${pen.id}`)
  pen.image = getTopologySharedPublicAssetUrl(staticPath)
}

/** 图元数、编号和有限几何字段在进入画布前逐项校验，防止异常边界污染适应视图。 */
function validateStepUpSubstationTopologyPens(
  pens: readonly Pen[],
  variantId: StepUpSubstationTopologyVariantId,
  expectedPenCount: number,
): void {
  if (pens.length !== expectedPenCount) {
    throw new Error(`升压站拓扑 ${variantId} 图元数量异常：应为 ${expectedPenCount}，实际为 ${pens.length}。`)
  }
  const ids = new Set<string>()
  for (const pen of pens) {
    if (!pen.id) throw new Error(`升压站拓扑 ${variantId} 格式无效：存在无编号图元。`)
    if (ids.has(pen.id)) throw new Error(`升压站拓扑 ${variantId} 格式无效：图元编号重复 ${pen.id}。`)
    ids.add(pen.id)
    if (![pen.x, pen.y, pen.width, pen.height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`升压站拓扑 ${variantId} 格式无效：图元 ${pen.id} 的坐标或尺寸不是有限数字。`)
    }
  }
}

/** 禁用输入数据中的模拟、联网、数据点和初始化脚本，仅保留视觉动画。 */
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

/**
 * 加载一份完整拓扑文件，不合并其他版本，也不通过 visible（可见性）实现筛选。
 * 首次请求缓存净化后的源副本，后续仅克隆、资源本地化和应用只读选择策略。
 */
export async function loadStepUpSubstationTopologyPreviewData(
  variantId: StepUpSubstationTopologyVariantId = 'network-business-key-process',
  signal?: AbortSignal,
): Promise<Meta2dData> {
  const variant = STEP_UP_SUBSTATION_TOPOLOGY_VARIANT_BY_ID.get(variantId)
  if (!variant) throw new Error(`升压站拓扑版本未登记：${variantId}`)

  let sourceData = sourceDataCache.get(variantId)
  if (!sourceData) {
    const response = await fetch(getStepUpSubstationTopologyPublicAssetUrl(variant.topologyPath), {
      signal,
      cache: import.meta.env.DEV ? 'no-store' : 'force-cache',
    })
    if (!response.ok) throw new Error(`升压站拓扑 ${variantId} 加载失败：${response.status}`)
    const fetchedData = await response.json() as Partial<Meta2dData>
    if (!Array.isArray(fetchedData.pens)) throw new Error(`升压站拓扑 ${variantId} 格式无效：缺少图元数组。`)
    validateStepUpSubstationTopologyPens(fetchedData.pens, variantId, variant.expectedPenCount)
    sourceData = fetchedData as Meta2dData
    sanitizeTopologyData(sourceData)
    sourceDataCache.set(variantId, cloneTopologyData(sourceData))
  }

  const data = cloneTopologyData(sourceData)
  for (const pen of data.pens) localizePenImage(pen, variantId)
  // 每种筛选文件都拆开全部组合，避免父组合截获图元点击。
  flattenSubstationTopologyCombines(data.pens, `升压站/${variantId}`)
  applyStepUpSubstationTopologySelectionPolicy(data.pens, variantId)
  // 取消旧编辑器纸张尺寸，让公共画布按原始图元边界适配；不修改坐标、层级或连线路径。
  data.width = undefined
  data.height = undefined
  return data
}

/** 只供单元测试隔离不可变缓存，生产运行时不主动清空。 */
export function clearStepUpSubstationTopologyPreviewDataCacheForTests(): void {
  sourceDataCache.clear()
}

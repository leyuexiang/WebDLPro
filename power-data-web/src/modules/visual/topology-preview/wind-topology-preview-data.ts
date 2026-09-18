import type { Meta2dData, Pen } from '@meta2d/core'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { applyWindTopologySelectionPolicy } from './wind-topology-selection'
import { getWindTopologyResourceManifest } from './wind-topology-manifest'
import { getTopologySharedPublicAssetUrl } from './topology-shared-assets'
import {
  WIND_TOPOLOGY_VARIANT_BY_ID,
  type WindTopologyVariantId,
} from './wind-topology-variant-manifest'

export {
  WIND_TOPOLOGY_BACKGROUND_PEN_IDS,
  WIND_TOPOLOGY_DEVICE_PEN_IDS,
} from './wind-topology-manifest'

/** 平台四态协议与公共资源目录保持一一对应。 */
const ICON_DIRECTORY_BY_STATUS: Readonly<Record<TopologyDeviceStatus, string>> = Object.freeze({
  normal: 'normal', alarm: 'alarm', fault: 'fault', offline: 'offline',
})

/**
 * 缓存只保存未交给二维组态引擎（Meta2D）的安全原始副本；每次打开返回深拷贝，
 * 防止状态图片、选中样式或引擎计算字段污染再次切回同一版本的结果。
 */
const sourceDataCache = new Map<WindTopologyVariantId, Meta2dData>()

/** 按版本和图元编号读取公共四态图标，不解析标题、坐标或输入文件的原图片地址。 */
export function getWindTopologyPreviewIconPath(
  variantId: WindTopologyVariantId,
  penId: string,
  status: TopologyDeviceStatus = 'normal',
): string | undefined {
  const normalPath = getWindTopologyResourceManifest(variantId).deviceIconPathByPenId.get(penId)
  return normalPath?.replace('/normal/', `/${ICON_DIRECTORY_BY_STATUS[status]}/`)
}

/** 把正式设备状态转换为受控公共资源地址。 */
export function getWindTopologyStatusIconUrl(
  variantId: WindTopologyVariantId,
  penId: string,
  status: TopologyDeviceStatus,
): string | undefined {
  const relativePath = getWindTopologyPreviewIconPath(variantId, penId, status)
  return relativePath ? getTopologySharedPublicAssetUrl(relativePath) : undefined
}

/** 生成风电版本数据地址；图片资源始终由公共资源地址工具单独生成。 */
export function getWindTopologyPreviewPublicAssetUrl(
  relativePath: string,
  viteBaseUrl = import.meta.env.BASE_URL,
  entryModuleScriptUrl = typeof document === 'undefined'
    ? undefined
    : document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src || undefined,
): string {
  const assetRelativePath = `topology/wind-json-preview/${relativePath}`
  if ((viteBaseUrl === './' || viteBaseUrl === '.') && entryModuleScriptUrl) {
    return new URL(`../${assetRelativePath}`, entryModuleScriptUrl).toString()
  }
  const basePath = viteBaseUrl.endsWith('/') ? viteBaseUrl : `${viteBaseUrl}/`
  return `${basePath}${assetRelativePath}`
}

/** 使用平台原生结构化克隆，确保缓存对象不可被画布或调用方修改。 */
function cloneTopologyData(data: Meta2dData): Meta2dData {
  return structuredClone(data)
}

/**
 * 只替换当前版本清单中登记的设备和区域标题背景。任何遗漏图片都会中止加载，
 * 防止浏览器继续请求压缩包中的站点路径，或把装饰图片误当成设备状态载体。
 */
function localizePenImage(pen: Pen, variantId: WindTopologyVariantId): void {
  if (!pen.image?.trim() || !pen.id) return
  const manifest = getWindTopologyResourceManifest(variantId)
  if (manifest.titleBackgroundPenIds.has(pen.id)) {
    pen.image = getTopologySharedPublicAssetUrl('background/flow-light-3.png')
    return
  }
  const iconPath = getWindTopologyPreviewIconPath(variantId, pen.id)
  if (iconPath) {
    pen.image = getTopologySharedPublicAssetUrl(iconPath)
    return
  }
  const staticPath = manifest.staticImagePathByPenId.get(pen.id)
  if (staticPath) {
    pen.image = getTopologySharedPublicAssetUrl(staticPath)
    return
  }
  throw new Error(`风电拓扑图片图元未登记：${variantId}/${pen.id}`)
}

/** 逐文件校验图元数、稳定编号与有限几何字段，避免损坏数据污染画布边界。 */
function validateWindTopologyPens(
  pens: readonly Pen[],
  variantId: WindTopologyVariantId,
  expectedPenCount: number,
): void {
  if (pens.length !== expectedPenCount) {
    throw new Error(`风电拓扑 ${variantId} 图元数量异常：应为 ${expectedPenCount}，实际为 ${pens.length}。`)
  }
  const ids = new Set<string>()
  for (const pen of pens) {
    if (!pen.id) throw new Error(`风电拓扑 ${variantId} 格式无效：存在无编号图元。`)
    if (ids.has(pen.id)) throw new Error(`风电拓扑 ${variantId} 格式无效：图元编号重复 ${pen.id}。`)
    ids.add(pen.id)
    if (![pen.x, pen.y, pen.width, pen.height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`风电拓扑 ${variantId} 格式无效：图元 ${pen.id} 的坐标或尺寸不是有限数字。`)
    }
  }
}

/** 禁用导出文件中的模拟、联网、数据点和初始化脚本，保留纯视觉动画属性。 */
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
 * 加载一份完整版本文件。首次请求后缓存安全原始副本；每次返回隔离副本并应用公共资源和选择策略。
 * 函数不会合并多个文件，也不会通过 visible（可见性）字段模拟层级筛选。
 */
export async function loadWindTopologyPreviewData(
  variantId: WindTopologyVariantId = 'network-business-key-process',
  signal?: AbortSignal,
): Promise<Meta2dData> {
  const variant = WIND_TOPOLOGY_VARIANT_BY_ID.get(variantId)
  if (!variant) throw new Error(`风电拓扑版本未登记：${variantId}`)

  let sourceData = sourceDataCache.get(variantId)
  if (!sourceData) {
    const response = await fetch(getWindTopologyPreviewPublicAssetUrl(variant.topologyPath), {
      signal,
      cache: import.meta.env.DEV ? 'no-store' : 'force-cache',
    })
    if (!response.ok) throw new Error(`风电拓扑 ${variantId} 加载失败：${response.status}`)
    const fetchedData = await response.json() as Partial<Meta2dData>
    if (!Array.isArray(fetchedData.pens)) throw new Error(`风电拓扑 ${variantId} 格式无效：缺少图元数组。`)
    validateWindTopologyPens(fetchedData.pens, variantId, variant.expectedPenCount)
    sourceData = fetchedData as Meta2dData
    sanitizeTopologyData(sourceData)
    sourceDataCache.set(variantId, cloneTopologyData(sourceData))
  }

  const data = cloneTopologyData(sourceData)
  /**
   * 架构层左上角“工艺流程”为源图的固定导航图元，不属于拓扑内容。
   * 用稳定图元编号精确删除，禁止再用坐标或文字猜测；删除后 fitView 会按剩余图元重新适配。
   */
  if (variantId === 'architecture') {
    data.pens = data.pens.filter((pen) => pen.id !== '1bbff66' && pen.id !== '2c32ca67')
  }
  for (const pen of data.pens) localizePenImage(pen, variantId)
  applyWindTopologySelectionPolicy(data.pens, variantId)
  // 仅取消旧编辑器固定纸张尺寸；源图元坐标、组合关系、连线路径和倍率保持不变。
  data.width = undefined
  data.height = undefined
  return data
}

/** 仅供单元测试隔离不可变缓存，生产代码不会主动清空已校验数据。 */
export function clearWindTopologyPreviewDataCacheForTests(): void {
  sourceDataCache.clear()
}


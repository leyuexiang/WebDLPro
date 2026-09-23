import type { Meta2dData, Pen } from '@meta2d/core'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { applyGasV3TopologySelectionPolicy } from './gas-v3-topology-selection'
import { getTopologySharedPublicAssetUrl } from './topology-shared-assets'
import { getGasV3TopologyResourceManifest } from './gas-v3-topology-manifest'
import {
  GAS_V3_TOPOLOGY_VARIANT_BY_ID,
  type GasV3TopologyVariantId,
} from './gas-v3-topology-variant-manifest'

export {
  GAS_V3_DEVICE_PEN_IDS,
  GAS_V3_TITLE_BACKGROUND_PEN_IDS,
} from './gas-v3-topology-manifest'

/** 四态目录与平台状态协议保持一一对应，文件类型使用已核验的网页图片格式（WebP）动图。 */
const ICON_DIRECTORY_BY_STATUS: Readonly<Record<TopologyDeviceStatus, string>> = Object.freeze({
  normal: 'normal',
  alarm: 'alarm',
  fault: 'fault',
  offline: 'offline',
})

/**
 * 缓存只保存未交给二维组态引擎（Meta2D）的安全原始副本；每次切层返回深拷贝，
 * 防止引擎写入计算字段、选中态或状态图片后污染后续再次打开同一版本。
 */
const sourceDataCache = new Map<GasV3TopologyVariantId, Meta2dData>()

/** 返回指定版本图元对应的公共四态图标路径；运行时不解析标题、坐标或源图片地址。 */
export function getGasV3TopologyPreviewIconPath(
  variantId: GasV3TopologyVariantId,
  penId: string,
  status: TopologyDeviceStatus = 'normal',
): string | undefined {
  const normalPath = getGasV3TopologyResourceManifest(variantId).deviceIconPathByPenId.get(penId)
  if (!normalPath) return undefined
  return normalPath.replace('/normal/', `/${ICON_DIRECTORY_BY_STATUS[status]}/`)
}

/** 将指定版本的设备状态转换为公共资源目录中的部署地址。 */
export function getGasV3TopologyStatusIconUrl(
  variantId: GasV3TopologyVariantId,
  penId: string,
  status: TopologyDeviceStatus,
): string | undefined {
  const relativePath = getGasV3TopologyPreviewIconPath(variantId, penId, status)
  return relativePath ? getTopologySharedPublicAssetUrl(relativePath) : undefined
}

/** 生成燃气拓扑数据地址；图片资源仍统一通过公共资源地址工具获取。 */
export function getGasV3TopologyPreviewPublicAssetUrl(
  relativePath: string,
  viteBaseUrl = import.meta.env.BASE_URL,
  entryModuleScriptUrl = typeof document === 'undefined'
    ? undefined
    : document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src || undefined,
): string {
  const assetRelativePath = `topology/gas-v3-json-preview/${relativePath}`
  if ((viteBaseUrl === './' || viteBaseUrl === '.') && entryModuleScriptUrl) {
    return new URL(`../${assetRelativePath}`, entryModuleScriptUrl).toString()
  }
  const basePath = viteBaseUrl.endsWith('/') ? viteBaseUrl : `${viteBaseUrl}/`
  return `${basePath}${assetRelativePath}`
}

/** 深拷贝拓扑数据，确保缓存对象永远不会被画布实例或调用方修改。 */
function cloneTopologyData(data: Meta2dData): Meta2dData {
  return structuredClone(data)
}

/**
 * 只替换已经登记的设备和区域标题背景。任一未登记图片都会中止目标文件加载，
 * 避免生产环境继续请求压缩包中的站点根路径或把装饰图片误当设备状态载体。
 */
function localizePenImage(pen: Pen, variantId: GasV3TopologyVariantId): void {
  if (!pen.image?.trim() || !pen.id) return
  const manifest = getGasV3TopologyResourceManifest(variantId)
  if (manifest.titleBackgroundPenIds.has(pen.id)) {
    pen.image = getTopologySharedPublicAssetUrl('background/flow-light-3.png')
    return
  }
  const iconPath = getGasV3TopologyPreviewIconPath(variantId, pen.id)
  if (iconPath) {
    pen.image = getTopologySharedPublicAssetUrl(iconPath)
    return
  }
  const staticPath = manifest.staticImagePathByPenId.get(pen.id)
  if (staticPath) {
    pen.image = getTopologySharedPublicAssetUrl(staticPath)
    return
  }
  throw new Error(`燃气拓扑图片图元未登记：${variantId}/${pen.id}`)
}

/** 校验独立输入文件的稳定编号和几何字段，提前阻止损坏数据污染画布边界。 */
function validateGasV3TopologyPens(
  pens: readonly Pen[],
  variantId: GasV3TopologyVariantId,
  expectedPenCount: number,
): void {
  if (pens.length !== expectedPenCount) {
    throw new Error(`燃气拓扑 ${variantId} 图元数量异常：应为 ${expectedPenCount}，实际为 ${pens.length}。`)
  }
  const ids = new Set<string>()
  for (const pen of pens) {
    if (!pen.id) throw new Error(`燃气拓扑 ${variantId} 格式无效：存在无编号图元。`)
    if (ids.has(pen.id)) throw new Error(`燃气拓扑 ${variantId} 格式无效：图元编号重复 ${pen.id}。`)
    ids.add(pen.id)
    if (![pen.x, pen.y, pen.width, pen.height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`燃气拓扑 ${variantId} 格式无效：图元 ${pen.id} 的坐标或尺寸不是有限数字。`)
    }
  }
}

/**
 * 移除导出文件中的模拟和网络副作用。视觉动画属性保留，但禁用每秒全图扫描的模拟状态、
 * 数据点和网络配置，避免打开不受信任输入时启动轮询、联网或脚本行为。
 */
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
 * 按清单加载一份完整拓扑数据。首次请求后缓存安全原始副本；每次返回独立副本并应用公共图片和选择策略。
 * 函数不会合并多份文件，也不会对单份文件做逐图元显隐过滤。
 */
export async function loadGasV3TopologyPreviewData(
  variantId: GasV3TopologyVariantId = 'network-business-key-process',
  signal?: AbortSignal,
): Promise<Meta2dData> {
  const variant = GAS_V3_TOPOLOGY_VARIANT_BY_ID.get(variantId)
  if (!variant) throw new Error(`燃气拓扑版本未登记：${variantId}`)

  let sourceData = sourceDataCache.get(variantId)
  if (!sourceData) {
    const response = await fetch(getGasV3TopologyPreviewPublicAssetUrl(variant.topologyPath), {
      signal,
      cache: import.meta.env.DEV ? 'no-store' : 'force-cache',
    })
    if (!response.ok) throw new Error(`燃气拓扑 ${variantId} 加载失败：${response.status}`)

    const fetchedData = await response.json() as Partial<Meta2dData>
    if (!Array.isArray(fetchedData.pens)) throw new Error(`燃气拓扑 ${variantId} 格式无效：缺少图元数组。`)
    validateGasV3TopologyPens(fetchedData.pens, variantId, variant.expectedPenCount)
    sourceData = fetchedData as Meta2dData
    sanitizeTopologyData(sourceData)
    sourceDataCache.set(variantId, cloneTopologyData(sourceData))
  }

  const data = cloneTopologyData(sourceData)
  for (const pen of data.pens) localizePenImage(pen, variantId)
  applyGasV3TopologySelectionPolicy(data.pens, variantId)

  // 只取消旧编辑器的固定纸张尺寸，让画布适应响应式容器；源图元坐标、组合关系、连线路径和倍率保持不变。
  data.width = undefined
  data.height = undefined
  return data
}

/** 仅供单元测试隔离缓存，生产代码不会清理已校验的不可变源数据。 */
export function clearGasV3TopologyPreviewDataCacheForTests(): void {
  sourceDataCache.clear()
}

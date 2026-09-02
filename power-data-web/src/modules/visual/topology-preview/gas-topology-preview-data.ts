import type { Meta2dData, Pen } from '@meta2d/core'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { applyGasTopologySelectionPolicy } from './gas-topology-selection'

/**
 * 用户提供的动态图标统一采用 WebP（网页图片格式）版本：它保留动画，同时体积约为 APNG
 *（带动画的 PNG 图片）版本的五分之一。映射键使用 JSON 图元 penId（图元标识），避免多个
 * 语义不同的图元共用一个远程图片地址时发生误替换；未列入映射的图片仍保留原始地址供诊断。
 */
const NORMAL_IMAGE_PATH_BY_PEN_ID = new Map<string, string>([
  // 企业边界和工业非军事区边界使用两项独立图元编号，不按相同图片地址自动合并。
  ['2b71305', 'icons/normal/firewall.webp'], ['388a6870', 'icons/normal/firewall.webp'],
  ['ae2d950', 'icons/normal/server.webp'],
  ['7c6036a', 'icons/normal/mirror.webp'], ['18fe83e', 'icons/normal/mirror.webp'], ['920c750', 'icons/normal/mirror.webp'],
  // 七个监控组合分别包含数据服务器、历史服务器、工程师站和操作员站；逐项登记可保证组合子图元全部本地化。
  ['28f0f8ba', 'icons/normal/server.webp'], ['032c67b', 'icons/normal/server.webp'], ['421fca00', 'icons/normal/server.webp'],
  ['62f93c8', 'icons/normal/server.webp'], ['2b28555', 'icons/normal/server.webp'], ['7489115', 'icons/normal/server.webp'],
  ['7c5f939', 'icons/normal/server.webp'],
  ['45518ad8', 'icons/normal/server.webp'], ['19742cc7', 'icons/normal/server.webp'], ['335edd99', 'icons/normal/server.webp'],
  ['63cffbbf', 'icons/normal/server.webp'], ['54cf46d9', 'icons/normal/server.webp'], ['f16e288', 'icons/normal/server.webp'],
  ['3459bcf4', 'icons/normal/server.webp'],
  ['45cf2261', 'icons/normal/desktop.webp'], ['4e4b985a', 'icons/normal/desktop.webp'], ['fd434d7', 'icons/normal/desktop.webp'],
  ['5711e3e4', 'icons/normal/desktop.webp'], ['420c522d', 'icons/normal/desktop.webp'], ['3fe42fc', 'icons/normal/desktop.webp'],
  ['5f3c5f1c', 'icons/normal/desktop.webp'],
  ['162b8a', 'icons/normal/desktop.webp'], ['3650f7f5', 'icons/normal/desktop.webp'], ['3fdbe5f9', 'icons/normal/desktop.webp'],
  ['26eb7936', 'icons/normal/desktop.webp'], ['ee99dba', 'icons/normal/desktop.webp'], ['43f27ae8', 'icons/normal/desktop.webp'],
  ['ea88a62', 'icons/normal/desktop.webp'],
  ['efdfac7', 'icons/normal/gas_turbine.webp'], ['643c415e', 'icons/normal/compressor.webp'],
  // 图源没有“脱硝装置”专用素材，显式复用同属烟气净化设备的脱硫塔动图；不得按标题运行时猜图。
  ['72e3b42a', 'icons/normal/desulfurization.webp'], ['7d7bf688', 'icons/normal/pump.webp'],
  ['17723a9e', 'icons/normal/generator.webp'], ['369a5871', 'icons/normal/hrsg.webp'], ['ed5e92c', 'icons/normal/steam_turbine.webp'],
  // 企业办公网应用终端统一使用项目现有受控办公终端素材，但仍保持一图元一编号的精确映射。
  ['8e6a7e5', 'icons/normal/office.webp'], ['1e733533', 'icons/normal/office.webp'],
  ['dcd71de', 'icons/normal/office.webp'], ['563e19a0', 'icons/normal/office.webp'],
  ['4ab519f3', 'icons/normal/office.webp'], ['a4bcf46', 'icons/normal/office.webp'],
  ['533cd1cf', 'icons/normal/dcs.webp'], ['e29514', 'icons/normal/plc.webp'], ['fa7d41a', 'icons/normal/plc.webp'],
  ['c154b27', 'icons/normal/plc.webp'], ['1c78393', 'icons/normal/dcs.webp'], ['75426ac5', 'icons/normal/dcs.webp'],
  ['782a7b2e', 'icons/normal/dcs.webp'],
])

/**
 * 四态目录与外层状态协议保持一一对应；文件名沿用已核验的正常态英文资源名。
 * 图元类型仍由上面的 penId（图元标识）精确映射决定，运行时不会按标题、坐标或文件名猜测设备类型。
 */
const ICON_DIRECTORY_BY_STATUS: Readonly<Record<TopologyDeviceStatus, string>> = Object.freeze({
  normal: 'normal',
  alarm: 'alarm',
  fault: 'fault',
  offline: 'offline',
})

/**
 * 供预览加载、正式运行画布和契约测试复用同一份四态素材路径。
 * 未登记图元返回 undefined（未定义值），避免误用其他设备动图；状态切换只替换目录，不改变已确认的设备类型。
 */
export function getGasTopologyPreviewIconPath(
  penId: string,
  status: TopologyDeviceStatus = 'normal',
): string | undefined {
  const normalPath = NORMAL_IMAGE_PATH_BY_PEN_ID.get(penId)
  if (!normalPath) return undefined
  return normalPath.replace('/normal/', `/${ICON_DIRECTORY_BY_STATUS[status]}/`)
}

/** 将已确认的四态相对路径转换为部署环境可访问的绝对资源地址。 */
export function getGasTopologyStatusIconUrl(
  penId: string,
  status: TopologyDeviceStatus,
): string | undefined {
  const relativePath = getGasTopologyPreviewIconPath(penId, status)
  return relativePath ? getGasTopologyPreviewPublicAssetUrl(relativePath) : undefined
}

/**
 * 读取应用入口模块的绝对地址。发布包采用相对基础路径（`./`）时，Vue 路由会把页面地址
 * 切换为 `/embed`；此时不能再把资源地址相对当前路由解析，必须以实际加载的入口脚本所在的
 * `shell`（嵌入壳）目录为锚点。开发模式及绝对基础路径不走该分支，不增加运行时查询成本。
 */
function getEntryModuleScriptUrl(): string | undefined {
  if (typeof document === 'undefined') return undefined
  return document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src || undefined
}

/**
 * 生成燃气拓扑公开资源地址。
 *
 * - 绝对 Vite 基础路径（前端构建工具资源前缀）继续直接拼接，兼容常规站点与子目录部署。
 * - 相对基础路径只在本地联调壳使用；从入口脚本的 `assets`（静态资源目录）向上回退一级，
 *   可稳定定位到 `shell/topology`，不会受 `/embed` 等前端路由路径影响。
 * - 可注入入口脚本地址便于单元测试覆盖发布包场景，避免测试依赖浏览器全局状态。
 */
export function getGasTopologyPreviewPublicAssetUrl(
  relativePath: string,
  viteBaseUrl = import.meta.env.BASE_URL,
  entryModuleScriptUrl = getEntryModuleScriptUrl(),
): string {
  const assetRelativePath = `topology/gas-json-preview/${relativePath}`
  if ((viteBaseUrl === './' || viteBaseUrl === '.') && entryModuleScriptUrl) {
    return new URL(`../${assetRelativePath}`, entryModuleScriptUrl).toString()
  }

  const basePath = viteBaseUrl.endsWith('/') ? viteBaseUrl : `${viteBaseUrl}/`
  return `${basePath}${assetRelativePath}`
}

/**
 * 将原图纸中的图片引用按 penId 替换为用户提供的本地 WebP 动图。
 * 函数直接更新刚刚获取、尚未交给画布的对象，避免为图元创建第二份深拷贝。
 */
function localizePenImage(pen: Pen): void {
  const localRelativePath = pen.id ? getGasTopologyPreviewIconPath(pen.id) : undefined
  if (localRelativePath) pen.image = getGasTopologyPreviewPublicAssetUrl(localRelativePath)
}

/**
 * 获取并校验原始组态数据，再只替换图片地址；坐标、层级、文字、连线、颜色和画布参数全部保留。
 */
export async function loadGasTopologyPreviewData(signal?: AbortSignal): Promise<Meta2dData> {
  const response = await fetch(getGasTopologyPreviewPublicAssetUrl('topology.json'), {
    signal,
    cache: import.meta.env.DEV ? 'no-store' : 'force-cache',
  })

  if (!response.ok) {
    throw new Error(`拓扑 JSON 加载失败：${response.status}`)
  }

  const data = await response.json() as Partial<Meta2dData>
  if (!Array.isArray(data.pens)) {
    throw new Error('拓扑 JSON 格式无效：缺少图元数组。')
  }

  for (const pen of data.pens) localizePenImage(pen)
  // 背景矩形、分区文字和连线只承担视觉分组，不参与鼠标命中；设备与底部流程节点保持只读可选。
  applyGasTopologySelectionPolicy(data.pens)

  // 数据由组态引擎 1.1.19 保存，图元坐标、尺寸和字号均与顶层 scale 构成同一套缩放链。
  // 必须保留文件中的实时倍率，再由同一引擎从该倍率等比适配当前画布；若先把 scale 归一为 1，
  // 文字会脱离图元尺寸单独放大。此处不写死倍率，后续替换新版拓扑数据时可继续沿用原始视觉比例。
  // 源 width/height 是旧编辑器的 1920×1080 纸张，直接放入响应式容器会只覆盖左侧并留下黑色空块；
  // 取消固定纸张只会让相同背景色铺满当前容器，不会改动任何业务图元。旧视口平移量由页面打开后统一居中。
  data.width = undefined
  data.height = undefined
  return data as Meta2dData
}

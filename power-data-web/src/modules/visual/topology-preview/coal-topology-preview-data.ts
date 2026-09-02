import type { Meta2dData, Pen } from '@meta2d/core'
import { applyCoalTopologySelectionPolicy } from './coal-topology-selection'

/**
 * 用户提供的动态图标统一采用 WebP（网页图片格式）版本：它保留动画，同时体积约为 APNG
 *（带动画的 PNG 图片）版本的五分之一。映射键使用 JSON 图元 penId（图元标识），避免多个
 * 语义不同的图元共用一个远程图片地址时发生误替换；未列入映射的图片仍保留原始地址供诊断。
 */
const LOCAL_IMAGE_PATH_BY_PEN_ID = new Map<string, string>([
  ['2b71305', 'icons/normal/firewall.webp'], ['30122c32', 'icons/normal/firewall.webp'],
  ['ae2d950', 'icons/normal/server.webp'], ['7c5f939', 'icons/normal/server.webp'],
  ['71863327', 'icons/normal/server.webp'], ['2dcb5e32', 'icons/normal/server.webp'], ['3459bcf4', 'icons/normal/server.webp'],
  ['efdfac7', 'icons/normal/coal_mill.webp'], ['643c415e', 'icons/normal/conveyor.webp'],
  ['72e3b42a', 'icons/normal/desulfurization.webp'], ['7d7bf688', 'icons/normal/pump.webp'],
  // 图源没有“电除尘器灰斗”专用素材，显式复用同属环保处理设备的脱硫塔动图；不得按标题运行时猜图。
  ['8c7f158', 'icons/normal/desulfurization.webp'],
  ['17723a9e', 'icons/normal/generator.webp'], ['369a5871', 'icons/normal/boiler.webp'], ['ed5e92c', 'icons/normal/steam_turbine.webp'],
  ['5f3c5f1c', 'icons/normal/desktop.webp'], ['ea88a62', 'icons/normal/desktop.webp'],
  ['d80643c', 'icons/normal/desktop.webp'], ['df77d73', 'icons/normal/desktop.webp'],
  ['9b9d1e6', 'icons/normal/office.webp'], ['18b5e2e', 'icons/normal/office.webp'],
  ['65adc3b6', 'icons/normal/office.webp'], ['021173d', 'icons/normal/office.webp'],
  ['4f68483a', 'icons/normal/office.webp'], ['8e6a7e5', 'icons/normal/office.webp'],
  ['025c248', 'icons/normal/mirror.webp'], ['68a979f', 'icons/normal/mirror.webp'], ['352337e9', 'icons/normal/mirror.webp'],
  ['533cd1cf', 'icons/normal/dcs.webp'], ['e29514', 'icons/normal/plc.webp'], ['c154b27', 'icons/normal/plc.webp'],
  ['1c78393', 'icons/normal/dcs.webp'], ['75426ac5', 'icons/normal/dcs.webp'], ['782a7b2e', 'icons/normal/dcs.webp'],
  ['fa7d41a', 'icons/normal/plc.webp'], ['521f11a', 'icons/normal/plc.webp'],
])

/** 供正式运行画布和契约测试复用同一份显式图元素材路径，未知图元不会返回猜测结果。 */
export function getCoalTopologyPreviewIconPath(penId: string): string | undefined {
  return LOCAL_IMAGE_PATH_BY_PEN_ID.get(penId)
}

/** 预览静态资源统一经 Vite 基础路径拼接，保证站点部署在子目录时仍能正确加载。 */
function getPreviewPublicAssetUrl(relativePath: string): string {
  const basePath = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  return `${basePath}topology/coal-json-preview/${relativePath}`
}

/**
 * 将原图纸中的图片引用按 penId 替换为用户提供的本地 WebP 动图。
 * 函数直接更新刚刚获取、尚未交给画布的对象，避免为图元创建第二份深拷贝。
 */
function localizePenImage(pen: Pen): void {
  const localRelativePath = pen.id ? getCoalTopologyPreviewIconPath(pen.id) : undefined
  if (localRelativePath) pen.image = getPreviewPublicAssetUrl(localRelativePath)
}

/**
 * 获取并校验原始组态数据，再只替换图片地址；坐标、层级、文字、连线、颜色和画布参数全部保留。
 */
export async function loadCoalTopologyPreviewData(signal?: AbortSignal): Promise<Meta2dData> {
  const response = await fetch(getPreviewPublicAssetUrl('topology.json'), {
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
  applyCoalTopologySelectionPolicy(data.pens)

  // 数据由组态引擎 1.1.19 保存，图元坐标、尺寸和字号均与顶层 scale 构成同一套缩放链。
  // 必须保留文件中的实时倍率，再由同一引擎从该倍率等比适配当前画布；若先把 scale 归一为 1，
  // 文字会脱离图元尺寸单独放大。此处不写死倍率，后续替换新版拓扑数据时可继续沿用原始视觉比例。
  // 源 width/height 是旧编辑器的 1920×1080 纸张，直接放入响应式容器会只覆盖左侧并留下黑色空块；
  // 取消固定纸张只会让相同背景色铺满当前容器，不会改动任何业务图元。旧视口平移量由页面打开后统一居中。
  data.width = undefined
  data.height = undefined
  return data as Meta2dData
}


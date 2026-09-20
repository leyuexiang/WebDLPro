import { LockState, type Meta2dData, type Pen } from '@meta2d/core'
import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'

/** 关键环节源副本按共享文件路径缓存；九个逻辑上下文不会重复请求、解析同一份 JSON。 */
const sourceDataByPath = new Map<string, Meta2dData>()

/** 相对部署和绝对部署共用同一 URL 解析规则，不依赖开发服务器根路径。 */
export function getProtectionProcessDetailTopologyUrl(
  topologyPath: string,
  viteBaseUrl = import.meta.env.BASE_URL,
  entryModuleScriptUrl = typeof document === 'undefined'
    ? undefined
    : document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src || undefined,
): string {
  const relativePath = `topology/${topologyPath}`
  if ((viteBaseUrl === './' || viteBaseUrl === '.') && entryModuleScriptUrl) {
    return new URL(`../${relativePath}`, entryModuleScriptUrl).toString()
  }
  const basePath = viteBaseUrl.endsWith('/') ? viteBaseUrl : `${viteBaseUrl}/`
  return `${basePath}${relativePath}`
}

/**
 * 解除覆盖整张图的顶层组合。子图元坐标从父级比例坐标换算为世界坐标，画面位置保持不变，
 * 但点击设备时不会再激活整张图；内部小组合仍保留视觉结构。
 */
export function removeProtectionTopologyRootCombines(pens: Pen[]): void {
  const rootIndexes: number[] = []
  for (let index = 0; index < pens.length; index += 1) {
    const root = pens[index]
    if (root?.name !== 'combine' || root.parentId || !root.id) continue
    if (![root.x, root.y, root.width, root.height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`保护拓扑顶层组合几何数据无效：${root.id}`)
    }
    for (const pen of pens) {
      if (pen.parentId !== root.id) continue
      if (![pen.x, pen.y, pen.width, pen.height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
        throw new Error(`保护拓扑子图元几何数据无效：${pen.id ?? '未知图元'}`)
      }
      pen.x = root.x! + pen.x! * root.width!
      pen.y = root.y! + pen.y! * root.height!
      pen.width = pen.width! * root.width!
      pen.height = pen.height! * root.height!
      pen.parentId = undefined
    }
    rootIndexes.push(index)
  }
  for (let index = rootIndexes.length - 1; index >= 0; index -= 1) pens.splice(rootIndexes[index]!, 1)
}

/** 只允许上下文显式绑定的设备命中；背景、标题、区域框和线段均不截获点击。 */
function applyProtectionSelectionPolicy(pens: Pen[], context: TopologyDataContext): void {
  const selectablePenIds = new Set(context.bindings.map((binding) => binding.penId))
  for (const pen of pens) {
    pen.locked = pen.id && selectablePenIds.has(pen.id) ? LockState.DisableEdit : LockState.Disable
  }
}

/** 加载并克隆单份保护拓扑，保证场景状态、引擎计算字段和选择效果互不污染。 */
export async function loadProtectionProcessDetailTopologyData(
  context: TopologyDataContext,
  signal?: AbortSignal,
): Promise<Meta2dData> {
  if (context.renderer !== 'manifest-json') throw new Error(`保护拓扑渲染器不匹配：${context.contextId}`)
  let source = sourceDataByPath.get(context.topologyPath)
  if (!source) {
    const response = await fetch(getProtectionProcessDetailTopologyUrl(context.topologyPath), {
      signal,
      cache: import.meta.env.DEV ? 'no-store' : 'force-cache',
    })
    if (!response.ok) throw new Error(`保护拓扑加载失败：${response.status}`)
    const loaded = await response.json() as Partial<Meta2dData>
    if (!Array.isArray(loaded.pens) || loaded.pens.length !== context.expectedPenCount) {
      throw new Error(`保护拓扑图元数量异常：${context.contextId}`)
    }
    source = loaded as Meta2dData
    sourceDataByPath.set(context.topologyPath, structuredClone(source))
  }
  const data = structuredClone(source)
  removeProtectionTopologyRootCombines(data.pens)
  applyProtectionSelectionPolicy(data.pens, context)
  data.width = undefined
  data.height = undefined
  return data
}

/** 仅供测试隔离模块缓存，生产运行时保持三文件级缓存。 */
export function clearProtectionProcessDetailTopologyCacheForTests(): void {
  sourceDataByPath.clear()
}

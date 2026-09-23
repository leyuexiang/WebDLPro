import { LockState, type Meta2dData } from '@meta2d/core'
import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'
import { getTopologySharedPublicAssetUrl } from './topology-shared-assets'

const PATH_BY_CONTEXT = new Map([
  ['process-detail.wind-power.wind-turbine', 'process-detail/wind-power/wind-turbine/topology.json'],
  ['process-detail.wind-power.gearbox', 'process-detail/wind-power/gearbox/topology.json'],
])
const IMAGE_MAP: Readonly<Record<string, string>> = Object.freeze({
  '/material/装饰/流光3.png': 'background/flow-light-3.png',
  '/cloud/2026/09/09/19/01a085ee-550a-730f-88af-d790f1148bcd.png': 'assets/chemical-water-control.png',
  '/cloud/2026/09/09/19/01a085ee-07b2-7487-a60f-a54b4ebc048c.png': 'assets/chemical-water-control.png',
  '/cloud/2026/09/09/19/01a085ee-352c-7587-ba00-b77266e4aaf6.png': 'assets/chemical-water-control.png',
  '/cloud/2026/09/01/22/01a05d75-b20c-7e1f-9f04-6f70a3344851.png': 'assets/boiler-safety-control.png',
  '/cloud/2026/09/15/17/01a0a44f-adaf-7ebf-b5e5-46566af514d0.png': 'assets/24ebf71e12d52b8eefa670e47598f2d2a983ad9c8144a48c54995269286485f4.png',
  '/cloud/2026/09/15/17/01a0a44e-c9b0-74d9-9ef4-69fdd545759b.png': 'assets/3bccb7e7c803d154697613cbf9442e7a1a0558ae700eff0fe525e3fa1540b50f.png',
  '/cloud/2026/09/15/17/01a0a44f-0f9d-7d98-bf20-22d7f35114f5.png': 'assets/c22310dddba4eac96f3576338f9fb8c1a3c8c35c8135860d41f65a2bc919b8b4.png',
  '/cloud/2026/09/09/20/01a08639-799b-7a65-8a8f-e31e02cb35fe.png': 'assets/21960efa9d7b5349021290020a64889d5bf9116717949f55b5be9225fe67162a.png',
  '/cloud/2026/09/09/20/01a08639-15ae-7ed0-9ab4-539dee85ade1.png': 'assets/fc2eb70c87fa47ee40600832dd9de280ba60b79aedbaaf99304ed30043fd5ffb.png',
})

/** 风电第三层只读取显式登记文件，图片统一转换为公共资源地址。 */
export async function loadWindProcessDetailTopologyData(context: TopologyDataContext, signal?: AbortSignal): Promise<Meta2dData> {
  const path = PATH_BY_CONTEXT.get(context.contextId)
  if (context.renderer !== 'manifest-json' || !path || path !== context.topologyPath) throw new Error(`风电关键环节上下文未登记：${context.contextId}`)
  const response = await fetch(`${import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`}topology/${path}`, { signal, cache: import.meta.env.DEV ? 'no-store' : 'force-cache' })
  if (!response.ok) throw new Error(`风电关键环节拓扑加载失败：${context.contextId}`)
  const source = await response.json() as Meta2dData
  if (!Array.isArray(source.pens) || source.pens.length !== context.expectedPenCount) throw new Error(`风电关键环节图元数量异常：${context.contextId}`)
  const data = structuredClone(source)
  for (const pen of data.pens) {
    if (![pen.x, pen.y, pen.width, pen.height].every((value) => typeof value === 'number' && Number.isFinite(value))) throw new Error(`风电关键环节图元几何值无效：${context.contextId}`)
    if (pen.image) {
      const sharedPath = IMAGE_MAP[pen.image]
      if (!sharedPath) throw new Error(`风电关键环节图片未登记：${pen.image}`)
      pen.image = getTopologySharedPublicAssetUrl(sharedPath)
    }
    pen.locked = context.bindings.some((binding) => binding.penId === pen.id) ? LockState.DisableEdit : LockState.Disable
  }
  const runtimeData = data as Meta2dData & { enableMock?: boolean; dataPoints?: unknown[]; networks?: unknown[]; initJs?: string }
  runtimeData.enableMock = false
  runtimeData.dataPoints = []
  runtimeData.networks = []
  runtimeData.initJs = ''
  data.width = undefined
  data.height = undefined
  return data
}

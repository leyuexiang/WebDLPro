import type { Pen } from '@meta2d/core'

/** 四个站类拓扑共用的资源索引；图元是否有三维映射不参与二维可选性判断。 */
export interface SubstationTopologyNodeManifest {
  readonly devicePenIds: ReadonlySet<string>
  readonly processNodePenIds: ReadonlySet<string>
  readonly titleBackgroundPenIds: ReadonlySet<string>
}

/**
 * 生成当前文件的连线端点索引。
 * 拓扑源文件用连线锚点的 connectTo（连接目标）声明工艺节点，不能依赖文字、坐标或图标推断。
 */
function createConnectedNodeIdSet(pens: readonly Pen[]): ReadonlySet<string> {
  const connectedNodeIds = new Set<string>()
  for (const pen of pens) {
    if (pen.name !== 'line') continue
    for (const anchor of pen.anchors ?? []) {
      if (typeof anchor.connectTo === 'string' && anchor.connectTo.length > 0) {
        connectedNodeIds.add(anchor.connectTo)
      }
    }
  }
  return connectedNodeIds
}

/**
 * 计算四个站类当前筛选文件里所有业务节点的图元编号。
 * 设备图元按图片和资源清单确认，工艺节点按资源清单或连线端点确认；标题、连线和组合装饰始终排除。
 * 该索引只在文件载入时构建一次，点击热路径仍由公共画布统一处理。
 */
export function getSubstationTopologySelectablePenIds(
  pens: readonly Pen[],
  manifest: SubstationTopologyNodeManifest,
): ReadonlySet<string> {
  const connectedNodeIds = createConnectedNodeIdSet(pens)
  const selectableIds = new Set<string>()
  for (const pen of pens) {
    if (!pen.id || pen.name === 'line' || pen.name === 'combine' || manifest.titleBackgroundPenIds.has(pen.id)) continue
    const isDeviceNode = Boolean(pen.image) || manifest.devicePenIds.has(pen.id)
    const isProcessNode = manifest.processNodePenIds.has(pen.id) || connectedNodeIds.has(pen.id)
    if (isDeviceNode || isProcessNode) selectableIds.add(pen.id)
  }
  return selectableIds
}

import type { Meta2dData } from '@meta2d/core'
import type { ProcessNodeId } from '@/config/process/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { getWindTopologyStatusIconUrl } from './wind-topology-preview-data'
import type { WindTopologyRuntimeBinding } from './wind-topology-runtime-bindings'
import type { WindTopologyVariantId } from './wind-topology-variant-manifest'

/**
 * 在二维组态引擎打开目标文件前，将此刻最新的中央业务状态快照投影到目标设备图片。
 * 不存在的图元不会被创建；返回值只记录实际写入项，供打开后的增量更新缓存使用。
 */
export function projectWindTopologyStatusesBeforeOpen(
  data: Meta2dData,
  variantId: WindTopologyVariantId,
  bindings: readonly WindTopologyRuntimeBinding[],
  hasActiveNode: (nodeId: ProcessNodeId) => boolean,
  getEffectiveNodeStatus: (nodeId: ProcessNodeId) => TopologyDeviceStatus,
): ReadonlyMap<string, TopologyDeviceStatus> {
  const penById = new Map(data.pens.filter((pen) => Boolean(pen.id)).map((pen) => [pen.id!, pen]))
  const projectedStatuses = new Map<string, TopologyDeviceStatus>()
  for (const binding of bindings) {
    const pen = penById.get(binding.penId)
    if (!pen) continue
    const status = hasActiveNode(binding.nodeId) ? getEffectiveNodeStatus(binding.nodeId) : 'normal'
    const image = getWindTopologyStatusIconUrl(variantId, binding.penId, status)
    if (!image) continue
    pen.image = image
    projectedStatuses.set(binding.penId, status)
  }
  return projectedStatuses
}

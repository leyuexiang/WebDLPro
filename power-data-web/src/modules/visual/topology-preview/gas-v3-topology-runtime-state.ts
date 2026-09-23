import type { Meta2dData } from '@meta2d/core'
import type { ProcessNodeId } from '@/config/process/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { getGasV3TopologyStatusIconUrl } from './gas-v3-topology-preview-data'
import type { GasV3TopologyRuntimeBinding } from './gas-v3-topology-runtime-bindings'
import type { GasV3TopologyVariantId } from './gas-v3-topology-variant-manifest'

/**
 * 在二维组态引擎打开目标文件前，把中央业务状态快照写入目标设备图片。
 * 目标图元不存在时不创建占位物；返回的缓存仅包含实际写入的图元，供后续增量状态更新使用。
 */
export function projectGasV3TopologyStatusesBeforeOpen(
  data: Meta2dData,
  variantId: GasV3TopologyVariantId,
  bindings: readonly GasV3TopologyRuntimeBinding[],
  hasActiveNode: (nodeId: ProcessNodeId) => boolean,
  getEffectiveNodeStatus: (nodeId: ProcessNodeId) => TopologyDeviceStatus,
): ReadonlyMap<string, TopologyDeviceStatus> {
  const penById = new Map(data.pens.filter((pen) => Boolean(pen.id)).map((pen) => [pen.id!, pen]))
  const projectedStatuses = new Map<string, TopologyDeviceStatus>()
  for (const binding of bindings) {
    const pen = penById.get(binding.penId)
    if (!pen) continue
    const status = hasActiveNode(binding.nodeId) ? getEffectiveNodeStatus(binding.nodeId) : 'normal'
    const image = getGasV3TopologyStatusIconUrl(variantId, binding.penId, status)
    if (!image) continue
    pen.image = image
    projectedStatuses.set(binding.penId, status)
  }
  return projectedStatuses
}

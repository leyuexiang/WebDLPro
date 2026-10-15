import type { ProcessNodeId } from '@/config/process/identifiers'
import type { SceneNodeId } from '@/config/scene-topology/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'
import type { WindTopologyVariantId } from './wind-topology-variant-manifest'
export interface WindTopologyRuntimeBinding {
  readonly penId: string
  readonly nodeId: ProcessNodeId
  readonly sceneNodeId?: SceneNodeId
}
/** 尚无用户确认的业务与三维映射；保持空绑定，禁止借用其他场景编号或按标题猜测。 */
const UNBOUND: readonly WindTopologyRuntimeBinding[] = Object.freeze([])
export function getWindTopologyRuntimeBindings(_variantId: WindTopologyVariantId): readonly WindTopologyRuntimeBinding[] { return UNBOUND }
/**
 * 为当前文件一次性构建正反索引；状态、二维选择和三维反向选择均通过常数时间查询完成。
 * 切换版本后必须重建索引，禁止跨文件沿用图元编号。
 */
export function createWindTopologyRuntimeBindingIndex(
  variantId: WindTopologyVariantId = 'network-business-key-process',
): {
  readonly nodeIdByPenId: ReadonlyMap<string, ProcessNodeId>
  readonly sceneNodeIdByPenId: ReadonlyMap<string, SceneNodeId>
  readonly penIdsByNodeId: ReadonlyMap<ProcessNodeId, readonly string[]>
} {
  const nodeIdByPenId = new Map<string, ProcessNodeId>()
  const sceneNodeIdByPenId = new Map<string, SceneNodeId>()
  const mutablePenIdsByNodeId = new Map<ProcessNodeId, string[]>()
  for (const binding of getWindTopologyRuntimeBindings(variantId)) {
    nodeIdByPenId.set(binding.penId, binding.nodeId)
    if (binding.sceneNodeId) sceneNodeIdByPenId.set(binding.penId, binding.sceneNodeId)
    const penIds = mutablePenIdsByNodeId.get(binding.nodeId)
    if (penIds) penIds.push(binding.penId)
    else mutablePenIdsByNodeId.set(binding.nodeId, [binding.penId])
  }
  const penIdsByNodeId = new Map<ProcessNodeId, readonly string[]>()
  for (const [nodeId, penIds] of mutablePenIdsByNodeId) penIdsByNodeId.set(nodeId, Object.freeze(penIds))
  return { nodeIdByPenId, sceneNodeIdByPenId, penIdsByNodeId }
}

/** 默认三层整图导出仅兼容既有检查；切层运行时必须按版本读取。 */
export const WIND_TOPOLOGY_RUNTIME_BINDINGS = getWindTopologyRuntimeBindings('network-business-key-process')

/** 四态中文标签与平台状态协议一一对应，提示和状态图片使用同一来源。 */
export const WIND_TOPOLOGY_STATUS_PRESENTATION: Readonly<Record<TopologyDeviceStatus, {
  readonly label: string
}>> = Object.freeze({
  normal: { label: '正常' }, alarm: { label: '告警' }, fault: { label: '故障' }, offline: { label: '离线' },
})

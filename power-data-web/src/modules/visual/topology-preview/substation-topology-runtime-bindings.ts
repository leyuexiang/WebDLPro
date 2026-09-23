import { toProcessNodeId, type ProcessNodeId } from '@/config/process/identifiers'
import { toSceneNodeId, type SceneNodeId } from '@/config/scene-topology/identifiers'

/** 拓扑图元到业务节点、三维场景节点的正式绑定记录。 */
export interface SubstationTopologyRuntimeBinding {
  readonly penId: string
  readonly nodeId: ProcessNodeId
  readonly sceneNodeId: SceneNodeId
}

/**
 * 四个站点共用的索引构造器。
 * 绑定表由各场景文件显式提供，运行时只做哈希索引，不按标题、坐标或数组位置推导。
 */
export function createSubstationTopologyRuntimeBindingIndex(
  bindings: readonly SubstationTopologyRuntimeBinding[],
) {
  const nodeIdByPenId = new Map<string, ProcessNodeId>()
  const sceneNodeIdByPenId = new Map<string, SceneNodeId>()
  const penIdsByNodeId = new Map<ProcessNodeId, string[]>()
  for (const binding of bindings) {
    nodeIdByPenId.set(binding.penId, binding.nodeId)
    sceneNodeIdByPenId.set(binding.penId, binding.sceneNodeId)
    const penIds = penIdsByNodeId.get(binding.nodeId)
    if (penIds) penIds.push(binding.penId)
    else penIdsByNodeId.set(binding.nodeId, [binding.penId])
  }
  return {
    nodeIdByPenId,
    sceneNodeIdByPenId,
    penIdsByNodeId: new Map([...penIdsByNodeId].map(([nodeId, penIds]) => [nodeId, Object.freeze(penIds)])),
  }
}

export const stationNode = (nodeId: string, sceneNodeId: string): Omit<SubstationTopologyRuntimeBinding, 'penId'> => ({
  nodeId: toProcessNodeId(nodeId),
  sceneNodeId: toSceneNodeId(sceneNodeId),
})

import type { ProcessNodeId } from '@/config/process/identifiers'
import { toProcessNodeId } from '@/config/process/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'
import type { SceneNodeId } from '@/config/scene-topology/identifiers'
import { toSceneNodeId } from '@/config/scene-topology/identifiers'

export interface CoalTopologyRuntimeBinding {
  readonly penId: string
  readonly nodeId: ProcessNodeId
  /**
   * 当前燃煤场景登记的三维节点；未登记时保持 undefined，避免把没有唯一模型的图元
   * 错误投影到三维场景。已登记项必须保持图元、sceneNodeId 与模型严格一对一。
   */
  readonly sceneNodeId?: SceneNodeId
}

/**
 * 模块加载时只校验一次正式标识，后续图元表直接复用这些不可变值。
 * 当前只登记能在燃煤场景中找到唯一独立模型的五个现场设备图元，确保二维图元、
 * 三维 sceneNodeId（三维场景节点标识）与模型渲染器严格一对一。
 */
const COAL_FEEDER_NODE_ID = toProcessNodeId('asset.coal-mill-actuator')
const COAL_BOILER_NODE_ID = toProcessNodeId('system.boiler-dcs')
const COAL_STEAM_TURBINE_NODE_ID = toProcessNodeId('system.steam-turbine-dcs')
const COAL_GENERATOR_NODE_ID = toProcessNodeId('system.generator-excitation-controller')
const COAL_PRECIPITATOR_NODE_ID = toProcessNodeId('system.coal-handling-ash-plc')
const COAL_FEEDER_SCENE_NODE_ID = toSceneNodeId('node.coal-feeder')
const COAL_BOILER_SCENE_NODE_ID = toSceneNodeId('node.coal-boiler')
const COAL_STEAM_TURBINE_SCENE_NODE_ID = toSceneNodeId('node.coal-steam-turbine')
const COAL_GENERATOR_SCENE_NODE_ID = toSceneNodeId('node.coal-generator')
const COAL_PRECIPITATOR_SCENE_NODE_ID = toSceneNodeId('node.coal-precipitator')

/**
 * 新版燃煤 JSON 图元到正式节点和 Unity 模型的显式一对一映射。
 *
 * 只保留当前场景中能够明确找到唯一模型的五个现场设备图元：磨煤机/给煤机、锅炉炉膛、
 * 汽轮机、发电机和高电除尘器灰斗。控制器图元与缺少唯一模型的输煤皮带、反渗透高压泵、
 * 脱硝/脱硫图元继续只负责展示，避免一次三维点击同时选中多个二维图元。
 */
export const COAL_TOPOLOGY_RUNTIME_BINDINGS = Object.freeze([
  { penId: 'efdfac7', nodeId: COAL_FEEDER_NODE_ID, sceneNodeId: COAL_FEEDER_SCENE_NODE_ID },
  { penId: '369a5871', nodeId: COAL_BOILER_NODE_ID, sceneNodeId: COAL_BOILER_SCENE_NODE_ID },
  { penId: 'ed5e92c', nodeId: COAL_STEAM_TURBINE_NODE_ID, sceneNodeId: COAL_STEAM_TURBINE_SCENE_NODE_ID },
  { penId: '17723a9e', nodeId: COAL_GENERATOR_NODE_ID, sceneNodeId: COAL_GENERATOR_SCENE_NODE_ID },
  { penId: '8c7f158', nodeId: COAL_PRECIPITATOR_NODE_ID, sceneNodeId: COAL_PRECIPITATOR_SCENE_NODE_ID },
] satisfies readonly CoalTopologyRuntimeBinding[])

/** 单次构建正反索引，悬浮和点击均保持常数时间，不在新版图片图元中重复扫描。 */
export function createCoalTopologyRuntimeBindingIndex(): {
  readonly nodeIdByPenId: ReadonlyMap<string, ProcessNodeId>
  readonly sceneNodeIdByPenId: ReadonlyMap<string, SceneNodeId>
  readonly penIdsByNodeId: ReadonlyMap<ProcessNodeId, readonly string[]>
} {
  const nodeIdByPenId = new Map<string, ProcessNodeId>()
  const sceneNodeIdByPenId = new Map<string, SceneNodeId>()
  const mutablePenIdsByNodeId = new Map<ProcessNodeId, string[]>()

  for (const binding of COAL_TOPOLOGY_RUNTIME_BINDINGS) {
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

/** 四态颜色与原拓扑语义一致，只作为新版动态图片旁的轻量状态标记，不改变原图纸布局。 */
export const COAL_TOPOLOGY_STATUS_PRESENTATION: Readonly<Record<TopologyDeviceStatus, {
  readonly label: string
  readonly color: string
  readonly filter: string
}>> = Object.freeze({
  normal: { label: '正常', color: '#22c55e', filter: 'none' },
  alarm: { label: '告警', color: '#f59e0b', filter: 'drop-shadow(0 0 5px #f59e0b)' },
  fault: { label: '故障', color: '#ef4444', filter: 'drop-shadow(0 0 6px #ef4444)' },
  offline: { label: '离线', color: '#94a3b8', filter: 'grayscale(1) opacity(0.55)' },
})


import type { ProcessNodeId } from '@/config/process/identifiers'
import { toProcessNodeId } from '@/config/process/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'
import type { SceneNodeId } from '@/config/scene-topology/identifiers'
import { toSceneNodeId } from '@/config/scene-topology/identifiers'
import type { CoalTopologyVariantId } from './coal-topology-variant-manifest'

export interface CoalTopologyRuntimeBinding {
  readonly penId: string
  readonly nodeId: ProcessNodeId
  /** 只有在当前燃煤场景中存在唯一模型证据时才登记三维场景节点编号。 */
  readonly sceneNodeId?: SceneNodeId
}

/** 三个已确认现场设备复用正式业务编号与唯一三维模型编号，模块加载时只校验一次。 */
const COAL_BOILER_NODE_ID = toProcessNodeId('system.boiler-dcs')
const COAL_STEAM_TURBINE_NODE_ID = toProcessNodeId('system.steam-turbine-dcs')
const COAL_GENERATOR_NODE_ID = toProcessNodeId('system.generator-excitation-controller')
const COAL_BOILER_SCENE_NODE_ID = toSceneNodeId('node.coal-boiler')
const COAL_STEAM_TURBINE_SCENE_NODE_ID = toSceneNodeId('node.coal-steam-turbine')
const COAL_GENERATOR_SCENE_NODE_ID = toSceneNodeId('node.coal-generator')

/** 按目标文件中的独立图元编号创建三个已确认设备的不可变绑定。 */
function bindConfirmedDevices(ids: {
  readonly boiler: string
  readonly steamTurbine: string
  readonly generator: string
}): readonly CoalTopologyRuntimeBinding[] {
  return Object.freeze([
    Object.freeze({ penId: ids.boiler, nodeId: COAL_BOILER_NODE_ID, sceneNodeId: COAL_BOILER_SCENE_NODE_ID }),
    Object.freeze({ penId: ids.steamTurbine, nodeId: COAL_STEAM_TURBINE_NODE_ID, sceneNodeId: COAL_STEAM_TURBINE_SCENE_NODE_ID }),
    Object.freeze({ penId: ids.generator, nodeId: COAL_GENERATOR_NODE_ID, sceneNodeId: COAL_GENERATOR_SCENE_NODE_ID }),
  ])
}

/**
 * 八份输入文件的绑定相互隔离。只迁移已有正式燃煤拓扑确认过的锅炉、汽轮机和发电机；
 * 不含这三个设备的网络、业务及网络业务组合只保留中央状态快照，不创建视觉占位。
 */
export const COAL_TOPOLOGY_RUNTIME_BINDINGS_BY_VARIANT_ID: ReadonlyMap<
  CoalTopologyVariantId,
  readonly CoalTopologyRuntimeBinding[]
> = new Map([
  ['architecture', bindConfirmedDevices({ boiler: '6e5fb55c', steamTurbine: '89854a4', generator: 'f13c58a' })],
  ['network', Object.freeze([])],
  ['business', Object.freeze([])],
  ['key-process', bindConfirmedDevices({ boiler: '2a01627b', steamTurbine: '271db7a', generator: '8e17c6' })],
  ['network-business', Object.freeze([])],
  ['network-key-process', bindConfirmedDevices({ boiler: '37330c6c', steamTurbine: 'cd9d874', generator: '3253036' })],
  ['business-key-process', bindConfirmedDevices({ boiler: '138c356', steamTurbine: '6ca4ed1', generator: '49768f46' })],
  ['network-business-key-process', bindConfirmedDevices({
    boiler: '4d87c9a3', steamTurbine: '69d36f83', generator: 'c1ee89f',
  })],
  ['process-detail-boiler', Object.freeze([
    Object.freeze({ penId: '2a01627b', nodeId: COAL_BOILER_NODE_ID, sceneNodeId: COAL_BOILER_SCENE_NODE_ID }),
    Object.freeze({ penId: '271db7a', nodeId: COAL_STEAM_TURBINE_NODE_ID, sceneNodeId: COAL_STEAM_TURBINE_SCENE_NODE_ID }),
    Object.freeze({ penId: '8e17c6', nodeId: COAL_GENERATOR_NODE_ID, sceneNodeId: COAL_GENERATOR_SCENE_NODE_ID }),
  ])],
  ['process-detail-steam-turbine', Object.freeze([
    // 关键环节文件中的汽轮机与数字电调均明确属于汽机控制单元，两个图元同步四态。
    Object.freeze({ penId: 'baf5ab7', nodeId: COAL_STEAM_TURBINE_NODE_ID, sceneNodeId: COAL_STEAM_TURBINE_SCENE_NODE_ID }),
    Object.freeze({ penId: 'b9ae43', nodeId: COAL_STEAM_TURBINE_NODE_ID, sceneNodeId: COAL_STEAM_TURBINE_SCENE_NODE_ID }),
  ])],
])

/** 严格读取目标版本绑定；缺项属于开发配置错误，不能回退到另一文件的图元编号。 */
export function getCoalTopologyRuntimeBindings(
  variantId: CoalTopologyVariantId,
): readonly CoalTopologyRuntimeBinding[] {
  const bindings = COAL_TOPOLOGY_RUNTIME_BINDINGS_BY_VARIANT_ID.get(variantId)
  if (!bindings) throw new Error(`燃煤拓扑版本缺少运行时绑定：${variantId}`)
  return bindings
}

/**
 * 为当前文件一次性构建正反索引；状态、二维选择和三维反向选择均通过常数时间查询完成。
 * 切换版本后必须重建索引，禁止跨文件沿用图元编号。
 */
export function createCoalTopologyRuntimeBindingIndex(
  variantId: CoalTopologyVariantId = 'network-business-key-process',
): {
  readonly nodeIdByPenId: ReadonlyMap<string, ProcessNodeId>
  readonly sceneNodeIdByPenId: ReadonlyMap<string, SceneNodeId>
  readonly penIdsByNodeId: ReadonlyMap<ProcessNodeId, readonly string[]>
} {
  const nodeIdByPenId = new Map<string, ProcessNodeId>()
  const sceneNodeIdByPenId = new Map<string, SceneNodeId>()
  const mutablePenIdsByNodeId = new Map<ProcessNodeId, string[]>()
  for (const binding of getCoalTopologyRuntimeBindings(variantId)) {
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
export const COAL_TOPOLOGY_RUNTIME_BINDINGS = getCoalTopologyRuntimeBindings('network-business-key-process')

/** 四态中文标签与平台状态协议一一对应，提示和状态图片使用同一来源。 */
export const COAL_TOPOLOGY_STATUS_PRESENTATION: Readonly<Record<TopologyDeviceStatus, {
  readonly label: string
}>> = Object.freeze({
  normal: { label: '正常' }, alarm: { label: '告警' }, fault: { label: '故障' }, offline: { label: '离线' },
})

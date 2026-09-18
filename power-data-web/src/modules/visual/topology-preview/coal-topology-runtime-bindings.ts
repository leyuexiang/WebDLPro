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

/** 三个上层控制系统与三个下层现场设备使用不同业务编号和场景节点编号。 */
const COAL_BOILER_CONTROL_NODE_ID = toProcessNodeId('system.coal-boiler-control')
const COAL_STEAM_TURBINE_CONTROL_NODE_ID = toProcessNodeId('system.coal-steam-turbine-control')
const COAL_GENERATOR_CONTROL_NODE_ID = toProcessNodeId('system.coal-generator-control')
const COAL_BOILER_DEVICE_NODE_ID = toProcessNodeId('asset.coal-boiler')
const COAL_STEAM_TURBINE_DEVICE_NODE_ID = toProcessNodeId('asset.coal-steam-turbine')
const COAL_GENERATOR_DEVICE_NODE_ID = toProcessNodeId('asset.coal-generator')
const COAL_BOILER_CONTROL_SCENE_NODE_ID = toSceneNodeId('unit.coal-boiler.control')
const COAL_STEAM_TURBINE_CONTROL_SCENE_NODE_ID = toSceneNodeId('unit.coal-steam-turbine.control')
const COAL_GENERATOR_CONTROL_SCENE_NODE_ID = toSceneNodeId('unit.coal-generator.control')
const COAL_BOILER_DEVICE_SCENE_NODE_ID = toSceneNodeId('node.coal-boiler')
const COAL_STEAM_TURBINE_DEVICE_SCENE_NODE_ID = toSceneNodeId('node.coal-steam-turbine')
const COAL_GENERATOR_DEVICE_SCENE_NODE_ID = toSceneNodeId('node.coal-generator')

interface CoalControlAndDevicePenIds {
  readonly boilerControl: string
  readonly steamTurbineControl: string
  readonly generatorControl: string
  readonly boilerDevice?: string
  readonly steamTurbineDevice?: string
  readonly generatorDevice?: string
}

/** 控制系统只负责拓扑到三维聚焦；现场设备负责单模型聚焦、三维反选和四态。 */
function bindControlAndDeviceNodes(ids: CoalControlAndDevicePenIds): readonly CoalTopologyRuntimeBinding[] {
  const bindings: CoalTopologyRuntimeBinding[] = [
    Object.freeze({ penId: ids.boilerControl, nodeId: COAL_BOILER_CONTROL_NODE_ID, sceneNodeId: COAL_BOILER_CONTROL_SCENE_NODE_ID }),
    Object.freeze({ penId: ids.steamTurbineControl, nodeId: COAL_STEAM_TURBINE_CONTROL_NODE_ID, sceneNodeId: COAL_STEAM_TURBINE_CONTROL_SCENE_NODE_ID }),
    Object.freeze({ penId: ids.generatorControl, nodeId: COAL_GENERATOR_CONTROL_NODE_ID, sceneNodeId: COAL_GENERATOR_CONTROL_SCENE_NODE_ID }),
  ]
  if (ids.boilerDevice) {
    bindings.push(Object.freeze({ penId: ids.boilerDevice, nodeId: COAL_BOILER_DEVICE_NODE_ID, sceneNodeId: COAL_BOILER_DEVICE_SCENE_NODE_ID }))
  }
  if (ids.steamTurbineDevice) {
    bindings.push(Object.freeze({ penId: ids.steamTurbineDevice, nodeId: COAL_STEAM_TURBINE_DEVICE_NODE_ID, sceneNodeId: COAL_STEAM_TURBINE_DEVICE_SCENE_NODE_ID }))
  }
  if (ids.generatorDevice) {
    bindings.push(Object.freeze({ penId: ids.generatorDevice, nodeId: COAL_GENERATOR_DEVICE_NODE_ID, sceneNodeId: COAL_GENERATOR_DEVICE_SCENE_NODE_ID }))
  }
  return Object.freeze(bindings)
}

/**
 * 八份输入文件的绑定相互隔离。只迁移已有正式燃煤拓扑确认过的锅炉、汽轮机和发电机；
 * 不含这三个设备的网络、业务及网络业务组合只保留中央状态快照，不创建视觉占位。
 */
export const COAL_TOPOLOGY_RUNTIME_BINDINGS_BY_VARIANT_ID: ReadonlyMap<
  CoalTopologyVariantId,
  readonly CoalTopologyRuntimeBinding[]
> = new Map([
  ['architecture', bindControlAndDeviceNodes({
    boilerControl: 'a2dad7b', steamTurbineControl: 'a1d78e1', generatorControl: '61fc2f3',
    boilerDevice: '6e5fb55c', steamTurbineDevice: '89854a4', generatorDevice: 'f13c58a',
  })],
  ['network', bindControlAndDeviceNodes({
    boilerControl: '5c4ccdc3', steamTurbineControl: '54656a8f', generatorControl: '1020cee',
  })],
  ['business', Object.freeze([])],
  ['key-process', bindControlAndDeviceNodes({
    boilerControl: '4f007812', steamTurbineControl: '1965c29e', generatorControl: '61224818',
    boilerDevice: '2a01627b', steamTurbineDevice: '271db7a', generatorDevice: '8e17c6',
  })],
  ['network-business', bindControlAndDeviceNodes({
    boilerControl: '28ad5ca', steamTurbineControl: '6d7e2838', generatorControl: 'b3d4c7b',
  })],
  ['network-key-process', bindControlAndDeviceNodes({
    boilerControl: '077b9d', steamTurbineControl: '092ecd', generatorControl: '1247290',
    boilerDevice: '37330c6c', steamTurbineDevice: 'cd9d874', generatorDevice: '3253036',
  })],
  ['business-key-process', bindControlAndDeviceNodes({
    boilerControl: '51b2dfb', steamTurbineControl: '5e8a7a7a', generatorControl: '0d79b6',
    boilerDevice: '138c356', steamTurbineDevice: '6ca4ed1', generatorDevice: '49768f46',
  })],
  ['network-business-key-process', bindControlAndDeviceNodes({
    boilerControl: 'b6c2c58', steamTurbineControl: '21136a0', generatorControl: '11d93d44',
    boilerDevice: '4d87c9a3', steamTurbineDevice: '69d36f83', generatorDevice: 'c1ee89f',
  })],
  ['process-detail-boiler', Object.freeze([
    Object.freeze({ penId: '2a01627b', nodeId: COAL_BOILER_DEVICE_NODE_ID, sceneNodeId: COAL_BOILER_DEVICE_SCENE_NODE_ID }),
    Object.freeze({ penId: '271db7a', nodeId: COAL_STEAM_TURBINE_DEVICE_NODE_ID, sceneNodeId: COAL_STEAM_TURBINE_DEVICE_SCENE_NODE_ID }),
    Object.freeze({ penId: '8e17c6', nodeId: COAL_GENERATOR_DEVICE_NODE_ID, sceneNodeId: COAL_GENERATOR_DEVICE_SCENE_NODE_ID }),
  ])],
  ['process-detail-steam-turbine', Object.freeze([
    // 新关键环节文件中的主汽轮机使用公共四态汽轮机图标。
    Object.freeze({ penId: '429749ea', nodeId: COAL_STEAM_TURBINE_DEVICE_NODE_ID, sceneNodeId: COAL_STEAM_TURBINE_DEVICE_SCENE_NODE_ID }),
    // 锅炉和发电机复用燃煤下层现场设备的稳定业务及三维节点，切换时同步中央状态快照。
    Object.freeze({ penId: '8be4fc2', nodeId: COAL_BOILER_DEVICE_NODE_ID, sceneNodeId: COAL_BOILER_DEVICE_SCENE_NODE_ID }),
    Object.freeze({ penId: '9533a1f', nodeId: COAL_GENERATOR_DEVICE_NODE_ID, sceneNodeId: COAL_GENERATOR_DEVICE_SCENE_NODE_ID }),
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

import type { ProcessNodeId } from '@/config/process/identifiers'
import { toProcessNodeId } from '@/config/process/identifiers'
import type { SceneNodeId } from '@/config/scene-topology/identifiers'
import { toSceneNodeId } from '@/config/scene-topology/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'
import type { SolarTopologyVariantId } from './solar-topology-variant-manifest'
export interface SolarTopologyRuntimeBinding {
  readonly penId: string
  readonly nodeId: ProcessNodeId
  readonly sceneNodeId?: SceneNodeId
}

/** 光伏三维场景中已登记的两个稳定业务节点；控制节点负责聚焦，设备节点负责模型状态。 */
const SOLAR_INVERTER_CONTROL_NODE_ID = toProcessNodeId('system.solar-inverter-control')
const SOLAR_INVERTER_NODE_ID = toProcessNodeId('asset.solar-inverter')
const SOLAR_INVERTER_CONTROL_SCENE_NODE_ID = toSceneNodeId('unit.solar-inverter.control')
const SOLAR_INVERTER_SCENE_NODE_ID = toSceneNodeId('node.solar-inverter')

function bindControl(penIds: readonly string[]): readonly SolarTopologyRuntimeBinding[] {
  return penIds.map((penId) => Object.freeze({
    penId,
    nodeId: SOLAR_INVERTER_CONTROL_NODE_ID,
    sceneNodeId: SOLAR_INVERTER_CONTROL_SCENE_NODE_ID,
  }))
}

function bindDevice(penIds: readonly string[]): readonly SolarTopologyRuntimeBinding[] {
  return penIds.map((penId) => Object.freeze({
    penId,
    nodeId: SOLAR_INVERTER_NODE_ID,
    sceneNodeId: SOLAR_INVERTER_SCENE_NODE_ID,
  }))
}

/**
 * 每份独立 JSON 使用自身稳定的 penId；组合文件中重复出现的逆变器图元仍映射到同一业务节点，
 * 这样状态快照、二维选择与三维反选不会因切层或组合层发生漂移。没有目标图元的业务层保持空绑定。
 */
const SOLAR_TOPOLOGY_RUNTIME_BINDINGS_BY_VARIANT_ID: ReadonlyMap<SolarTopologyVariantId, readonly SolarTopologyRuntimeBinding[]> = new Map([
  ['architecture', Object.freeze([...bindControl(['f5185f9']), ...bindDevice(['f7bf477'])])],
  ['network', Object.freeze(bindControl(['7c5436', '32f050f8']))],
  ['business', Object.freeze([])],
  ['key-process', Object.freeze([
    ...bindControl(['0f400f1', '1a75b51e']),
    ...bindDevice(['119a9aa6', 'f7331d4']),
  ])],
  ['network-business', Object.freeze(bindControl(['0e822c6', '3a0e7852']))],
  ['network-key-process', Object.freeze([
    ...bindControl(['447525ed', '77928430']),
    ...bindDevice(['49fcb5e6', '93065bc']),
  ])],
  ['business-key-process', Object.freeze([
    ...bindControl(['75722e8b', 'c263844']),
    ...bindDevice(['f007964', '7c754099']),
  ])],
  ['network-business-key-process', Object.freeze([
    ...bindControl(['49e49f47', '7ca1b67a']),
    ...bindDevice(['6940ceef', 'ebd260c']),
  ])],
  ['process-detail-solar-inverter', Object.freeze([
    // 第三层控制器与实体逆变器只绑定压缩包中逐项核验的两个稳定图元，主控制器保持静态未绑定。
    ...bindControl(['df25e45']),
    ...bindDevice(['2cf7b170']),
  ])],
])

/** 严格按变体读取绑定；缺失登记属于发布配置错误，禁止回退到其他文件。 */
export function getSolarTopologyRuntimeBindings(variantId: SolarTopologyVariantId): readonly SolarTopologyRuntimeBinding[] {
  const bindings = SOLAR_TOPOLOGY_RUNTIME_BINDINGS_BY_VARIANT_ID.get(variantId)
  if (!bindings) throw new Error(`光伏拓扑版本缺少运行时绑定：${variantId}`)
  return bindings
}
/**
 * 为当前文件一次性构建正反索引；状态、二维选择和三维反向选择均通过常数时间查询完成。
 * 切换版本后必须重建索引，禁止跨文件沿用图元编号。
 */
export function createSolarTopologyRuntimeBindingIndex(
  variantId: SolarTopologyVariantId = 'network-business-key-process',
): {
  readonly nodeIdByPenId: ReadonlyMap<string, ProcessNodeId>
  readonly sceneNodeIdByPenId: ReadonlyMap<string, SceneNodeId>
  readonly penIdsByNodeId: ReadonlyMap<ProcessNodeId, readonly string[]>
} {
  const nodeIdByPenId = new Map<string, ProcessNodeId>()
  const sceneNodeIdByPenId = new Map<string, SceneNodeId>()
  const mutablePenIdsByNodeId = new Map<ProcessNodeId, string[]>()
  for (const binding of getSolarTopologyRuntimeBindings(variantId)) {
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
export const SOLAR_TOPOLOGY_RUNTIME_BINDINGS = getSolarTopologyRuntimeBindings('network-business-key-process')

/** 四态中文标签与平台状态协议一一对应，提示和状态图片使用同一来源。 */
export const SOLAR_TOPOLOGY_STATUS_PRESENTATION: Readonly<Record<TopologyDeviceStatus, {
  readonly label: string
}>> = Object.freeze({
  normal: { label: '正常' }, alarm: { label: '告警' }, fault: { label: '故障' }, offline: { label: '离线' },
})

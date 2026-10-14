import type { ProcessNodeId } from '@/config/process/identifiers'
import { toProcessNodeId } from '@/config/process/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'
import type { SceneNodeId } from '@/config/scene-topology/identifiers'
import { toSceneNodeId } from '@/config/scene-topology/identifiers'
import type { WindTopologyVariantId } from './wind-topology-variant-manifest'

export interface WindTopologyRuntimeBinding {
  readonly penId: string
  readonly nodeId: ProcessNodeId
  readonly sceneNodeId?: SceneNodeId
}

type WindTopologyBindingRole =
  | 'pitchControl'
  | 'converterControl'
  | 'yawControl'
  | 'drivetrainControl'
  | 'brakeControl'
  | 'pitchSystem'
  | 'converterSystem'
  | 'yawSystem'
  | 'drivetrainSystem'
  | 'brakeSystem'

/**
 * 十个二维业务身份及供 Unity 后续配置的稳定目标编号。
 * 控制系统使用 unit 聚合目标，现场系统使用 node 设备目标；中文标题和图标不参与映射。
 */
const WIND_TOPOLOGY_NODE_IDENTITIES: Readonly<Record<WindTopologyBindingRole, {
  readonly nodeId: ProcessNodeId
  readonly sceneNodeId: SceneNodeId
}>> = Object.freeze({
  pitchControl: Object.freeze({
    nodeId: toProcessNodeId('system.wind-pitch-control'),
    sceneNodeId: toSceneNodeId('unit.wind-pitch.control'),
  }),
  converterControl: Object.freeze({
    nodeId: toProcessNodeId('system.wind-converter-control'),
    sceneNodeId: toSceneNodeId('unit.wind-converter.control'),
  }),
  yawControl: Object.freeze({
    nodeId: toProcessNodeId('system.wind-yaw-control'),
    sceneNodeId: toSceneNodeId('unit.wind-yaw.control'),
  }),
  drivetrainControl: Object.freeze({
    nodeId: toProcessNodeId('system.wind-drivetrain-control'),
    sceneNodeId: toSceneNodeId('unit.wind-drivetrain.control'),
  }),
  brakeControl: Object.freeze({
    nodeId: toProcessNodeId('system.wind-brake-control'),
    sceneNodeId: toSceneNodeId('unit.wind-brake.control'),
  }),
  pitchSystem: Object.freeze({
    nodeId: toProcessNodeId('asset.wind-pitch-system'),
    sceneNodeId: toSceneNodeId('node.wind-pitch-system'),
  }),
  converterSystem: Object.freeze({
    nodeId: toProcessNodeId('asset.wind-converter-system'),
    sceneNodeId: toSceneNodeId('node.wind-converter-system'),
  }),
  yawSystem: Object.freeze({
    nodeId: toProcessNodeId('asset.wind-yaw-system'),
    sceneNodeId: toSceneNodeId('node.wind-yaw-system'),
  }),
  drivetrainSystem: Object.freeze({
    nodeId: toProcessNodeId('asset.wind-drivetrain-system'),
    sceneNodeId: toSceneNodeId('node.wind-drivetrain-system'),
  }),
  brakeSystem: Object.freeze({
    nodeId: toProcessNodeId('asset.wind-brake-system'),
    sceneNodeId: toSceneNodeId('node.wind-brake-system'),
  }),
})

type WindTopologyPenIdsByRole = Partial<Record<WindTopologyBindingRole, readonly string[]>>

/**
 * 将某一份 JSON 的图元编号显式投影到十个稳定业务身份。
 * 同一文件中重复展示的同类部件共用一条业务节点，Unity 可将它们登记为同一个聚合目标。
 */
function createWindTopologyBindings(penIdsByRole: WindTopologyPenIdsByRole): readonly WindTopologyRuntimeBinding[] {
  const bindings: WindTopologyRuntimeBinding[] = []
  for (const [role, penIds] of Object.entries(penIdsByRole) as [WindTopologyBindingRole, readonly string[]][]) {
    const identity = WIND_TOPOLOGY_NODE_IDENTITIES[role]
    for (const penId of penIds) {
      bindings.push(Object.freeze({ penId, nodeId: identity.nodeId, sceneNodeId: identity.sceneNodeId }))
    }
  }
  return Object.freeze(bindings)
}

/**
 * 八份第二层文件各自使用独立 penId；每个出现目标语义图元的版本都显式列出编号。
 * 默认三层组合含二十个 pen，十种语义各出现两次；其余版本只绑定文件中确实存在的节点。
 */
const WIND_TOPOLOGY_RUNTIME_BINDINGS_BY_VARIANT_ID: ReadonlyMap<WindTopologyVariantId, readonly WindTopologyRuntimeBinding[]> = new Map([
  ['architecture', createWindTopologyBindings({
    pitchControl: ['b8d197d'],
    yawControl: ['1ae02016'],
    drivetrainSystem: ['eca11c6'],
    brakeSystem: ['3518b49'],
  })],
  ['network', createWindTopologyBindings({
    pitchControl: ['a8f94f6', '288459b2'],
    yawControl: ['b7884e6', '6a0e5a0e'],
    drivetrainSystem: ['6d463462', '7100f20'],
    brakeSystem: ['4e4e4b', '779c4bd9'],
  })],
  ['business', Object.freeze([])],
  ['key-process', createWindTopologyBindings({
    pitchControl: ['9396e06', '4d345e6'],
    yawControl: ['15b49d26', '60369370'],
    drivetrainSystem: ['6bd3ecb9', '6ae5e42'],
    brakeSystem: ['7241f93e', '3790242'],
  })],
  ['network-business', createWindTopologyBindings({
    pitchControl: ['51bc092', '406297f8'],
    yawControl: ['1055adfd', '1e412298'],
    drivetrainSystem: ['ec6a59e', '5d39b66f'],
    brakeSystem: ['4a75cf4', '17d8b5c'],
  })],
  ['network-key-process', createWindTopologyBindings({
    pitchControl: ['361789f0', '3f5581bd'],
    yawControl: ['159a8d', '5a7b7f30'],
    drivetrainSystem: ['4d331569', '82b105'],
    brakeSystem: ['777e94bc', '40eac465'],
  })],
  ['business-key-process', createWindTopologyBindings({
    pitchControl: ['6a0592cc', '6b12cd8'],
    yawControl: ['2cdd2b5', '7a0b0af0'],
    drivetrainSystem: ['8d7675b', '17cee71'],
    brakeSystem: ['ccca65e', '7e8936'],
  })],
  ['network-business-key-process', createWindTopologyBindings({
    pitchControl: ['28457c83', '26bfee5'],
    converterControl: ['28e27ec2', '006f1fc'],
    yawControl: ['27e09c2f', '49fe7d9'],
    drivetrainControl: ['67fd9a', '7a8bb9bf'],
    brakeControl: ['c8042a6', 'b4a3335'],
    pitchSystem: ['87f441c', 'd4ab511'],
    converterSystem: ['4996538', '5e9d380'],
    yawSystem: ['44940c8', 'a89f0ae'],
    drivetrainSystem: ['52b0990b', '5fbd69f'],
    brakeSystem: ['9331d40', '828058d'],
  })],
])

/** 严格按当前完整 JSON 版本取绑定；未知版本视为配置错误，不借用其他文件的 penId。 */
export function getWindTopologyRuntimeBindings(variantId: WindTopologyVariantId): readonly WindTopologyRuntimeBinding[] {
  const bindings = WIND_TOPOLOGY_RUNTIME_BINDINGS_BY_VARIANT_ID.get(variantId)
  if (!bindings) throw new Error(`风电拓扑版本缺少运行时绑定：${variantId}`)
  return bindings
}

/**
 * 为当前文件一次性构建正反索引；二维点击、状态更新和三维反向选择均通过常数时间查询完成。
 * 切换 JSON 版本后必须重建索引，禁止把旧图元编号沿用到新文件。
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

/** 默认三层整图导出仅兼容既有调用；正式画布按切换后的 JSON 版本读取绑定。 */
export const WIND_TOPOLOGY_RUNTIME_BINDINGS = getWindTopologyRuntimeBindings('network-business-key-process')

/** 四态中文标签与平台状态协议一一对应，提示和状态图片使用同一来源。 */
export const WIND_TOPOLOGY_STATUS_PRESENTATION: Readonly<Record<TopologyDeviceStatus, {
  readonly label: string
}>> = Object.freeze({
  normal: { label: '正常' }, alarm: { label: '告警' }, fault: { label: '故障' }, offline: { label: '离线' },
})

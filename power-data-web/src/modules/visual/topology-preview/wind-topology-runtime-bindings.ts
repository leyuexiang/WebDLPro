import type { ProcessNodeId } from '@/config/process/identifiers'
import { toProcessNodeId } from '@/config/process/identifiers'
import type { SceneNodeId } from '@/config/scene-topology/identifiers'
import { toSceneNodeId } from '@/config/scene-topology/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'
import type { WindTopologyVariantId } from './wind-topology-variant-manifest'
export interface WindTopologyRuntimeBinding {
  readonly penId: string
  readonly nodeId: ProcessNodeId
  readonly sceneNodeId: SceneNodeId
}
/** 当前筛选文件未出现目标节点时返回空绑定，不借用其它文件编号或按标题猜测。 */
const UNBOUND: readonly WindTopologyRuntimeBinding[] = Object.freeze([])

/** 图2确认的风电业务节点与 Unity 场景节点编号；两组重复图元共用同一语义映射。 */
const WIND_RUNTIME_NODE_IDS = Object.freeze({
  pitchControl: {
    nodeId: toProcessNodeId('system.wind-pitch-control'),
    sceneNodeId: toSceneNodeId('unit.wind-pitch.control'),
  },
  converterControl: {
    nodeId: toProcessNodeId('system.wind-converter-control'),
    sceneNodeId: toSceneNodeId('unit.wind-converter.control'),
  },
  yawControl: {
    nodeId: toProcessNodeId('system.wind-yaw-control'),
    sceneNodeId: toSceneNodeId('unit.wind-yaw.control'),
  },
  drivetrainControl: {
    nodeId: toProcessNodeId('system.wind-drivetrain-control'),
    sceneNodeId: toSceneNodeId('unit.wind-drivetrain.control'),
  },
  brakeControl: {
    nodeId: toProcessNodeId('system.wind-brake-control'),
    sceneNodeId: toSceneNodeId('unit.wind-brake.control'),
  },
  pitchSystem: {
    nodeId: toProcessNodeId('asset.wind-pitch-system'),
    sceneNodeId: toSceneNodeId('node.wind-pitch-system'),
  },
  converterSystem: {
    nodeId: toProcessNodeId('asset.wind-converter-system'),
    sceneNodeId: toSceneNodeId('node.wind-converter-system'),
  },
  yawSystem: {
    nodeId: toProcessNodeId('asset.wind-yaw-system'),
    sceneNodeId: toSceneNodeId('node.wind-yaw-system'),
  },
  drivetrainSystem: {
    nodeId: toProcessNodeId('asset.wind-drivetrain-system'),
    sceneNodeId: toSceneNodeId('node.wind-drivetrain-system'),
  },
  brakeSystem: {
    nodeId: toProcessNodeId('asset.wind-brake-system'),
    sceneNodeId: toSceneNodeId('node.wind-brake-system'),
  },
})

type WindRuntimeNodeKey = keyof typeof WIND_RUNTIME_NODE_IDS
type WindVariantPenIds = Readonly<Partial<Record<WindRuntimeNodeKey, readonly string[]>>>

/** 为同一业务节点登记一个或多个实际图元，保证点击任一图元都可双向聚焦。 */
function bindPens(
  penIds: readonly string[],
  nodeId: ProcessNodeId,
  sceneNodeId: SceneNodeId,
): readonly WindTopologyRuntimeBinding[] {
  return Object.freeze(penIds.map((penId) => Object.freeze({ penId, nodeId, sceneNodeId })))
}

/**
 * 八份筛选文件各自登记图2对应节点的实际图元编号；重复绘制的同名节点共用同一业务与三维编号。
 * 没有出现对应业务文字的文件保持空映射，不通过位置、图标或其它文件的图元编号补造绑定。
 */
const WIND_PEN_IDS_BY_VARIANT: Readonly<Record<WindTopologyVariantId, WindVariantPenIds>> = Object.freeze({
  architecture: {
    pitchControl: ['b8d197d'],
    yawControl: ['1ae02016'],
    drivetrainSystem: ['eca11c6'],
    brakeSystem: ['3518b49'],
  },
  network: {
    pitchControl: ['a8f94f6', '288459b2'],
    yawControl: ['b7884e6', '6a0e5a0e'],
    drivetrainSystem: ['6d463462', '7100f20'],
    brakeSystem: ['4e4e4b', '779c4bd9'],
  },
  business: {},
  'key-process': {
    pitchControl: ['9396e06', '4d345e6'],
    yawControl: ['15b49d26', '60369370'],
    drivetrainSystem: ['6bd3ecb9', '6ae5e42'],
    brakeSystem: ['7241f93e', '3790242'],
  },
  'network-business': {
    pitchControl: ['51bc092', '406297f8'],
    yawControl: ['1055adfd', '1e412298'],
    drivetrainSystem: ['ec6a59e', '5d39b66f'],
    brakeSystem: ['4a75cf4', '17d8b5c'],
  },
  'network-key-process': {
    pitchControl: ['361789f0', '3f5581bd'],
    yawControl: ['159a8d', '5a7b7f30'],
    drivetrainSystem: ['4d331569', '82b105'],
    brakeSystem: ['777e94bc', '40eac465'],
  },
  'business-key-process': {
    pitchControl: ['6a0592cc', '6b12cd8'],
    yawControl: ['2cdd2b5', '7a0b0af0'],
    drivetrainSystem: ['8d7675b', '17cee71'],
    brakeSystem: ['ccca65e', '7e8936'],
  },
  'network-business-key-process': {
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
  },
})

/** 初始化时按节点键展开显式图元映射，运行时通过版本索引常数时间读取。 */
function createVariantBindings(penIdsByNode: WindVariantPenIds): readonly WindTopologyRuntimeBinding[] {
  const bindings: WindTopologyRuntimeBinding[] = []
  for (const [key, penIds] of Object.entries(penIdsByNode)) {
    if (!penIds?.length) continue
    const node = WIND_RUNTIME_NODE_IDS[key as WindRuntimeNodeKey]
    bindings.push(...bindPens(penIds, node.nodeId, node.sceneNodeId))
  }
  return Object.freeze(bindings)
}

// 各筛选拓扑的图元编号只在此处解析一次，后续切换筛选直接复用对应绑定，避免运行时重复扫描。
const WIND_RUNTIME_BINDINGS_BY_VARIANT: ReadonlyMap<WindTopologyVariantId, readonly WindTopologyRuntimeBinding[]> = new Map<
  WindTopologyVariantId,
  readonly WindTopologyRuntimeBinding[]
>(
  (Object.keys(WIND_PEN_IDS_BY_VARIANT) as WindTopologyVariantId[])
    .map((variantId) => [variantId, createVariantBindings(WIND_PEN_IDS_BY_VARIANT[variantId])] as const),
)

/** 每个筛选文件只使用本文件图元编号，保持同一业务节点与三维目标不随筛选改变。 */
export function getWindTopologyRuntimeBindings(variantId: WindTopologyVariantId): readonly WindTopologyRuntimeBinding[] {
  return WIND_RUNTIME_BINDINGS_BY_VARIANT.get(variantId) ?? UNBOUND
}
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
    sceneNodeIdByPenId.set(binding.penId, binding.sceneNodeId)
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

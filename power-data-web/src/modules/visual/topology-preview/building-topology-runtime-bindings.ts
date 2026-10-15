import { toProcessNodeId, type ProcessNodeId } from '@/config/process/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { toSceneNodeId, type SceneNodeId } from '@/config/scene-topology/identifiers'
import { getTopologySharedPublicAssetUrl } from './topology-shared-assets'
import type { SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/** 楼宇二维逻辑节点与三维场景节点按用户截图逐字登记，不从节点名称或位置推导。 */
export const BUILDING_TOPOLOGY_NODE_IDS = Object.freeze({
  hvac: toProcessNodeId('asset.building-hvac-control'),
  access: toProcessNodeId('asset.building-access-control'),
  lighting: toProcessNodeId('asset.building-smart-lighting'),
})

const BUILDING_TOPOLOGY_SCENE_NODE_IDS: Readonly<Record<keyof typeof BUILDING_TOPOLOGY_NODE_IDS, SceneNodeId>> = Object.freeze({
  hvac: toSceneNodeId('node.building-hvac-control'),
  access: toSceneNodeId('node.building-access-control'),
  lighting: toSceneNodeId('node.building-smart-lighting'),
})

/** 每份组合 JSON 使用本文件的 penId；同一设备跨筛选组合时稳定回到同一个业务节点。 */
function bindNode(
  nodeId: ProcessNodeId,
  sceneNodeId: SceneNodeId,
  penIds: readonly string[],
): readonly SubstationTopologyRuntimeBinding[] {
  return Object.freeze(penIds.map((penId) => Object.freeze({ penId, nodeId, sceneNodeId })))
}

/** 仅登记图中确实包含设备图元的变体；未出现设备图元的过滤组合必须保持空绑定。 */
const BINDINGS_BY_VARIANT: ReadonlyMap<string, readonly SubstationTopologyRuntimeBinding[]> = new Map([
  ['architecture', Object.freeze([
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.hvac, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvac, ['42312320']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.lighting, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lighting, ['8b80c2d']),
  ])],
  ['network', Object.freeze([])],
  ['business', Object.freeze([])],
  ['key-process', Object.freeze([
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.hvac, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvac, ['5a232852']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.lighting, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lighting, ['7de351ce']),
  ])],
  ['network-key-process', Object.freeze([
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.hvac, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvac, ['39eb5ed1']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.lighting, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lighting, ['5890fe4f']),
  ])],
  ['network-business', Object.freeze([])],
  ['business-key-process', Object.freeze([
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.hvac, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvac, ['cf58f4e']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.lighting, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lighting, ['ae15b2b']),
  ])],
  ['network-business-key-process', Object.freeze([
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.hvac, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvac, ['f765f99']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.access, BUILDING_TOPOLOGY_SCENE_NODE_IDS.access, ['81a3de2']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.lighting, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lighting, ['74365219']),
  ])],
])

/** 切换完整 JSON 文件时严格换用它自己的映射，不允许回退复用其它变体的图元编号。 */
export function getBuildingTopologyRuntimeBindings(
  variantId: string,
): readonly SubstationTopologyRuntimeBinding[] {
  const bindings = BINDINGS_BY_VARIANT.get(variantId)
  if (!bindings) throw new Error(`楼宇拓扑版本缺少运行时绑定：${variantId}`)
  return bindings
}

/** 共享图标目录为三类楼宇设备固定登记四态 WebP，状态由中央设备快照驱动。 */
const STATUS_ICON_PATHS_BY_NODE_ID: ReadonlyMap<ProcessNodeId, Readonly<Record<TopologyDeviceStatus, string>>> = new Map([
  [BUILDING_TOPOLOGY_NODE_IDS.hvac, Object.freeze({
    normal: getTopologySharedPublicAssetUrl('icons/normal/building-hvac-control.webp'),
    alarm: getTopologySharedPublicAssetUrl('icons/alarm/building-hvac-control.webp'),
    fault: getTopologySharedPublicAssetUrl('icons/fault/building-hvac-control.webp'),
    offline: getTopologySharedPublicAssetUrl('icons/offline/building-hvac-control.webp'),
  })],
  [BUILDING_TOPOLOGY_NODE_IDS.access, Object.freeze({
    normal: getTopologySharedPublicAssetUrl('icons/normal/building-access-control.webp'),
    alarm: getTopologySharedPublicAssetUrl('icons/alarm/building-access-control.webp'),
    fault: getTopologySharedPublicAssetUrl('icons/fault/building-access-control.webp'),
    offline: getTopologySharedPublicAssetUrl('icons/offline/building-access-control.webp'),
  })],
  [BUILDING_TOPOLOGY_NODE_IDS.lighting, Object.freeze({
    normal: getTopologySharedPublicAssetUrl('icons/normal/building-smart-lighting.webp'),
    alarm: getTopologySharedPublicAssetUrl('icons/alarm/building-smart-lighting.webp'),
    fault: getTopologySharedPublicAssetUrl('icons/fault/building-smart-lighting.webp'),
    offline: getTopologySharedPublicAssetUrl('icons/offline/building-smart-lighting.webp'),
  })],
])

/** 未登记设备没有四态资源时返回空值，避免替换成语义不匹配的图标。 */
export function getBuildingTopologyStatusIconUrl(
  nodeId: ProcessNodeId,
  status: TopologyDeviceStatus,
): string | undefined {
  return STATUS_ICON_PATHS_BY_NODE_ID.get(nodeId)?.[status]
}

/** 供运行时和契约测试按逻辑节点常数时间读取唯一三维目标。 */
export const BUILDING_TOPOLOGY_SCENE_NODE_ID_BY_NODE_ID: ReadonlyMap<ProcessNodeId, SceneNodeId> = new Map([
  [BUILDING_TOPOLOGY_NODE_IDS.hvac, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvac],
  [BUILDING_TOPOLOGY_NODE_IDS.access, BUILDING_TOPOLOGY_SCENE_NODE_IDS.access],
  [BUILDING_TOPOLOGY_NODE_IDS.lighting, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lighting],
])

import { toProcessNodeId, type ProcessNodeId } from '@/config/process/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { toSceneNodeId, type SceneNodeId } from '@/config/scene-topology/identifiers'
import { getTopologySharedPublicAssetUrl } from './topology-shared-assets'
import type { SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/** 三类楼宇现场设备使用稳定业务编号，不从节点名称或图元位置推导。 */
export const BUILDING_TOPOLOGY_NODE_IDS = Object.freeze({
  hvac: toProcessNodeId('asset.building-hvac-control'),
  access: toProcessNodeId('asset.building-access-control'),
  lighting: toProcessNodeId('asset.building-smart-lighting'),
})

/** 三个上层控制系统参与二维、三维选择交互，但不绑定设备四态资源。 */
export const BUILDING_TOPOLOGY_SYSTEM_NODE_IDS = Object.freeze({
  hvacAutomation: toProcessNodeId('system.building-hvac-building-automation'),
  accessGroupDispatch: toProcessNodeId('system.building-access-group-control-dispatch'),
  lightingControl: toProcessNodeId('system.building-smart-lighting-control'),
})

/** 下列 Unity 编号是供后续离线场景配置使用的目标契约。 */
export const BUILDING_TOPOLOGY_SCENE_NODE_IDS = Object.freeze({
  hvac: toSceneNodeId('node.building-hvac-control'),
  access: toSceneNodeId('node.building-access-control'),
  lighting: toSceneNodeId('node.building-smart-lighting'),
  hvacAutomation: toSceneNodeId('unit.building-hvac-automation.control'),
  accessGroupDispatch: toSceneNodeId('unit.building-access-group-dispatch.control'),
  lightingControl: toSceneNodeId('unit.building-smart-lighting.control'),
})

/** 每份拓扑 JSON 使用本文件核对的 penId；同一业务节点跨组合时复用固定逻辑编号。 */
function bindNode(
  nodeId: ProcessNodeId,
  sceneNodeId: SceneNodeId,
  penIds: readonly string[],
): readonly SubstationTopologyRuntimeBinding[] {
  return Object.freeze(penIds.map((penId) => Object.freeze({ penId, nodeId, sceneNodeId })))
}

/** 只登记各文件实际包含的六类图元；缺少图元的变体不借用其他文件编号。 */
const BINDINGS_BY_VARIANT: ReadonlyMap<string, readonly SubstationTopologyRuntimeBinding[]> = new Map([
  ['architecture', Object.freeze([
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.hvacAutomation, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvacAutomation, ['d0b75']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.hvac, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvac, ['42312320']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.lighting, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lighting, ['8b80c2d']),
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.lightingControl, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lightingControl, ['7ab900d7']),
  ])],
  ['network', Object.freeze([
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.hvacAutomation, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvacAutomation, ['73874ef9']),
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.lightingControl, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lightingControl, ['340e210e']),
  ])],
  ['business', Object.freeze([])],
  ['key-process', Object.freeze([
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.hvacAutomation, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvacAutomation, ['19302081']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.hvac, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvac, ['5a232852']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.lighting, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lighting, ['7de351ce']),
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.lightingControl, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lightingControl, ['491d605']),
  ])],
  ['network-key-process', Object.freeze([
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.hvacAutomation, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvacAutomation, ['3e24d70e']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.hvac, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvac, ['39eb5ed1']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.lighting, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lighting, ['5890fe4f']),
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.lightingControl, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lightingControl, ['eff5466']),
  ])],
  ['network-business', Object.freeze([
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.hvacAutomation, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvacAutomation, ['2ee5a087']),
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.lightingControl, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lightingControl, ['736daf4']),
  ])],
  ['business-key-process', Object.freeze([
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.hvacAutomation, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvacAutomation, ['22063f6c']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.hvac, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvac, ['cf58f4e']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.lighting, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lighting, ['ae15b2b']),
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.lightingControl, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lightingControl, ['72130944']),
  ])],
  ['network-business-key-process', Object.freeze([
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.hvacAutomation, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvacAutomation, ['7101900b']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.hvac, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvac, ['f765f99']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.access, BUILDING_TOPOLOGY_SCENE_NODE_IDS.access, ['81a3de2']),
    ...bindNode(BUILDING_TOPOLOGY_NODE_IDS.lighting, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lighting, ['74365219']),
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.accessGroupDispatch, BUILDING_TOPOLOGY_SCENE_NODE_IDS.accessGroupDispatch, ['588de3c6']),
    ...bindNode(BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.lightingControl, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lightingControl, ['7338607a']),
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

/** 共享图标目录为三类楼宇现场设备登记四态 WebP，状态由中央设备快照驱动。 */
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
  [BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.hvacAutomation, BUILDING_TOPOLOGY_SCENE_NODE_IDS.hvacAutomation],
  [BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.accessGroupDispatch, BUILDING_TOPOLOGY_SCENE_NODE_IDS.accessGroupDispatch],
  [BUILDING_TOPOLOGY_SYSTEM_NODE_IDS.lightingControl, BUILDING_TOPOLOGY_SCENE_NODE_IDS.lightingControl],
])

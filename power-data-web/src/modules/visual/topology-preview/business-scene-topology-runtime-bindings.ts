import { toProcessNodeId, type ProcessNodeId } from '@/config/process/identifiers'
import { toSceneNodeId, type SceneNodeId } from '@/config/scene-topology/identifiers'
import type { ManifestTopologyPreviewRuntimeBinding } from './manifest-topology-preview-profile'

/** 楼宇三个设备逻辑身份；标识不依赖图元编号、中文标题或统一引擎层级路径。 */
const BUILDING_NODE_IDENTITIES = Object.freeze({
  hvac: Object.freeze({
    nodeId: toProcessNodeId('asset.building-hvac-control'),
    sceneNodeId: toSceneNodeId('node.building-hvac-control'),
  }),
  accessControl: Object.freeze({
    nodeId: toProcessNodeId('asset.building-access-control'),
    sceneNodeId: toSceneNodeId('node.building-access-control'),
  }),
  smartLighting: Object.freeze({
    nodeId: toProcessNodeId('asset.building-smart-lighting'),
    sceneNodeId: toSceneNodeId('node.building-smart-lighting'),
  }),
}) satisfies Readonly<Record<string, {
  readonly nodeId: ProcessNodeId
  readonly sceneNodeId: SceneNodeId
}>>

type BuildingDeviceRole = keyof typeof BUILDING_NODE_IDENTITIES
type PenIdsByRole = Partial<Record<BuildingDeviceRole, readonly string[]>>
const EMPTY_BUILDING_BINDINGS: readonly ManifestTopologyPreviewRuntimeBinding[] = Object.freeze([])

/** 把单份完整 JSON 中核对过的 penId 显式绑定到同一逻辑节点和三维场景目标。 */
function createBuildingTopologyBindings(penIdsByRole: PenIdsByRole): readonly ManifestTopologyPreviewRuntimeBinding[] {
  const bindings: ManifestTopologyPreviewRuntimeBinding[] = []
  for (const [role, penIds] of Object.entries(penIdsByRole) as [BuildingDeviceRole, readonly string[]][]) {
    const identity = BUILDING_NODE_IDENTITIES[role]
    for (const penId of penIds) {
      bindings.push(Object.freeze({
        penId,
        nodeId: identity.nodeId,
        sceneNodeId: identity.sceneNodeId,
      }))
    }
  }
  return Object.freeze(bindings)
}

/*
 * 每种筛选组合单独登记图元编号。旧文件只复用文字与语义均明确对应的暖通、照明设备；
 * 门禁设备只出现在本次更新的默认组合，其他文件没有该图元就不制造映射。
 */
const BUILDING_TOPOLOGY_RUNTIME_BINDINGS_BY_VARIANT: ReadonlyMap<string, readonly ManifestTopologyPreviewRuntimeBinding[]> = new Map([
  ['architecture', createBuildingTopologyBindings({ hvac: ['42312320'], smartLighting: ['8b80c2d'] })],
  ['business', EMPTY_BUILDING_BINDINGS],
  ['business-key-process', createBuildingTopologyBindings({ hvac: ['cf58f4e'], smartLighting: ['ae15b2b'] })],
  ['key-process', createBuildingTopologyBindings({ hvac: ['5a232852'], smartLighting: ['7de351ce'] })],
  ['network', EMPTY_BUILDING_BINDINGS],
  ['network-business', EMPTY_BUILDING_BINDINGS],
  ['network-business-key-process', createBuildingTopologyBindings({
    hvac: ['f765f99'],
    accessControl: ['81a3de2'],
    smartLighting: ['74365219'],
  })],
  ['network-key-process', createBuildingTopologyBindings({ hvac: ['39eb5ed1'], smartLighting: ['5890fe4f'] })],
])

/** 精确按完整文件版本读取楼宇映射；未知版本返回冻结空集，不从标题或其他文件借用编号。 */
export function getBusinessSceneTopologyRuntimeBindings(variantId: string): readonly ManifestTopologyPreviewRuntimeBinding[] {
  return BUILDING_TOPOLOGY_RUNTIME_BINDINGS_BY_VARIANT.get(variantId) ?? EMPTY_BUILDING_BINDINGS
}

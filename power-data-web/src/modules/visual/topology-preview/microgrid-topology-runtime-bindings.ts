import { toProcessNodeId } from '@/config/process/identifiers'
import { toSceneNodeId } from '@/config/scene-topology/identifiers'
import { bindNode, type SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/** 六个节点均属于设备层；统一使用 asset/node 编号，不因名称含“控制器”改作 system/unit。 */
export const MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS = Object.freeze({
  windController: Object.freeze({
    nodeId: toProcessNodeId('asset.microgrid-wind-controller'),
    sceneNodeId: toSceneNodeId('node.microgrid-wind-controller'),
  }),
  photovoltaicController: Object.freeze({
    nodeId: toProcessNodeId('asset.microgrid-photovoltaic-controller'),
    sceneNodeId: toSceneNodeId('node.microgrid-photovoltaic-controller'),
  }),
  dieselGeneratorController: Object.freeze({
    nodeId: toProcessNodeId('asset.microgrid-diesel-generator-controller'),
    sceneNodeId: toSceneNodeId('node.microgrid-diesel-generator-controller'),
  }),
  atsController: Object.freeze({
    nodeId: toProcessNodeId('asset.microgrid-ats-controller'),
    sceneNodeId: toSceneNodeId('node.microgrid-ats-controller'),
  }),
  switchgear: Object.freeze({
    nodeId: toProcessNodeId('asset.microgrid-switchgear'),
    sceneNodeId: toSceneNodeId('node.microgrid-switchgear'),
  }),
  storageConverter: Object.freeze({
    nodeId: toProcessNodeId('asset.microgrid-storage-converter'),
    sceneNodeId: toSceneNodeId('node.microgrid-storage-converter'),
  }),
})

/**
 * 默认三层组合图的逐图元映射：只使用该 JSON 中核对过的 penId。
 * 用户已将本次范围限定为 network+business+key-process；其他七个变体不登记微电网节点。
 */
const DEFAULT_COMBINED_TOPOLOGY_BINDINGS: readonly SubstationTopologyRuntimeBinding[] = Object.freeze([
  ...bindNode(
    MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS.windController.nodeId,
    MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS.windController.sceneNodeId,
    ['58845f75'],
  ),
  ...bindNode(
    MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS.photovoltaicController.nodeId,
    MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS.photovoltaicController.sceneNodeId,
    ['ac4cdcc'],
  ),
  ...bindNode(
    MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS.dieselGeneratorController.nodeId,
    MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS.dieselGeneratorController.sceneNodeId,
    ['6eaf50f7'],
  ),
  ...bindNode(
    MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS.atsController.nodeId,
    MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS.atsController.sceneNodeId,
    ['30ecc688'],
  ),
  ...bindNode(
    MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS.switchgear.nodeId,
    MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS.switchgear.sceneNodeId,
    ['a6a3147'],
  ),
  ...bindNode(
    MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS.storageConverter.nodeId,
    MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS.storageConverter.sceneNodeId,
    ['abf1410'],
  ),
])

/** 不展示筛选框时默认始终命中此组合；非默认合法变体仍保持纯二维交互。 */
const EMPTY_BINDINGS: readonly SubstationTopologyRuntimeBinding[] = Object.freeze([])
const BINDINGS_BY_VARIANT: ReadonlyMap<string, readonly SubstationTopologyRuntimeBinding[]> = new Map([
  ['architecture', EMPTY_BINDINGS],
  ['network', EMPTY_BINDINGS],
  ['business', EMPTY_BINDINGS],
  ['key-process', EMPTY_BINDINGS],
  ['network-key-process', EMPTY_BINDINGS],
  ['network-business', EMPTY_BINDINGS],
  ['business-key-process', EMPTY_BINDINGS],
  ['network-business-key-process', DEFAULT_COMBINED_TOPOLOGY_BINDINGS],
])

/** 切换拓扑版本时只加载其自身映射；未知版本报错，避免误用默认文件的图元编号。 */
export function getMicrogridTopologyRuntimeBindings(
  variantId: string,
): readonly SubstationTopologyRuntimeBinding[] {
  const bindings = BINDINGS_BY_VARIANT.get(variantId)
  if (!bindings) throw new Error(`微电网拓扑版本缺少运行时绑定配置：${variantId}`)
  return bindings
}

import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'

/**
 * 第三层关键环节 JSON 的显式上下文清单。
 *
 * 图元编号只在对应文件内有效，不能与总览或其他关键环节文件混用；
 * 每项绑定均由参考 JSON 和现有业务节点逐项核对，未核对的控制装置保持未绑定。
 */
const PROCESS_DETAIL_TOPOLOGY_CONTEXTS: readonly TopologyDataContext[] = Object.freeze([
  Object.freeze({
    contextId: 'process-detail.gas-power.gas-turbine',
    renderer: 'gas-v3',
    // 该路径相对于 shell/topology 根目录，由构建后的资源 URL 工具拼接，不包含预览目录前缀。
    topologyPath: 'process-detail/gas-power/gas-turbine/topology.json',
    sourceSha256: '30652c2a8a2b5bf0af76c70501baa94e2ece57edb57fd35d164486546103b9ba',
    expectedPenCount: 32,
    bindings: Object.freeze([
      // 主燃气轮机和压缩机均属于现有燃机入口节点，状态图片同步到同一业务节点。
      Object.freeze({ penId: '14d76d6', nodeId: 'inlet-duct' }),
      Object.freeze({ penId: '35d969bb', nodeId: 'inlet-duct' }),
      // 脱硝装置与现有余热/脱硝状态节点显式对应；控制系统图元没有可靠三维节点证据，不绑定状态。
      Object.freeze({ penId: '621bf39b', nodeId: 'hrsg' }),
    ]),
  }),
  Object.freeze({
    contextId: 'process-detail.coal-power.boiler',
    renderer: 'coal-v2',
    // 当前锅炉第三层沿用已登记的关键环节输入文件；它仍由同一公共画布加载，不复制图元资源。
    topologyPath: 'variants/key-process/topology.json',
    sourceSha256: '513344c1af2d80f5a3eeca016a00e46916340b3684924bca7afd92125a86c49f',
    expectedPenCount: 46,
    bindings: Object.freeze([
      Object.freeze({ penId: '2a01627b', nodeId: 'system.boiler-dcs' }),
    ]),
  }),
  Object.freeze({
    contextId: 'process-detail.coal-power.steam-turbine',
    renderer: 'coal-v2',
    topologyPath: 'process-detail/coal-power/steam-turbine/topology.json',
    sourceSha256: '038c8c639d98ecbe30b650a8315e1bfc3a09fc57cc1904e6ab8bef0c219243cc',
    expectedPenCount: 19,
    bindings: Object.freeze([
      // 汽轮机和数字电调共同呈现同一汽机控制单元，四态切换必须保持同步。
      Object.freeze({ penId: 'baf5ab7', nodeId: 'system.steam-turbine-dcs' }),
      Object.freeze({ penId: 'b9ae43', nodeId: 'system.steam-turbine-dcs' }),
    ]),
  }),
])

const PROCESS_DETAIL_TOPOLOGY_CONTEXT_BY_ID = new Map(
  PROCESS_DETAIL_TOPOLOGY_CONTEXTS.map((context) => [context.contextId, context]),
)

/** 只按清单登记的稳定拓扑上下文标识精确查询；未知编号不回退到关键环节标题、文件名或数组位置。 */
export function getProcessDetailTopologyDataContext(
  topologyDataContextId: string,
): TopologyDataContext | undefined {
  return PROCESS_DETAIL_TOPOLOGY_CONTEXT_BY_ID.get(topologyDataContextId)
}

/** 供合同测试核对所有第三层输入均已登记，调用方不得修改返回数组。 */
export const PROCESS_DETAIL_TOPOLOGY_DATA_CONTEXTS = PROCESS_DETAIL_TOPOLOGY_CONTEXTS

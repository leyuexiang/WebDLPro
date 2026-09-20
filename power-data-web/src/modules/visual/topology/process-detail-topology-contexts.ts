import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'

/** 三个站类场景使用相同保护画面，但业务节点标识必须带场景前缀，保证状态缓存绝不串场。 */
const PROTECTION_SCENES = Object.freeze([
  'step-down-substation',
  'step-up-substation',
  'converter-station',
] as const)

/** 三份参考资料各落盘一次；九个逻辑上下文通过稳定编号复用同一只读文件。 */
const PROTECTION_TOPOLOGIES = Object.freeze([
  Object.freeze({
    key: 'transformer-protection',
    topologyPath: 'process-detail/protection/transformer-protection/topology.json',
    sourceSha256: 'a6b41ef5c00d0a18498d40f06e5a3c91ae90bfcbdf19403b6e4a67b06e824647',
    expectedPenCount: 37,
    devicePenIds: Object.freeze(['13641187', '3ca46467', '5c62b7c9', '638bfdc8', '4c977fd', '5ba41a5e', '2afc53b']),
  }),
  Object.freeze({
    key: 'busbar-protection',
    topologyPath: 'process-detail/protection/busbar-protection/topology.json',
    sourceSha256: '1b9ad1dd05c718220c00414d1d030a8965e8738ef61b7c2cde1df5e4a59cdd93',
    expectedPenCount: 35,
    devicePenIds: Object.freeze(['764bd402', 'cb91449', '3e2176c6', '276dbcd0', '6c957795', '149e5ff']),
  }),
  Object.freeze({
    key: 'line-protection',
    topologyPath: 'process-detail/protection/line-protection/topology.json',
    sourceSha256: 'e9fcb283169bfa8e269c28c65e22747e38e8b338d4a5e2b2dc1f754f466d12c6',
    expectedPenCount: 34,
    devicePenIds: Object.freeze(['c15baad', '692fe9ae', '16a5c2d1', 'b8f3ceb', 'a5f4bae', '31d8ffd']),
  }),
] as const)

/**
 * 预计算九个上下文和各自的状态节点绑定。相同图元编号只代表同一参考图中的位置，不能成为
 * 跨场景状态键，因此 nodeId 同时包含场景、保护类型和图元编号。
 */
function createProtectionTopologyContexts(): readonly TopologyDataContext[] {
  return PROTECTION_SCENES.flatMap((sceneId) => PROTECTION_TOPOLOGIES.map((topology) => Object.freeze({
    contextId: `process-detail.${sceneId}.${topology.key}`,
    renderer: 'manifest-json' as const,
    topologyPath: topology.topologyPath,
    sourceSha256: topology.sourceSha256,
    expectedPenCount: topology.expectedPenCount,
    bindings: Object.freeze(topology.devicePenIds.map((penId) => Object.freeze({
      penId,
      nodeId: `asset.${sceneId}.${topology.key}.${penId}`,
    }))),
  })))
}

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
      // 主燃气轮机和压缩机均对应下层现场设备节点，状态图片同步到同一燃气轮机设备。
      Object.freeze({ penId: '14d76d6', nodeId: 'asset.gas-turbine' }),
      Object.freeze({ penId: '35d969bb', nodeId: 'asset.gas-turbine' }),
      // 脱硝装置沿用余热锅炉现场设备状态；控制系统图元没有可靠三维节点证据，不绑定状态。
      Object.freeze({ penId: '621bf39b', nodeId: 'asset.gas-hrsg' }),
    ]),
  }),
  Object.freeze({
    contextId: 'process-detail.coal-power.steam-turbine',
    renderer: 'coal-v2',
    topologyPath: 'process-detail/coal-power/steam-turbine/topology.json',
    sourceSha256: '5c7262f198f4b4443d863d07a8b39f5bd0d9d841cb03d820b5535c736c78a79c',
    expectedPenCount: 45,
    bindings: Object.freeze([
      // 新输入中的汽轮机、锅炉和发电机均对应下层现场设备节点，状态由公共四态资源表达。
      Object.freeze({ penId: '429749ea', nodeId: 'asset.coal-steam-turbine' }),
      Object.freeze({ penId: '8be4fc2', nodeId: 'asset.coal-boiler' }),
      Object.freeze({ penId: '9533a1f', nodeId: 'asset.coal-generator' }),
    ]),
  }),
  Object.freeze({
    contextId: 'process-detail.solar-power.inverter',
    renderer: 'solar',
    topologyPath: 'process-detail/solar-power/inverter/topology.json',
    sourceSha256: '6391b1212c07664721cbccfea4bb9d5f7ef06487655b08fbf09d4b09e9018686',
    expectedPenCount: 19,
    bindings: Object.freeze([
      // 控制器和实体设备分别沿用光伏总览的正式业务节点；机组主控制器没有可靠映射，保持静态。
      Object.freeze({ penId: 'df25e45', nodeId: 'system.solar-inverter-control' }),
      Object.freeze({ penId: '2cf7b170', nodeId: 'asset.solar-inverter' }),
    ]),
  }),
  ...createProtectionTopologyContexts(),
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

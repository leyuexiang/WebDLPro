import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'

/** 四个变电站类场景使用相同保护画面；绑定仍按当前场景的业务节点和三维节点显式登记。 */
const PROTECTION_SCENES = Object.freeze([
  'step-down-substation',
  'step-up-substation',
  'converter-station',
  'switching-station',
] as const)

const PROTECTION_SCENE_TOPOLOGY_KEYS = Object.freeze({
  'step-down-substation': Object.freeze(['transformer-protection', 'busbar-protection', 'line-protection']),
  'step-up-substation': Object.freeze(['transformer-protection', 'busbar-protection', 'line-protection']),
  'converter-station': Object.freeze(['transformer-protection', 'busbar-protection', 'line-protection']),
  'switching-station': Object.freeze(['busbar-protection', 'line-protection']),
} as const)

type ProtectionDeviceRole = 'measurement' | 'protection' | 'instrumentTransformer' | 'breaker' | 'transformer'
type ProtectionSceneNodeBinding = readonly [nodeId: string, sceneNodeId: string]
type ProtectionSceneBindings = Partial<Record<ProtectionDeviceRole, ProtectionSceneNodeBinding>>

/** 只有源图文字可以明确对应的设备才进入双向联动；合并单元和智能终端不猜测三维目标。 */
const PROTECTION_SCENE_NODE_BINDINGS: Readonly<Record<(typeof PROTECTION_SCENES)[number], ProtectionSceneBindings>> = Object.freeze({
  'step-down-substation': Object.freeze({
    measurement: ['system.step-down-measurement-control', 'unit.step-down-measurement.control'] as const,
    protection: ['system.step-down-protection-control', 'unit.step-down-protection.control'] as const,
    instrumentTransformer: ['asset.step-down-instrument-transformer', 'node.step-down-instrument-transformer'] as const,
    breaker: ['asset.step-down-breaker', 'node.step-down-breaker'] as const,
    transformer: ['asset.step-down-transformer', 'node.step-down-transformer'] as const,
  }),
  'step-up-substation': Object.freeze({
    measurement: ['system.step-up-measurement-control', 'unit.step-up-measurement.control'] as const,
    protection: ['system.step-up-protection-control', 'unit.step-up-protection.control'] as const,
    instrumentTransformer: ['asset.step-up-instrument-transformer', 'node.step-up-instrument-transformer'] as const,
    breaker: ['asset.step-up-breaker', 'node.step-up-breaker'] as const,
    transformer: ['asset.step-up-transformer', 'node.step-up-transformer'] as const,
  }),
  'converter-station': Object.freeze({
    measurement: ['system.converter-measurement-control', 'unit.converter-measurement.control'] as const,
    protection: ['system.converter-protection-control', 'unit.converter-protection.control'] as const,
    instrumentTransformer: ['asset.converter-instrument-transformer', 'node.converter-instrument-transformer'] as const,
    breaker: ['asset.converter-breaker', 'node.converter-breaker'] as const,
    transformer: ['asset.converter-transformer', 'node.converter-transformer'] as const,
  }),
  'switching-station': Object.freeze({
    measurement: ['system.switching-measurement-control', 'unit.switching-measurement.control'] as const,
    protection: ['system.switching-protection-control', 'unit.switching-protection.control'] as const,
    instrumentTransformer: ['asset.switching-instrument-transformer', 'node.switching-instrument-transformer'] as const,
    breaker: ['asset.switching-breaker', 'node.switching-breaker'] as const,
  }),
} as const)

/** 三份参考资料各落盘一次；十一个逻辑上下文通过稳定编号复用同一只读文件。 */
const PROTECTION_TOPOLOGIES = Object.freeze([
  Object.freeze({
    key: 'transformer-protection',
    topologyPath: 'process-detail/protection/transformer-protection/topology.json',
    sourceSha256: 'cebf00fc7b375ff7bff26e29da3d722edc378f825d75813f384825b9a24f5431',
    expectedPenCount: 37,
    devicePenBindings: Object.freeze([
      ['13641187', 'measurement'], ['638bfdc8', 'protection'], ['4c977fd', 'instrumentTransformer'],
      ['5ba41a5e', 'breaker'], ['2afc53b', 'transformer'],
    ] as const),
  }),
  Object.freeze({
    key: 'busbar-protection',
    topologyPath: 'process-detail/protection/busbar-protection/topology.json',
    sourceSha256: '0b6ed18b48c7039cf3f0079642f1b9d2197c9a2890fd5a28d50839eca7161eb4',
    expectedPenCount: 35,
    devicePenBindings: Object.freeze([
      ['764bd402', 'measurement'], ['276dbcd0', 'protection'], ['6c957795', 'instrumentTransformer'],
      ['149e5ff', 'breaker'],
    ] as const),
  }),
  Object.freeze({
    key: 'line-protection',
    topologyPath: 'process-detail/protection/line-protection/topology.json',
    sourceSha256: 'e635617e600c787442823d0887c79bc581bbb244a63a9dc1c51d732be6b2c08c',
    expectedPenCount: 34,
    devicePenBindings: Object.freeze([
      ['c15baad', 'measurement'], ['b8f3ceb', 'protection'], ['a5f4bae', 'instrumentTransformer'],
      ['31d8ffd', 'breaker'],
    ] as const),
  }),
] as const)

/** 预计算十一个上下文和各自的图元绑定；未确认语义的图元保持二维只读，不伪造三维目标。 */
function createProtectionTopologyContexts(): readonly TopologyDataContext[] {
  return PROTECTION_SCENES.flatMap((sceneId) => {
    const topologyKeys = PROTECTION_SCENE_TOPOLOGY_KEYS[sceneId]
    return PROTECTION_TOPOLOGIES.filter((topology) => topologyKeys.includes(topology.key)).map((topology) => Object.freeze({
      contextId: `process-detail.${sceneId}.${topology.key}`,
      renderer: 'manifest-json' as const,
      topologyPath: topology.topologyPath,
      sourceSha256: topology.sourceSha256,
      expectedPenCount: topology.expectedPenCount,
      bindings: Object.freeze(topology.devicePenBindings.flatMap(([penId, role]) => {
        const sceneBindings = PROTECTION_SCENE_NODE_BINDINGS[sceneId]
        // 角色来自源 JSON 的可见文字：测控装置、保护装置、互感器、断路器、变压器；不按数组位置推断。
        const target = sceneBindings[role as ProtectionDeviceRole]
        return target ? [Object.freeze({
          penId,
          // 直接复用正式总览拓扑节点，保证第三层点击、中央选择状态和 Unity 三维节点使用同一主键。
          nodeId: target[0],
          sceneNodeId: target[1],
        })] : []
      })),
    }))
  })
}

/**
 * 第三层关键环节 JSON 的显式上下文清单。
 *
 * 图元编号只在对应文件内有效，不能与总览或其他关键环节文件混用；
 * 每项绑定均由参考 JSON 和现有业务节点逐项核对，未核对的控制装置保持未绑定。
 */
const PROCESS_DETAIL_TOPOLOGY_CONTEXTS: readonly TopologyDataContext[] = Object.freeze([
  Object.freeze({
    contextId: 'process-detail.wind-power.wind-turbine',
    renderer: 'manifest-json',
    topologyPath: 'process-detail/wind-power/wind-turbine/topology.json',
    sourceSha256: '246826daf501f12ca1ff88b28179976bf2bcff8837ce50767ba0e7c17fb9525c',
    expectedPenCount: 40,
    bindings: Object.freeze([]),
  }),
  Object.freeze({
    contextId: 'process-detail.wind-power.gearbox',
    renderer: 'manifest-json',
    topologyPath: 'process-detail/wind-power/gearbox/topology.json',
    sourceSha256: 'bb6ed25e5f473e9276ac9370aaea19fa825ec49467f331e913d4ecd05ed4185a',
    expectedPenCount: 15,
    bindings: Object.freeze([]),
  }),
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

import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'

/** 四个变电站类场景使用相同保护画面；第二层设备绑定仍按当前场景显式登记。 */
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
type ProtectionTopologyBinding = { readonly penId: string; readonly nodeId: string; readonly sceneNodeId?: string }

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

/**
 * 第三层断路器是合作方独立上报的状态节点，必须与第二层 Unity（统一开发平台）节点分开。
 * 这些编号同时写入发布清单的 topologyNodes，statusTargetNodeId 指向对应第二层断路器；
 * 因此第三层只参与二维状态聚合，不产生三维映射。
 */
export const PROTECTION_PROCESS_DETAIL_BREAKER_NODE_IDS = Object.freeze({
  'step-down-substation': Object.freeze({
    'transformer-protection': 'asset.step-down-transformer-protection-breaker',
    'busbar-protection': 'asset.step-down-busbar-protection-breaker',
    'line-protection': 'asset.step-down-line-protection-breaker',
  }),
  'step-up-substation': Object.freeze({
    'transformer-protection': 'asset.step-up-transformer-protection-breaker',
    'busbar-protection': 'asset.step-up-busbar-protection-breaker',
    'line-protection': 'asset.step-up-line-protection-breaker',
  }),
  'converter-station': Object.freeze({
    'transformer-protection': 'asset.converter-transformer-protection-breaker',
    'busbar-protection': 'asset.converter-busbar-protection-breaker',
    'line-protection': 'asset.converter-line-protection-breaker',
  }),
  'switching-station': Object.freeze({
    'busbar-protection': 'asset.switching-busbar-protection-breaker',
    'line-protection': 'asset.switching-line-protection-breaker',
  }),
} as const)

/** 三份参考资料各落盘一次；十一个逻辑上下文通过稳定编号复用同一只读文件。 */
const PROTECTION_TOPOLOGIES = Object.freeze([
  Object.freeze({
    key: 'transformer-protection',
    topologyPath: 'process-detail/protection/transformer-protection/topology.json',
    // 原始参考文件散列为 924775e96291054d071f7c81ad617532eb3cdd1fc1cfc5a7aba6da86d7a75e0d、43 个图元；
    // 运行时另补入公共目录中的变压器及连接线，因此以下散列和数量锁定本次可交付文件。
    sourceSha256: 'f212e9bc772af3ee832707337d8ad852a515d8431806396899718959f056b4cf',
    expectedPenCount: 45,
    devicePenBindings: Object.freeze([
      // 新文件把六个保护装置拆成独立图元，全部沿用原保护控制业务节点，状态可同步到同一设备。
      ['4d08c079', 'protection'], ['1cc838c8', 'protection'], ['bfe233e', 'protection'],
      ['5357ee02', 'protection'], ['525ddd87', 'protection'], ['10a7f4', 'protection'],
      ['b901fcf', 'instrumentTransformer'], ['3934001', 'breaker'],
      // 参考 JSON 未提供变压器图元，已从公共资源目录补入旧业务图元编号，保持原变压器绑定不变。
      ['2afc53b', 'transformer'],
    ] as const),
  }),
  Object.freeze({
    key: 'busbar-protection',
    topologyPath: 'process-detail/protection/busbar-protection/topology.json',
    // 原始参考文件散列为 3d1964089908ca323301c3ee70d3908fbdf992c36fe7aca335781aab4b7bfbd9、30 个图元；
    // 运行时仅做公共 WebP 本地化，以下散列和数量锁定可交付文件。
    sourceSha256: 'c161e398a4a2ca6ae14a1fc08c2942ba02c89cb38e38aedf05e70d46ff75d648',
    expectedPenCount: 30,
    devicePenBindings: Object.freeze([
      ['697c8274', 'protection'], ['9feded4', 'protection'], ['369ffe7d', 'instrumentTransformer'],
      ['9ca0194', 'breaker'],
    ] as const),
  }),
  Object.freeze({
    key: 'line-protection',
    topologyPath: 'process-detail/protection/line-protection/topology.json',
    // 原始参考文件散列为 f4919d57d13b746d01b2ea7e2a6ddf8c2555f3ee074880f97868631282949507、39 个图元；
    // 运行时仅做公共 WebP 本地化，以下散列和数量锁定可交付文件。
    sourceSha256: 'f4edf30234dc7dd90b1bda72576adbe7a1a8e32dea6c41b95b37aa62c6cadc3b',
    expectedPenCount: 39,
    devicePenBindings: Object.freeze([
      ['4a0e1cda', 'protection'], ['26b1c4c0', 'protection'], ['318d6252', 'protection'],
      ['1c93d79', 'protection'], ['53ce6f5c', 'protection'], ['7a69ba60', 'instrumentTransformer'],
      ['740db66c', 'breaker'],
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
      bindings: Object.freeze(topology.devicePenBindings.flatMap(([penId, role]): ProtectionTopologyBinding[] => {
        const sceneBindings = PROTECTION_SCENE_NODE_BINDINGS[sceneId]
        // 角色来自源 JSON 的可见文字：测控装置、保护装置、互感器、断路器、变压器；不按数组位置推断。
        if (role === 'breaker') {
          const sceneBreakerNodeIds = PROTECTION_PROCESS_DETAIL_BREAKER_NODE_IDS[sceneId] as Readonly<Record<string, string>>
          const nodeId = sceneBreakerNodeIds[topology.key]
          return nodeId ? [Object.freeze({ penId: String(penId), nodeId })] : []
        }
        const target = sceneBindings[role as ProtectionDeviceRole]
        return target ? [Object.freeze({
          penId: String(penId),
          // 保护装置、互感器等已有映射继续沿用第二层业务节点；只有第三层断路器使用独立合作方节点。
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
 * 每项绑定均由参考 JSON 逐项核对。无 sceneNodeId 的条目只接收合作方状态并更新二维第三层，不映射 Unity。
 */
const PROCESS_DETAIL_TOPOLOGY_CONTEXTS: readonly TopologyDataContext[] = Object.freeze([
  Object.freeze({
    contextId: 'process-detail.wind-power.wind-turbine',
    renderer: 'manifest-json',
    topologyPath: 'process-detail/wind-power/wind-turbine/topology.json',
    // 风机关键环节最新输入含三十五个顶层图元；版本散列同时阻断旧四十图元文件缓存。
    sourceSha256: '41c4f6eb12126401c67207b85683ce4c2dea786af69b457c84d36b8c6184ef4c',
    expectedPenCount: 35,
    bindings: Object.freeze([
      // 偏航系统五个设备图元共用同一业务状态；系统区域框本身没有图片，不登记为状态图元。
      Object.freeze({ penId: '4e8f84e0', nodeId: 'asset.wind-turbine-yaw-system' }),
      Object.freeze({ penId: 'ff8e8e2', nodeId: 'asset.wind-turbine-yaw-system' }),
      Object.freeze({ penId: 'e1cb52b', nodeId: 'asset.wind-turbine-yaw-system' }),
      Object.freeze({ penId: 'f6eb29d', nodeId: 'asset.wind-turbine-yaw-system' }),
      Object.freeze({ penId: '4af3bcb7', nodeId: 'asset.wind-turbine-yaw-system' }),
      // 传动系统五个设备图元共用原传动系统业务状态，齿轮箱仍是其中的主设备。
      Object.freeze({ penId: '2167a855', nodeId: 'asset.wind-turbine-drivetrain-system' }),
      Object.freeze({ penId: '49b8df2', nodeId: 'asset.wind-turbine-drivetrain-system' }),
      Object.freeze({ penId: '7e83956', nodeId: 'asset.wind-turbine-drivetrain-system' }),
      Object.freeze({ penId: '76259d', nodeId: 'asset.wind-turbine-drivetrain-system' }),
      Object.freeze({ penId: 'a0a7e97', nodeId: 'asset.wind-turbine-drivetrain-system' }),
    ]),
  }),
  Object.freeze({
    contextId: 'process-detail.wind-power.gearbox',
    renderer: 'manifest-json',
    topologyPath: 'process-detail/wind-power/gearbox/topology.json',
    // 齿轮箱专属新输入共二十个源图元，原组合没有子图元，无需展平；两个状态节点仅提供合作方二维状态，不声明独立三维绑定。
    sourceSha256: '1f3de2f9cb1f4e7ea86daa836c9c5f189fa059c5bf33c7d9d49866e66512c9fc',
    expectedPenCount: 20,
    bindings: Object.freeze([
      // 散热风扇使用本文件真实图元编号，供合作方按稳定业务编号接收四态状态。
      Object.freeze({ penId: '310a9d42', nodeId: 'asset.wind-gearbox-cooling-fan' }),
      // 润滑油装置只绑定齿轮箱第三层业务编号，没有独立 Unity 节点映射。
      Object.freeze({ penId: 'a7d5ad8', nodeId: 'asset.wind-gearbox-lubrication-unit' }),
    ]),
  }),
  Object.freeze({
    contextId: 'process-detail.wind-power.yaw-system',
    renderer: 'manifest-json',
    // 用户提供的偏航专属完整图；五个子设备没有独立三维编号，不借用整机编号制造子设备映射。
    topologyPath: 'process-detail/wind-power/yaw-system/topology.json',
    sourceSha256: '86767c78df1d0ea12ed8b34e3ed8834caa0ba27d13a0dbd6e2011ac175d7dddd',
    expectedPenCount: 15,
    bindings: Object.freeze([
      // 角度传感器使用独立平台状态编号，不借用偏航系统整机 Unity 节点。
      Object.freeze({ penId: '5221dc0', nodeId: 'asset.wind-yaw-angle-sensor' }),
    ]),
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
    // 2026-10-21 同步用户提供的光伏逆变器关键环节最新 JSON。
    sourceSha256: '392c1bee67b66723fe0fb06f438637a34c85a763f6da72596309740cac2a2e88',
    expectedPenCount: 18,
    bindings: Object.freeze([
      // 网关和实体逆变器分别沿用光伏场景的正式业务节点，均按来源文件的稳定图元编号绑定。
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

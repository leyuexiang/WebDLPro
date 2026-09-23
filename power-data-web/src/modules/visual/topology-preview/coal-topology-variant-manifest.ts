/**
 * 燃煤拓扑固定使用四个业务层级。架构层对应独立文件并与其余层互斥；
 * 其余三层按固定顺序生成组合键，避免勾选顺序影响缓存和文件查找。
 */
export type CoalTopologyLayerId = 'architecture' | 'network' | 'business' | 'key-process'

export type CoalTopologyCombinationKey =
  | 'architecture'
  | 'network'
  | 'business'
  | 'key-process'
  | 'network+business'
  | 'network+key-process'
  | 'business+key-process'
  | 'network+business+key-process'

export type CoalTopologyVariantId =
  | 'architecture'
  | 'network'
  | 'business'
  | 'key-process'
  | 'network-business'
  | 'network-key-process'
  | 'business-key-process'
  | 'network-business-key-process'
  | 'process-detail-boiler'
  | 'process-detail-steam-turbine'

export interface CoalTopologyVariantManifestEntry {
  readonly id: CoalTopologyVariantId
  readonly combinationKey: CoalTopologyCombinationKey
  readonly layerIds: readonly CoalTopologyLayerId[]
  readonly topologyPath: string
  readonly sourceSha256: string
  readonly expectedPenCount: number
  readonly isDefault?: true
}

/** 第三层汽轮机输入不参与四层筛选，仅复用燃煤公共 Meta2D 运行时。 */
export interface CoalProcessDetailVariantManifestEntry {
  readonly id: 'process-detail-boiler' | 'process-detail-steam-turbine'
  readonly topologyPath: string
  readonly sourceSha256: string
  readonly expectedPenCount: number
  readonly isProcessDetail: true
}

/**
 * 八份经过安全审计的独立输入文件。每项锁定图元数与安全散列算法 256 位（SHA-256），
 * 测试可据此发现文件被意外替换；运行时只能精确加载，禁止合并其他文件生成组合图。
 */
export const COAL_TOPOLOGY_VARIANTS = Object.freeze([
  {
    id: 'architecture', combinationKey: 'architecture', layerIds: Object.freeze(['architecture']),
    topologyPath: 'variants/architecture/topology.json',
    sourceSha256: '5d302bd3d8c006ac379fade4fdf80b915c29eee3c9059b2fa25540c61ac99861', expectedPenCount: 70,
  },
  {
    id: 'network', combinationKey: 'network', layerIds: Object.freeze(['network']),
    topologyPath: 'variants/network/topology.json',
    sourceSha256: '2a5036e2b6a648159baa42679863db743ddd1e51e13465ada6a71c72c7fbca62', expectedPenCount: 110,
  },
  {
    id: 'business', combinationKey: 'business', layerIds: Object.freeze(['business']),
    topologyPath: 'variants/business/topology.json',
    sourceSha256: '45707987e1b2db0602c55d6d5801d7eb6502487ecaca55fc03613a4566496f7e', expectedPenCount: 38,
  },
  {
    id: 'key-process', combinationKey: 'key-process', layerIds: Object.freeze(['key-process']),
    topologyPath: 'variants/key-process/topology.json',
    sourceSha256: '513344c1af2d80f5a3eeca016a00e46916340b3684924bca7afd92125a86c49f', expectedPenCount: 46,
  },
  {
    id: 'network-business', combinationKey: 'network+business', layerIds: Object.freeze(['network', 'business']),
    topologyPath: 'variants/network-business/topology.json',
    sourceSha256: 'd1f22712d1eb5f8c9aed0caa8bd48d3d0fcf02b66601c398a866a20412726f26', expectedPenCount: 136,
  },
  {
    id: 'network-key-process', combinationKey: 'network+key-process', layerIds: Object.freeze(['network', 'key-process']),
    topologyPath: 'variants/network-key-process/topology.json',
    sourceSha256: 'd5da5e0b32d778d4d4e828eee3c88b1cf990228244573ce4f28e42198020a98b', expectedPenCount: 127,
  },
  {
    id: 'business-key-process', combinationKey: 'business+key-process', layerIds: Object.freeze(['business', 'key-process']),
    topologyPath: 'variants/business-key-process/topology.json',
    sourceSha256: 'a2a1aac569346af2bd6f9c6fec2bf87b70b6e4daeb7aa91d326f4855e02c3ff8', expectedPenCount: 79,
  },
  {
    id: 'network-business-key-process', combinationKey: 'network+business+key-process',
    layerIds: Object.freeze(['network', 'business', 'key-process']),
    topologyPath: 'variants/network-business-key-process/topology.json',
    sourceSha256: '4c3a1f9f21660ff44f25d5c48d7784b3dbb9f738947451b274c8646e187629ac', expectedPenCount: 159,
    isDefault: true,
  },
] as const satisfies readonly CoalTopologyVariantManifestEntry[])

/** 燃煤汽轮机第三层只加载用户提供的独立 JSON。 */
export const COAL_PROCESS_DETAIL_VARIANTS: readonly CoalProcessDetailVariantManifestEntry[] = Object.freeze([
  Object.freeze({
    id: 'process-detail-boiler',
    topologyPath: 'variants/key-process/topology.json',
    sourceSha256: '513344c1af2d80f5a3eeca016a00e46916340b3684924bca7afd92125a86c49f',
    expectedPenCount: 46,
    isProcessDetail: true,
  }),
  Object.freeze({
    id: 'process-detail-steam-turbine',
    // 与燃气关键环节一致，发布目录为 shell/topology/process-detail，回退一层即可定位独立 JSON。
    topologyPath: '../process-detail/coal-power/steam-turbine/topology.json',
    sourceSha256: '5c7262f198f4b4443d863d07a8b39f5bd0d9d841cb03d820b5535c736c78a79c',
    expectedPenCount: 45,
    isProcessDetail: true,
  }),
])

/** 组合键索引仅构建一次，筛选热路径只执行常数时间查找。 */
export const COAL_TOPOLOGY_VARIANT_BY_COMBINATION_KEY: ReadonlyMap<
  CoalTopologyCombinationKey, CoalTopologyVariantManifestEntry
> = new Map(COAL_TOPOLOGY_VARIANTS.map((variant) => [variant.combinationKey, variant]))

/** 图元资源和业务绑定均以版本编号隔离，不能跨文件复用图元编号。 */
export const COAL_TOPOLOGY_VARIANT_BY_ID: ReadonlyMap<
  CoalTopologyVariantId, CoalTopologyVariantManifestEntry | CoalProcessDetailVariantManifestEntry
> = new Map<CoalTopologyVariantId, CoalTopologyVariantManifestEntry | CoalProcessDetailVariantManifestEntry>([
  ...COAL_TOPOLOGY_VARIANTS.map((variant) => [variant.id, variant] as [CoalTopologyVariantId, CoalTopologyVariantManifestEntry]),
  ...COAL_PROCESS_DETAIL_VARIANTS.map((variant) => [variant.id, variant] as [CoalTopologyVariantId, CoalProcessDetailVariantManifestEntry]),
])

/** 默认项显式指向燃煤三层整图，不由数组位置或四层全选隐式推导。 */
export const COAL_DEFAULT_TOPOLOGY_VARIANT = COAL_TOPOLOGY_VARIANTS.find(
  (variant) => (variant as CoalTopologyVariantManifestEntry).isDefault === true,
)!

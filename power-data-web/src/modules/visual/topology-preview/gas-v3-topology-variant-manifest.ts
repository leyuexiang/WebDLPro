/**
 * 燃气第三版拓扑的四个业务层级。架构层拥有独立拓扑文件，不能与其余三层组合。
 * 其余三层按固定顺序生成组合键，避免勾选顺序影响缓存和文件查找。
 */
export type GasV3TopologyLayerId = 'architecture' | 'network' | 'business' | 'key-process'

export type GasV3TopologyCombinationKey =
  | 'architecture'
  | 'network'
  | 'business'
  | 'key-process'
  | 'network+business'
  | 'network+key-process'
  | 'business+key-process'
  | 'network+business+key-process'

export type GasV3TopologyVariantId =
  | 'architecture'
  | 'network'
  | 'business'
  | 'key-process'
  | 'network-business'
  | 'network-key-process'
  | 'business-key-process'
  | 'network-business-key-process'
  | 'process-detail-gas-turbine'

export interface GasV3TopologyVariantManifestEntry {
  readonly id: GasV3TopologyVariantId
  readonly combinationKey: GasV3TopologyCombinationKey
  readonly layerIds: readonly GasV3TopologyLayerId[]
  readonly topologyPath: string
  readonly sourceSha256: string
  readonly expectedPenCount: number
  readonly isDefault?: true
}

/** 第三层独立输入不参与四层筛选，但复用同一数据加载和 Meta2D 运行时。 */
export interface GasV3ProcessDetailVariantManifestEntry {
  readonly id: 'process-detail-gas-turbine'
  readonly topologyPath: string
  readonly sourceSha256: string
  readonly expectedPenCount: number
  readonly isProcessDetail: true
}

/**
 * 八份经过安全审计的输入文件清单。每个组合都精确指向用户单独提供的完整组态文件，
 * 散列值和图元数用于测试阶段发现文件被意外替换，禁止运行时合并其他版本生成组合图。
 */
export const GAS_V3_TOPOLOGY_VARIANTS = Object.freeze([
  {
    id: 'architecture',
    combinationKey: 'architecture',
    layerIds: Object.freeze(['architecture']),
    topologyPath: 'variants/architecture/topology.json',
    sourceSha256: 'ebce03dcd096b781fadc90134e47fde14b967577d6b6a42896004b6fe639afae',
    expectedPenCount: 62,
  },
  {
    id: 'network',
    combinationKey: 'network',
    layerIds: Object.freeze(['network']),
    topologyPath: 'variants/network/topology.json',
    sourceSha256: 'a1f09bc40e55830060cc8fb7f481f19b16511e5dd1e8959fe5b4473373ab96e7',
    expectedPenCount: 101,
  },
  {
    id: 'business',
    combinationKey: 'business',
    layerIds: Object.freeze(['business']),
    topologyPath: 'variants/business/topology.json',
    sourceSha256: '82b7c4f643965d9983d8ca067d047dbb866958f75c52f9619cc25417e920c3f8',
    expectedPenCount: 39,
  },
  {
    id: 'key-process',
    combinationKey: 'key-process',
    layerIds: Object.freeze(['key-process']),
    topologyPath: 'variants/key-process/topology.json',
    sourceSha256: '4aca388b53b7598293b2959bb7f5830b28835f360834c4e8f3f0d3ef859e3583',
    expectedPenCount: 44,
  },
  {
    id: 'network-business',
    combinationKey: 'network+business',
    layerIds: Object.freeze(['network', 'business']),
    topologyPath: 'variants/network-business/topology.json',
    // 2026-09-07 用户纠正输入：燃气 网+业 (1).zip 内 public/json/v.json。
    // 使用原始文件散列锁定本次燃气数据，防止误恢复为此前含燃煤内容的输入。
    sourceSha256: '87d0fd5b77a2a308570859eed142d22613a32aed05cdb07a13f6d8e832248206',
    expectedPenCount: 124,
  },
  {
    id: 'network-key-process',
    combinationKey: 'network+key-process',
    layerIds: Object.freeze(['network', 'key-process']),
    topologyPath: 'variants/network-key-process/topology.json',
    sourceSha256: '5e7b0c5fdd7f183c67a9c8018421a94d9e7e8eaa10551b3e5db0d81bd055c571',
    expectedPenCount: 118,
  },
  {
    id: 'business-key-process',
    combinationKey: 'business+key-process',
    layerIds: Object.freeze(['business', 'key-process']),
    topologyPath: 'variants/business-key-process/topology.json',
    sourceSha256: '207c140ca9d72eb52a687a405af44f2d240d6ae992bd85151a55ca7942e6289a',
    expectedPenCount: 75,
  },
  {
    id: 'network-business-key-process',
    combinationKey: 'network+business+key-process',
    layerIds: Object.freeze(['network', 'business', 'key-process']),
    topologyPath: 'variants/network-business-key-process/topology.json',
    sourceSha256: '6a50c4b0ed4eaba2793fafff5bacabd4487f6c03087d230313e62388c728bc53',
    expectedPenCount: 144,
    isDefault: true,
  },
] as const satisfies readonly GasV3TopologyVariantManifestEntry[])

/** 燃气轮机第三层只加载用户提供的独立 JSON，不从四层文件拼接图元。 */
export const GAS_V3_PROCESS_DETAIL_VARIANTS: readonly GasV3ProcessDetailVariantManifestEntry[] = Object.freeze([
  Object.freeze({
    id: 'process-detail-gas-turbine',
    // 运行包把该文件复制到 shell/topology/process-detail；相对 gas-v3-json-preview 只需回退一层，
    // 避免构建后的相对 URL 规范化为 shell/process-detail 并产生 404。
    topologyPath: '../process-detail/gas-power/gas-turbine/topology.json',
    sourceSha256: '30652c2a8a2b5bf0af76c70501baa94e2ece57edb57fd35d164486546103b9ba',
    expectedPenCount: 32,
    isProcessDetail: true,
  }),
])

/** 组合键索引只构建一次，切层热路径为常数时间查找，不扫描拓扑图元。 */
export const GAS_V3_TOPOLOGY_VARIANT_BY_COMBINATION_KEY: ReadonlyMap<
  GasV3TopologyCombinationKey,
  GasV3TopologyVariantManifestEntry
> = new Map(GAS_V3_TOPOLOGY_VARIANTS.map((variant) => [variant.combinationKey, variant]))

/** 图元资源和业务绑定以版本编号为边界，不能跨文件复用图元编号。 */
export const GAS_V3_TOPOLOGY_VARIANT_BY_ID: ReadonlyMap<
  GasV3TopologyVariantId,
  GasV3TopologyVariantManifestEntry | GasV3ProcessDetailVariantManifestEntry
> = new Map<GasV3TopologyVariantId, GasV3TopologyVariantManifestEntry | GasV3ProcessDetailVariantManifestEntry>([
  ...GAS_V3_TOPOLOGY_VARIANTS.map((variant) => [variant.id, variant] as [GasV3TopologyVariantId, GasV3TopologyVariantManifestEntry]),
  ...GAS_V3_PROCESS_DETAIL_VARIANTS.map((variant) => [variant.id, variant] as [GasV3TopologyVariantId, GasV3ProcessDetailVariantManifestEntry]),
])

export const GAS_V3_DEFAULT_TOPOLOGY_VARIANT = GAS_V3_TOPOLOGY_VARIANTS.find(
  (variant) => (variant as GasV3TopologyVariantManifestEntry).isDefault === true,
)!

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
    sourceSha256: 'fa38291d1361c58c4f73574a4d7e93bcc0370eb3ddbae8eced503b7132617006',
    expectedPenCount: 62,
  },
  {
    id: 'network',
    combinationKey: 'network',
    layerIds: Object.freeze(['network']),
    topologyPath: 'variants/network/topology.json',
    sourceSha256: 'a24b9407e8641197e9cb1b75020357f760df4aec33911b0d0992d79f995ff0c1',
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
    sourceSha256: '536124e12bef5ce743eda38838dfb4549783da27249b0745e67fc91d4712fa41',
    expectedPenCount: 124,
  },
  {
    id: 'network-key-process',
    combinationKey: 'network+key-process',
    layerIds: Object.freeze(['network', 'key-process']),
    topologyPath: 'variants/network-key-process/topology.json',
    sourceSha256: '013fcedc684fd8549563cc85584b26e70cfb7c73612868ed42e098efb92e4cbd',
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
    sourceSha256: '9bc8ef0bbebaf0cc02acc46c989d6859c68d9fc73f472c72079d9a1a4c505483',
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

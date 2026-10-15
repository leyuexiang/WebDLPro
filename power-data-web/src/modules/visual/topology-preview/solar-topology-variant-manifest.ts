/** 光伏第二层拓扑版本清单；筛选只按组合键加载完整输入文件。 */
export type SolarTopologyLayerId = 'architecture' | 'network' | 'business' | 'key-process'
export type SolarTopologyCombinationKey = SolarTopologyLayerId | 'network+business' | 'network+key-process' | 'business+key-process' | 'network+business+key-process'
export type SolarTopologyVariantId = 'architecture' | 'network' | 'business' | 'key-process' | 'network-business' | 'network-key-process' | 'business-key-process' | 'network-business-key-process' | 'process-detail-solar-inverter'
export interface SolarTopologyVariantManifestEntry { readonly id: SolarTopologyVariantId; readonly combinationKey: SolarTopologyCombinationKey; readonly layerIds: readonly SolarTopologyLayerId[]; readonly topologyPath: string; readonly sourceSha256: string; readonly expectedPenCount: number; readonly isDefault?: true }

/** 第三层逆变器详情不属于第二层筛选，类型中刻意不提供组合键和层级集合。 */
export interface SolarProcessDetailVariantManifestEntry {
  readonly id: 'process-detail-solar-inverter'
  readonly topologyPath: string
  readonly sourceSha256: string
  readonly expectedPenCount: number
  readonly isProcessDetail: true
}
/** 八份文件均直接来自用户指定的独立压缩包，散列和图元数用于防止误替换。 */
export const SOLAR_TOPOLOGY_VARIANTS = [
  { id: 'architecture', combinationKey: 'architecture', layerIds: ['architecture'], topologyPath: 'variants/architecture/topology.json', sourceSha256: '42d11a6c9e0951dce4bb179697a4f02f811ff94e5d6949efbd6dd6b14fdb264c', expectedPenCount: 54 },
  { id: 'network', combinationKey: 'network', layerIds: ['network'], topologyPath: 'variants/network/topology.json', sourceSha256: '68e1ef5f5b5197f314dc54b8e78aab3e181b6fbad9804971a5b11bc04478579e', expectedPenCount: 75 },
  { id: 'business', combinationKey: 'business', layerIds: ['business'], topologyPath: 'variants/business/topology.json', sourceSha256: 'd0bfbe476cf0a63dbb73aa6da8e656e5d98c9672ee56bd9ea9ea2db06f7a726b', expectedPenCount: 48 },
  { id: 'key-process', combinationKey: 'key-process', layerIds: ['key-process'], topologyPath: 'variants/key-process/topology.json', sourceSha256: '8cd677368fb61917fba5e233106baaa18dccce975fe564a917c3721bd017a92f', expectedPenCount: 67 },
  { id: 'network-business', combinationKey: 'network+business', layerIds: ['network', 'business'], topologyPath: 'variants/network-business/topology.json', sourceSha256: '0661afe914481790fcd45610d9842b09a76610e055724faf0f0041fb7573944b', expectedPenCount: 101 },
  { id: 'network-key-process', combinationKey: 'network+key-process', layerIds: ['network', 'key-process'], topologyPath: 'variants/network-key-process/topology.json', sourceSha256: '4408545bb1ab7cf9d48a65e475e76ecc8536314f29c4a647f2317239be8a9b31', expectedPenCount: 96 },
  { id: 'business-key-process', combinationKey: 'business+key-process', layerIds: ['business', 'key-process'], topologyPath: 'variants/business-key-process/topology.json', sourceSha256: '9baa6c3ab00f7a43d074c09e2282e6f4534c6d3e37c2e5c3b4b1d3253e769f4b', expectedPenCount: 100 },
  { id: 'network-business-key-process', combinationKey: 'network+business+key-process', layerIds: ['network', 'business', 'key-process'], topologyPath: 'variants/network-business-key-process/topology.json', sourceSha256: '01cefac7b1c70150e9827af66cdd178fae850ac036c24a9d7ecf5237625b993c', expectedPenCount: 129, isDefault: true },
] as const satisfies readonly SolarTopologyVariantManifestEntry[]

/** 逆变器关键环节只加载本次压缩包审核通过的唯一完整文件，不拼接第二层图元。 */
export const SOLAR_PROCESS_DETAIL_VARIANTS: readonly SolarProcessDetailVariantManifestEntry[] = Object.freeze([
  Object.freeze({
    id: 'process-detail-solar-inverter',
    // 发布目录以 solar-json-preview 为基准回退一层，最终定位到 shell/topology/process-detail。
    topologyPath: '../process-detail/solar-power/inverter/topology.json',
    sourceSha256: '6391b1212c07664721cbccfea4bb9d5f7ef06487655b08fbf09d4b09e9018686',
    expectedPenCount: 19,
    isProcessDetail: true,
  }),
])
/** 两个索引只构建一次，切层热路径保持常数时间查询。 */
export const SOLAR_TOPOLOGY_VARIANT_BY_ID: ReadonlyMap<
  SolarTopologyVariantId,
  SolarTopologyVariantManifestEntry | SolarProcessDetailVariantManifestEntry
> = new Map<SolarTopologyVariantId, SolarTopologyVariantManifestEntry | SolarProcessDetailVariantManifestEntry>([
  ...SOLAR_TOPOLOGY_VARIANTS.map((variant) => [variant.id, variant] as [SolarTopologyVariantId, SolarTopologyVariantManifestEntry]),
  ...SOLAR_PROCESS_DETAIL_VARIANTS.map((variant) => [variant.id, variant] as [SolarTopologyVariantId, SolarProcessDetailVariantManifestEntry]),
])
export const SOLAR_TOPOLOGY_VARIANT_BY_COMBINATION_KEY: ReadonlyMap<SolarTopologyCombinationKey, SolarTopologyVariantManifestEntry> = new Map(SOLAR_TOPOLOGY_VARIANTS.map((variant) => [variant.combinationKey, variant]))
/** 默认总图由用户明确指定，不能依赖数组顺序。 */
export const SOLAR_DEFAULT_TOPOLOGY_VARIANT = SOLAR_TOPOLOGY_VARIANTS.find((variant) => 'isDefault' in variant)!

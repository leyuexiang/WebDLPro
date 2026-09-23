/** 开关站第二层固定层级；架构层拥有独立文件并与其他层互斥。 */
export type SwitchingStationTopologyLayerId = 'architecture' | 'network' | 'business' | 'key-process'

export type SwitchingStationTopologyCombinationKey =
  | SwitchingStationTopologyLayerId
  | 'network+business'
  | 'network+key-process'
  | 'business+key-process'
  | 'network+business+key-process'

export type SwitchingStationTopologyVariantId =
  | 'architecture'
  | 'network'
  | 'business'
  | 'key-process'
  | 'network-business'
  | 'network-key-process'
  | 'business-key-process'
  | 'network-business-key-process'

export interface SwitchingStationTopologyVariantManifestEntry {
  readonly id: SwitchingStationTopologyVariantId
  readonly combinationKey: SwitchingStationTopologyCombinationKey
  readonly layerIds: readonly SwitchingStationTopologyLayerId[]
  readonly topologyPath: string
  readonly sourceSha256: string
  readonly expectedPenCount: number
  readonly isDefault?: true
}

/**
 * 八份源文件逐一对应用户提供的单层、双层和三层整图。
 * 散列与图元数锁定本次输入，筛选只允许常数时间查表并加载完整文件。
 */
export const SWITCHING_STATION_TOPOLOGY_VARIANTS = Object.freeze([
  { id: 'architecture', combinationKey: 'architecture', layerIds: Object.freeze(['architecture']), topologyPath: 'variants/architecture/topology.json', sourceSha256: '50ec2bf804bef5417968cb06d3d4cf0eee0a2c2f2b0700efca6b13bcad6881b7', expectedPenCount: 50 },
  { id: 'network', combinationKey: 'network', layerIds: Object.freeze(['network']), topologyPath: 'variants/network/topology.json', sourceSha256: '8629aef0b3e2b68108c9cd3a6357dccba1a447af2d892df146e4b25e79037371', expectedPenCount: 78 },
  { id: 'business', combinationKey: 'business', layerIds: Object.freeze(['business']), topologyPath: 'variants/business/topology.json', sourceSha256: '9a715686ab680255652128d80fbe9edd56f28587635a6afa5d67b58bc0a55b31', expectedPenCount: 25 },
  { id: 'key-process', combinationKey: 'key-process', layerIds: Object.freeze(['key-process']), topologyPath: 'variants/key-process/topology.json', sourceSha256: '4a57419ab65c2994be9cb3666eef9083975fa61ba8ac5fa0e2ea330f8caa2f73', expectedPenCount: 43 },
  { id: 'network-business', combinationKey: 'network+business', layerIds: Object.freeze(['network', 'business']), topologyPath: 'variants/network-business/topology.json', sourceSha256: '6e5ceb97cacf87f84ff30194ecaa67711291e73873bb4ec6fdff3f103756c179', expectedPenCount: 87 },
  { id: 'network-key-process', combinationKey: 'network+key-process', layerIds: Object.freeze(['network', 'key-process']), topologyPath: 'variants/network-key-process/topology.json', sourceSha256: 'c4c151e924da92a2d3aa39145bb87089740701c05b62f435a5daf90f88d99034', expectedPenCount: 86 },
  { id: 'business-key-process', combinationKey: 'business+key-process', layerIds: Object.freeze(['business', 'key-process']), topologyPath: 'variants/business-key-process/topology.json', sourceSha256: 'a5b7b5bdee2aa244ed6a276c65127c27d8821149aa21e514f16be2f9d9f3cd7f', expectedPenCount: 52 },
  { id: 'network-business-key-process', combinationKey: 'network+business+key-process', layerIds: Object.freeze(['network', 'business', 'key-process']), topologyPath: 'variants/network-business-key-process/topology.json', sourceSha256: 'ecb6561c22c42604124e9c17187f94967ea179b6ac7fbacf2f6389afa3a5ee54', expectedPenCount: 96, isDefault: true },
] as const satisfies readonly SwitchingStationTopologyVariantManifestEntry[])

/** 两个索引在模块初始化时各构建一次，切层热路径不扫描清单或图元。 */
export const SWITCHING_STATION_TOPOLOGY_VARIANT_BY_ID = new Map(
  SWITCHING_STATION_TOPOLOGY_VARIANTS.map((variant) => [variant.id, variant]),
)
export const SWITCHING_STATION_TOPOLOGY_VARIANT_BY_COMBINATION_KEY = new Map(
  SWITCHING_STATION_TOPOLOGY_VARIANTS.map((variant) => [variant.combinationKey, variant]),
)

/** 默认项由三层完整输入显式声明，不能依赖数组顺序或架构层聚合。 */
export const SWITCHING_STATION_DEFAULT_TOPOLOGY_VARIANT = SWITCHING_STATION_TOPOLOGY_VARIANTS.find(
  (variant) => 'isDefault' in variant,
)!

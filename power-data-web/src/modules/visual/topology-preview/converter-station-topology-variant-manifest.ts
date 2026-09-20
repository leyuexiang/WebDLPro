/** 换流站第二层固定层级；架构层拥有独立文件并与其他层互斥。 */
export type ConverterStationTopologyLayerId = 'architecture' | 'network' | 'business' | 'key-process'

export type ConverterStationTopologyCombinationKey =
  | ConverterStationTopologyLayerId
  | 'network+business'
  | 'network+key-process'
  | 'business+key-process'
  | 'network+business+key-process'

export type ConverterStationTopologyVariantId =
  | 'architecture'
  | 'network'
  | 'business'
  | 'key-process'
  | 'network-business'
  | 'network-key-process'
  | 'business-key-process'
  | 'network-business-key-process'

export interface ConverterStationTopologyVariantManifestEntry {
  readonly id: ConverterStationTopologyVariantId
  readonly combinationKey: ConverterStationTopologyCombinationKey
  readonly layerIds: readonly ConverterStationTopologyLayerId[]
  readonly topologyPath: string
  readonly sourceSha256: string
  readonly expectedPenCount: number
  readonly isDefault?: true
}

/**
 * 八份源文件逐一对应用户提供的单层、双层和三层整图。
 * 散列与图元数锁定本次输入，筛选只允许常数时间查表并加载完整文件。
 */
export const CONVERTER_STATION_TOPOLOGY_VARIANTS = Object.freeze([
  { id: 'architecture', combinationKey: 'architecture', layerIds: Object.freeze(['architecture']), topologyPath: 'variants/architecture/topology.json', sourceSha256: 'eecedbd8e5a11f3c50bb315dc5bc7aadfe000ab7e0c3396f9bf9abf8fedf4707', expectedPenCount: 57 },
  { id: 'network', combinationKey: 'network', layerIds: Object.freeze(['network']), topologyPath: 'variants/network/topology.json', sourceSha256: '9049a8bd847679f3e03ce07c5630c0d6bb4ac77860e16a3d60944981e97f07e8', expectedPenCount: 82 },
  { id: 'business', combinationKey: 'business', layerIds: Object.freeze(['business']), topologyPath: 'variants/business/topology.json', sourceSha256: 'ab40aa8232d2e9780f179c24a06d868c79517f69f336c430151b9836f0476c7b', expectedPenCount: 28 },
  { id: 'key-process', combinationKey: 'key-process', layerIds: Object.freeze(['key-process']), topologyPath: 'variants/key-process/topology.json', sourceSha256: 'e2444233abd897039783e7180f4ee712a08d0d5418566c86fa84e5958db55889', expectedPenCount: 52 },
  { id: 'network-business', combinationKey: 'network+business', layerIds: Object.freeze(['network', 'business']), topologyPath: 'variants/network-business/topology.json', sourceSha256: '3da3f8cfa01619eebf83284c7932b13114c0e9f091fca4046e8052fd298a0153', expectedPenCount: 93 },
  { id: 'network-key-process', combinationKey: 'network+key-process', layerIds: Object.freeze(['network', 'key-process']), topologyPath: 'variants/network-key-process/topology.json', sourceSha256: '33f36f402c289cf005656954f48a68a885f03597b44ff27ec2cf315defe30777', expectedPenCount: 96 },
  { id: 'business-key-process', combinationKey: 'business+key-process', layerIds: Object.freeze(['business', 'key-process']), topologyPath: 'variants/business-key-process/topology.json', sourceSha256: '137225baceadb5642b431b242f024471c88a6e7ef73f7f87682139868b3f509f', expectedPenCount: 63 },
  { id: 'network-business-key-process', combinationKey: 'network+business+key-process', layerIds: Object.freeze(['network', 'business', 'key-process']), topologyPath: 'variants/network-business-key-process/topology.json', sourceSha256: 'c6a68b568d6c964b54dceef5b97e3be54529acff6ba7be25a5aed0bc13ff874b', expectedPenCount: 107, isDefault: true },
] as const satisfies readonly ConverterStationTopologyVariantManifestEntry[])

/** 两个索引在模块初始化时各构建一次，切层热路径不扫描清单或图元。 */
export const CONVERTER_STATION_TOPOLOGY_VARIANT_BY_ID = new Map(
  CONVERTER_STATION_TOPOLOGY_VARIANTS.map((variant) => [variant.id, variant]),
)
export const CONVERTER_STATION_TOPOLOGY_VARIANT_BY_COMBINATION_KEY = new Map(
  CONVERTER_STATION_TOPOLOGY_VARIANTS.map((variant) => [variant.combinationKey, variant]),
)

/** 默认项由三层完整输入显式声明，不能依赖数组顺序或架构层聚合。 */
export const CONVERTER_STATION_DEFAULT_TOPOLOGY_VARIANT = CONVERTER_STATION_TOPOLOGY_VARIANTS.find(
  (variant) => 'isDefault' in variant,
)!

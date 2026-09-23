/** 升压站第二层固定层级；架构层拥有独立文件并与其他层互斥。 */
export type StepUpSubstationTopologyLayerId = 'architecture' | 'network' | 'business' | 'key-process'

export type StepUpSubstationTopologyCombinationKey =
  | StepUpSubstationTopologyLayerId
  | 'network+business'
  | 'network+key-process'
  | 'business+key-process'
  | 'network+business+key-process'

export type StepUpSubstationTopologyVariantId =
  | 'architecture'
  | 'network'
  | 'business'
  | 'key-process'
  | 'network-business'
  | 'network-key-process'
  | 'business-key-process'
  | 'network-business-key-process'

export interface StepUpSubstationTopologyVariantManifestEntry {
  readonly id: StepUpSubstationTopologyVariantId
  readonly combinationKey: StepUpSubstationTopologyCombinationKey
  readonly layerIds: readonly StepUpSubstationTopologyLayerId[]
  readonly topologyPath: string
  readonly sourceSha256: string
  readonly expectedPenCount: number
  readonly isDefault?: true
}

/**
 * 八份源文件逐一对应用户提供的单层、双层和三层整图。
 * 散列与图元数锁定本次输入，筛选只允许常数时间查表并加载完整文件。
 */
export const STEP_UP_SUBSTATION_TOPOLOGY_VARIANTS = Object.freeze([
  { id: 'architecture', combinationKey: 'architecture', layerIds: Object.freeze(['architecture']), topologyPath: 'variants/architecture/topology.json', sourceSha256: 'b5ca69459ca8bb059c2d221ae4ce3e37d7e96f327018ffca34e71d0ccaf83b81', expectedPenCount: 53 },
  { id: 'network', combinationKey: 'network', layerIds: Object.freeze(['network']), topologyPath: 'variants/network/topology.json', sourceSha256: '5f2e33859e49636634f602ca22f9626c235e8fde407664d8da71f50a4c784dac', expectedPenCount: 79 },
  { id: 'business', combinationKey: 'business', layerIds: Object.freeze(['business']), topologyPath: 'variants/business/topology.json', sourceSha256: '864e6e5fdbd5f966ab2333cf60a2d2bf810140d9ec928712c78e2d59f924af04', expectedPenCount: 28 },
  { id: 'key-process', combinationKey: 'key-process', layerIds: Object.freeze(['key-process']), topologyPath: 'variants/key-process/topology.json', sourceSha256: '9a57da3b575e740a67b60f3552a2bbed7bc19f1fb6ea9252dc68d76f82fdf422', expectedPenCount: 45 },
  { id: 'network-business', combinationKey: 'network+business', layerIds: Object.freeze(['network', 'business']), topologyPath: 'variants/network-business/topology.json', sourceSha256: '7691d45ab42b7c1aaf0e38a4030d42473de6cadc26b58dd148ea90548288f4f4', expectedPenCount: 90 },
  { id: 'network-key-process', combinationKey: 'network+key-process', layerIds: Object.freeze(['network', 'key-process']), topologyPath: 'variants/network-key-process/topology.json', sourceSha256: '6f2694f02a40de8e6cc074f1c89938fa988b1693915006e92cf965c4655e43ff', expectedPenCount: 88 },
  { id: 'business-key-process', combinationKey: 'business+key-process', layerIds: Object.freeze(['business', 'key-process']), topologyPath: 'variants/business-key-process/topology.json', sourceSha256: 'b5633433e26b9f72d2c52fcb7df3931713d12aebddb0d3119a9eefc14ffbd14e', expectedPenCount: 57 },
  { id: 'network-business-key-process', combinationKey: 'network+business+key-process', layerIds: Object.freeze(['network', 'business', 'key-process']), topologyPath: 'variants/network-business-key-process/topology.json', sourceSha256: '7d59eb4234cba6c662d12085537c0848c51204a8f6fcde0c33bd22a84e3691ca', expectedPenCount: 99, isDefault: true },
] as const satisfies readonly StepUpSubstationTopologyVariantManifestEntry[])

/** 两个索引在模块初始化时各构建一次，切层热路径不扫描清单或图元。 */
export const STEP_UP_SUBSTATION_TOPOLOGY_VARIANT_BY_ID = new Map(
  STEP_UP_SUBSTATION_TOPOLOGY_VARIANTS.map((variant) => [variant.id, variant]),
)
export const STEP_UP_SUBSTATION_TOPOLOGY_VARIANT_BY_COMBINATION_KEY = new Map(
  STEP_UP_SUBSTATION_TOPOLOGY_VARIANTS.map((variant) => [variant.combinationKey, variant]),
)

/** 默认项由三层完整输入显式声明，不能依赖数组顺序或架构层聚合。 */
export const STEP_UP_SUBSTATION_DEFAULT_TOPOLOGY_VARIANT = STEP_UP_SUBSTATION_TOPOLOGY_VARIANTS.find(
  (variant) => 'isDefault' in variant,
)!

/** 降压站第二层固定层级；架构层拥有独立文件并与其他层互斥。 */
export type StepDownSubstationTopologyLayerId = 'architecture' | 'network' | 'business' | 'key-process'

export type StepDownSubstationTopologyCombinationKey =
  | StepDownSubstationTopologyLayerId
  | 'network+business'
  | 'network+key-process'
  | 'business+key-process'
  | 'network+business+key-process'

export type StepDownSubstationTopologyVariantId =
  | 'architecture'
  | 'network'
  | 'business'
  | 'key-process'
  | 'network-business'
  | 'network-key-process'
  | 'business-key-process'
  | 'network-business-key-process'

export interface StepDownSubstationTopologyVariantManifestEntry {
  readonly id: StepDownSubstationTopologyVariantId
  readonly combinationKey: StepDownSubstationTopologyCombinationKey
  readonly layerIds: readonly StepDownSubstationTopologyLayerId[]
  readonly topologyPath: string
  readonly sourceSha256: string
  readonly expectedPenCount: number
  readonly isDefault?: true
}

/**
 * 八份源文件逐一对应用户提供的单层、双层和三层整图。
 * 散列与图元数锁定本次输入，筛选只允许常数时间查表并加载完整文件。
 */
export const STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANTS = Object.freeze([
  { id: 'architecture', combinationKey: 'architecture', layerIds: Object.freeze(['architecture']), topologyPath: 'variants/architecture/topology.json', sourceSha256: '4b23e0baeaeab0f587b3ebace51c2835d7d17317faac99bcb0a42c9d32961cd4', expectedPenCount: 54 },
  { id: 'network', combinationKey: 'network', layerIds: Object.freeze(['network']), topologyPath: 'variants/network/topology.json', sourceSha256: '4ad27a508effac5d073724343f9adebc4b34db1f4c80a57fe33327ce77724357', expectedPenCount: 76 },
  { id: 'business', combinationKey: 'business', layerIds: Object.freeze(['business']), topologyPath: 'variants/business/topology.json', sourceSha256: 'a53b902dd0d4e2cb9d02b8f42b0d612fa091a7e78d47eefa3d2837578bddec8b', expectedPenCount: 25 },
  { id: 'key-process', combinationKey: 'key-process', layerIds: Object.freeze(['key-process']), topologyPath: 'variants/key-process/topology.json', sourceSha256: '18843e05183c0235d121d6b43a3cb9f61bb99b4a3bc265a7db158c32ad778a19', expectedPenCount: 43 },
  { id: 'network-business', combinationKey: 'network+business', layerIds: Object.freeze(['network', 'business']), topologyPath: 'variants/network-business/topology.json', sourceSha256: '769ae7d323d9afd9c34e84e35c4b1458680495c3a745ce5bde29c2e21303a007', expectedPenCount: 87 },
  { id: 'network-key-process', combinationKey: 'network+key-process', layerIds: Object.freeze(['network', 'key-process']), topologyPath: 'variants/network-key-process/topology.json', sourceSha256: '091af616deb31ff2d413a6f057ef3deb826a1cc5400015b098b1b2bd0f81bfc4', expectedPenCount: 86 },
  { id: 'business-key-process', combinationKey: 'business+key-process', layerIds: Object.freeze(['business', 'key-process']), topologyPath: 'variants/business-key-process/topology.json', sourceSha256: 'd752629a719d37a72c02622deb70a78e751bd634c10f1a5e0adebe0d56ae5d37', expectedPenCount: 54 },
  { id: 'network-business-key-process', combinationKey: 'network+business+key-process', layerIds: Object.freeze(['network', 'business', 'key-process']), topologyPath: 'variants/network-business-key-process/topology.json', sourceSha256: 'f7ec84b8f5371114774672fdf6e79c98530081d9cb5a031b34cb140de00c2f8b', expectedPenCount: 97, isDefault: true },
] as const satisfies readonly StepDownSubstationTopologyVariantManifestEntry[])

/** 两个索引在模块初始化时各构建一次，切层热路径不扫描清单或图元。 */
export const STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANT_BY_ID = new Map(
  STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANTS.map((variant) => [variant.id, variant]),
)
export const STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANT_BY_COMBINATION_KEY = new Map(
  STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANTS.map((variant) => [variant.combinationKey, variant]),
)

/** 默认项由三层完整输入显式声明，不能依赖数组顺序或架构层聚合。 */
export const STEP_DOWN_SUBSTATION_DEFAULT_TOPOLOGY_VARIANT = STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANTS.find(
  (variant) => 'isDefault' in variant,
)!

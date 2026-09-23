/**
 * 风电拓扑固定使用四个业务层级。架构层对应独立文件并与其余层互斥；
 * 其余三层按固定顺序生成组合键，避免勾选顺序影响缓存和文件查找。
 */
export type WindTopologyLayerId = 'architecture' | 'network' | 'business' | 'key-process'

export type WindTopologyCombinationKey =
  | 'architecture'
  | 'network'
  | 'business'
  | 'key-process'
  | 'network+business'
  | 'network+key-process'
  | 'business+key-process'
  | 'network+business+key-process'

export type WindTopologyVariantId =
  | 'architecture'
  | 'network'
  | 'business'
  | 'key-process'
  | 'network-business'
  | 'network-key-process'
  | 'business-key-process'
  | 'network-business-key-process'

export interface WindTopologyVariantManifestEntry {
  readonly id: WindTopologyVariantId
  readonly combinationKey: WindTopologyCombinationKey
  readonly layerIds: readonly WindTopologyLayerId[]
  readonly topologyPath: string
  readonly sourceSha256: string
  readonly expectedPenCount: number
  readonly isDefault?: true
}

/** 用户确认的八份第二层整图；仅按组合键查表，禁止运行时合并图元。 */
export const WIND_TOPOLOGY_VARIANTS = [
  {
    "id": "architecture",
    "combinationKey": "architecture",
    "layerIds": [
      "architecture"
    ],
    "topologyPath": "variants/architecture/topology.json",
    "sourceSha256": "f2e2969943c38babc93b6bb02e8f818975126962e32bc3873b98365b36b32ceb",
    "expectedPenCount": 46
  },
  {
    "id": "network",
    "combinationKey": "network",
    "layerIds": [
      "network"
    ],
    "topologyPath": "variants/network/topology.json",
    "sourceSha256": "53f507b20988a6267caca74b347c9515d112688669982b94209d8fd6f490381f",
    "expectedPenCount": 86
  },
  {
    "id": "business",
    "combinationKey": "business",
    "layerIds": [
      "business"
    ],
    "topologyPath": "variants/business/topology.json",
    "sourceSha256": "056b6995f67fb625cfbd08dc10407b52ac54bbf6deadef6c2d4c83f7355248bb",
    "expectedPenCount": 31
  },
  {
    "id": "key-process",
    "combinationKey": "key-process",
    "layerIds": [
      "key-process"
    ],
    "topologyPath": "variants/key-process/topology.json",
    "sourceSha256": "359edd93b215b76722d3c2b42beedc3c5803c00568ea1f474a6807c788c25bd1",
    "expectedPenCount": 84
  },
  {
    "id": "network-business",
    "combinationKey": "network+business",
    "layerIds": [
      "network",
      "business"
    ],
    "topologyPath": "variants/network-business/topology.json",
    "sourceSha256": "aa62e831dca4fe499c83b0b6aaa6e6911c09c5963f466c905b83c841274a7086",
    "expectedPenCount": 96
  },
  {
    "id": "network-key-process",
    "combinationKey": "network+key-process",
    "layerIds": [
      "network",
      "key-process"
    ],
    "topologyPath": "variants/network-key-process/topology.json",
    "sourceSha256": "5a3313cc9040635705d3b018c2fb3d7672769111fb8d57013def77892c5f4e8e",
    "expectedPenCount": 110
  },
  {
    "id": "business-key-process",
    "combinationKey": "business+key-process",
    "layerIds": [
      "business",
      "key-process"
    ],
    "topologyPath": "variants/business-key-process/topology.json",
    "sourceSha256": "22b82ca838fe778c9a977d3acafa93e8d0fd77807f1a292dc98adfa85becb759",
    "expectedPenCount": 103
  },
  {
    "id": "network-business-key-process",
    "combinationKey": "network+business+key-process",
    "layerIds": [
      "network",
      "business",
      "key-process"
    ],
    "topologyPath": "variants/network-business-key-process/topology.json",
    "sourceSha256": "08db7672e29370482d58364240f3f11aaec44c510f0fb56e30df034efb29afde",
    "expectedPenCount": 128,
    "isDefault": true
  }
] as const satisfies readonly WindTopologyVariantManifestEntry[]
/** 初始化时建立索引；勾选不扫描图元。 */
export const WIND_TOPOLOGY_VARIANT_BY_ID: ReadonlyMap<WindTopologyVariantId, WindTopologyVariantManifestEntry> = new Map(WIND_TOPOLOGY_VARIANTS.map(v => [v.id, v]))
export const WIND_TOPOLOGY_VARIANT_BY_COMBINATION_KEY: ReadonlyMap<WindTopologyCombinationKey, WindTopologyVariantManifestEntry> = new Map(WIND_TOPOLOGY_VARIANTS.map(v => [v.combinationKey, v]))
/** 默认项来自用户确认，架构层不等于全选。 */
export const WIND_DEFAULT_TOPOLOGY_VARIANT = WIND_TOPOLOGY_VARIANTS.find(v => 'isDefault' in v)!


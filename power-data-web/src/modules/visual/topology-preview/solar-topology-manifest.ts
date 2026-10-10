import type { SolarTopologyVariantId } from './solar-topology-variant-manifest'

/** 光伏拓扑资源清单把源文件图元编号映射到新公共图标；旧键兼容关系在公共资源模块集中维护。 */
export interface SolarTopologyResourceManifest {
  readonly deviceIconPathByPenId: ReadonlyMap<string, string>
  readonly staticImagePathByPenId: ReadonlyMap<string, string>
  readonly devicePenIds: ReadonlySet<string>
  readonly titleBackgroundPenIds: ReadonlySet<string>
  readonly processNodePenIds: ReadonlySet<string>
}

/** 光伏场景当前确认接收四态的两类图元；控制系统与实体设备分别复用公共控制、光伏图标。 */
type SolarTopologyDeviceIconKey = 'dcs' | 'solar'

const DEVICE_ICON_KEYS: readonly SolarTopologyDeviceIconKey[] = Object.freeze(['dcs', 'solar'])

type ResourceManifestSource = Partial<Record<SolarTopologyDeviceIconKey, readonly string[]>> & {
  readonly staticImagePathByPenId: Readonly<Record<string, string>>
  readonly titleBackgroundPenIds: readonly string[]
  readonly processNodePenIds: readonly string[]
}

/** 一次性构建只读索引，运行时查询不扫描图元或重复解析资源。 */
function createResourceManifest(source: ResourceManifestSource): SolarTopologyResourceManifest {
  const staticImagePathByPenId = new Map(Object.entries(source.staticImagePathByPenId))
  const deviceIconPathByPenId = new Map<string, string>()
  for (const iconKey of DEVICE_ICON_KEYS) {
    for (const penId of source[iconKey] ?? []) {
      deviceIconPathByPenId.set(penId, `icons/normal/${iconKey}.webp`)
    }
  }
  return Object.freeze({
    // 只覆盖用户确认的两个节点类型；其余源包图片继续保持静态，避免扩大状态接入范围。
    deviceIconPathByPenId,
    staticImagePathByPenId,
    devicePenIds: new Set(deviceIconPathByPenId.keys()),
    titleBackgroundPenIds: new Set(source.titleBackgroundPenIds),
    processNodePenIds: new Set(source.processNodePenIds),
  })
}

/** 八个用户确认的第二层变体；每项只绑定自身 JSON 的稳定图元编号。 */
const RESOURCE_MANIFEST_BY_VARIANT_ID: ReadonlyMap<SolarTopologyVariantId, SolarTopologyResourceManifest> = new Map([
  ['architecture', createResourceManifest({
    dcs: ['f5185f9'],
    solar: ['f7bf477'],
    staticImagePathByPenId: {
      '2ca1b6c': 'icons/normal/firewall.webp',
      '0f33406': 'icons/normal/server.webp',
      'db6fe9a': 'icons/normal/server.webp',
      '7a2df18a': 'icons/normal/generator.webp',
      '3ff1647a': 'icons/normal/wind_blade.webp',
      '8f20d1f': 'icons/normal/yaw_motor.webp',
      '2cde84a': 'icons/normal/office.webp',
      '22a1d3df': 'icons/normal/office.webp',
      '40b15fc9': 'icons/normal/desktop.webp',
      '2403af2': 'icons/normal/desktop.webp',
      '2f7b333d': 'icons/normal/desktop.webp',
      '1ae02016': 'icons/normal/plc.webp',
      'cb045e1': 'icons/normal/plc.webp',
      '3518b49': 'icons/normal/plc.webp',
      'eca11c6': 'icons/normal/plc.webp',
      '27aaca7d': 'icons/normal/plc.webp',
      '793932b9': 'icons/normal/dcs.webp',
      'ace86e3': 'icons/normal/gearbox.webp',
      '207f733': 'icons/normal/heat_fan.webp',
      '986608e': 'icons/normal/brake_disc.webp',
      'b8d197d': 'icons/normal/plc.webp',
      '1bbff66': 'background/flow-light-3.png',
      '7505c4f4': 'background/flow-light-3.png',
      'dc8538': 'background/flow-light-3.png',
      '865babf': 'background/flow-light-3.png',
      '6406b68': 'background/flow-light-3.png',
      '1058fb89': 'background/flow-light-3.png',
      '2c32ca67': 'background/flow-light-3.png',
    },
    titleBackgroundPenIds: ["1bbff66", "7505c4f4", "dc8538", "865babf", "6406b68", "1058fb89", "2c32ca67"],
    processNodePenIds: ["9f8e2b6", "66a63a90", "c87292d"],
  })],
  ['business', createResourceManifest({
    staticImagePathByPenId: {
      '5660738b': 'background/flow-light-3.png',
      '387ce21f': 'background/flow-light-3.png',
      'dc99914': 'background/flow-light-3.png',
      'b7d4825': 'background/flow-light-3.png',
      'cf4d67b': 'background/flow-light-3.png',
      '0d090d4': 'background/flow-light-3.png',
    },
    titleBackgroundPenIds: ["5660738b", "387ce21f", "dc99914", "b7d4825", "cf4d67b", "0d090d4"],
    processNodePenIds: ["78826709", "5d16d6f9", "68dbdc25", "c56687c", "4a301c9", "107cb1"],
  })],
  ['business-key-process', createResourceManifest({
    dcs: ['75722e8b', 'c263844'],
    solar: ['f007964', '7c754099'],
    staticImagePathByPenId: {
      '1b5bf2db': 'icons/normal/generator.webp',
      'c9d8513': 'icons/normal/wind_blade.webp',
      '7e2be0d0': 'icons/normal/yaw_motor.webp',
      '4aad3db9': 'icons/normal/generator.webp',
      '3c00e87b': 'icons/normal/wind_blade.webp',
      '2cdd2b5': 'icons/normal/plc.webp',
      'dc6bddf': 'icons/normal/plc.webp',
      'ccca65e': 'icons/normal/plc.webp',
      '8d7675b': 'icons/normal/plc.webp',
      '85c8d5': 'icons/normal/plc.webp',
      '6a5def5f': 'icons/normal/dcs.webp',
      '2a2f00b': 'icons/normal/gearbox.webp',
      '489dea58': 'icons/normal/heat_fan.webp',
      'ea315cc': 'icons/normal/brake_disc.webp',
      '1cdaff39': 'icons/normal/yaw_motor.webp',
      '7a0b0af0': 'icons/normal/plc.webp',
      '180e37e': 'icons/normal/plc.webp',
      '7e8936': 'icons/normal/plc.webp',
      '17cee71': 'icons/normal/plc.webp',
      '692e58a0': 'icons/normal/plc.webp',
      '61bd6206': 'icons/normal/dcs.webp',
      '6a0592cc': 'icons/normal/plc.webp',
      '15f6e31': 'icons/normal/gearbox.webp',
      '3ef31bef': 'icons/normal/heat_fan.webp',
      'a5f2c06': 'icons/normal/brake_disc.webp',
      '6b12cd8': 'icons/normal/plc.webp',
      '33e12454': 'background/flow-light-3.png',
      'f36ac94': 'background/flow-light-3.png',
      'e8d3efe': 'background/flow-light-3.png',
      '1c490480': 'background/flow-light-3.png',
      '4647f5c': 'background/flow-light-3.png',
      '166bab1': 'background/flow-light-3.png',
    },
    titleBackgroundPenIds: ["33e12454", "f36ac94", "e8d3efe", "1c490480", "4647f5c", "166bab1"],
    processNodePenIds: ["2a5210d5", "d21fd8e", "54d1e021", "d6a35ed", "0deda7", "a10d819"],
  })],
  ['key-process', createResourceManifest({
    dcs: ['0f400f1', '1a75b51e'],
    solar: ['119a9aa6', 'f7331d4'],
    staticImagePathByPenId: {
      '43591e1': 'icons/normal/generator.webp',
      '2726eea': 'icons/normal/wind_blade.webp',
      '39b88c13': 'icons/normal/yaw_motor.webp',
      '2c8684de': 'icons/normal/generator.webp',
      'c9c0f7e': 'icons/normal/wind_blade.webp',
      '15b49d26': 'icons/normal/plc.webp',
      '1d860db1': 'icons/normal/plc.webp',
      '7241f93e': 'icons/normal/plc.webp',
      '6bd3ecb9': 'icons/normal/plc.webp',
      '5324a4b3': 'icons/normal/plc.webp',
      '43972ff0': 'icons/normal/dcs.webp',
      'b9f54d2': 'icons/normal/gearbox.webp',
      'ad61a3f': 'icons/normal/heat_fan.webp',
      '7fbceb07': 'icons/normal/brake_disc.webp',
      '5d871db': 'icons/normal/yaw_motor.webp',
      '60369370': 'icons/normal/plc.webp',
      'b20d06b': 'icons/normal/plc.webp',
      '3790242': 'icons/normal/plc.webp',
      '6ae5e42': 'icons/normal/plc.webp',
      '6c39c08': 'icons/normal/plc.webp',
      '3afce6a': 'icons/normal/dcs.webp',
      '9396e06': 'icons/normal/plc.webp',
      '1a89f78': 'icons/normal/gearbox.webp',
      '2f57d425': 'icons/normal/heat_fan.webp',
      '3e25050': 'icons/normal/brake_disc.webp',
      '4d345e6': 'icons/normal/plc.webp',
      '6cb7caa': 'background/flow-light-3.png',
      '645f1a9': 'background/flow-light-3.png',
      'a1b6f8': 'background/flow-light-3.png',
      '76bdf94': 'background/flow-light-3.png',
      '627967d5': 'background/flow-light-3.png',
      '2bf7bdf6': 'background/flow-light-3.png',
    },
    titleBackgroundPenIds: ["6cb7caa", "645f1a9", "a1b6f8", "76bdf94", "627967d5", "2bf7bdf6"],
    processNodePenIds: [],
  })],
  ['network', createResourceManifest({
    dcs: ['7c5436', '32f050f8'],
    staticImagePathByPenId: {
      '49ccb4f': 'background/flow-light-3.png',
      '3f848c1': 'background/flow-light-3.png',
      'fa6a1fe': 'background/flow-light-3.png',
      'be887ae': 'background/flow-light-3.png',
      '12b08daf': 'background/flow-light-3.png',
      '90f9076': 'background/flow-light-3.png',
      'd992a79': 'icons/normal/firewall.webp',
      '36e95e21': 'icons/normal/firewall.webp',
      '5fc2c31d': 'icons/normal/server.webp',
      '19337f95': 'icons/normal/server.webp',
      'b7884e6': 'icons/normal/plc.webp',
      '52b4226c': 'icons/normal/plc.webp',
      '4e4e4b': 'icons/normal/plc.webp',
      '6d463462': 'icons/normal/plc.webp',
      'f1c9a24': 'icons/normal/plc.webp',
      '23530211': 'icons/normal/dcs.webp',
      '103501bf': 'icons/normal/office.webp',
      '209dd3d': 'icons/normal/office.webp',
      'd51a233': 'icons/normal/desktop.webp',
      '10fe915': 'icons/normal/desktop.webp',
      '1f7b00': 'icons/normal/desktop.webp',
      '6a0e5a0e': 'icons/normal/plc.webp',
      '82f8af': 'icons/normal/plc.webp',
      '779c4bd9': 'icons/normal/plc.webp',
      '7100f20': 'icons/normal/plc.webp',
      '357575f2': 'icons/normal/plc.webp',
      '29de29': 'icons/normal/dcs.webp',
      'a8f94f6': 'icons/normal/plc.webp',
      '66fdc69b': 'icons/normal/router.webp',
      '34c03f3a': 'icons/normal/dual_router.webp',
      '288459b2': 'icons/normal/plc.webp',
    },
    titleBackgroundPenIds: ["49ccb4f", "3f848c1", "fa6a1fe", "be887ae", "12b08daf", "90f9076"],
    processNodePenIds: [],
  })],
  ['network-business', createResourceManifest({
    dcs: ['0e822c6', '3a0e7852'],
    staticImagePathByPenId: {
      '4057f312': 'icons/normal/firewall.webp',
      '113316a': 'icons/normal/firewall.webp',
      '89dcf27': 'icons/normal/server.webp',
      'd6bc657': 'icons/normal/server.webp',
      '1055adfd': 'icons/normal/plc.webp',
      '21056d8': 'icons/normal/plc.webp',
      '4a75cf4': 'icons/normal/plc.webp',
      'ec6a59e': 'icons/normal/plc.webp',
      '374854': 'icons/normal/plc.webp',
      '39a53751': 'icons/normal/dcs.webp',
      '1a7a333c': 'icons/normal/office.webp',
      '4617a8d2': 'icons/normal/office.webp',
      '5d892a7': 'icons/normal/desktop.webp',
      '43709d7': 'icons/normal/desktop.webp',
      '3b2eaf': 'icons/normal/desktop.webp',
      '1e412298': 'icons/normal/plc.webp',
      '7426171': 'icons/normal/plc.webp',
      '17d8b5c': 'icons/normal/plc.webp',
      '5d39b66f': 'icons/normal/plc.webp',
      'f3dafe8': 'icons/normal/plc.webp',
      'e294556': 'icons/normal/dcs.webp',
      '51bc092': 'icons/normal/plc.webp',
      '21bf844': 'icons/normal/router.webp',
      '23ada6c': 'icons/normal/dual_router.webp',
      '406297f8': 'icons/normal/plc.webp',
      'ec6cf6e': 'background/flow-light-3.png',
      '7bee951': 'background/flow-light-3.png',
      '1dbaa69c': 'background/flow-light-3.png',
      '225572f3': 'background/flow-light-3.png',
      'dbef4df': 'background/flow-light-3.png',
      '16bcd02f': 'background/flow-light-3.png',
    },
    titleBackgroundPenIds: ["ec6cf6e", "7bee951", "1dbaa69c", "225572f3", "dbef4df", "16bcd02f"],
    processNodePenIds: ["730f9118", "eb7d4da", "5b1b946", "53f5be", "f48a03d", "050e39b"],
  })],
  ['network-business-key-process', createResourceManifest({
    dcs: ['49e49f47', '7ca1b67a'],
    solar: ['6940ceef', 'ebd260c'],
    staticImagePathByPenId: {
      '641ad6': 'icons/normal/generator.webp',
      '7c0be9c': 'icons/normal/wind_blade.webp',
      '90a032f': 'icons/normal/yaw_motor.webp',
      '1ae2e552': 'icons/normal/firewall.webp',
      '0c8a079': 'icons/normal/firewall.webp',
      'dad2c5b': 'icons/normal/server.webp',
      '77d10fd': 'icons/normal/server.webp',
      '391907e8': 'icons/normal/generator.webp',
      '87f441c': 'icons/normal/wind_blade.webp',
      '210b4294': 'icons/normal/plc.webp',
      '121a52d5': 'icons/normal/plc.webp',
      '53faeab': 'icons/normal/plc.webp',
      '3e7914c8': 'icons/normal/plc.webp',
      '59925d99': 'icons/normal/plc.webp',
      '7ee2b128': 'icons/normal/dcs.webp',
      '4a053f68': 'icons/normal/gearbox.webp',
      '4b0ee679': 'icons/normal/heat_fan.webp',
      '2fbe527': 'icons/normal/brake_disc.webp',
      '4996538': 'icons/normal/yaw_motor.webp',
      '10497337': 'icons/normal/office.webp',
      'd8e617b': 'icons/normal/office.webp',
      '986ad3d': 'icons/normal/desktop.webp',
      '8e6205d': 'icons/normal/desktop.webp',
      'd715e38': 'icons/normal/desktop.webp',
      '28e27ec2': 'icons/normal/plc.webp',
      '67fd9a': 'icons/normal/plc.webp',
      'c8042a6': 'icons/normal/plc.webp',
      '27e09c2f': 'icons/normal/plc.webp',
      '41ab4ea5': 'icons/normal/plc.webp',
      '1380738': 'icons/normal/dcs.webp',
      '03ed836': 'icons/normal/plc.webp',
      '44940c8': 'icons/normal/gearbox.webp',
      '52b0990b': 'icons/normal/heat_fan.webp',
      '9331d40': 'icons/normal/brake_disc.webp',
      '781bfab9': 'icons/normal/router.webp',
      '6258c20d': 'icons/normal/dual_router.webp',
      '28457c83': 'icons/normal/plc.webp',
      '1aeb61': 'background/flow-light-3.png',
      '24384824': 'background/flow-light-3.png',
      '748a6a1': 'background/flow-light-3.png',
      '39d73f43': 'background/flow-light-3.png',
      '08c05a7': 'background/flow-light-3.png',
      '4a5310d': 'background/flow-light-3.png',
    },
    titleBackgroundPenIds: ["1aeb61", "24384824", "748a6a1", "39d73f43", "08c05a7", "4a5310d"],
    processNodePenIds: ["59539828", "55ce2ad0", "2f6e06", "2bfdf432", "42e6522b", "6596f4f"],
  })],
  ['network-key-process', createResourceManifest({
    dcs: ['447525ed', '77928430'],
    solar: ['49fcb5e6', '93065bc'],
    staticImagePathByPenId: {
      '348b373': 'icons/normal/generator.webp',
      'c70905d': 'icons/normal/wind_blade.webp',
      '7716ffa': 'icons/normal/yaw_motor.webp',
      'dee23c7': 'icons/normal/firewall.webp',
      '115e86e': 'icons/normal/firewall.webp',
      '4cc685d': 'icons/normal/server.webp',
      '15637183': 'icons/normal/server.webp',
      'ac4ba70': 'icons/normal/generator.webp',
      '6b05a580': 'icons/normal/wind_blade.webp',
      '159a8d': 'icons/normal/plc.webp',
      'd98cd30': 'icons/normal/plc.webp',
      '777e94bc': 'icons/normal/plc.webp',
      '4d331569': 'icons/normal/plc.webp',
      '7b6b575a': 'icons/normal/plc.webp',
      'f5f1d51': 'icons/normal/dcs.webp',
      '1bc2368': 'icons/normal/gearbox.webp',
      '58f4a32': 'icons/normal/heat_fan.webp',
      '2c1619f7': 'icons/normal/brake_disc.webp',
      '34692756': 'icons/normal/yaw_motor.webp',
      '0bcdd4c': 'icons/normal/office.webp',
      'bc2eba0': 'icons/normal/office.webp',
      '5bae862c': 'icons/normal/desktop.webp',
      '594e163d': 'icons/normal/desktop.webp',
      '9a046ea': 'icons/normal/desktop.webp',
      '5a7b7f30': 'icons/normal/plc.webp',
      '135f6578': 'icons/normal/plc.webp',
      '40eac465': 'icons/normal/plc.webp',
      '82b105': 'icons/normal/plc.webp',
      '48f32': 'icons/normal/plc.webp',
      '3cfad7b': 'icons/normal/dcs.webp',
      '361789f0': 'icons/normal/plc.webp',
      '099b847': 'icons/normal/gearbox.webp',
      'af0f606': 'icons/normal/heat_fan.webp',
      'e4e873f': 'icons/normal/brake_disc.webp',
      '31215ee0': 'icons/normal/router.webp',
      '3527c113': 'icons/normal/dual_router.webp',
      '3f5581bd': 'icons/normal/plc.webp',
      '26e36a28': 'background/flow-light-3.png',
      '6019877': 'background/flow-light-3.png',
      '0b85737': 'background/flow-light-3.png',
      '51750a0': 'background/flow-light-3.png',
      '17cbc953': 'background/flow-light-3.png',
      'f68a7e9': 'background/flow-light-3.png',
    },
    titleBackgroundPenIds: ["26e36a28", "6019877", "0b85737", "51750a0", "17cbc953", "f68a7e9"],
    processNodePenIds: [],
  })],
  ['process-detail-solar-inverter', createResourceManifest({
    dcs: ['df25e45'],
    solar: ['2cf7b170'],
    staticImagePathByPenId: {
      // 机组主控制器没有业务状态映射，仅按来源散列复用公共静态图片。
      '7c547b4d': 'icons/normal/dcs.webp',
      'b16b48b': 'background/flow-light-3.png',
      'bf8082e': 'background/flow-light-3.png',
      '32d9c9c': 'background/flow-light-3.png',
    },
    titleBackgroundPenIds: ['b16b48b', 'bf8082e', '32d9c9c'],
    // 工艺矩形仅允许本地只读选择，不生成设备提示或三维状态绑定。
    processNodePenIds: ['1ff66281'],
  })],
])

/** 严格按组合键读取；缺项属于开发配置错误，不能回退到其他拓扑。 */
export function getSolarTopologyResourceManifest(variantId: SolarTopologyVariantId): SolarTopologyResourceManifest {
  const manifest = RESOURCE_MANIFEST_BY_VARIANT_ID.get(variantId)
  if (!manifest) throw new Error(`光伏拓扑版本缺少资源清单：${variantId}`)
  return manifest
}

/** 默认总图是用户确认的网络、业务、关键环节组合。 */
const defaultManifest = getSolarTopologyResourceManifest('network-business-key-process')
export const SOLAR_TOPOLOGY_DEVICE_PEN_IDS = defaultManifest.devicePenIds
export const SOLAR_TOPOLOGY_BACKGROUND_PEN_IDS = defaultManifest.titleBackgroundPenIds
export const SOLAR_TOPOLOGY_PROCESS_PEN_IDS = defaultManifest.processNodePenIds
// 兼容现有消费端的导出名称。
export const SOLAR_DEVICE_PEN_IDS = SOLAR_TOPOLOGY_DEVICE_PEN_IDS
export const SOLAR_TITLE_BACKGROUND_PEN_IDS = SOLAR_TOPOLOGY_BACKGROUND_PEN_IDS



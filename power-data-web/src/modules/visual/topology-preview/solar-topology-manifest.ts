import type { SolarTopologyVariantId } from './solar-topology-variant-manifest'

/** 光伏拓扑资源清单；所有路径均由源包图片与公共资源的 SHA-256 散列精确核对。 */
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
      '2ca1b6c': 'assets/firewall-compact.png',
      '0f33406': 'assets/data-server.png',
      'db6fe9a': 'assets/data-server.png',
      '7a2df18a': 'assets/generator.png',
      '3ff1647a': 'assets/21960efa9d7b5349021290020a64889d5bf9116717949f55b5be9225fe67162a.png',
      '8f20d1f': 'assets/3bccb7e7c803d154697613cbf9442e7a1a0558ae700eff0fe525e3fa1540b50f.png',
      '2cde84a': 'assets/operator.png',
      '22a1d3df': 'assets/operator.png',
      '40b15fc9': 'assets/enterprise-system.png',
      '2403af2': 'assets/enterprise-system.png',
      '2f7b333d': 'assets/enterprise-system.png',
      '1ae02016': 'assets/chemical-water-control.png',
      'cb045e1': 'assets/chemical-water-control.png',
      '3518b49': 'assets/chemical-water-control.png',
      'eca11c6': 'assets/chemical-water-control.png',
      '27aaca7d': 'assets/chemical-water-control.png',
      '793932b9': 'assets/boiler-safety-control.png',
      'ace86e3': 'assets/24ebf71e12d52b8eefa670e47598f2d2a983ad9c8144a48c54995269286485f4.png',
      '207f733': 'assets/9dcf00f20a365b2173fdd125676166950388cf84cd7fb0f4765eb29685bc1c38.png',
      '986608e': 'assets/fc2eb70c87fa47ee40600832dd9de280ba60b79aedbaaf99304ed30043fd5ffb.png',
      'b8d197d': 'assets/chemical-water-control.png',
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
      '1b5bf2db': 'assets/generator.png',
      'c9d8513': 'assets/21960efa9d7b5349021290020a64889d5bf9116717949f55b5be9225fe67162a.png',
      '7e2be0d0': 'assets/3bccb7e7c803d154697613cbf9442e7a1a0558ae700eff0fe525e3fa1540b50f.png',
      '4aad3db9': 'assets/generator.png',
      '3c00e87b': 'assets/21960efa9d7b5349021290020a64889d5bf9116717949f55b5be9225fe67162a.png',
      '2cdd2b5': 'assets/chemical-water-control.png',
      'dc6bddf': 'assets/chemical-water-control.png',
      'ccca65e': 'assets/chemical-water-control.png',
      '8d7675b': 'assets/chemical-water-control.png',
      '85c8d5': 'assets/chemical-water-control.png',
      '6a5def5f': 'assets/boiler-safety-control.png',
      '2a2f00b': 'assets/24ebf71e12d52b8eefa670e47598f2d2a983ad9c8144a48c54995269286485f4.png',
      '489dea58': 'assets/9dcf00f20a365b2173fdd125676166950388cf84cd7fb0f4765eb29685bc1c38.png',
      'ea315cc': 'assets/fc2eb70c87fa47ee40600832dd9de280ba60b79aedbaaf99304ed30043fd5ffb.png',
      '1cdaff39': 'assets/3bccb7e7c803d154697613cbf9442e7a1a0558ae700eff0fe525e3fa1540b50f.png',
      '7a0b0af0': 'assets/chemical-water-control.png',
      '180e37e': 'assets/chemical-water-control.png',
      '7e8936': 'assets/chemical-water-control.png',
      '17cee71': 'assets/chemical-water-control.png',
      '692e58a0': 'assets/chemical-water-control.png',
      '61bd6206': 'assets/boiler-safety-control.png',
      '6a0592cc': 'assets/chemical-water-control.png',
      '15f6e31': 'assets/24ebf71e12d52b8eefa670e47598f2d2a983ad9c8144a48c54995269286485f4.png',
      '3ef31bef': 'assets/9dcf00f20a365b2173fdd125676166950388cf84cd7fb0f4765eb29685bc1c38.png',
      'a5f2c06': 'assets/fc2eb70c87fa47ee40600832dd9de280ba60b79aedbaaf99304ed30043fd5ffb.png',
      '6b12cd8': 'assets/chemical-water-control.png',
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
      '43591e1': 'assets/generator.png',
      '2726eea': 'assets/21960efa9d7b5349021290020a64889d5bf9116717949f55b5be9225fe67162a.png',
      '39b88c13': 'assets/3bccb7e7c803d154697613cbf9442e7a1a0558ae700eff0fe525e3fa1540b50f.png',
      '2c8684de': 'assets/generator.png',
      'c9c0f7e': 'assets/21960efa9d7b5349021290020a64889d5bf9116717949f55b5be9225fe67162a.png',
      '15b49d26': 'assets/chemical-water-control.png',
      '1d860db1': 'assets/chemical-water-control.png',
      '7241f93e': 'assets/chemical-water-control.png',
      '6bd3ecb9': 'assets/chemical-water-control.png',
      '5324a4b3': 'assets/chemical-water-control.png',
      '43972ff0': 'assets/boiler-safety-control.png',
      'b9f54d2': 'assets/24ebf71e12d52b8eefa670e47598f2d2a983ad9c8144a48c54995269286485f4.png',
      'ad61a3f': 'assets/9dcf00f20a365b2173fdd125676166950388cf84cd7fb0f4765eb29685bc1c38.png',
      '7fbceb07': 'assets/fc2eb70c87fa47ee40600832dd9de280ba60b79aedbaaf99304ed30043fd5ffb.png',
      '5d871db': 'assets/3bccb7e7c803d154697613cbf9442e7a1a0558ae700eff0fe525e3fa1540b50f.png',
      '60369370': 'assets/chemical-water-control.png',
      'b20d06b': 'assets/chemical-water-control.png',
      '3790242': 'assets/chemical-water-control.png',
      '6ae5e42': 'assets/chemical-water-control.png',
      '6c39c08': 'assets/chemical-water-control.png',
      '3afce6a': 'assets/boiler-safety-control.png',
      '9396e06': 'assets/chemical-water-control.png',
      '1a89f78': 'assets/24ebf71e12d52b8eefa670e47598f2d2a983ad9c8144a48c54995269286485f4.png',
      '2f57d425': 'assets/9dcf00f20a365b2173fdd125676166950388cf84cd7fb0f4765eb29685bc1c38.png',
      '3e25050': 'assets/fc2eb70c87fa47ee40600832dd9de280ba60b79aedbaaf99304ed30043fd5ffb.png',
      '4d345e6': 'assets/chemical-water-control.png',
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
      'd992a79': 'assets/firewall-compact.png',
      '36e95e21': 'assets/firewall-compact.png',
      '5fc2c31d': 'assets/data-server.png',
      '19337f95': 'assets/data-server.png',
      'b7884e6': 'assets/chemical-water-control.png',
      '52b4226c': 'assets/chemical-water-control.png',
      '4e4e4b': 'assets/chemical-water-control.png',
      '6d463462': 'assets/chemical-water-control.png',
      'f1c9a24': 'assets/chemical-water-control.png',
      '23530211': 'assets/boiler-safety-control.png',
      '103501bf': 'assets/operator.png',
      '209dd3d': 'assets/operator.png',
      'd51a233': 'assets/enterprise-system.png',
      '10fe915': 'assets/enterprise-system.png',
      '1f7b00': 'assets/enterprise-system.png',
      '6a0e5a0e': 'assets/chemical-water-control.png',
      '82f8af': 'assets/chemical-water-control.png',
      '779c4bd9': 'assets/chemical-water-control.png',
      '7100f20': 'assets/chemical-water-control.png',
      '357575f2': 'assets/chemical-water-control.png',
      '29de29': 'assets/boiler-safety-control.png',
      'a8f94f6': 'assets/chemical-water-control.png',
      '66fdc69b': 'assets/switch-compact.png',
      '34c03f3a': 'assets/switch.png',
      '288459b2': 'assets/chemical-water-control.png',
    },
    titleBackgroundPenIds: ["49ccb4f", "3f848c1", "fa6a1fe", "be887ae", "12b08daf", "90f9076"],
    processNodePenIds: [],
  })],
  ['network-business', createResourceManifest({
    dcs: ['0e822c6', '3a0e7852'],
    staticImagePathByPenId: {
      '4057f312': 'assets/firewall-compact.png',
      '113316a': 'assets/firewall-compact.png',
      '89dcf27': 'assets/data-server.png',
      'd6bc657': 'assets/data-server.png',
      '1055adfd': 'assets/chemical-water-control.png',
      '21056d8': 'assets/chemical-water-control.png',
      '4a75cf4': 'assets/chemical-water-control.png',
      'ec6a59e': 'assets/chemical-water-control.png',
      '374854': 'assets/chemical-water-control.png',
      '39a53751': 'assets/boiler-safety-control.png',
      '1a7a333c': 'assets/operator.png',
      '4617a8d2': 'assets/operator.png',
      '5d892a7': 'assets/enterprise-system.png',
      '43709d7': 'assets/enterprise-system.png',
      '3b2eaf': 'assets/enterprise-system.png',
      '1e412298': 'assets/chemical-water-control.png',
      '7426171': 'assets/chemical-water-control.png',
      '17d8b5c': 'assets/chemical-water-control.png',
      '5d39b66f': 'assets/chemical-water-control.png',
      'f3dafe8': 'assets/chemical-water-control.png',
      'e294556': 'assets/boiler-safety-control.png',
      '51bc092': 'assets/chemical-water-control.png',
      '21bf844': 'assets/switch-compact.png',
      '23ada6c': 'assets/switch.png',
      '406297f8': 'assets/chemical-water-control.png',
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
      '641ad6': 'assets/generator.png',
      '7c0be9c': 'assets/21960efa9d7b5349021290020a64889d5bf9116717949f55b5be9225fe67162a.png',
      '90a032f': 'assets/3bccb7e7c803d154697613cbf9442e7a1a0558ae700eff0fe525e3fa1540b50f.png',
      '1ae2e552': 'assets/firewall-compact.png',
      '0c8a079': 'assets/firewall-compact.png',
      'dad2c5b': 'assets/data-server.png',
      '77d10fd': 'assets/data-server.png',
      '391907e8': 'assets/generator.png',
      '87f441c': 'assets/21960efa9d7b5349021290020a64889d5bf9116717949f55b5be9225fe67162a.png',
      '210b4294': 'assets/chemical-water-control.png',
      '121a52d5': 'assets/chemical-water-control.png',
      '53faeab': 'assets/chemical-water-control.png',
      '3e7914c8': 'assets/chemical-water-control.png',
      '59925d99': 'assets/chemical-water-control.png',
      '7ee2b128': 'assets/boiler-safety-control.png',
      '4a053f68': 'assets/24ebf71e12d52b8eefa670e47598f2d2a983ad9c8144a48c54995269286485f4.png',
      '4b0ee679': 'assets/9dcf00f20a365b2173fdd125676166950388cf84cd7fb0f4765eb29685bc1c38.png',
      '2fbe527': 'assets/fc2eb70c87fa47ee40600832dd9de280ba60b79aedbaaf99304ed30043fd5ffb.png',
      '4996538': 'assets/3bccb7e7c803d154697613cbf9442e7a1a0558ae700eff0fe525e3fa1540b50f.png',
      '10497337': 'assets/operator.png',
      'd8e617b': 'assets/operator.png',
      '986ad3d': 'assets/enterprise-system.png',
      '8e6205d': 'assets/enterprise-system.png',
      'd715e38': 'assets/enterprise-system.png',
      '28e27ec2': 'assets/chemical-water-control.png',
      '67fd9a': 'assets/chemical-water-control.png',
      'c8042a6': 'assets/chemical-water-control.png',
      '27e09c2f': 'assets/chemical-water-control.png',
      '41ab4ea5': 'assets/chemical-water-control.png',
      '1380738': 'assets/boiler-safety-control.png',
      '03ed836': 'assets/chemical-water-control.png',
      '44940c8': 'assets/24ebf71e12d52b8eefa670e47598f2d2a983ad9c8144a48c54995269286485f4.png',
      '52b0990b': 'assets/9dcf00f20a365b2173fdd125676166950388cf84cd7fb0f4765eb29685bc1c38.png',
      '9331d40': 'assets/fc2eb70c87fa47ee40600832dd9de280ba60b79aedbaaf99304ed30043fd5ffb.png',
      '781bfab9': 'assets/switch-compact.png',
      '6258c20d': 'assets/switch.png',
      '28457c83': 'assets/chemical-water-control.png',
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
      '348b373': 'assets/generator.png',
      'c70905d': 'assets/21960efa9d7b5349021290020a64889d5bf9116717949f55b5be9225fe67162a.png',
      '7716ffa': 'assets/3bccb7e7c803d154697613cbf9442e7a1a0558ae700eff0fe525e3fa1540b50f.png',
      'dee23c7': 'assets/firewall-compact.png',
      '115e86e': 'assets/firewall-compact.png',
      '4cc685d': 'assets/data-server.png',
      '15637183': 'assets/data-server.png',
      'ac4ba70': 'assets/generator.png',
      '6b05a580': 'assets/21960efa9d7b5349021290020a64889d5bf9116717949f55b5be9225fe67162a.png',
      '159a8d': 'assets/chemical-water-control.png',
      'd98cd30': 'assets/chemical-water-control.png',
      '777e94bc': 'assets/chemical-water-control.png',
      '4d331569': 'assets/chemical-water-control.png',
      '7b6b575a': 'assets/chemical-water-control.png',
      'f5f1d51': 'assets/boiler-safety-control.png',
      '1bc2368': 'assets/24ebf71e12d52b8eefa670e47598f2d2a983ad9c8144a48c54995269286485f4.png',
      '58f4a32': 'assets/9dcf00f20a365b2173fdd125676166950388cf84cd7fb0f4765eb29685bc1c38.png',
      '2c1619f7': 'assets/fc2eb70c87fa47ee40600832dd9de280ba60b79aedbaaf99304ed30043fd5ffb.png',
      '34692756': 'assets/3bccb7e7c803d154697613cbf9442e7a1a0558ae700eff0fe525e3fa1540b50f.png',
      '0bcdd4c': 'assets/operator.png',
      'bc2eba0': 'assets/operator.png',
      '5bae862c': 'assets/enterprise-system.png',
      '594e163d': 'assets/enterprise-system.png',
      '9a046ea': 'assets/enterprise-system.png',
      '5a7b7f30': 'assets/chemical-water-control.png',
      '135f6578': 'assets/chemical-water-control.png',
      '40eac465': 'assets/chemical-water-control.png',
      '82b105': 'assets/chemical-water-control.png',
      '48f32': 'assets/chemical-water-control.png',
      '3cfad7b': 'assets/boiler-safety-control.png',
      '361789f0': 'assets/chemical-water-control.png',
      '099b847': 'assets/24ebf71e12d52b8eefa670e47598f2d2a983ad9c8144a48c54995269286485f4.png',
      'af0f606': 'assets/9dcf00f20a365b2173fdd125676166950388cf84cd7fb0f4765eb29685bc1c38.png',
      'e4e873f': 'assets/fc2eb70c87fa47ee40600832dd9de280ba60b79aedbaaf99304ed30043fd5ffb.png',
      '31215ee0': 'assets/switch-compact.png',
      '3527c113': 'assets/switch.png',
      '3f5581bd': 'assets/chemical-water-control.png',
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
      '7c547b4d': 'assets/fe44783bc63ef1f69551cba04ad53c53a41fc89feebc2a0d94a850d6c9b80fbb.png',
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



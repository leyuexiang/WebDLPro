import type { WindTopologyVariantId } from './wind-topology-variant-manifest'
import type { TopologyDeviceStatus } from '@/config/process/types'

/** 风电资源清单将源图元显式映射到公共 WebP；绑定设备的四态图路径按图元编号单独登记。 */
export interface WindTopologyResourceManifest {
  readonly deviceIconPathByPenId: ReadonlyMap<string, Readonly<Record<TopologyDeviceStatus, string>>>
  readonly staticImagePathByPenId: ReadonlyMap<string, string>
  readonly devicePenIds: ReadonlySet<string>
  readonly titleBackgroundPenIds: ReadonlySet<string>
  readonly processNodePenIds: ReadonlySet<string>
}

type ResourceManifestSource = {
  readonly deviceIconPathByPenId?: Readonly<Record<string, Readonly<Record<TopologyDeviceStatus, string>>>>
  readonly staticImagePathByPenId: Readonly<Record<string, string>>
  readonly titleBackgroundPenIds: readonly string[]
  readonly processNodePenIds: readonly string[]
}

/** 旧筛选文件中的同名控制与系统图元均沿用已确认的公共控制器四态 WebP。 */
const WIND_PLC_DEVICE_ICON_PATHS: Readonly<Record<TopologyDeviceStatus, string>> = Object.freeze({
  normal: 'icons/normal/plc.webp',
  alarm: 'icons/alarm/plc.webp',
  fault: 'icons/fault/plc.webp',
  offline: 'icons/offline/plc.webp',
})

/** 一次性构建只读索引，运行时查询不扫描图元或重复解析资源。 */
function createResourceManifest(source: ResourceManifestSource): WindTopologyResourceManifest {
  const deviceIconPathByPenId = new Map(Object.entries(source.deviceIconPathByPenId ?? {}))
  const staticImagePathByPenId = new Map(Object.entries(source.staticImagePathByPenId))
  return Object.freeze({
    // 只为输入文件中逐项确认的设备登记完整四态路径；不按图元标题或相近名称推断图标。
    deviceIconPathByPenId,
    staticImagePathByPenId,
    devicePenIds: new Set(deviceIconPathByPenId.keys()),
    titleBackgroundPenIds: new Set(source.titleBackgroundPenIds),
    processNodePenIds: new Set(source.processNodePenIds),
  })
}

/** 八个用户确认的第二层变体；每项只绑定自身 JSON 的稳定图元编号。 */
const RESOURCE_MANIFEST_BY_VARIANT_ID: ReadonlyMap<WindTopologyVariantId, WindTopologyResourceManifest> = new Map([
  ['architecture', createResourceManifest({
    deviceIconPathByPenId: {
      '1ae02016': WIND_PLC_DEVICE_ICON_PATHS,
      '3518b49': WIND_PLC_DEVICE_ICON_PATHS,
      'eca11c6': WIND_PLC_DEVICE_ICON_PATHS,
      'b8d197d': WIND_PLC_DEVICE_ICON_PATHS,
    },
    staticImagePathByPenId: {
      '2ca1b6c': 'icons/normal/firewall.webp',
      '0f33406': 'icons/normal/server.webp',
      'db6fe9a': 'icons/normal/server.webp',
      '7a2df18a': 'icons/normal/generator.webp',
      '3ff1647a': 'icons/static/e2e275e4a94ef6d9f2313aee8ee7857b2ba21ac4d323bd53378144dc47169f7f.webp',
      '8f20d1f': 'icons/static/def6155598057373934ea3668fa58a2ed4cf26f9d1722fae22f6a06af732859a.webp',
      '2cde84a': 'icons/normal/office.webp',
      '22a1d3df': 'icons/normal/office.webp',
      '40b15fc9': 'icons/normal/desktop.webp',
      '2403af2': 'icons/normal/desktop.webp',
      '2f7b333d': 'icons/normal/desktop.webp',
      'cb045e1': 'icons/normal/plc.webp',
      '27aaca7d': 'icons/normal/plc.webp',
      '793932b9': 'icons/normal/dcs.webp',
      'ace86e3': 'icons/normal/gearbox.webp',
      '207f733': 'icons/static/72c7e1e4eed654c8cddb379b8db4c6f3554b810eff9fd8d74f9084c5d28fe6e5.webp',
      '986608e': 'icons/static/cd8655f8bcede28c1a381160c4a696c93556459006d8fd8c2583a261b312d755.webp',
      '1bbff66': 'background/flow-light-3.webp',
      '7505c4f4': 'background/flow-light-3.webp',
      'dc8538': 'background/flow-light-3.webp',
      '865babf': 'background/flow-light-3.webp',
      '6406b68': 'background/flow-light-3.webp',
      '1058fb89': 'background/flow-light-3.webp',
      '2c32ca67': 'background/flow-light-3.webp',
    },
    titleBackgroundPenIds: ["1bbff66", "7505c4f4", "dc8538", "865babf", "6406b68", "1058fb89", "2c32ca67"],
    processNodePenIds: ["9f8e2b6", "66a63a90", "c87292d"],
  })],
  ['business', createResourceManifest({
    staticImagePathByPenId: {
      '5660738b': 'background/flow-light-3.webp',
      '387ce21f': 'background/flow-light-3.webp',
      'dc99914': 'background/flow-light-3.webp',
      'b7d4825': 'background/flow-light-3.webp',
      'cf4d67b': 'background/flow-light-3.webp',
      '0d090d4': 'background/flow-light-3.webp',
    },
    titleBackgroundPenIds: ["5660738b", "387ce21f", "dc99914", "b7d4825", "cf4d67b", "0d090d4"],
    processNodePenIds: ["78826709", "5d16d6f9", "68dbdc25", "c56687c", "4a301c9", "107cb1"],
  })],
  ['business-key-process', createResourceManifest({
    deviceIconPathByPenId: {
      '2cdd2b5': WIND_PLC_DEVICE_ICON_PATHS,
      'ccca65e': WIND_PLC_DEVICE_ICON_PATHS,
      '8d7675b': WIND_PLC_DEVICE_ICON_PATHS,
      '7a0b0af0': WIND_PLC_DEVICE_ICON_PATHS,
      '7e8936': WIND_PLC_DEVICE_ICON_PATHS,
      '17cee71': WIND_PLC_DEVICE_ICON_PATHS,
      '6a0592cc': WIND_PLC_DEVICE_ICON_PATHS,
      '6b12cd8': WIND_PLC_DEVICE_ICON_PATHS,
    },
    staticImagePathByPenId: {
      '1b5bf2db': 'icons/normal/generator.webp',
      'c9d8513': 'icons/static/e2e275e4a94ef6d9f2313aee8ee7857b2ba21ac4d323bd53378144dc47169f7f.webp',
      '7e2be0d0': 'icons/static/def6155598057373934ea3668fa58a2ed4cf26f9d1722fae22f6a06af732859a.webp',
      '4aad3db9': 'icons/normal/generator.webp',
      '3c00e87b': 'icons/static/e2e275e4a94ef6d9f2313aee8ee7857b2ba21ac4d323bd53378144dc47169f7f.webp',
      'dc6bddf': 'icons/normal/plc.webp',
      '85c8d5': 'icons/normal/plc.webp',
      '6a5def5f': 'icons/normal/dcs.webp',
      '2a2f00b': 'icons/normal/gearbox.webp',
      '489dea58': 'icons/static/72c7e1e4eed654c8cddb379b8db4c6f3554b810eff9fd8d74f9084c5d28fe6e5.webp',
      'ea315cc': 'icons/static/cd8655f8bcede28c1a381160c4a696c93556459006d8fd8c2583a261b312d755.webp',
      '1cdaff39': 'icons/static/def6155598057373934ea3668fa58a2ed4cf26f9d1722fae22f6a06af732859a.webp',
      '180e37e': 'icons/normal/plc.webp',
      '692e58a0': 'icons/normal/plc.webp',
      '61bd6206': 'icons/normal/dcs.webp',
      '15f6e31': 'icons/normal/gearbox.webp',
      '3ef31bef': 'icons/static/72c7e1e4eed654c8cddb379b8db4c6f3554b810eff9fd8d74f9084c5d28fe6e5.webp',
      'a5f2c06': 'icons/static/cd8655f8bcede28c1a381160c4a696c93556459006d8fd8c2583a261b312d755.webp',
      '33e12454': 'background/flow-light-3.webp',
      'f36ac94': 'background/flow-light-3.webp',
      'e8d3efe': 'background/flow-light-3.webp',
      '1c490480': 'background/flow-light-3.webp',
      '4647f5c': 'background/flow-light-3.webp',
      '166bab1': 'background/flow-light-3.webp',
    },
    titleBackgroundPenIds: ["33e12454", "f36ac94", "e8d3efe", "1c490480", "4647f5c", "166bab1"],
    processNodePenIds: ["2a5210d5", "d21fd8e", "54d1e021", "d6a35ed", "0deda7", "a10d819"],
  })],
  ['key-process', createResourceManifest({
    deviceIconPathByPenId: {
      '15b49d26': WIND_PLC_DEVICE_ICON_PATHS,
      '7241f93e': WIND_PLC_DEVICE_ICON_PATHS,
      '6bd3ecb9': WIND_PLC_DEVICE_ICON_PATHS,
      '60369370': WIND_PLC_DEVICE_ICON_PATHS,
      '3790242': WIND_PLC_DEVICE_ICON_PATHS,
      '6ae5e42': WIND_PLC_DEVICE_ICON_PATHS,
      '9396e06': WIND_PLC_DEVICE_ICON_PATHS,
      '4d345e6': WIND_PLC_DEVICE_ICON_PATHS,
    },
    staticImagePathByPenId: {
      '43591e1': 'icons/normal/generator.webp',
      '2726eea': 'icons/static/e2e275e4a94ef6d9f2313aee8ee7857b2ba21ac4d323bd53378144dc47169f7f.webp',
      '39b88c13': 'icons/static/def6155598057373934ea3668fa58a2ed4cf26f9d1722fae22f6a06af732859a.webp',
      '2c8684de': 'icons/normal/generator.webp',
      'c9c0f7e': 'icons/static/e2e275e4a94ef6d9f2313aee8ee7857b2ba21ac4d323bd53378144dc47169f7f.webp',
      '1d860db1': 'icons/normal/plc.webp',
      '5324a4b3': 'icons/normal/plc.webp',
      '43972ff0': 'icons/normal/dcs.webp',
      'b9f54d2': 'icons/normal/gearbox.webp',
      'ad61a3f': 'icons/static/72c7e1e4eed654c8cddb379b8db4c6f3554b810eff9fd8d74f9084c5d28fe6e5.webp',
      '7fbceb07': 'icons/static/cd8655f8bcede28c1a381160c4a696c93556459006d8fd8c2583a261b312d755.webp',
      '5d871db': 'icons/static/def6155598057373934ea3668fa58a2ed4cf26f9d1722fae22f6a06af732859a.webp',
      'b20d06b': 'icons/normal/plc.webp',
      '6c39c08': 'icons/normal/plc.webp',
      '3afce6a': 'icons/normal/dcs.webp',
      '1a89f78': 'icons/normal/gearbox.webp',
      '2f57d425': 'icons/static/72c7e1e4eed654c8cddb379b8db4c6f3554b810eff9fd8d74f9084c5d28fe6e5.webp',
      '3e25050': 'icons/static/cd8655f8bcede28c1a381160c4a696c93556459006d8fd8c2583a261b312d755.webp',
      '6cb7caa': 'background/flow-light-3.webp',
      '645f1a9': 'background/flow-light-3.webp',
      'a1b6f8': 'background/flow-light-3.webp',
      '76bdf94': 'background/flow-light-3.webp',
      '627967d5': 'background/flow-light-3.webp',
      '2bf7bdf6': 'background/flow-light-3.webp',
    },
    titleBackgroundPenIds: ["6cb7caa", "645f1a9", "a1b6f8", "76bdf94", "627967d5", "2bf7bdf6"],
    processNodePenIds: [],
  })],
  ['network', createResourceManifest({
    deviceIconPathByPenId: {
      'b7884e6': WIND_PLC_DEVICE_ICON_PATHS,
      '4e4e4b': WIND_PLC_DEVICE_ICON_PATHS,
      '6d463462': WIND_PLC_DEVICE_ICON_PATHS,
      '6a0e5a0e': WIND_PLC_DEVICE_ICON_PATHS,
      '779c4bd9': WIND_PLC_DEVICE_ICON_PATHS,
      '7100f20': WIND_PLC_DEVICE_ICON_PATHS,
      'a8f94f6': WIND_PLC_DEVICE_ICON_PATHS,
      '288459b2': WIND_PLC_DEVICE_ICON_PATHS,
    },
    staticImagePathByPenId: {
      '49ccb4f': 'background/flow-light-3.webp',
      '3f848c1': 'background/flow-light-3.webp',
      'fa6a1fe': 'background/flow-light-3.webp',
      'be887ae': 'background/flow-light-3.webp',
      '12b08daf': 'background/flow-light-3.webp',
      '90f9076': 'background/flow-light-3.webp',
      'd992a79': 'icons/normal/firewall.webp',
      '36e95e21': 'icons/normal/firewall.webp',
      '5fc2c31d': 'icons/normal/server.webp',
      '19337f95': 'icons/normal/server.webp',
      '52b4226c': 'icons/normal/plc.webp',
      'f1c9a24': 'icons/normal/plc.webp',
      '23530211': 'icons/normal/dcs.webp',
      '103501bf': 'icons/normal/office.webp',
      '209dd3d': 'icons/normal/office.webp',
      'd51a233': 'icons/normal/desktop.webp',
      '10fe915': 'icons/normal/desktop.webp',
      '1f7b00': 'icons/normal/desktop.webp',
      '82f8af': 'icons/normal/plc.webp',
      '357575f2': 'icons/normal/plc.webp',
      '29de29': 'icons/normal/dcs.webp',
      '66fdc69b': 'icons/normal/router.webp',
      '34c03f3a': 'icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp',
    },
    titleBackgroundPenIds: ["49ccb4f", "3f848c1", "fa6a1fe", "be887ae", "12b08daf", "90f9076"],
    processNodePenIds: [],
  })],
  ['network-business', createResourceManifest({
    deviceIconPathByPenId: {
      '1055adfd': WIND_PLC_DEVICE_ICON_PATHS,
      '4a75cf4': WIND_PLC_DEVICE_ICON_PATHS,
      'ec6a59e': WIND_PLC_DEVICE_ICON_PATHS,
      '1e412298': WIND_PLC_DEVICE_ICON_PATHS,
      '17d8b5c': WIND_PLC_DEVICE_ICON_PATHS,
      '5d39b66f': WIND_PLC_DEVICE_ICON_PATHS,
      '51bc092': WIND_PLC_DEVICE_ICON_PATHS,
      '406297f8': WIND_PLC_DEVICE_ICON_PATHS,
    },
    staticImagePathByPenId: {
      '4057f312': 'icons/normal/firewall.webp',
      '113316a': 'icons/normal/firewall.webp',
      '89dcf27': 'icons/normal/server.webp',
      'd6bc657': 'icons/normal/server.webp',
      '21056d8': 'icons/normal/plc.webp',
      '374854': 'icons/normal/plc.webp',
      '39a53751': 'icons/normal/dcs.webp',
      '1a7a333c': 'icons/normal/office.webp',
      '4617a8d2': 'icons/normal/office.webp',
      '5d892a7': 'icons/normal/desktop.webp',
      '43709d7': 'icons/normal/desktop.webp',
      '3b2eaf': 'icons/normal/desktop.webp',
      '7426171': 'icons/normal/plc.webp',
      'f3dafe8': 'icons/normal/plc.webp',
      'e294556': 'icons/normal/dcs.webp',
      '21bf844': 'icons/normal/router.webp',
      '23ada6c': 'icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp',
      'ec6cf6e': 'background/flow-light-3.webp',
      '7bee951': 'background/flow-light-3.webp',
      '1dbaa69c': 'background/flow-light-3.webp',
      '225572f3': 'background/flow-light-3.webp',
      'dbef4df': 'background/flow-light-3.webp',
      '16bcd02f': 'background/flow-light-3.webp',
    },
    titleBackgroundPenIds: ["ec6cf6e", "7bee951", "1dbaa69c", "225572f3", "dbef4df", "16bcd02f"],
    processNodePenIds: ["730f9118", "eb7d4da", "5b1b946", "53f5be", "f48a03d", "050e39b"],
  })],
  ['network-business-key-process', createResourceManifest({
    // 每种设备按用户提供的节点对照图登记四态；normal 指向与新 JSON 视觉匹配的公共 WebP。
    // 两组重复绘制的同类设备使用相同状态图标，状态快照切换时不会留下旧图元编号。
    // 风机专用的告警、故障和离线 WebP 来自 Docs/拓扑图图标，并统一放入 public/topology/shared/icons 对应状态目录。
    deviceIconPathByPenId: {
      '28457c83': { normal: 'icons/normal/plc.webp', alarm: 'icons/alarm/plc.webp', fault: 'icons/fault/plc.webp', offline: 'icons/offline/plc.webp' },
      '28e27ec2': { normal: 'icons/normal/plc.webp', alarm: 'icons/alarm/plc.webp', fault: 'icons/fault/plc.webp', offline: 'icons/offline/plc.webp' },
      '27e09c2f': { normal: 'icons/normal/plc.webp', alarm: 'icons/alarm/plc.webp', fault: 'icons/fault/plc.webp', offline: 'icons/offline/plc.webp' },
      '67fd9a': { normal: 'icons/normal/plc.webp', alarm: 'icons/alarm/plc.webp', fault: 'icons/fault/plc.webp', offline: 'icons/offline/plc.webp' },
      'c8042a6': { normal: 'icons/normal/plc.webp', alarm: 'icons/alarm/plc.webp', fault: 'icons/fault/plc.webp', offline: 'icons/offline/plc.webp' },
      '26bfee5': { normal: 'icons/normal/plc.webp', alarm: 'icons/alarm/plc.webp', fault: 'icons/fault/plc.webp', offline: 'icons/offline/plc.webp' },
      '006f1fc': { normal: 'icons/normal/plc.webp', alarm: 'icons/alarm/plc.webp', fault: 'icons/fault/plc.webp', offline: 'icons/offline/plc.webp' },
      '49fe7d9': { normal: 'icons/normal/plc.webp', alarm: 'icons/alarm/plc.webp', fault: 'icons/fault/plc.webp', offline: 'icons/offline/plc.webp' },
      '7a8bb9bf': { normal: 'icons/normal/plc.webp', alarm: 'icons/alarm/plc.webp', fault: 'icons/fault/plc.webp', offline: 'icons/offline/plc.webp' },
      'b4a3335': { normal: 'icons/normal/plc.webp', alarm: 'icons/alarm/plc.webp', fault: 'icons/fault/plc.webp', offline: 'icons/offline/plc.webp' },
      '87f441c': { normal: 'icons/static/e2e275e4a94ef6d9f2313aee8ee7857b2ba21ac4d323bd53378144dc47169f7f.webp', alarm: 'icons/alarm/wind-pitch-system.webp', fault: 'icons/fault/wind-pitch-system.webp', offline: 'icons/offline/wind-pitch-system.webp' },
      'd4ab511': { normal: 'icons/static/e2e275e4a94ef6d9f2313aee8ee7857b2ba21ac4d323bd53378144dc47169f7f.webp', alarm: 'icons/alarm/wind-pitch-system.webp', fault: 'icons/fault/wind-pitch-system.webp', offline: 'icons/offline/wind-pitch-system.webp' },
      '4996538': { normal: 'icons/static/3f298fdca1e67c404570bede325564faebedad1ef887ad355bca07ee0be56767.webp', alarm: 'icons/alarm/wind-converter-system.webp', fault: 'icons/fault/wind-converter-system.webp', offline: 'icons/offline/wind-converter-system.webp' },
      '5e9d380': { normal: 'icons/static/3f298fdca1e67c404570bede325564faebedad1ef887ad355bca07ee0be56767.webp', alarm: 'icons/alarm/wind-converter-system.webp', fault: 'icons/fault/wind-converter-system.webp', offline: 'icons/offline/wind-converter-system.webp' },
      '44940c8': { normal: 'icons/static/def6155598057373934ea3668fa58a2ed4cf26f9d1722fae22f6a06af732859a.webp', alarm: 'icons/alarm/wind-yaw-system.webp', fault: 'icons/fault/wind-yaw-system.webp', offline: 'icons/offline/wind-yaw-system.webp' },
      'a89f0ae': { normal: 'icons/static/def6155598057373934ea3668fa58a2ed4cf26f9d1722fae22f6a06af732859a.webp', alarm: 'icons/alarm/wind-yaw-system.webp', fault: 'icons/fault/wind-yaw-system.webp', offline: 'icons/offline/wind-yaw-system.webp' },
      '52b0990b': { normal: 'icons/normal/gearbox.webp', alarm: 'icons/alarm/gearbox.webp', fault: 'icons/fault/gearbox.webp', offline: 'icons/offline/gearbox.webp' },
      '5fbd69f': { normal: 'icons/normal/gearbox.webp', alarm: 'icons/alarm/gearbox.webp', fault: 'icons/fault/gearbox.webp', offline: 'icons/offline/gearbox.webp' },
      '9331d40': { normal: 'icons/static/cd8655f8bcede28c1a381160c4a696c93556459006d8fd8c2583a261b312d755.webp', alarm: 'icons/alarm/wind-brake-system.webp', fault: 'icons/fault/wind-brake-system.webp', offline: 'icons/offline/wind-brake-system.webp' },
      '828058d': { normal: 'icons/static/cd8655f8bcede28c1a381160c4a696c93556459006d8fd8c2583a261b312d755.webp', alarm: 'icons/alarm/wind-brake-system.webp', fault: 'icons/fault/wind-brake-system.webp', offline: 'icons/offline/wind-brake-system.webp' },
    },
    staticImagePathByPenId: {
      '1ae2e552': 'icons/normal/firewall.webp',
      '0c8a079': 'icons/normal/firewall.webp',
      'dad2c5b': 'icons/normal/server.webp',
      '77d10fd': 'icons/normal/server.webp',
      '10497337': 'icons/normal/office.webp',
      'd8e617b': 'icons/normal/office.webp',
      '986ad3d': 'icons/normal/desktop.webp',
      '8e6205d': 'icons/normal/desktop.webp',
      'd715e38': 'icons/normal/desktop.webp',
      '1380738': 'icons/normal/dcs.webp',
      'c7345cf': 'icons/normal/dcs.webp',
      '781bfab9': 'icons/normal/router.webp',
      '6258c20d': 'icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp',
      '1aeb61': 'background/flow-light-3.webp',
      '24384824': 'background/flow-light-3.webp',
      '748a6a1': 'background/flow-light-3.webp',
      '39d73f43': 'background/flow-light-3.webp',
      '08c05a7': 'background/flow-light-3.webp',
      '4a5310d': 'background/flow-light-3.webp',
    },
    titleBackgroundPenIds: ["1aeb61", "24384824", "748a6a1", "39d73f43", "08c05a7", "4a5310d"],
    processNodePenIds: ["2bfdf432", "42e6522b", "6596f4f", "deeb260", "e3d9c0", "c2c2897"],
  })],
  ['network-key-process', createResourceManifest({
    deviceIconPathByPenId: {
      '159a8d': WIND_PLC_DEVICE_ICON_PATHS,
      '777e94bc': WIND_PLC_DEVICE_ICON_PATHS,
      '4d331569': WIND_PLC_DEVICE_ICON_PATHS,
      '5a7b7f30': WIND_PLC_DEVICE_ICON_PATHS,
      '40eac465': WIND_PLC_DEVICE_ICON_PATHS,
      '82b105': WIND_PLC_DEVICE_ICON_PATHS,
      '361789f0': WIND_PLC_DEVICE_ICON_PATHS,
      '3f5581bd': WIND_PLC_DEVICE_ICON_PATHS,
    },
    staticImagePathByPenId: {
      '348b373': 'icons/normal/generator.webp',
      'c70905d': 'icons/static/e2e275e4a94ef6d9f2313aee8ee7857b2ba21ac4d323bd53378144dc47169f7f.webp',
      '7716ffa': 'icons/static/def6155598057373934ea3668fa58a2ed4cf26f9d1722fae22f6a06af732859a.webp',
      'dee23c7': 'icons/normal/firewall.webp',
      '115e86e': 'icons/normal/firewall.webp',
      '4cc685d': 'icons/normal/server.webp',
      '15637183': 'icons/normal/server.webp',
      'ac4ba70': 'icons/normal/generator.webp',
      '6b05a580': 'icons/static/e2e275e4a94ef6d9f2313aee8ee7857b2ba21ac4d323bd53378144dc47169f7f.webp',
      'd98cd30': 'icons/normal/plc.webp',
      '7b6b575a': 'icons/normal/plc.webp',
      'f5f1d51': 'icons/normal/dcs.webp',
      '1bc2368': 'icons/normal/gearbox.webp',
      '58f4a32': 'icons/static/72c7e1e4eed654c8cddb379b8db4c6f3554b810eff9fd8d74f9084c5d28fe6e5.webp',
      '2c1619f7': 'icons/static/cd8655f8bcede28c1a381160c4a696c93556459006d8fd8c2583a261b312d755.webp',
      '34692756': 'icons/static/def6155598057373934ea3668fa58a2ed4cf26f9d1722fae22f6a06af732859a.webp',
      '0bcdd4c': 'icons/normal/office.webp',
      'bc2eba0': 'icons/normal/office.webp',
      '5bae862c': 'icons/normal/desktop.webp',
      '594e163d': 'icons/normal/desktop.webp',
      '9a046ea': 'icons/normal/desktop.webp',
      '135f6578': 'icons/normal/plc.webp',
      '48f32': 'icons/normal/plc.webp',
      '3cfad7b': 'icons/normal/dcs.webp',
      '099b847': 'icons/normal/gearbox.webp',
      'af0f606': 'icons/static/72c7e1e4eed654c8cddb379b8db4c6f3554b810eff9fd8d74f9084c5d28fe6e5.webp',
      'e4e873f': 'icons/static/cd8655f8bcede28c1a381160c4a696c93556459006d8fd8c2583a261b312d755.webp',
      '31215ee0': 'icons/normal/router.webp',
      '3527c113': 'icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp',
      '26e36a28': 'background/flow-light-3.webp',
      '6019877': 'background/flow-light-3.webp',
      '0b85737': 'background/flow-light-3.webp',
      '51750a0': 'background/flow-light-3.webp',
      '17cbc953': 'background/flow-light-3.webp',
      'f68a7e9': 'background/flow-light-3.webp',
    },
    titleBackgroundPenIds: ["26e36a28", "6019877", "0b85737", "51750a0", "17cbc953", "f68a7e9"],
    processNodePenIds: [],
  })],
])

/** 严格按组合键读取；缺项属于开发配置错误，不能回退到其他拓扑。 */
export function getWindTopologyResourceManifest(variantId: WindTopologyVariantId): WindTopologyResourceManifest {
  const manifest = RESOURCE_MANIFEST_BY_VARIANT_ID.get(variantId)
  if (!manifest) throw new Error(`风电拓扑版本缺少资源清单：${variantId}`)
  return manifest
}

/** 默认总图是用户确认的网络、业务、关键环节组合。 */
const defaultManifest = getWindTopologyResourceManifest('network-business-key-process')
export const WIND_TOPOLOGY_DEVICE_PEN_IDS = defaultManifest.devicePenIds
export const WIND_TOPOLOGY_BACKGROUND_PEN_IDS = defaultManifest.titleBackgroundPenIds
export const WIND_TOPOLOGY_PROCESS_PEN_IDS = defaultManifest.processNodePenIds
// 兼容现有消费端的导出名称。
export const WIND_DEVICE_PEN_IDS = WIND_TOPOLOGY_DEVICE_PEN_IDS
export const WIND_TITLE_BACKGROUND_PEN_IDS = WIND_TOPOLOGY_BACKGROUND_PEN_IDS


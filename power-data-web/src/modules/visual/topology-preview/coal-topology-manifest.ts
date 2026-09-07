import type { CoalTopologyVariantId } from './coal-topology-variant-manifest'

/** 公共设备图标类型；运行时只按版本和稳定图元编号查表，不解析标题、坐标或源图片地址。 */
type CoalTopologyDeviceIconKey =
  | 'office' | 'desktop' | 'firewall' | 'dcs' | 'mirror' | 'server' | 'conveyor'
  | 'desulfurization' | 'pump' | 'generator' | 'boiler' | 'steam_turbine' | 'plc' | 'router'

const DEVICE_ICON_KEYS: readonly CoalTopologyDeviceIconKey[] = Object.freeze([
  'office', 'desktop', 'firewall', 'dcs', 'mirror', 'server', 'conveyor',
  'desulfurization', 'pump', 'generator', 'boiler', 'steam_turbine', 'plc', 'router',
])

export interface CoalTopologyResourceManifest {
  readonly deviceIconPathByPenId: ReadonlyMap<string, string>
  /** 非设备静态图片的公共资源映射；不参与四态状态切换。 */
  readonly staticImagePathByPenId: ReadonlyMap<string, string>
  readonly devicePenIds: ReadonlySet<string>
  readonly titleBackgroundPenIds: ReadonlySet<string>
  readonly processNodePenIds: ReadonlySet<string>
}

type ResourceManifestSource = Partial<Record<CoalTopologyDeviceIconKey, readonly string[]>> & {
  readonly titleBackgroundPenIds: readonly string[]
  readonly processNodePenIds: readonly string[]
  readonly staticImagePathByPenId?: Readonly<Record<string, string>>
}

/** 将人工核对后的分类压平为常数时间索引，同时确保版本目录无需复制任何公共图片。 */
function createResourceManifest(source: ResourceManifestSource): CoalTopologyResourceManifest {
  const deviceIconPathByPenId = new Map<string, string>()
  for (const iconKey of DEVICE_ICON_KEYS) {
    for (const penId of source[iconKey] ?? []) {
      deviceIconPathByPenId.set(penId, `icons/normal/${iconKey}.webp`)
    }
  }
  return Object.freeze({
    deviceIconPathByPenId,
    staticImagePathByPenId: new Map(Object.entries(source.staticImagePathByPenId ?? {})),
    devicePenIds: new Set(deviceIconPathByPenId.keys()),
    titleBackgroundPenIds: new Set(source.titleBackgroundPenIds),
    processNodePenIds: new Set(source.processNodePenIds),
  })
}

/**
 * 八份独立输入文件的显式资源清单。图元编号按文件隔离；业务单层只有背景与工艺矩形，
 * 不凭空创建设备。以下编号均由本次导入文件逐项核对，不会在运行时按文字或位置推断。
 */
const RESOURCE_MANIFEST_BY_VARIANT_ID: ReadonlyMap<CoalTopologyVariantId, CoalTopologyResourceManifest> = new Map([
  ['architecture', createResourceManifest({
    office: ['a3bb623', '851d82', 'e34fba8', '76ecaa5', 'a377b57', '64850bd1', '228031c0'],
    desktop: ['1f5b8b5'],
    firewall: ['611ca56', '5e97c875'],
    dcs: ['11c46c', 'a1d78e1', 'c262cef', '1128b31', '1d9a0ba8', '85c666a'],
    mirror: ['efab9e0'], server: ['9f63dc7', '5637775'], conveyor: ['2b99cb6e'],
    desulfurization: ['c099ff6', 'f4010a'], pump: ['96c4bbe'], generator: ['f13c58a'],
    boiler: ['6e5fb55c'], steam_turbine: ['89854a4'],
    plc: ['52b8d2d5', 'a2dad7b', '61fc2f3', '7af9e00b'],
    titleBackgroundPenIds: ['3018fd4', 'db3e552', '35bedb7b', '7fca9519', '3ba2dc', '546498'],
    processNodePenIds: ['7ede91e', '483b2e0c', '2ec39393', '3bf5c8c', '66d088e4', '443d2d1d', '6b32f75b', 'ed4d05c', '237a498a', '404543fd', '749dd47b', '1f1f3a01'],
  })],
  ['network', createResourceManifest({
    office: ['46ef38', '678ef91a', '3b625710', '3868f70c', '7d361223', '71c2a0df', 'c06abc7', '1afa2484', 'd2896eb', '3e291427', '8e098bc'],
    desktop: ['7162d4c', '2a9e9d83', '431edf91', '4815665', 'f7580c9'],
    firewall: ['304a751', '0317f07'], dcs: ['4365ab7', '54656a8f', '49e1a49b', '2e306940', '197ce245'],
    mirror: ['81e8419', '27a46a97', '2dbfb5c'], server: ['019d830', 'f2bc4c7', '752b9935', 'c8719f9', '0096f26', '3d6dc440'],
    plc: ['326e33bc', 'b96e734', '5c4ccdc3', '1020cee'], router: ['44ac4f2f', '56ac1da', 'c8c4bf3', '2a60fc22', '6c135049', '614418e'],
    titleBackgroundPenIds: ['8e94782', 'b7cc212', '34c331e', '123f5ae', '0e6d56e', '35351a86'],
    processNodePenIds: [],
  })],
  ['business', createResourceManifest({
    titleBackgroundPenIds: ['e7a3341', 'aafde6f', 'b3ed32e', '95212b8', '54ba98c', '0131dbe'],
    processNodePenIds: ['f218ba2', '791b2f05', '8780070', '2ce43bb3', '3babd70d', '251faa5e', '77e068f6', '23d03077', '17b6a13', '875600a', 'a56a1f', '26459dd8'],
  })],
  ['key-process', createResourceManifest({
    conveyor: ['bd71a78'], desulfurization: ['7cd0387', 'a921c2'], pump: ['1ae6756f'],
    generator: ['8e17c6'], boiler: ['2a01627b'], steam_turbine: ['271db7a'],
    dcs: ['1965c29e', '4882f156', '28c8201', 'c6ce35c', '6b8a4c59'],
    plc: ['49830226', '42ebc00', '4f007812', '61224818'],
    titleBackgroundPenIds: ['8d1cdff', '44f6db0', 'b63de3d', '3ffe6eb0', 'a12a411', '21b2d4ab'],
    processNodePenIds: [],
  })],
  ['network-business', createResourceManifest({
    office: ['28138773', '48f357d', '7eb508ce', 'aa73221', '391fc4f1', '4a13d52d', '6c15e52', 'af67c5c', '0c5183', 'f7739f8', 'dc829f8'],
    desktop: ['719ce5b', '425a7499', '120bffaa', '7dbab36', '31a08ea'],
    firewall: ['040a992', '1005511'], dcs: ['365005ba', '6d7e2838', '7a562a3', '8f12003', '1701b2a0'],
    mirror: ['0465bb3', '3741283', '13b19ee8'], server: ['77809c4e', '3d9db', '2279770b', '78dfd692', '3f1dc3b', '564506b'],
    plc: ['5fe4c3c5', '564dc55', '28ad5ca', 'b3d4c7b'], router: ['32a1305', 'e9893b6', 'a2ef179', '9d822d5', '4974a23f', '60d2df19'],
    titleBackgroundPenIds: ['3519c5b', 'f7e2737', '77480c', '21031096', '66cf1c', '888e14d'],
    processNodePenIds: ['4dd97a7a', '7ae75362', '943eae', '173a8be', '7b31787c', 'e18acaa', '6a0d0ab', '24695f2d', 'e5b39d3', '3371b8e3', '11efe4fb', '47b5ae19'],
  })],
  ['network-key-process', createResourceManifest({
    office: ['59b774d', '3befc9a', '3cee8c0', '5cefe1a', 'bdf5e13', '7db92738', '03a036e', 'a640146', '708e8b1c', '458a748', '41daab3b'],
    desktop: ['4788f2a2', '18937f24', '6927b26', '7599195', '2cb27e0'],
    firewall: ['4757ff3c', '6097ecf'], dcs: ['32a23d5', '092ecd', '286071b', '5a865e7', '2c3dc708', '5831d532'],
    mirror: ['4afbe970', '70bda457', '4d2699f9'], server: ['0467da', 'eb96159', '13ff7361', '42e88704', '4204d5b', '1145f61'],
    conveyor: ['8f3093e'], desulfurization: ['4a4dcce5', '36e012ee'], pump: ['5e8c632f'],
    generator: ['3253036'], boiler: ['37330c6c'], steam_turbine: ['cd9d874'],
    plc: ['5e1672f4', '883ac2d', '077b9d', '1247290'], router: ['60e7ad2', '46ba870', '5e3d15f8', '7cc9d90', '7e286486', 'ce57dcc'],
    titleBackgroundPenIds: ['a7b8145', '9a82096', '62ec992', '58a9e1c0', '737929', 'df6975d'],
    processNodePenIds: [],
  })],
  ['business-key-process', createResourceManifest({
    conveyor: ['290d8907'], desulfurization: ['9d841b7', '28534648'], pump: ['1d0b069'],
    generator: ['49768f46'], boiler: ['138c356'], steam_turbine: ['6ca4ed1'],
    dcs: ['5e8a7a7a', '2f08192', '3e6d801', 'f1f7825', '1cb78b9'],
    plc: ['583ab3cd', '6d46cb26', '51b2dfb', '0d79b6'],
    titleBackgroundPenIds: ['e1bb239', '2240cc69', '3879793d', '51eb7d7f', '8c91d4f', '2896f7c2'],
    processNodePenIds: ['5f53cd9', '3d4287b3', '15d7b809', '03816b3', '763f84f3', '43ff96c3', 'b74313e', 'de248ac', '3cae9a3b', '821d281', '7132c655', '5f29f1da'],
  })],
  ['network-business-key-process', createResourceManifest({
    office: ['2ed519d', '8ff5f40', '788d56b', 'f3d558d', '16cd2900', '1b6ec53', '15f022', '7ecd2bcb', '7600456', '579309c', '088dc0'],
    desktop: ['fce5fc4', '29633cff', 'bff4ab7', 'b535735', '32f5afbd'],
    firewall: ['927cfac', '508798a0'], dcs: ['4fac15b8', '21136a0', '726aff31', '1eee410d', '52efcda', '5269b64a'],
    mirror: ['4effaeac', 'c64cb9a', '9e82b6c'], server: ['30d38c', 'c46634e', 'a7267c8', '24704eba', '77668ba9', '23ce86'],
    conveyor: ['174871cf'], desulfurization: ['88e3282', '19ada4a'], pump: ['5eedb48'],
    generator: ['c1ee89f'], boiler: ['4d87c9a3'], steam_turbine: ['69d36f83'],
    plc: ['6127ab04', '870bced', 'b6c2c58', '11d93d44'], router: ['d1f2037', '550b2585', 'd0c4a54', 'ec66216', 'e2e3c4a', '3806e5c8'],
    titleBackgroundPenIds: ['53f2260e', '70f0fd4', '5c525eb1', '4d14b40f', '4a4eceda', '5c23ca8'],
    processNodePenIds: ['85cabfb', '2e3deb0', '400b2e', '5b595f', 'c8c3578', 'dc91da3', '21e09460', '6d77b386', '7b765f3b', '4c9274d9', '6cda614d', 'c4ff0d1'],
  })],
  ['process-detail-steam-turbine', createResourceManifest({
    steam_turbine: ['baf5ab7', 'b9ae43'],
    titleBackgroundPenIds: ['d22317e', '44e2393', '7d7130ab'],
    processNodePenIds: [],
  })],
])

/** 严格读取目标版本清单；缺项属于开发配置错误，不回退到默认文件。 */
export function getCoalTopologyResourceManifest(variantId: CoalTopologyVariantId): CoalTopologyResourceManifest {
  // 锅炉第三层当前复用已发布关键环节输入文件的资源登记，不复制公共资源表。
  if (variantId === 'process-detail-boiler') {
    return RESOURCE_MANIFEST_BY_VARIANT_ID.get('key-process')!
  }
  const manifest = RESOURCE_MANIFEST_BY_VARIANT_ID.get(variantId)
  if (!manifest) throw new Error(`燃煤拓扑版本缺少资源清单：${variantId}`)
  return manifest
}

/** 默认整图兼容导出仅供既有检查使用；切层逻辑必须显式传入版本编号。 */
const defaultManifest = getCoalTopologyResourceManifest('network-business-key-process')
export const COAL_TOPOLOGY_DEVICE_PEN_IDS = defaultManifest.devicePenIds
export const COAL_TOPOLOGY_BACKGROUND_PEN_IDS = defaultManifest.titleBackgroundPenIds
export const COAL_TOPOLOGY_PROCESS_PEN_IDS = defaultManifest.processNodePenIds

import type { GasV3TopologyVariantId } from './gas-v3-topology-variant-manifest'

/** 公共设备图标类型；每个版本只登记稳定图元编号，不在运行时解析标题、坐标或原图片地址。 */
type GasV3TopologyDeviceIconKey =
  | 'firewall' | 'server' | 'mirror' | 'desktop' | 'office' | 'dcs' | 'plc'
  | 'gas_turbine' | 'compressor' | 'desulfurization' | 'pump' | 'generator'
  | 'hrsg' | 'steam_turbine' | 'router'

const DEVICE_ICON_KEYS: readonly GasV3TopologyDeviceIconKey[] = Object.freeze([
  'firewall', 'server', 'mirror', 'desktop', 'office', 'dcs', 'plc',
  'gas_turbine', 'compressor', 'desulfurization', 'pump', 'generator',
  'hrsg', 'steam_turbine', 'router',
])

export interface GasV3TopologyResourceManifest {
  readonly deviceIconPathByPenId: ReadonlyMap<string, string>
  /** 不参与四态切图的静态图片（例如控制系统图标）；仍必须显式登记公共资源路径。 */
  readonly staticImagePathByPenId: ReadonlyMap<string, string>
  readonly devicePenIds: ReadonlySet<string>
  readonly titleBackgroundPenIds: ReadonlySet<string>
  readonly processNodePenIds: ReadonlySet<string>
}

type ResourceManifestSource = Partial<Record<GasV3TopologyDeviceIconKey, readonly string[]>> & {
  readonly titleBackgroundPenIds: readonly string[]
  readonly processNodePenIds: readonly string[]
  readonly staticImagePathByPenId?: Readonly<Record<string, string>>
}

/**
 * 将按图标类型分组的显式编号压平为常数时间索引。分组写法减少重复路径，同时仍保留逐文件、逐图元的人工确认边界。
 */
function createResourceManifest(source: ResourceManifestSource): GasV3TopologyResourceManifest {
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
 * 八份输入文件的图元资源清单。不同文件的图元编号完全独立，因此任何编号都不得跨版本复用；
 * 业务层没有设备图片，只登记工艺矩形和区域标题，状态同步不会凭空创建状态标记。
 */
export const GAS_V3_TOPOLOGY_RESOURCE_MANIFEST_BY_VARIANT_ID: ReadonlyMap<
  GasV3TopologyVariantId,
  GasV3TopologyResourceManifest
> = new Map([
  ['architecture', createResourceManifest({
    compressor: ['4865dae'],
    dcs: ['a55fd3', 'b464ddd', '6fab81', 'd2d584'],
    desktop: ['7e7431e', 'aab866f'],
    desulfurization: ['d925cda'],
    firewall: ['551a4c0f', '20d61a7d'],
    gas_turbine: ['2914be6f'],
    generator: ['b4ff8ef'],
    hrsg: ['e1c5b75'],
    mirror: ['c6a5fca'],
    office: ['5c43ddc', '2f6b647', '45435ec', '55c1014', '800665', '102a428a'],
    plc: ['6ff9a2e', '1b28f94', '5fe02726'],
    pump: ['603a424f'],
    server: ['00119ff', 'c08c85b', '27b095b'],
    steam_turbine: ['2f90ef43'],
    titleBackgroundPenIds: ['12f5e25e', '2e02d95a', '101bedff', '7ec9ab39', '1e5f6687', '5ab063f9'],
    processNodePenIds: ['536051b5', '147795c9', '16c8ff39', '5e81322c', '45144b9', '134f1f0', '4da94a3d', '8822cc0', '47036b6', '90c2eb', 'd37ced0'],
  })],
  ['network', createResourceManifest({
    dcs: ['851ac7b', '4373e5de', '161c5dc', '2df72e66'],
    desktop: ['e80b72', '7294f4b9', '6d96fffd', '3216388', 'a59a4c1', '225d98f6', '3788e4e', 'af6daa7'],
    firewall: ['85e8b44', '19b421ad'],
    mirror: ['202a5868', '1cd0f682', '303087ea'],
    office: ['6cc04503', '368a862d', '4687804e', '7a04cd2e', '18a78692', '7ab89c3'],
    plc: ['30ba8d7', '850ccc7', '46972bab'],
    router: ['b89be1c', '2b8ba179', 'bca1a0f', '303158c', '2068236c'],
    server: ['fbbcde9', '323f5235', 'f08823b', '2fa2a110', '5bdb321e', '3d1248d7'],
    titleBackgroundPenIds: ['16fab3c5', '6a7cc11', '600d1f26', '006bf2b', '2df92d9', '43152740'],
    processNodePenIds: [],
  })],
  ['business', createResourceManifest({
    titleBackgroundPenIds: ['01b3d83', 'a1d6e61', '13f15c64', '100f723', '490b9d9c', '47c7988a'],
    processNodePenIds: ['f765e91', '8378d44', 'f7a9e3b', '3ab110ec', '5c54467c', 'abce8a6', 'db4ba45', '4987425e', '63eb7c38', '93585e', '3bb4417d'],
  })],
  ['key-process', createResourceManifest({
    compressor: ['4f130f0e'],
    dcs: ['5cc1b2bd', 'fda2e86', '808ce1', 'ca0550f'],
    desulfurization: ['b0f7b85'],
    gas_turbine: ['89bbc09'],
    generator: ['ef84ff0'],
    hrsg: ['2ccb9bc'],
    plc: ['45fe6ef3', '6fb6e47', '39f3246c'],
    pump: ['3123828b'],
    steam_turbine: ['428f679'],
    titleBackgroundPenIds: ['332a55ce', '4b3af6a', '3103e699', '7678bfa', '46a7b6a', '20faec5'],
    processNodePenIds: [],
  })],
  // 网络层＋业务层采用 2026-09-07 纠正文件的完整编号清单；43 张图片含 37 个设备和 6 个标题背景。
  // 源图片已按散列核对公共资源；设备类型沿用现有燃气网络层的显式分类，切层继续共用四态图片。
  ['network-business', createResourceManifest({
    dcs: ['4026b99', '4ffe660d', '1cff0ae6', '3ea7f2e1'],
    desktop: [
      '69b370e9', '68d2510', 'fcd4c1', 'd971830',
      'c2b04d2', '503af85f', '4d7640b9', '7d762fc',
    ],
    firewall: ['13b84357', '2a17843f'],
    mirror: ['58351698', '2de5130b', '11c7c253'],
    office: ['1c22e95a', '6a59a06f', 'e9f91d', '882ee07', '190b11f2', '265fad2'],
    plc: ['3f5865df', '1cc9e63', '064d5de'],
    router: ['8ee92f6', '5f2d1d47', '7e3ae959', '3ff4ac4d', 'a65db5a'],
    server: ['cd99351', '61969bcf', '6974b354', '171e5ba1', '7dc179a3', '6b729874'],
    titleBackgroundPenIds: ['6fea9b', '05ef733', '486abf3', 'e207000', 'f8b8284', '16ecfcd'],
    processNodePenIds: [
      'df1ae13', '3820f15', '3abd7c6', '3610d822', '70113f5', '0066034',
      '31caaaba', '823011f', '74ce1b7', '1274c0b1', '3cb48f6',
    ],
  })],
  ['network-key-process', createResourceManifest({
    compressor: ['3c5af058'],
    dcs: ['c12e50d', '5fcf89d3', '3a2b0d2', '6646a093'],
    desktop: ['494401c0', 'b4c7c53', '5c3b9e10', '25f3d3', '933f520', 'd4832d', 'aaf2ff6', '7c951d2'],
    desulfurization: ['1c52e89'],
    firewall: ['195812b', '3afc0cd0'],
    gas_turbine: ['11c1d85'],
    generator: ['038d860'],
    hrsg: ['e1700c'],
    mirror: ['4769b6a2', '72ed552', '2e4aee80'],
    office: ['d36ac9c', '3f43088', '8758c92', '05bab8b', '0f31fb0', '65445f73'],
    plc: ['590af6e', '5badc71', 'a96940'],
    pump: ['59549e1'],
    router: ['61b302a', '2b175237', '81c669c', '31358f2f', '71831d4'],
    server: ['1a3510c8', '18da9d6', '015d99c', '3aea886b', '7768b0d', '2775d554'],
    steam_turbine: ['95d696'],
    titleBackgroundPenIds: ['17a00c4', '76fee98b', '3a6a12e5', '750846b', '29e644e3', '4ef6831'],
    processNodePenIds: [],
  })],
  ['business-key-process', createResourceManifest({
    compressor: ['997fc38'],
    dcs: ['8be8ae0', '4ef5ad7a', '33721dd', 'ced7f5f'],
    desulfurization: ['84a1009'],
    gas_turbine: ['48257df'],
    generator: ['fca8c37'],
    hrsg: ['b57087d'],
    plc: ['ae768a', 'a6dfe28', 'f256a61'],
    pump: ['7d053b1c'],
    steam_turbine: ['a0a83b9'],
    titleBackgroundPenIds: ['1580a060', 'cef4ec2', '86bd028', '83d7950', 'c074ff4', '749bee6e'],
    processNodePenIds: ['44ecb96', '1fa8c91c', 'eec3847', '3f6fc6cc', '12634ed3', '79cad056', '4cc36c85', '6346262', '0a8ffe5', '565e195', 'c8a3e4e'],
  })],
  ['network-business-key-process', createResourceManifest({
    compressor: ['2ebebdf0'],
    dcs: ['4c65e23f', '1b4e10a', '365d2986', '0f354e'],
    desktop: ['7b5d6e17', '64a4077', 'f90c16e', '716def7b', '83f2b7', '1ef83a1', '55b71536', '77916030'],
    desulfurization: ['3fcb0bf'],
    firewall: ['9b794e1', '567de6f7'],
    gas_turbine: ['868df1f'],
    generator: ['29b5edb2'],
    hrsg: ['de9e321'],
    mirror: ['5b3791f1', 'c2bd2d5', '509076ba'],
    office: ['65a6a73', '2dc3b042', '165c34ab', 'bdbb07d', '7ec2342', '2d4a354d'],
    plc: ['e6071e5', 'b81f1a9', '65be935d'],
    pump: ['ab19ff4'],
    router: ['754c8e62', '726bf58', '15bf99f3', '10851356', '190cc5e'],
    server: ['2eec4aaf', '49493f', '442e9a24', '7aa4a9eb', '7803a76a', '57be1f3'],
    steam_turbine: ['0c51f9f'],
    titleBackgroundPenIds: ['1a3039dc', 'f09357', '310bef6', '7b5be68', '443ebe4', '59c15d3'],
    processNodePenIds: ['ce327', 'a7c57f8', '21cf1afe', '71026287', '1b3e55a', '15d95230', '72628999', '355282b6', '6f26fffa', '152c0333', 'e5c55f9'],
  })],
  ['process-detail-gas-turbine', createResourceManifest({
    // 关键环节的三台设备直接复用公共四态资源，状态只替换原设备图元图片。
    compressor: ['35d969bb'],
    desulfurization: ['621bf39b'],
    gas_turbine: ['14d76d6'],
    titleBackgroundPenIds: ['3d5a336a', '2dc53a65', '4458b51'],
    processNodePenIds: [],
    // 控制系统源图与公共控制资源逐项按文件哈希核对，未登记为设备状态图元。
    staticImagePathByPenId: {
      '47c8043': 'assets/denitration-control.png',
      '1a099f22': 'assets/coordination-control.png',
      'cee16fb': 'assets/coordination-control.png',
    },
  })],
])

/** 读取指定版本清单；缺失属于开发期配置错误，立即失败比回退到其他版本的编号更安全。 */
export function getGasV3TopologyResourceManifest(variantId: GasV3TopologyVariantId): GasV3TopologyResourceManifest {
  const manifest = GAS_V3_TOPOLOGY_RESOURCE_MANIFEST_BY_VARIANT_ID.get(variantId)
  if (!manifest) throw new Error(`燃气拓扑版本缺少图元资源清单：${variantId}`)
  return manifest
}

/** 保留默认整图导出，兼容公共资源检查；新代码必须优先按版本读取清单。 */
const defaultManifest = getGasV3TopologyResourceManifest('network-business-key-process')
export const GAS_V3_DEVICE_ICON_PATH_BY_PEN_ID = defaultManifest.deviceIconPathByPenId
export const GAS_V3_DEVICE_PEN_IDS = defaultManifest.devicePenIds
export const GAS_V3_TITLE_BACKGROUND_PEN_IDS = defaultManifest.titleBackgroundPenIds
export const GAS_V3_PROCESS_NODE_PEN_IDS = defaultManifest.processNodePenIds

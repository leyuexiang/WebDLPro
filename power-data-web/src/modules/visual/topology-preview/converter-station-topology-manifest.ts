import type { ConverterStationTopologyVariantId } from './converter-station-topology-variant-manifest'

/**
 * 换流站资源清单把旧图片键映射到按图元类型核对的新公共四态图标。
 * 当前场景没有登记实时设备节点绑定，所以静态图元只显示正常图标，不按标题推断状态绑定。
 */
export interface ConverterStationTopologyResourceManifest {
  readonly staticImagePathByPenId: ReadonlyMap<string, string>
  readonly devicePenIds: ReadonlySet<string>
  readonly titleBackgroundPenIds: ReadonlySet<string>
  readonly processNodePenIds: ReadonlySet<string>
}

interface ResourceManifestSource {
  readonly staticImagePenIdsByPath: Readonly<Record<string, readonly string[]>>
  readonly titleBackgroundPenIds: readonly string[]
  /** 仅登记源文件明确存在、允许本地选择和连线高亮的蓝色工艺流程节点。 */
  readonly processNodePenIds?: readonly string[]
}

/** 在模块初始化时一次构建常数时间索引，切层、悬浮和选择热路径不重复扫描图元。 */
function createResourceManifest(source: ResourceManifestSource): ConverterStationTopologyResourceManifest {
  const staticImagePathByPenId = new Map<string, string>()
  for (const [path, penIds] of Object.entries(source.staticImagePenIdsByPath)) {
    for (const penId of penIds) staticImagePathByPenId.set(penId, path)
  }
  return Object.freeze({
    staticImagePathByPenId,
    devicePenIds: new Set(staticImagePathByPenId.keys()),
    titleBackgroundPenIds: new Set(source.titleBackgroundPenIds),
    processNodePenIds: new Set(source.processNodePenIds ?? []),
  })
}

/** 每个变体只登记自身图元编号；跨文件编号不同，禁止复用或按位置推断。 */
const RESOURCE_MANIFEST_BY_VARIANT_ID = new Map<
  ConverterStationTopologyVariantId,
  ConverterStationTopologyResourceManifest
>([
  ['architecture', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/mutual_transformer.webp': ['1493ece'],
      'icons/normal/desktop.webp': ['e4e1acf', '495ae47f', '0f86312', '2d5c43d', '5ebedc4', 'be79f21'],
      'icons/normal/clock.webp': ['e191348'],
      'icons/normal/server.webp': ['a45da0e', '39c8ed1'],
      'icons/normal/firewall.webp': ['747d22ee', '11ddd07a', '162ab427', '4134a4c9'],
      'icons/normal/protection.webp': ['1b10c19', '58b8c70', '6f9481fa'],
      'icons/normal/instrument.webp': ['d9d34cd'],
      'icons/normal/dual_router.webp': ['4449a556', '3539a04b', '64e96d0e'],
      'icons/normal/remote_terminal.webp': ['3f34a374'],
      'icons/normal/monitor.webp': ['ed896ac'],
      'icons/normal/pmu.webp': ['69d29ce7'],
      'icons/normal/breaker.webp': ['3123d4e9'],
      'icons/normal/combiner_unit.webp': ['76e638f'],
      'icons/normal/intelligent_terminal.webp': ['6f0c3120'],
      'icons/normal/transformer.webp': ['5b54f5a5', '25a33904'],
    },
    titleBackgroundPenIds: ['a5972e8', 'e8e2371', '6f68eeb0', 'ab53dc6', '4dd63e73', '4754690'],
    processNodePenIds: ['7604607d', '605320f2', '2b890f42', '747d9f4b', '6a8755d', '5d948092'],
  })],
  ['network', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/desktop.webp': ['1f124c2e', 'ba4eff', '1e96e215', '2269c0a', 'de84de5', '0cf31f6'],
      'icons/normal/clock.webp': ['50a9578'],
      'icons/normal/server.webp': ['7dd877bf', '1ead1d1c'],
      'icons/normal/firewall.webp': ['448eac21', '5d622b2c', '492868a8', 'bd6efbc'],
      'icons/normal/protection.webp': ['596ad0f4', '37d50467', '27387af8', '4c07da', '388caef5'],
      'icons/normal/instrument.webp': ['ea95866', '5d212d0b'],
      'icons/normal/dual_router.webp': ['6b9fe24c', '8265bc3', '5cd3c0d7'],
      'icons/normal/remote_terminal.webp': ['fc0d685'],
      'icons/normal/monitor.webp': ['2001aab'],
      'icons/normal/pmu.webp': ['ee10a1b'],
      'icons/normal/combiner_unit.webp': ['c5aa5e5', '60e0e4a4'],
      'icons/normal/intelligent_terminal.webp': ['690adf5', 'a97d9b1'],
    },
    titleBackgroundPenIds: ['355edf7f', 'de2ebca', '6145526', 'cf448e', 'b96664f', '4978b20'],
  })],
  ['business', createResourceManifest({
    staticImagePenIdsByPath: {
    },
    titleBackgroundPenIds: ['2456a6f4', '134ad323', 'ac622cd', '42e46509', '44bdbfc7', '9e3513d'],
    processNodePenIds: ['23c390a', 'c09510d', '6361af47', '260ffd8d', '61f42b1d', '603e0e'],
  })],
  ['key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/mutual_transformer.webp': ['44acea', '26170cba'],
      'icons/normal/protection.webp': ['10a6c303', '348ed432', '56898748', '69c06114'],
      'icons/normal/instrument.webp': ['a193a8', '2fcaf4'],
      'icons/normal/breaker.webp': ['be926de', 'ab2fe3b'],
      'icons/normal/combiner_unit.webp': ['4dc2d6b6', '657f401'],
      'icons/normal/intelligent_terminal.webp': ['73ab314', '30ebcc98'],
      'icons/normal/transformer.webp': ['6bfc5fec', '2ed3ecd9', '380f8dec', '6b28e311'],
    },
    titleBackgroundPenIds: ['fecad47', '5acaad21', '71ccde2', '1bc8c9c4', 'c4544e3', 'a2f52a8'],
  })],
  ['network-business', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/desktop.webp': ['1374daaf', '904e999', '92a569a', '7f6ab25f', '2a765cc', '7d38faab'],
      'icons/normal/clock.webp': ['4011b97'],
      'icons/normal/server.webp': ['65f1383d', 'db228b8'],
      'icons/normal/firewall.webp': ['ae96a3a', '98fe2e5', '1a919af9', '641a88c'],
      'icons/normal/protection.webp': ['3612ca14', 'e21507c', '0398fc5', 'c5c28fd', 'e57af10'],
      'icons/normal/instrument.webp': ['1a2db2ec', 'a2acfa1'],
      'icons/normal/dual_router.webp': ['b120879', '37eb74c', '27698bba'],
      'icons/normal/remote_terminal.webp': ['8f6974a'],
      'icons/normal/monitor.webp': ['76012753'],
      'icons/normal/pmu.webp': ['06b6260'],
      'icons/normal/combiner_unit.webp': ['1ce8f616', '92f5bf1'],
      'icons/normal/intelligent_terminal.webp': ['98f8ec9', '756976c8'],
    },
    titleBackgroundPenIds: ['4aca498', '128ce5c9', '4d56fcd', '3fc05cf', '83120e1', '63c5aea6'],
    processNodePenIds: ['b49e529', '150357cc', '7354abc', '20425bd7', '7acc314e', 'e93c896'],
  })],
  ['network-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/mutual_transformer.webp': ['25c07b3', '4520535e'],
      'icons/normal/desktop.webp': ['619d25', 'b09cfa5', '1997e737', '44240c4d', 'ff238dd', '6fec7902'],
      'icons/normal/clock.webp': ['8f58aff'],
      'icons/normal/server.webp': ['7b799f2', '7765aeee'],
      'icons/normal/firewall.webp': ['7ca40646', '4cef7083', 'c557203', '9a4e2d7'],
      'icons/normal/protection.webp': ['100e67b', '591f49d', '26b29d1', 'db39b86', '2604c497'],
      'icons/normal/instrument.webp': ['37017063', '73df224'],
      'icons/normal/dual_router.webp': ['777df84', '7cd4fd9', 'c1c7eb2'],
      'icons/normal/remote_terminal.webp': ['7ffad1ac'],
      'icons/normal/monitor.webp': ['ffadd3a'],
      'icons/normal/pmu.webp': ['4eefc830'],
      'icons/normal/breaker.webp': ['4b25188', '6d6f12cf'],
      'icons/normal/combiner_unit.webp': ['e10112e', '686b6788'],
      'icons/normal/intelligent_terminal.webp': ['cf049c5', '3ee0d41b'],
      'icons/normal/transformer.webp': ['762744', '2a638b5e', '6615c7f', '555182af'],
    },
    titleBackgroundPenIds: ['316e3aa4', 'bca92ba', '887d15', '6ae11eb', '623821d1', '1a3ee74'],
  })],
  ['business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/mutual_transformer.webp': ['5d737b0', 'cfe0259'],
      'icons/normal/protection.webp': ['620b00f', '7ea6c9f4', 'ab5843e', '78cf8450'],
      'icons/normal/instrument.webp': ['f5c53', '1ecf12bf'],
      'icons/normal/breaker.webp': ['1297850c', '615c4de'],
      'icons/normal/combiner_unit.webp': ['9814d9a', '29ee8afb'],
      'icons/normal/intelligent_terminal.webp': ['2eeca5c', '643e248e'],
      'icons/normal/transformer.webp': ['059e33b', '4b9b8b8', '2c188b08', '1bb9d658'],
    },
    titleBackgroundPenIds: ['1398fe9c', '1e97a57', '50d30326', '2cc1b06', '0080878', '960673c'],
    processNodePenIds: ['5267b93a', '2b017e', '5bef0f7', 'a895262', '5495baf3', '1e1525bb'],
  })],
  ['network-business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/mutual_transformer.webp': ['04f9d7c', '2cdbfb76'],
      'icons/normal/desktop.webp': ['84e3b8a', 'a48f9b0', '80ef1db', '31ed3025', 'a71dc2a', 'ab5fac7'],
      'icons/normal/clock.webp': ['5dacbd3a'],
      'icons/normal/server.webp': ['628b9c4e', 'c32d282'],
      'icons/normal/firewall.webp': ['3ec3448a', '297fe33', '4f3bec0', 'cb521c3'],
      'icons/normal/protection.webp': ['3ab0c8da', '79d97146', '6b3b68c5', '84ec315', '2be587e9'],
      'icons/normal/instrument.webp': ['ec686db', '08c0355'],
      'icons/normal/dual_router.webp': ['7c4d7358', '4015205', '3e2de874'],
      'icons/normal/remote_terminal.webp': ['eec5273'],
      'icons/normal/monitor.webp': ['43af8f05'],
      'icons/normal/pmu.webp': ['604052e9'],
      'icons/normal/breaker.webp': ['d8437c4', '56d825e'],
      'icons/normal/combiner_unit.webp': ['6f162e', 'fb67601'],
      'icons/normal/intelligent_terminal.webp': ['86fe909', '7569a21'],
      'icons/normal/transformer.webp': ['142a4d7', 'dce0bda', '3cef2d22', '7757ec27'],
    },
    titleBackgroundPenIds: ['5480660', 'ded09c8', '7f78202', '3a3edab8', 'd5a6791', '3cfda83'],
    processNodePenIds: ['e1810d0', '362566e', '21d2d515', '481980ce', 'aa660a3', '39303ead'],
  })],
])

/** 严格按版本读取资源清单；缺项立即报错，禁止回退或混用其他场景资源。 */
export function getConverterStationTopologyResourceManifest(
  variantId: ConverterStationTopologyVariantId,
): ConverterStationTopologyResourceManifest {
  const manifest = RESOURCE_MANIFEST_BY_VARIANT_ID.get(variantId)
  if (!manifest) throw new Error(`换流站拓扑版本缺少资源清单：${variantId}`)
  return manifest
}

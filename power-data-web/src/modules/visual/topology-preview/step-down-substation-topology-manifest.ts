import type { StepDownSubstationTopologyVariantId } from './step-down-substation-topology-variant-manifest'

/**
 * 降压站资源清单把旧图片键映射到按图元类型核对的新公共四态图标。
 * 当前场景没有登记实时设备节点绑定，所以静态图元只显示正常图标，不按设备名称推断状态。
 */
export interface StepDownSubstationTopologyResourceManifest {
  readonly staticImagePathByPenId: ReadonlyMap<string, string>
  readonly devicePenIds: ReadonlySet<string>
  readonly titleBackgroundPenIds: ReadonlySet<string>
  readonly processNodePenIds: ReadonlySet<string>
}

interface ResourceManifestSource {
  readonly staticImagePenIdsByPath: Readonly<Record<string, readonly string[]>>
  readonly titleBackgroundPenIds: readonly string[]
  /** 只登记源文件中有明确编号且可作为连线端点的工艺流程节点。 */
  readonly processNodePenIds?: readonly string[]
}

/**
 * 把人工核对后的“公共路径到图元编号集合”压平为常数时间索引。
 * 相同动态图片只保存一次路径，避免八份变体重复大字符串和公共资源副本。
 */
function createResourceManifest(source: ResourceManifestSource): StepDownSubstationTopologyResourceManifest {
  const staticImagePathByPenId = new Map<string, string>()
  for (const [path, penIds] of Object.entries(source.staticImagePenIdsByPath)) {
    for (const penId of penIds) staticImagePathByPenId.set(penId, path)
  }
  return Object.freeze({
    staticImagePathByPenId,
    devicePenIds: new Set(staticImagePathByPenId.keys()),
    titleBackgroundPenIds: new Set(source.titleBackgroundPenIds),
    // 只使用逐文件人工核对后的显式编号，禁止在运行时按文字或坐标猜测。
    processNodePenIds: new Set(source.processNodePenIds ?? []),
  })
}

/** 每个版本只登记自身图元编号；跨文件编号不会复用。 */
const RESOURCE_MANIFEST_BY_VARIANT_ID = new Map<
  StepDownSubstationTopologyVariantId,
  StepDownSubstationTopologyResourceManifest
>([
  ['architecture', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/mutual_transformer.webp': ['8d687e1'],
      'icons/normal/desktop.webp': ['1173d51', '529f13ee', '123ce65', '3a4eea8', '7035a7b4', 'a5a5ebe'],
      'icons/normal/clock.webp': ['c9a177'],
      'icons/normal/server.webp': ['8653b65', '45f711d'],
      'icons/normal/firewall.webp': ['cbf50ce', '497484d', 'b93b6', '4fc9b61'],
      'icons/normal/protection.webp': ['5b87c90', '11ed67d4'],
      'icons/normal/instrument.webp': ['54d935f'],
      'icons/normal/dual_router.webp': ['1d228e2a', '433f5c', '70543ea4'],
      'icons/normal/remote_terminal.webp': ['f8ee726'],
      'icons/normal/monitor.webp': ['812ff71'],
      'icons/normal/pmu.webp': ['c07e68a'],
      'icons/normal/breaker.webp': ['1b677589'],
      'icons/normal/combiner_unit.webp': ['5f3e6cb6'],
      'icons/normal/intelligent_terminal.webp': ['bf36aef'],
      'icons/normal/transformer.webp': ['4c239731'],
    },
    titleBackgroundPenIds: ['74a4ff32', '4d551d2', 'ac4305e', '25ec7ff', '6da597c8', '6c3ef1ec'],
  })],
  ['network', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/desktop.webp': ['655d6848', '06e8755', '73a16283', '606a07b7', '87bb633', 'b6ede9d'],
      'icons/normal/clock.webp': ['60afd65e'],
      'icons/normal/server.webp': ['d6787a8', '2dc974b2'],
      'icons/normal/firewall.webp': ['3ea4fb78', '74608d', 'f78e34', '43726b0d'],
      'icons/normal/protection.webp': ['46be79b2', '74daf9c7', 'a16bf10'],
      'icons/normal/instrument.webp': ['40e39ff', '14434136'],
      'icons/normal/dual_router.webp': ['03b885', '3c4e62e9', 'ef57089'],
      'icons/normal/remote_terminal.webp': ['b59a1af'],
      'icons/normal/monitor.webp': ['6ad703b2'],
      'icons/normal/pmu.webp': ['309cbd3'],
      'icons/normal/combiner_unit.webp': ['8a71883', '29d7b32'],
      'icons/normal/intelligent_terminal.webp': ['3fa44503', '60b39f89'],
    },
    titleBackgroundPenIds: ['45687d7', '2dc62f8', '28d358a', '7c18fd41', '73eef66c', '57f27b07'],
  })],
  ['business', createResourceManifest({
    staticImagePenIdsByPath: {},
    titleBackgroundPenIds: ['f26aaf8', '53f82dfc', 'a808d1', 'ac47899', 'b3afa08', '5a90c84'],
  })],
  ['key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/mutual_transformer.webp': ['4f0557c5', '263759bd'],
      'icons/normal/protection.webp': ['61a4dc09', '4c564407'],
      'icons/normal/instrument.webp': ['7e3f840b', 'c6e09d8'],
      'icons/normal/breaker.webp': ['1940151b', '4d688931'],
      'icons/normal/combiner_unit.webp': ['70d009ac', 'e412df8'],
      'icons/normal/intelligent_terminal.webp': ['7717a17', '305e7b'],
      'icons/normal/transformer.webp': ['68a92b6c', '770036'],
    },
    titleBackgroundPenIds: ['35390fae', '16d1a725', '292e9813', 'f2a3166', '2137e80', '4056c4c'],
  })],
  ['network-business', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/desktop.webp': ['4e4e40b4', '38292bd', '406ee394', 'ecb112d', 'db349eb', '561618d6'],
      'icons/normal/clock.webp': ['6ad6fa42'],
      'icons/normal/server.webp': ['d7e4eda', '2a7d5a08'],
      'icons/normal/firewall.webp': ['da2c9f7', '326b1e2', '5cf6bd80', '6b3a4a25'],
      'icons/normal/protection.webp': ['fa79c44', 'a6511c3', 'db6141b'],
      'icons/normal/instrument.webp': ['b00df55', '10e628dd'],
      'icons/normal/dual_router.webp': ['c361b0', 'a6381e5', '1f0c5e95'],
      'icons/normal/remote_terminal.webp': ['3ae55cfe'],
      'icons/normal/monitor.webp': ['629eef5c'],
      'icons/normal/pmu.webp': ['12d1dba2'],
      'icons/normal/combiner_unit.webp': ['41058e87', '30acef2d'],
      'icons/normal/intelligent_terminal.webp': ['22ccc7c', '76fbbbb2'],
    },
    titleBackgroundPenIds: ['36665978', '21d2846', '3b8f1f9a', '192ebda8', 'da0fc4d', '753c89df'],
  })],
  ['network-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/mutual_transformer.webp': ['0bf74f9', 'fc88cdf'],
      'icons/normal/desktop.webp': ['38a882b', '51317b2f', 'dccee8a', 'b9c8e98', '1396d149', 'fc9c17'],
      'icons/normal/clock.webp': ['b675df2'],
      'icons/normal/server.webp': ['788f795f', '176094c8'],
      'icons/normal/firewall.webp': ['a15fdb9', '87f53d', '4b60f6fd', '7a0fedc5'],
      'icons/normal/protection.webp': ['7acc7bc4', '2c805a80', '97b3e90'],
      'icons/normal/instrument.webp': ['d5465e1', 'a032f60'],
      'icons/normal/dual_router.webp': ['fbb601d', 'fed43d0', '85e5250'],
      'icons/normal/remote_terminal.webp': ['bd00791'],
      'icons/normal/monitor.webp': ['4d4b7bc1'],
      'icons/normal/pmu.webp': ['5b98ef3f'],
      'icons/normal/breaker.webp': ['e0013ff', '94a825b'],
      'icons/normal/combiner_unit.webp': ['583c7af3', 'f8edbe7'],
      'icons/normal/intelligent_terminal.webp': ['e7078c', 'ab42b6c'],
      'icons/normal/transformer.webp': ['5873df', '49473c9'],
    },
    titleBackgroundPenIds: ['4f2d766e', '1969a61', '6a4a22e', '67aa1d06', '6547c5d6', 'f9a3675'],
  })],
  ['business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/mutual_transformer.webp': ['acf3d1', '59ba7ca4'],
      'icons/normal/protection.webp': ['2c3ac67', '6dfae588'],
      'icons/normal/instrument.webp': ['680d2e39', '1100064a'],
      'icons/normal/breaker.webp': ['1264385d', '5f5286a'],
      'icons/normal/combiner_unit.webp': ['313f08d', '160401d'],
      'icons/normal/intelligent_terminal.webp': ['60f2b9ad', '6a09b115'],
      'icons/normal/transformer.webp': ['bb2a0a3', '1a22aca'],
    },
    titleBackgroundPenIds: ['3839d8bd', '76ae525e', '2fda360', '7976958c', '6ca92192', 'ab80818'],
  })],
  ['network-business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/mutual_transformer.webp': ['35598cd', 'b54dd30'],
      'icons/normal/desktop.webp': ['20f179', '23de0dbf', '44c07203', '9475021', '6b74054a', 'a237bf8'],
      'icons/normal/clock.webp': ['249b45a3'],
      'icons/normal/server.webp': ['ea8e83b', '9d334fe'],
      'icons/normal/firewall.webp': ['1f9452ef', 'eaa1096', '17e649f3', 'e01edf1'],
      'icons/normal/protection.webp': ['1e663d0', '38653c0', 'a88dc8'],
      'icons/normal/instrument.webp': ['4e50604', 'aa56328'],
      'icons/normal/dual_router.webp': ['2c5dfdcf', '7ea1aa3d', '3fdd0ac5'],
      'icons/normal/remote_terminal.webp': ['ecd48c5'],
      'icons/normal/monitor.webp': ['2bb4c61f'],
      'icons/normal/pmu.webp': ['7ee383f'],
      'icons/normal/breaker.webp': ['1c9afaea', 'cc43205'],
      'icons/normal/combiner_unit.webp': ['bc655b6', '7f9a6d3e'],
      'icons/normal/intelligent_terminal.webp': ['5b6225c0', '11814c6d'],
      'icons/normal/transformer.webp': ['244aced6', '394405c6'],
    },
    titleBackgroundPenIds: ['43680d4', 'cec4671', '64b13e8a', '27284706', 'a2dea5e', '7f00e0dc'],
    processNodePenIds: ['4506becc', '2177e17', '05648b0', '13f5bae', 'a7e37a7', 'e203064'],
  })],
])

/** 严格按版本编号读取资源清单；缺项直接报错，不回退到默认文件。 */
export function getStepDownSubstationTopologyResourceManifest(
  variantId: StepDownSubstationTopologyVariantId,
): StepDownSubstationTopologyResourceManifest {
  const manifest = RESOURCE_MANIFEST_BY_VARIANT_ID.get(variantId)
  if (!manifest) throw new Error(`降压站拓扑版本缺少资源清单：${variantId}`)
  return manifest
}

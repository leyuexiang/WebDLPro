import type { StepDownSubstationTopologyVariantId } from './step-down-substation-topology-variant-manifest'

/**
 * 降压站资源清单只包含源包实际引用并经 256 位安全散列去重的公共动态图片。
 * 源包未提供四态成套图片，因此这些设备保持静态预览资源，不伪造状态目录映射。
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
      'icons/static/8d0315d77f6a8912efa50b79ed1e4ac44d276d699a9fd722ac76412e89bb6bd3.webp': ['8d687e1'],
      'icons/normal/desktop.webp': ['1173d51', '529f13ee', '123ce65', '3a4eea8', '7035a7b4', 'a5a5ebe'],
      'icons/static/fc0d7f043c577c6c378f47d2dbdebba016d21fe1080819ffae5f14d4a7416a0d.webp': ['c9a177'],
      'icons/normal/server.webp': ['8653b65', '45f711d'],
      'icons/normal/firewall.webp': ['cbf50ce', '497484d', 'b93b6', '4fc9b61'],
      'icons/normal/protection.webp': ['5b87c90', '11ed67d4'],
      'icons/static/f6ce2eb85bb851727eb46af15e165bd4dc0c3d718b251ddf3dad5d59d546ca4a.webp': ['54d935f'],
      'icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp': ['1d228e2a', '433f5c', '70543ea4'],
      'icons/static/3c55a879863799ca393401c68510aca17af14fdff71e330d1300e7ca5567e5fa.webp': ['f8ee726'],
      'icons/static/daf2fb1b44161fe4932687c9c6b6506bc5c31d7a4ed899070c8844cac9cccda2.webp': ['812ff71'],
      'icons/static/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['c07e68a'],
      'icons/static/86f82e4489853e4ee9eb849071eb8d3d8f34de00b771ba6615a43fb0da1b204c.webp': ['1b677589'],
      'icons/static/33c45e58ffbc78349129843cc7619e5a831aa08ac8175370f7f131d290ebf5b3.webp': ['5f3e6cb6'],
      'icons/static/194a1218e43f8e81192c29054a52f65edeca7b517aaaf7bad21a0c9739f2a33f.webp': ['bf36aef'],
      'icons/normal/transformer.webp': ['4c239731'],
    },
    titleBackgroundPenIds: ['74a4ff32', '4d551d2', 'ac4305e', '25ec7ff', '6da597c8', '6c3ef1ec'],
  })],
  ['network', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/desktop.webp': ['655d6848', '06e8755', '73a16283', '606a07b7', '87bb633', 'b6ede9d'],
      'icons/static/fc0d7f043c577c6c378f47d2dbdebba016d21fe1080819ffae5f14d4a7416a0d.webp': ['60afd65e'],
      'icons/normal/server.webp': ['d6787a8', '2dc974b2'],
      'icons/normal/firewall.webp': ['3ea4fb78', '74608d', 'f78e34', '43726b0d'],
      'icons/normal/protection.webp': ['46be79b2', '74daf9c7', 'a16bf10'],
      'icons/static/f6ce2eb85bb851727eb46af15e165bd4dc0c3d718b251ddf3dad5d59d546ca4a.webp': ['40e39ff', '14434136'],
      'icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp': ['03b885', '3c4e62e9', 'ef57089'],
      'icons/static/3c55a879863799ca393401c68510aca17af14fdff71e330d1300e7ca5567e5fa.webp': ['b59a1af'],
      'icons/static/daf2fb1b44161fe4932687c9c6b6506bc5c31d7a4ed899070c8844cac9cccda2.webp': ['6ad703b2'],
      'icons/static/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['309cbd3'],
      'icons/static/33c45e58ffbc78349129843cc7619e5a831aa08ac8175370f7f131d290ebf5b3.webp': ['8a71883', '29d7b32'],
      'icons/static/194a1218e43f8e81192c29054a52f65edeca7b517aaaf7bad21a0c9739f2a33f.webp': ['3fa44503', '60b39f89'],
    },
    titleBackgroundPenIds: ['45687d7', '2dc62f8', '28d358a', '7c18fd41', '73eef66c', '57f27b07'],
  })],
  ['business', createResourceManifest({
    staticImagePenIdsByPath: {},
    titleBackgroundPenIds: ['f26aaf8', '53f82dfc', 'a808d1', 'ac47899', 'b3afa08', '5a90c84'],
  })],
  ['key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/static/8d0315d77f6a8912efa50b79ed1e4ac44d276d699a9fd722ac76412e89bb6bd3.webp': ['4f0557c5', '263759bd'],
      'icons/normal/protection.webp': ['61a4dc09', '4c564407'],
      'icons/static/f6ce2eb85bb851727eb46af15e165bd4dc0c3d718b251ddf3dad5d59d546ca4a.webp': ['7e3f840b', 'c6e09d8'],
      'icons/static/86f82e4489853e4ee9eb849071eb8d3d8f34de00b771ba6615a43fb0da1b204c.webp': ['1940151b', '4d688931'],
      'icons/static/33c45e58ffbc78349129843cc7619e5a831aa08ac8175370f7f131d290ebf5b3.webp': ['70d009ac', 'e412df8'],
      'icons/static/194a1218e43f8e81192c29054a52f65edeca7b517aaaf7bad21a0c9739f2a33f.webp': ['7717a17', '305e7b'],
      'icons/normal/transformer.webp': ['68a92b6c', '770036'],
    },
    titleBackgroundPenIds: ['35390fae', '16d1a725', '292e9813', 'f2a3166', '2137e80', '4056c4c'],
  })],
  ['network-business', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/desktop.webp': ['4e4e40b4', '38292bd', '406ee394', 'ecb112d', 'db349eb', '561618d6'],
      'icons/static/fc0d7f043c577c6c378f47d2dbdebba016d21fe1080819ffae5f14d4a7416a0d.webp': ['6ad6fa42'],
      'icons/normal/server.webp': ['d7e4eda', '2a7d5a08'],
      'icons/normal/firewall.webp': ['da2c9f7', '326b1e2', '5cf6bd80', '6b3a4a25'],
      'icons/normal/protection.webp': ['fa79c44', 'a6511c3', 'db6141b'],
      'icons/static/f6ce2eb85bb851727eb46af15e165bd4dc0c3d718b251ddf3dad5d59d546ca4a.webp': ['b00df55', '10e628dd'],
      'icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp': ['c361b0', 'a6381e5', '1f0c5e95'],
      'icons/static/3c55a879863799ca393401c68510aca17af14fdff71e330d1300e7ca5567e5fa.webp': ['3ae55cfe'],
      'icons/static/daf2fb1b44161fe4932687c9c6b6506bc5c31d7a4ed899070c8844cac9cccda2.webp': ['629eef5c'],
      'icons/static/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['12d1dba2'],
      'icons/static/33c45e58ffbc78349129843cc7619e5a831aa08ac8175370f7f131d290ebf5b3.webp': ['41058e87', '30acef2d'],
      'icons/static/194a1218e43f8e81192c29054a52f65edeca7b517aaaf7bad21a0c9739f2a33f.webp': ['22ccc7c', '76fbbbb2'],
    },
    titleBackgroundPenIds: ['36665978', '21d2846', '3b8f1f9a', '192ebda8', 'da0fc4d', '753c89df'],
  })],
  ['network-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/static/8d0315d77f6a8912efa50b79ed1e4ac44d276d699a9fd722ac76412e89bb6bd3.webp': ['0bf74f9', 'fc88cdf'],
      'icons/normal/desktop.webp': ['38a882b', '51317b2f', 'dccee8a', 'b9c8e98', '1396d149', 'fc9c17'],
      'icons/static/fc0d7f043c577c6c378f47d2dbdebba016d21fe1080819ffae5f14d4a7416a0d.webp': ['b675df2'],
      'icons/normal/server.webp': ['788f795f', '176094c8'],
      'icons/normal/firewall.webp': ['a15fdb9', '87f53d', '4b60f6fd', '7a0fedc5'],
      'icons/normal/protection.webp': ['7acc7bc4', '2c805a80', '97b3e90'],
      'icons/static/f6ce2eb85bb851727eb46af15e165bd4dc0c3d718b251ddf3dad5d59d546ca4a.webp': ['d5465e1', 'a032f60'],
      'icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp': ['fbb601d', 'fed43d0', '85e5250'],
      'icons/static/3c55a879863799ca393401c68510aca17af14fdff71e330d1300e7ca5567e5fa.webp': ['bd00791'],
      'icons/static/daf2fb1b44161fe4932687c9c6b6506bc5c31d7a4ed899070c8844cac9cccda2.webp': ['4d4b7bc1'],
      'icons/static/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['5b98ef3f'],
      'icons/static/86f82e4489853e4ee9eb849071eb8d3d8f34de00b771ba6615a43fb0da1b204c.webp': ['e0013ff', '94a825b'],
      'icons/static/33c45e58ffbc78349129843cc7619e5a831aa08ac8175370f7f131d290ebf5b3.webp': ['583c7af3', 'f8edbe7'],
      'icons/static/194a1218e43f8e81192c29054a52f65edeca7b517aaaf7bad21a0c9739f2a33f.webp': ['e7078c', 'ab42b6c'],
      'icons/normal/transformer.webp': ['5873df', '49473c9'],
    },
    titleBackgroundPenIds: ['4f2d766e', '1969a61', '6a4a22e', '67aa1d06', '6547c5d6', 'f9a3675'],
  })],
  ['business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/static/8d0315d77f6a8912efa50b79ed1e4ac44d276d699a9fd722ac76412e89bb6bd3.webp': ['acf3d1', '59ba7ca4'],
      'icons/normal/protection.webp': ['2c3ac67', '6dfae588'],
      'icons/static/f6ce2eb85bb851727eb46af15e165bd4dc0c3d718b251ddf3dad5d59d546ca4a.webp': ['680d2e39', '1100064a'],
      'icons/static/86f82e4489853e4ee9eb849071eb8d3d8f34de00b771ba6615a43fb0da1b204c.webp': ['1264385d', '5f5286a'],
      'icons/static/33c45e58ffbc78349129843cc7619e5a831aa08ac8175370f7f131d290ebf5b3.webp': ['313f08d', '160401d'],
      'icons/static/194a1218e43f8e81192c29054a52f65edeca7b517aaaf7bad21a0c9739f2a33f.webp': ['60f2b9ad', '6a09b115'],
      'icons/normal/transformer.webp': ['bb2a0a3', '1a22aca'],
    },
    titleBackgroundPenIds: ['3839d8bd', '76ae525e', '2fda360', '7976958c', '6ca92192', 'ab80818'],
  })],
  ['network-business-key-process', createResourceManifest({
    // 2026-10-21 最新三层图：仅登记本次源 JSON 实际出现的图元编号，避免旧编号继续进入打包。
    staticImagePenIdsByPath: {
      'icons/normal/firewall.webp': ['54f814', '20a5ce8', '128b0566', '3e8a613'],
      'icons/normal/desktop.webp': ['3f1fe248', '2ff1ce8', '7288fd2', 'dada728', '6992eceb', 'e9e975', '22434eaf'],
      'icons/normal/protection.webp': ['6fd12ae', 'ba7f628', '53f3d7cb', '3935f07', '75fc187', 'f8fe6cd', '356e332', '46b3d33'],
      'icons/normal/server.webp': ['ebfb9e0', 'd42182'],
      'icons/static/fc0d7f043c577c6c378f47d2dbdebba016d21fe1080819ffae5f14d4a7416a0d.webp': ['52d11b8f'],
      'icons/static/3c55a879863799ca393401c68510aca17af14fdff71e330d1300e7ca5567e5fa.webp': ['7c16227a'],
      'icons/static/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['6a041f9f'],
      'icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp': ['29db69', '6adf46c4', '3e35d270'],
      'icons/static/8d0315d77f6a8912efa50b79ed1e4ac44d276d699a9fd722ac76412e89bb6bd3.webp': ['1c61f472', '5d78e39'],
      'icons/static/86f82e4489853e4ee9eb849071eb8d3d8f34de00b771ba6615a43fb0da1b204c.webp': ['d1c4ea5', '1ffdedd'],
      'icons/normal/transformer.webp': ['4f2c9f16', '4967f9'],
    },
    titleBackgroundPenIds: ['7f00e0dc', '77f792c', '0fac1e2', '6cd9f4db', 'f1f9fa'],
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

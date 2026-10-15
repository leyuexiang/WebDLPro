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
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['8d687e1'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['1173d51', '529f13ee', '123ce65', '3a4eea8', '7035a7b4', 'a5a5ebe'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['c9a177'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['8653b65', '45f711d'],
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['cbf50ce', '497484d', 'b93b6', '4fc9b61'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['5b87c90', '11ed67d4'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['54d935f'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['1d228e2a', '433f5c', '70543ea4'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['f8ee726'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['812ff71'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['c07e68a'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['1b677589'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['5f3e6cb6'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['bf36aef'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['4c239731'],
    },
    titleBackgroundPenIds: ['74a4ff32', '4d551d2', 'ac4305e', '25ec7ff', '6da597c8', '6c3ef1ec'],
  })],
  ['network', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['655d6848', '06e8755', '73a16283', '606a07b7', '87bb633', 'b6ede9d'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['60afd65e'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['d6787a8', '2dc974b2'],
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['3ea4fb78', '74608d', 'f78e34', '43726b0d'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['46be79b2', '74daf9c7', 'a16bf10'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['40e39ff', '14434136'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['03b885', '3c4e62e9', 'ef57089'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['b59a1af'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['6ad703b2'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['309cbd3'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['8a71883', '29d7b32'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['3fa44503', '60b39f89'],
    },
    titleBackgroundPenIds: ['45687d7', '2dc62f8', '28d358a', '7c18fd41', '73eef66c', '57f27b07'],
  })],
  ['business', createResourceManifest({
    staticImagePenIdsByPath: {},
    titleBackgroundPenIds: ['f26aaf8', '53f82dfc', 'a808d1', 'ac47899', 'b3afa08', '5a90c84'],
  })],
  ['key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['4f0557c5', '263759bd'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['61a4dc09', '4c564407'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['7e3f840b', 'c6e09d8'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['1940151b', '4d688931'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['70d009ac', 'e412df8'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['7717a17', '305e7b'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['68a92b6c', '770036'],
    },
    titleBackgroundPenIds: ['35390fae', '16d1a725', '292e9813', 'f2a3166', '2137e80', '4056c4c'],
  })],
  ['network-business', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['4e4e40b4', '38292bd', '406ee394', 'ecb112d', 'db349eb', '561618d6'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['6ad6fa42'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['d7e4eda', '2a7d5a08'],
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['da2c9f7', '326b1e2', '5cf6bd80', '6b3a4a25'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['fa79c44', 'a6511c3', 'db6141b'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['b00df55', '10e628dd'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['c361b0', 'a6381e5', '1f0c5e95'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['3ae55cfe'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['629eef5c'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['12d1dba2'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['41058e87', '30acef2d'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['22ccc7c', '76fbbbb2'],
    },
    titleBackgroundPenIds: ['36665978', '21d2846', '3b8f1f9a', '192ebda8', 'da0fc4d', '753c89df'],
  })],
  ['network-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['0bf74f9', 'fc88cdf'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['38a882b', '51317b2f', 'dccee8a', 'b9c8e98', '1396d149', 'fc9c17'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['b675df2'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['788f795f', '176094c8'],
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['a15fdb9', '87f53d', '4b60f6fd', '7a0fedc5'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['7acc7bc4', '2c805a80', '97b3e90'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['d5465e1', 'a032f60'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['fbb601d', 'fed43d0', '85e5250'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['bd00791'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['4d4b7bc1'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['5b98ef3f'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['e0013ff', '94a825b'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['583c7af3', 'f8edbe7'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['e7078c', 'ab42b6c'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['5873df', '49473c9'],
    },
    titleBackgroundPenIds: ['4f2d766e', '1969a61', '6a4a22e', '67aa1d06', '6547c5d6', 'f9a3675'],
  })],
  ['business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['acf3d1', '59ba7ca4'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['2c3ac67', '6dfae588'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['680d2e39', '1100064a'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['1264385d', '5f5286a'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['313f08d', '160401d'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['60f2b9ad', '6a09b115'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['bb2a0a3', '1a22aca'],
    },
    titleBackgroundPenIds: ['3839d8bd', '76ae525e', '2fda360', '7976958c', '6ca92192', 'ab80818'],
  })],
  ['network-business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['35598cd', 'b54dd30'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['20f179', '23de0dbf', '44c07203', '9475021', '6b74054a', 'a237bf8'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['249b45a3'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['ea8e83b', '9d334fe'],
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['1f9452ef', 'eaa1096', '17e649f3', 'e01edf1'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['1e663d0', '38653c0', 'a88dc8'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['4e50604', 'aa56328'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['2c5dfdcf', '7ea1aa3d', '3fdd0ac5'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['ecd48c5'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['2bb4c61f'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['7ee383f'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['1c9afaea', 'cc43205'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['bc655b6', '7f9a6d3e'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['5b6225c0', '11814c6d'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['244aced6', '394405c6'],
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

import type { ConverterStationTopologyVariantId } from './converter-station-topology-variant-manifest'

/**
 * 换流站资源清单只登记源包实际引用并经 256 位安全散列核验的公共图片。
 * 源资料没有提供完整四态资源和业务节点映射，因此仅保留预览默认态，不按标题猜测绑定。
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
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['1493ece'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['e4e1acf', '495ae47f', '0f86312', '2d5c43d', '5ebedc4', 'be79f21'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['e191348'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['a45da0e', '39c8ed1'],
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['747d22ee', '11ddd07a', '162ab427', '4134a4c9'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['1b10c19', '58b8c70', '6f9481fa'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['d9d34cd'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['4449a556', '3539a04b', '64e96d0e'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['3f34a374'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['ed896ac'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['69d29ce7'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['3123d4e9'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['76e638f'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['6f0c3120'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['5b54f5a5', '25a33904'],
    },
    titleBackgroundPenIds: ['a5972e8', 'e8e2371', '6f68eeb0', 'ab53dc6', '4dd63e73', '4754690'],
    processNodePenIds: ['7604607d', '605320f2', '2b890f42', '747d9f4b', '6a8755d', '5d948092'],
  })],
  ['network', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['1f124c2e', 'ba4eff', '1e96e215', '2269c0a', 'de84de5', '0cf31f6'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['50a9578'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['7dd877bf', '1ead1d1c'],
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['448eac21', '5d622b2c', '492868a8', 'bd6efbc'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['596ad0f4', '37d50467', '27387af8', '4c07da', '388caef5'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['ea95866', '5d212d0b'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['6b9fe24c', '8265bc3', '5cd3c0d7'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['fc0d685'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['2001aab'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['ee10a1b'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['c5aa5e5', '60e0e4a4'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['690adf5', 'a97d9b1'],
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
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['44acea', '26170cba'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['10a6c303', '348ed432', '56898748', '69c06114'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['a193a8', '2fcaf4'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['be926de', 'ab2fe3b'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['4dc2d6b6', '657f401'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['73ab314', '30ebcc98'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['6bfc5fec', '2ed3ecd9', '380f8dec', '6b28e311'],
    },
    titleBackgroundPenIds: ['fecad47', '5acaad21', '71ccde2', '1bc8c9c4', 'c4544e3', 'a2f52a8'],
  })],
  ['network-business', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['1374daaf', '904e999', '92a569a', '7f6ab25f', '2a765cc', '7d38faab'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['4011b97'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['65f1383d', 'db228b8'],
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['ae96a3a', '98fe2e5', '1a919af9', '641a88c'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['3612ca14', 'e21507c', '0398fc5', 'c5c28fd', 'e57af10'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['1a2db2ec', 'a2acfa1'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['b120879', '37eb74c', '27698bba'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['8f6974a'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['76012753'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['06b6260'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['1ce8f616', '92f5bf1'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['98f8ec9', '756976c8'],
    },
    titleBackgroundPenIds: ['4aca498', '128ce5c9', '4d56fcd', '3fc05cf', '83120e1', '63c5aea6'],
    processNodePenIds: ['b49e529', '150357cc', '7354abc', '20425bd7', '7acc314e', 'e93c896'],
  })],
  ['network-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['25c07b3', '4520535e'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['619d25', 'b09cfa5', '1997e737', '44240c4d', 'ff238dd', '6fec7902'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['8f58aff'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['7b799f2', '7765aeee'],
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['7ca40646', '4cef7083', 'c557203', '9a4e2d7'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['100e67b', '591f49d', '26b29d1', 'db39b86', '2604c497'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['37017063', '73df224'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['777df84', '7cd4fd9', 'c1c7eb2'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['7ffad1ac'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['ffadd3a'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['4eefc830'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['4b25188', '6d6f12cf'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['e10112e', '686b6788'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['cf049c5', '3ee0d41b'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['762744', '2a638b5e', '6615c7f', '555182af'],
    },
    titleBackgroundPenIds: ['316e3aa4', 'bca92ba', '887d15', '6ae11eb', '623821d1', '1a3ee74'],
  })],
  ['business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['5d737b0', 'cfe0259'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['620b00f', '7ea6c9f4', 'ab5843e', '78cf8450'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['f5c53', '1ecf12bf'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['1297850c', '615c4de'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['9814d9a', '29ee8afb'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['2eeca5c', '643e248e'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['059e33b', '4b9b8b8', '2c188b08', '1bb9d658'],
    },
    titleBackgroundPenIds: ['1398fe9c', '1e97a57', '50d30326', '2cc1b06', '0080878', '960673c'],
    processNodePenIds: ['5267b93a', '2b017e', '5bef0f7', 'a895262', '5495baf3', '1e1525bb'],
  })],
  ['network-business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['04f9d7c', '2cdbfb76'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['84e3b8a', 'a48f9b0', '80ef1db', '31ed3025', 'a71dc2a', 'ab5fac7'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['5dacbd3a'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['628b9c4e', 'c32d282'],
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['3ec3448a', '297fe33', '4f3bec0', 'cb521c3'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['3ab0c8da', '79d97146', '6b3b68c5', '84ec315', '2be587e9'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['ec686db', '08c0355'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['7c4d7358', '4015205', '3e2de874'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['eec5273'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['43af8f05'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['604052e9'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['d8437c4', '56d825e'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['6f162e', 'fb67601'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['86fe909', '7569a21'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['142a4d7', 'dce0bda', '3cef2d22', '7757ec27'],
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

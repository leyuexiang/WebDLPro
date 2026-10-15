import type { SwitchingStationTopologyVariantId } from './switching-station-topology-variant-manifest'

/** 开关站只登记源包实际引用并经安全散列核验的公共图片；源资料未提供四态或三维绑定。 */
export interface SwitchingStationTopologyResourceManifest { readonly staticImagePathByPenId: ReadonlyMap<string, string>; readonly devicePenIds: ReadonlySet<string>; readonly titleBackgroundPenIds: ReadonlySet<string>; readonly processNodePenIds: ReadonlySet<string> }
interface ResourceManifestSource { readonly staticImagePenIdsByPath: Readonly<Record<string, readonly string[]>>; readonly titleBackgroundPenIds: readonly string[]; readonly processNodePenIds?: readonly string[] }
/** 模块初始化时一次构建常数时间索引，切层、悬浮和选择热路径不重复扫描图元。 */
function createResourceManifest(source: ResourceManifestSource): SwitchingStationTopologyResourceManifest { const staticImagePathByPenId = new Map<string, string>(); for (const [path, penIds] of Object.entries(source.staticImagePenIdsByPath)) for (const penId of penIds) staticImagePathByPenId.set(penId, path); return Object.freeze({ staticImagePathByPenId, devicePenIds: new Set(staticImagePathByPenId.keys()), titleBackgroundPenIds: new Set(source.titleBackgroundPenIds), processNodePenIds: new Set(source.processNodePenIds ?? []) }) }
/** 各变体只使用自身显式图元编号；禁止跨文件按标题、位置或数组序号推断。 */
const RESOURCE_MANIFEST_BY_VARIANT_ID = new Map<SwitchingStationTopologyVariantId, SwitchingStationTopologyResourceManifest>([
  ['architecture', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['1990437b', '0e5c27a', '6a5db5a8', 'b3388cf'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['4e60978d', 'e2c4d65', '2fd7b9', '8846868', '1d40c04', '731954d1'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['398a81ed'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['44cda1ae'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['2c29a51'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['ae39506', '86341a2'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['69798b83', 'c1d6c25'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['ebf270a', '7f9ee365', '5c9e07a8'],
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['9b7d8ab'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['6e0da0'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['18099364'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['467fd815'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['0b27419'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['6649c571'],
    },
    titleBackgroundPenIds: ['8afd1aa', '45c40cef', '8c844f6', '6e6bad4', '16f46270', '78020a3f'],
    processNodePenIds: ['ccbf8c7', '350a9853', '1be32ae', 'bfb6f69', '4cd94594'],
  })],
  ['network', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['1824a286', 'b291686', '420d6083', '6089fe64'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['08dc737', 'c90af41', '46e6ccc', '7674c195', '70c30d8', '961a81'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['a38c3ed', 'f4791f9', '73144b5e'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['1b7da779', 'cbcec19'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['dc43626', '4707716e'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['327a2442', '133b647b'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['2687a615', '34ad489b'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['eb525a9'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['436ef921'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['879d5c1'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['c670bc3'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['3fc9c5', '1ff75d1', 'b14c963'],
    },
    titleBackgroundPenIds: ['45aa5d0', 'bb6db85', 'd8f3260', '7d030ddf', '4f9cee5', '3ea2e4bb'],
  })],
  ['business', createResourceManifest({
    staticImagePenIdsByPath: {
    },
    titleBackgroundPenIds: ['6dc4296', '4962e90', 'cbcf391', '0128809', 'ac60669', 'fa56cd9'],
    processNodePenIds: ['3ae593aa', '651c8b3a', '7f295df7', '7f0027dd', '25b9f20'],
  })],
  ['key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['4c264eb2', '7d0b7fde'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['61b2448', '63efb0b'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['6a363ec2', '29ac6a42'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['6c37e48c', '6280cc7'],
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['01a69f9', '491d4b19'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['fd928e0', '82215ae'],
    },
    titleBackgroundPenIds: ['767509', '294cc5b2', 'ac5fd58', 'c4937bc', 'd52daa3', '6ccad97a'],
  })],
  ['network-business', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['1824a286', 'b291686', '420d6083', '6089fe64'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['08dc737', 'c90af41', '46e6ccc', '7674c195', '70c30d8', '961a81'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['a38c3ed', 'f4791f9', '73144b5e'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['1b7da779', 'cbcec19'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['dc43626', '4707716e'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['327a2442', '133b647b'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['2687a615', '34ad489b'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['eb525a9'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['436ef921'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['879d5c1'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['c670bc3'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['3fc9c5', '1ff75d1', 'b14c963'],
    },
    titleBackgroundPenIds: ['45aa5d0', 'bb6db85', 'd8f3260', '7d030ddf', '4f9cee5', '3ea2e4bb'],
    processNodePenIds: ['5ad9492c', '7c7823ff', '465fa66', 'ef00f20', '81c8378'],
  })],
  ['network-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['b42b7b', '1f0e2461', '1f7b8f7e', '30c20b5'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['6cd4e657', '44e6b405', 'caf503', '75a788ed', '5dd1840b', 'c279a7'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['d6d8c99', '26a5740', '784920c4'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['7459f619', 'c0830e'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['5e1e64d1', '4cc82ae5'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['c4846e2', '487e96da'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['6c4e0f1e', 'b4a6cb'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['3040f8ef'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['14b9f51f'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['d19844a'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['6c8b9443'],
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['0341e1', '5e3d90c4'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['4cd18674', '6a987833'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['5256f4d2', '76cff72', '6eb83994'],
    },
    titleBackgroundPenIds: ['1c5465af', '441c40b', '78c63e4', 'd4996', '376315e0', '73e5ec2a'],
  })],
  ['business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['ffa6b25', '18d0c'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['ed618c', '7804e01'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['73efcad5', 'e3340f2'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['41755491', '9e69d20'],
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['bbe000', '7b8ce34'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['5682136', '576c4331'],
    },
    titleBackgroundPenIds: ['6c7595', '1aa773ca', 'ccd95eb', '2167152', '35139e39', '1e99a8fc'],
    processNodePenIds: ['5a4dc527', '15feb2d8', '5483808c', 'e3fcf97', '00c9c49'],
  })],
  ['network-business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['768dd227', '22ce239a', '0715290', '3197cb3'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['b7613e', '5f17490c', '518529b5', '588f573', '743945f', '6ebf7d0a'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['52bf1ad', '303a5722', '3e447129'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['6fa15c9', '6f96d55'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['4d119e1', 'a15c0ee'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['afc6526', '6d05ed67'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['7fa019a4', '30bbce'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['0ec78c8'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['06eec8c'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['3be12f8'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['552f149'],
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['31f78f', '76d94ff'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['174032f3', '19b9d'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['2719257', '480f9693', '7a3b2ab'],
    },
    titleBackgroundPenIds: ['32219ab', 'f940b09', '56dff4a5', 'cb5b6ea', '2449ce7', 'f713f78'],
    processNodePenIds: ['1295d81', '9d03a58', '585702cc', '21042bf', 'a4374ee'],
  })],
])
/** 未登记变体立即失败，防止错误清单静默退化为全背景不可选。 */
export function getSwitchingStationTopologyResourceManifest(variantId: SwitchingStationTopologyVariantId): SwitchingStationTopologyResourceManifest { const manifest = RESOURCE_MANIFEST_BY_VARIANT_ID.get(variantId); if (!manifest) throw new Error(`开关站拓扑资源清单不存在：${variantId}`); return manifest }

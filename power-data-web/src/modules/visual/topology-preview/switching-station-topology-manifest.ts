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
      'icons/normal/firewall.webp': ['1990437b', '0e5c27a', '6a5db5a8', 'b3388cf'],
      'icons/normal/desktop.webp': ['4e60978d', 'e2c4d65', '2fd7b9', '8846868', '1d40c04', '731954d1'],
      'icons/static/f6ce2eb85bb851727eb46af15e165bd4dc0c3d718b251ddf3dad5d59d546ca4a.webp': ['398a81ed'],
      'icons/static/33c45e58ffbc78349129843cc7619e5a831aa08ac8175370f7f131d290ebf5b3.webp': ['44cda1ae'],
      'icons/static/194a1218e43f8e81192c29054a52f65edeca7b517aaaf7bad21a0c9739f2a33f.webp': ['2c29a51'],
      'icons/normal/protection.webp': ['ae39506', '86341a2'],
      'icons/normal/server.webp': ['69798b83', 'c1d6c25'],
      'icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp': ['ebf270a', '7f9ee365', '5c9e07a8'],
      'icons/static/8d0315d77f6a8912efa50b79ed1e4ac44d276d699a9fd722ac76412e89bb6bd3.webp': ['9b7d8ab'],
      'icons/static/86f82e4489853e4ee9eb849071eb8d3d8f34de00b771ba6615a43fb0da1b204c.webp': ['6e0da0'],
      'icons/static/3c55a879863799ca393401c68510aca17af14fdff71e330d1300e7ca5567e5fa.webp': ['18099364'],
      'icons/static/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['467fd815'],
      'icons/static/fc0d7f043c577c6c378f47d2dbdebba016d21fe1080819ffae5f14d4a7416a0d.webp': ['0b27419'],
      'icons/static/daf2fb1b44161fe4932687c9c6b6506bc5c31d7a4ed899070c8844cac9cccda2.webp': ['6649c571'],
    },
    titleBackgroundPenIds: ['8afd1aa', '45c40cef', '8c844f6', '6e6bad4', '16f46270', '78020a3f'],
    processNodePenIds: ['ccbf8c7', '350a9853', '1be32ae', 'bfb6f69', '4cd94594'],
  })],
  ['network', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/firewall.webp': ['1824a286', 'b291686', '420d6083', '6089fe64'],
      'icons/normal/desktop.webp': ['08dc737', 'c90af41', '46e6ccc', '7674c195', '70c30d8', '961a81'],
      'icons/normal/protection.webp': ['a38c3ed', 'f4791f9', '73144b5e'],
      'icons/static/f6ce2eb85bb851727eb46af15e165bd4dc0c3d718b251ddf3dad5d59d546ca4a.webp': ['1b7da779', 'cbcec19'],
      'icons/static/33c45e58ffbc78349129843cc7619e5a831aa08ac8175370f7f131d290ebf5b3.webp': ['dc43626', '4707716e'],
      'icons/static/194a1218e43f8e81192c29054a52f65edeca7b517aaaf7bad21a0c9739f2a33f.webp': ['327a2442', '133b647b'],
      'icons/normal/server.webp': ['2687a615', '34ad489b'],
      'icons/static/fc0d7f043c577c6c378f47d2dbdebba016d21fe1080819ffae5f14d4a7416a0d.webp': ['eb525a9'],
      'icons/static/3c55a879863799ca393401c68510aca17af14fdff71e330d1300e7ca5567e5fa.webp': ['436ef921'],
      'icons/static/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['879d5c1'],
      'icons/static/daf2fb1b44161fe4932687c9c6b6506bc5c31d7a4ed899070c8844cac9cccda2.webp': ['c670bc3'],
      'icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp': ['3fc9c5', '1ff75d1', 'b14c963'],
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
      'icons/static/f6ce2eb85bb851727eb46af15e165bd4dc0c3d718b251ddf3dad5d59d546ca4a.webp': ['4c264eb2', '7d0b7fde'],
      'icons/static/33c45e58ffbc78349129843cc7619e5a831aa08ac8175370f7f131d290ebf5b3.webp': ['61b2448', '63efb0b'],
      'icons/static/194a1218e43f8e81192c29054a52f65edeca7b517aaaf7bad21a0c9739f2a33f.webp': ['6a363ec2', '29ac6a42'],
      'icons/normal/protection.webp': ['6c37e48c', '6280cc7'],
      'icons/static/8d0315d77f6a8912efa50b79ed1e4ac44d276d699a9fd722ac76412e89bb6bd3.webp': ['01a69f9', '491d4b19'],
      'icons/static/86f82e4489853e4ee9eb849071eb8d3d8f34de00b771ba6615a43fb0da1b204c.webp': ['fd928e0', '82215ae'],
    },
    titleBackgroundPenIds: ['767509', '294cc5b2', 'ac5fd58', 'c4937bc', 'd52daa3', '6ccad97a'],
  })],
  ['network-business', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/firewall.webp': ['1824a286', 'b291686', '420d6083', '6089fe64'],
      'icons/normal/desktop.webp': ['08dc737', 'c90af41', '46e6ccc', '7674c195', '70c30d8', '961a81'],
      'icons/normal/protection.webp': ['a38c3ed', 'f4791f9', '73144b5e'],
      'icons/static/f6ce2eb85bb851727eb46af15e165bd4dc0c3d718b251ddf3dad5d59d546ca4a.webp': ['1b7da779', 'cbcec19'],
      'icons/static/33c45e58ffbc78349129843cc7619e5a831aa08ac8175370f7f131d290ebf5b3.webp': ['dc43626', '4707716e'],
      'icons/static/194a1218e43f8e81192c29054a52f65edeca7b517aaaf7bad21a0c9739f2a33f.webp': ['327a2442', '133b647b'],
      'icons/normal/server.webp': ['2687a615', '34ad489b'],
      'icons/static/fc0d7f043c577c6c378f47d2dbdebba016d21fe1080819ffae5f14d4a7416a0d.webp': ['eb525a9'],
      'icons/static/3c55a879863799ca393401c68510aca17af14fdff71e330d1300e7ca5567e5fa.webp': ['436ef921'],
      'icons/static/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['879d5c1'],
      'icons/static/daf2fb1b44161fe4932687c9c6b6506bc5c31d7a4ed899070c8844cac9cccda2.webp': ['c670bc3'],
      'icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp': ['3fc9c5', '1ff75d1', 'b14c963'],
    },
    titleBackgroundPenIds: ['45aa5d0', 'bb6db85', 'd8f3260', '7d030ddf', '4f9cee5', '3ea2e4bb'],
    processNodePenIds: ['5ad9492c', '7c7823ff', '465fa66', 'ef00f20', '81c8378'],
  })],
  ['network-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/firewall.webp': ['b42b7b', '1f0e2461', '1f7b8f7e', '30c20b5'],
      'icons/normal/desktop.webp': ['6cd4e657', '44e6b405', 'caf503', '75a788ed', '5dd1840b', 'c279a7'],
      'icons/normal/protection.webp': ['d6d8c99', '26a5740', '784920c4'],
      'icons/static/f6ce2eb85bb851727eb46af15e165bd4dc0c3d718b251ddf3dad5d59d546ca4a.webp': ['7459f619', 'c0830e'],
      'icons/static/33c45e58ffbc78349129843cc7619e5a831aa08ac8175370f7f131d290ebf5b3.webp': ['5e1e64d1', '4cc82ae5'],
      'icons/static/194a1218e43f8e81192c29054a52f65edeca7b517aaaf7bad21a0c9739f2a33f.webp': ['c4846e2', '487e96da'],
      'icons/normal/server.webp': ['6c4e0f1e', 'b4a6cb'],
      'icons/static/fc0d7f043c577c6c378f47d2dbdebba016d21fe1080819ffae5f14d4a7416a0d.webp': ['3040f8ef'],
      'icons/static/3c55a879863799ca393401c68510aca17af14fdff71e330d1300e7ca5567e5fa.webp': ['14b9f51f'],
      'icons/static/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['d19844a'],
      'icons/static/daf2fb1b44161fe4932687c9c6b6506bc5c31d7a4ed899070c8844cac9cccda2.webp': ['6c8b9443'],
      'icons/static/8d0315d77f6a8912efa50b79ed1e4ac44d276d699a9fd722ac76412e89bb6bd3.webp': ['0341e1', '5e3d90c4'],
      'icons/static/86f82e4489853e4ee9eb849071eb8d3d8f34de00b771ba6615a43fb0da1b204c.webp': ['4cd18674', '6a987833'],
      'icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp': ['5256f4d2', '76cff72', '6eb83994'],
    },
    titleBackgroundPenIds: ['1c5465af', '441c40b', '78c63e4', 'd4996', '376315e0', '73e5ec2a'],
  })],
  ['business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/static/f6ce2eb85bb851727eb46af15e165bd4dc0c3d718b251ddf3dad5d59d546ca4a.webp': ['ffa6b25', '18d0c'],
      'icons/static/33c45e58ffbc78349129843cc7619e5a831aa08ac8175370f7f131d290ebf5b3.webp': ['ed618c', '7804e01'],
      'icons/static/194a1218e43f8e81192c29054a52f65edeca7b517aaaf7bad21a0c9739f2a33f.webp': ['73efcad5', 'e3340f2'],
      'icons/normal/protection.webp': ['41755491', '9e69d20'],
      'icons/static/8d0315d77f6a8912efa50b79ed1e4ac44d276d699a9fd722ac76412e89bb6bd3.webp': ['bbe000', '7b8ce34'],
      'icons/static/86f82e4489853e4ee9eb849071eb8d3d8f34de00b771ba6615a43fb0da1b204c.webp': ['5682136', '576c4331'],
    },
    titleBackgroundPenIds: ['6c7595', '1aa773ca', 'ccd95eb', '2167152', '35139e39', '1e99a8fc'],
    processNodePenIds: ['5a4dc527', '15feb2d8', '5483808c', 'e3fcf97', '00c9c49'],
  })],
  ['network-business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/firewall.webp': ['768dd227', '22ce239a', '0715290', '3197cb3'],
      'icons/normal/desktop.webp': ['b7613e', '5f17490c', '518529b5', '588f573', '743945f', '6ebf7d0a'],
      'icons/normal/protection.webp': ['52bf1ad', '303a5722', '3e447129'],
      'icons/static/f6ce2eb85bb851727eb46af15e165bd4dc0c3d718b251ddf3dad5d59d546ca4a.webp': ['6fa15c9', '6f96d55'],
      'icons/static/33c45e58ffbc78349129843cc7619e5a831aa08ac8175370f7f131d290ebf5b3.webp': ['4d119e1', 'a15c0ee'],
      'icons/static/194a1218e43f8e81192c29054a52f65edeca7b517aaaf7bad21a0c9739f2a33f.webp': ['afc6526', '6d05ed67'],
      'icons/normal/server.webp': ['7fa019a4', '30bbce'],
      'icons/static/fc0d7f043c577c6c378f47d2dbdebba016d21fe1080819ffae5f14d4a7416a0d.webp': ['0ec78c8'],
      'icons/static/3c55a879863799ca393401c68510aca17af14fdff71e330d1300e7ca5567e5fa.webp': ['06eec8c'],
      'icons/static/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['3be12f8'],
      'icons/static/daf2fb1b44161fe4932687c9c6b6506bc5c31d7a4ed899070c8844cac9cccda2.webp': ['552f149'],
      'icons/static/8d0315d77f6a8912efa50b79ed1e4ac44d276d699a9fd722ac76412e89bb6bd3.webp': ['31f78f', '76d94ff'],
      'icons/static/86f82e4489853e4ee9eb849071eb8d3d8f34de00b771ba6615a43fb0da1b204c.webp': ['174032f3', '19b9d'],
      'icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp': ['2719257', '480f9693', '7a3b2ab'],
    },
    titleBackgroundPenIds: ['32219ab', 'f940b09', '56dff4a5', 'cb5b6ea', '2449ce7', 'f713f78'],
    processNodePenIds: ['1295d81', '9d03a58', '585702cc', '21042bf', 'a4374ee'],
  })],
])
/** 未登记变体立即失败，防止错误清单静默退化为全背景不可选。 */
export function getSwitchingStationTopologyResourceManifest(variantId: SwitchingStationTopologyVariantId): SwitchingStationTopologyResourceManifest { const manifest = RESOURCE_MANIFEST_BY_VARIANT_ID.get(variantId); if (!manifest) throw new Error(`开关站拓扑资源清单不存在：${variantId}`); return manifest }

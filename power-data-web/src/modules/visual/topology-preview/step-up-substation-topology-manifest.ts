import type { StepUpSubstationTopologyVariantId } from './step-up-substation-topology-variant-manifest'

/**
 * 升压站资源清单只登记源包实际引用且已按 256 位安全散列去重的公共图片。
 * 源包没有提供完整的正常、告警、故障、离线四态资源，因此独立预览保持源图默认态，
 * 不根据设备名称或外观推断状态图片，避免错误绑定。
 */
export interface StepUpSubstationTopologyResourceManifest {
  readonly staticImagePathByPenId: ReadonlyMap<string, string>
  readonly devicePenIds: ReadonlySet<string>
  readonly titleBackgroundPenIds: ReadonlySet<string>
  readonly processNodePenIds: ReadonlySet<string>
}

interface ResourceManifestSource {
  readonly staticImagePenIdsByPath: Readonly<Record<string, readonly string[]>>
  readonly titleBackgroundPenIds: readonly string[]
  /** 只登记源文件中已人工核对、可独立选择且可作为连线端点的工艺流程节点。 */
  readonly processNodePenIds?: readonly string[]
}

/**
 * 在模块初始化阶段一次性把“公共资源路径 → 图元编号”压平为常数时间索引。
 * 运行时切换拓扑只查询映射，不重复扫描图元或重新解析资源路径。
 */
function createResourceManifest(source: ResourceManifestSource): StepUpSubstationTopologyResourceManifest {
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

/**
 * 每份源文件的图元编号彼此独立，必须按变体显式登记。
 * 公共路径按内容散列复用降压站等已存在资源，不复制二进制文件。
 */
const RESOURCE_MANIFEST_BY_VARIANT_ID = new Map<
  StepUpSubstationTopologyVariantId,
  StepUpSubstationTopologyResourceManifest
>([
  ['architecture', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['773f9223', '62330a1', '7dfb6866', '27774c91'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['57cfc124', '81d1183', '4530a53', '4226b0e1', 'c5a8647', '2e5d1124'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['fa826f6'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['88e1ad3'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['426b0a9'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['db97cd4', '1d235f2'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['6cddbb3d', 'd2c91f1'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['9f9c164', '536abc3c', '26766d6'],
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['8bc76ae'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['70aeaf6'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['854265d'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['f352047'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['667e37e'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['7a413c1d'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['55f86d59'],
    },
    titleBackgroundPenIds: ['3aa725f6', '10677415', '620c7d1', '4d25b46', '1aa7f9fa', '1b0200ba'],
    processNodePenIds: ['7c2370e0', '1cd34c4f', '50a18632', '2d1d4969', '62fcf60', 'd2e9be9'],
  })],
  ['network', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['3dc3725b', '5cf2e57', 'd253ea1', 'b445966'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['cc15d60', '7c45f1ef', '6fbcd0', 'e9fdf2e', '2e49a20', 'd9087c6'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['689a256', 'cbce244', '4b527da8'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['446d724', '066cc17'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['1c7c46ef', '7d998a18'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['e8c092c', '5b0010'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['8f7fa64', '564a03ed'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['1a57b91a'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['22f334a7'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['517c14e5'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['dda08fd'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['0359b07', '757684f7', '60e97d87'],
    },
    titleBackgroundPenIds: ['64e79713', 'e9deb35', 'e1f1e99', '86f6253', '118f0507', 'fe29500'],
  })],
  ['business', createResourceManifest({
    staticImagePenIdsByPath: {},
    titleBackgroundPenIds: ['c8a9420', '23caa1b2', '60297bb6', '234fd6dd', 'ead673f', 'ba5a7db'],
    processNodePenIds: ['9ef8326', '881951f', 'a2ec4f0', '182bc73', '20b39218', '7c80f119'],
  })],
  ['key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['db79d7b', '913edd4'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['5ba8df8', '7e83eb47'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['4ae17cf5', '21ea8fb'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['74a60aff', '72b1a2ca'],
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['46758ce', '8a512ee'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['34bae9f5', '3b0171c5'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['37891a4', '5675a6ad'],
    },
    titleBackgroundPenIds: ['483f6d1', '2cb7c3ff', '7bb5cab', '3682bc2', '51d3c5d', '4c8605f'],
  })],
  ['network-business', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['78040a4', 'b7b4d1c', '6b3ea37', '9c41ff4'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['18c871b7', '7c7ad5cd', '61f75c0', '840cab1', '73e0dbff', '290c6722'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['f52c135', '3d9d0fd8', '35549039'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['2e2abf0d', '4182793'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['4f909a10', '5c11fbbf'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['aed3231', '0b90c69'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['52176f2e', '1e8f48e7'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['719b1e7'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['b1af77'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['4f35bdca'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['1e021019'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['3f52fee3', '810d2f6', '8e332f8'],
    },
    titleBackgroundPenIds: ['59fd617a', '52a17e1', '418537f', '1e49f181', '7296871b', 'b3f7432'],
    processNodePenIds: ['d3ced1f', 'b6d8349', '62452d23', '68aee8e0', '56931d4c', '5c84634b'],
  })],
  ['network-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['4d00be6', '337a6c6', 'd7a82f7', '640b4365'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['35702ff9', 'bc38542', '403aff1', '3c2419d4', '77412a8b', '3cb34ff8'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['6a357867', 'a951f70', '5d4dd87a'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['232c36a5', '7ddbeff5'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['518653d', '5fd5e86'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['5116d22', '2aa25d38'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['71ff00b', '86d49c4'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['6b395f54'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['f51f02a'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['56f10c65'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['92fe94e'],
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['413c7a93', '7db0920'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['2eac17', '025e56c'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['45e7aa4b', '1e9925a3', '27d41218'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['99c5307', '7af6c86'],
    },
    titleBackgroundPenIds: ['2481a01b', '61b736ff', '3042cd81', '55688bc8', 'b1ae8e6', '738d19d1'],
  })],
  ['business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['4c06986', '13483e14'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['7dc2e1', '7ef2ec98'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['83c4d45', '1289e6d'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['1f43d277', 'c42dd10'],
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['56e413', '3425a2b6'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['1810341', '6d63425c'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['3a4f333', 'd22285a'],
    },
    titleBackgroundPenIds: ['2b7fd67', 'f4403cf', '899760a', '08cb0c8', '1a7f26fa', '7d6e965'],
    processNodePenIds: ['220e4fc', 'b3a0d3', '599c15e', '6240fb4e', '8b440ac', '3ac2dfde'],
  })],
  ['network-business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': ['0b59ba2', '1d6dc46', '3a412a8', '9ddf8'],
      'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': ['53787573', '4ff1e1f', '6f0a2c0', '3771b5aa', '476a2497', '3bb522e1'],
      'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': ['231062e0', '28846a8b', 'b896e48'],
      'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': ['3094af3', '69ccc050'],
      'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': ['2fda2aaa', '985e9a6'],
      'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': ['300aa5f', '478eb0df'],
      'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': ['f21af61', '3d15ad6'],
      'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': ['2d57f754'],
      'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': ['7e74f5dd'],
      'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': ['2facfc78'],
      'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': ['0404d2a'],
      'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': ['2c20d783', '5effb979'],
      'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': ['460b2f3c', 'bdb5432'],
      'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': ['a938209', '601f21c', 'b11d114'],
      'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': ['74048c89', '3b0bb6bd'],
    },
    titleBackgroundPenIds: ['a4ae075', '1e22435', 'cd8cecf', '61650b4', '11842d1', '54c6b28'],
    processNodePenIds: ['76d6e270', '706b723', '35cfc35', '75ee244d', 'ff086a5', 'c50d31c'],
  })],
])

/** 严格按版本编号读取资源清单；缺项立即报错，禁止回退到其他拓扑文件。 */
export function getStepUpSubstationTopologyResourceManifest(
  variantId: StepUpSubstationTopologyVariantId,
): StepUpSubstationTopologyResourceManifest {
  const manifest = RESOURCE_MANIFEST_BY_VARIANT_ID.get(variantId)
  if (!manifest) throw new Error(`升压站拓扑版本缺少资源清单：${variantId}`)
  return manifest
}

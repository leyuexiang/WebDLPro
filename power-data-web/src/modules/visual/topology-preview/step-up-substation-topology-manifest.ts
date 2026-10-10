import type { StepUpSubstationTopologyVariantId } from './step-up-substation-topology-variant-manifest'

/**
 * 升压站资源清单把旧图片键映射到按图元类型核对的新公共四态图标。
 * 当前场景没有登记实时设备节点绑定，所以静态图元只显示正常图标，不根据外观推断状态。
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
      'icons/normal/firewall.webp': ['773f9223', '62330a1', '7dfb6866', '27774c91'],
      'icons/normal/desktop.webp': ['57cfc124', '81d1183', '4530a53', '4226b0e1', 'c5a8647', '2e5d1124'],
      'icons/normal/instrument.webp': ['fa826f6'],
      'icons/normal/combiner_unit.webp': ['88e1ad3'],
      'icons/normal/intelligent_terminal.webp': ['426b0a9'],
      'icons/normal/protection.webp': ['db97cd4', '1d235f2'],
      'icons/normal/server.webp': ['6cddbb3d', 'd2c91f1'],
      'icons/normal/dual_router.webp': ['9f9c164', '536abc3c', '26766d6'],
      'icons/normal/mutual_transformer.webp': ['8bc76ae'],
      'icons/normal/breaker.webp': ['70aeaf6'],
      'icons/normal/transformer.webp': ['854265d'],
      'icons/normal/remote_terminal.webp': ['f352047'],
      'icons/normal/pmu.webp': ['667e37e'],
      'icons/normal/clock.webp': ['7a413c1d'],
      'icons/normal/monitor.webp': ['55f86d59'],
    },
    titleBackgroundPenIds: ['3aa725f6', '10677415', '620c7d1', '4d25b46', '1aa7f9fa', '1b0200ba'],
    processNodePenIds: ['7c2370e0', '1cd34c4f', '50a18632', '2d1d4969', '62fcf60', 'd2e9be9'],
  })],
  ['network', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/firewall.webp': ['3dc3725b', '5cf2e57', 'd253ea1', 'b445966'],
      'icons/normal/desktop.webp': ['cc15d60', '7c45f1ef', '6fbcd0', 'e9fdf2e', '2e49a20', 'd9087c6'],
      'icons/normal/protection.webp': ['689a256', 'cbce244', '4b527da8'],
      'icons/normal/instrument.webp': ['446d724', '066cc17'],
      'icons/normal/combiner_unit.webp': ['1c7c46ef', '7d998a18'],
      'icons/normal/intelligent_terminal.webp': ['e8c092c', '5b0010'],
      'icons/normal/server.webp': ['8f7fa64', '564a03ed'],
      'icons/normal/clock.webp': ['1a57b91a'],
      'icons/normal/remote_terminal.webp': ['22f334a7'],
      'icons/normal/pmu.webp': ['517c14e5'],
      'icons/normal/monitor.webp': ['dda08fd'],
      'icons/normal/dual_router.webp': ['0359b07', '757684f7', '60e97d87'],
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
      'icons/normal/instrument.webp': ['db79d7b', '913edd4'],
      'icons/normal/combiner_unit.webp': ['5ba8df8', '7e83eb47'],
      'icons/normal/intelligent_terminal.webp': ['4ae17cf5', '21ea8fb'],
      'icons/normal/protection.webp': ['74a60aff', '72b1a2ca'],
      'icons/normal/mutual_transformer.webp': ['46758ce', '8a512ee'],
      'icons/normal/breaker.webp': ['34bae9f5', '3b0171c5'],
      'icons/normal/transformer.webp': ['37891a4', '5675a6ad'],
    },
    titleBackgroundPenIds: ['483f6d1', '2cb7c3ff', '7bb5cab', '3682bc2', '51d3c5d', '4c8605f'],
  })],
  ['network-business', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/firewall.webp': ['78040a4', 'b7b4d1c', '6b3ea37', '9c41ff4'],
      'icons/normal/desktop.webp': ['18c871b7', '7c7ad5cd', '61f75c0', '840cab1', '73e0dbff', '290c6722'],
      'icons/normal/protection.webp': ['f52c135', '3d9d0fd8', '35549039'],
      'icons/normal/instrument.webp': ['2e2abf0d', '4182793'],
      'icons/normal/combiner_unit.webp': ['4f909a10', '5c11fbbf'],
      'icons/normal/intelligent_terminal.webp': ['aed3231', '0b90c69'],
      'icons/normal/server.webp': ['52176f2e', '1e8f48e7'],
      'icons/normal/clock.webp': ['719b1e7'],
      'icons/normal/remote_terminal.webp': ['b1af77'],
      'icons/normal/pmu.webp': ['4f35bdca'],
      'icons/normal/monitor.webp': ['1e021019'],
      'icons/normal/dual_router.webp': ['3f52fee3', '810d2f6', '8e332f8'],
    },
    titleBackgroundPenIds: ['59fd617a', '52a17e1', '418537f', '1e49f181', '7296871b', 'b3f7432'],
    processNodePenIds: ['d3ced1f', 'b6d8349', '62452d23', '68aee8e0', '56931d4c', '5c84634b'],
  })],
  ['network-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/firewall.webp': ['4d00be6', '337a6c6', 'd7a82f7', '640b4365'],
      'icons/normal/desktop.webp': ['35702ff9', 'bc38542', '403aff1', '3c2419d4', '77412a8b', '3cb34ff8'],
      'icons/normal/protection.webp': ['6a357867', 'a951f70', '5d4dd87a'],
      'icons/normal/instrument.webp': ['232c36a5', '7ddbeff5'],
      'icons/normal/combiner_unit.webp': ['518653d', '5fd5e86'],
      'icons/normal/intelligent_terminal.webp': ['5116d22', '2aa25d38'],
      'icons/normal/server.webp': ['71ff00b', '86d49c4'],
      'icons/normal/clock.webp': ['6b395f54'],
      'icons/normal/remote_terminal.webp': ['f51f02a'],
      'icons/normal/pmu.webp': ['56f10c65'],
      'icons/normal/monitor.webp': ['92fe94e'],
      'icons/normal/mutual_transformer.webp': ['413c7a93', '7db0920'],
      'icons/normal/breaker.webp': ['2eac17', '025e56c'],
      'icons/normal/dual_router.webp': ['45e7aa4b', '1e9925a3', '27d41218'],
      'icons/normal/transformer.webp': ['99c5307', '7af6c86'],
    },
    titleBackgroundPenIds: ['2481a01b', '61b736ff', '3042cd81', '55688bc8', 'b1ae8e6', '738d19d1'],
  })],
  ['business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/instrument.webp': ['4c06986', '13483e14'],
      'icons/normal/combiner_unit.webp': ['7dc2e1', '7ef2ec98'],
      'icons/normal/intelligent_terminal.webp': ['83c4d45', '1289e6d'],
      'icons/normal/protection.webp': ['1f43d277', 'c42dd10'],
      'icons/normal/mutual_transformer.webp': ['56e413', '3425a2b6'],
      'icons/normal/breaker.webp': ['1810341', '6d63425c'],
      'icons/normal/transformer.webp': ['3a4f333', 'd22285a'],
    },
    titleBackgroundPenIds: ['2b7fd67', 'f4403cf', '899760a', '08cb0c8', '1a7f26fa', '7d6e965'],
    processNodePenIds: ['220e4fc', 'b3a0d3', '599c15e', '6240fb4e', '8b440ac', '3ac2dfde'],
  })],
  ['network-business-key-process', createResourceManifest({
    staticImagePenIdsByPath: {
      'icons/normal/firewall.webp': ['0b59ba2', '1d6dc46', '3a412a8', '9ddf8'],
      'icons/normal/desktop.webp': ['53787573', '4ff1e1f', '6f0a2c0', '3771b5aa', '476a2497', '3bb522e1'],
      'icons/normal/protection.webp': ['231062e0', '28846a8b', 'b896e48'],
      'icons/normal/instrument.webp': ['3094af3', '69ccc050'],
      'icons/normal/combiner_unit.webp': ['2fda2aaa', '985e9a6'],
      'icons/normal/intelligent_terminal.webp': ['300aa5f', '478eb0df'],
      'icons/normal/server.webp': ['f21af61', '3d15ad6'],
      'icons/normal/clock.webp': ['2d57f754'],
      'icons/normal/remote_terminal.webp': ['7e74f5dd'],
      'icons/normal/pmu.webp': ['2facfc78'],
      'icons/normal/monitor.webp': ['0404d2a'],
      'icons/normal/mutual_transformer.webp': ['2c20d783', '5effb979'],
      'icons/normal/breaker.webp': ['460b2f3c', 'bdb5432'],
      'icons/normal/dual_router.webp': ['a938209', '601f21c', 'b11d114'],
      'icons/normal/transformer.webp': ['74048c89', '3b0bb6bd'],
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

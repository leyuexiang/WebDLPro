import { access, cp, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { constants as fileSystemConstants } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertReleaseArtifact, writeReleaseArtifactIntegrity } from './release-artifact-contract.mjs'
import {
  coalPowerEdgeColors,
  coalPowerProcessSteps,
  coalPowerSceneNodeMappings,
  createCoalPowerActions,
  createCoalPowerTopologies,
} from './coal-power-topology.mjs'

/**
 * 燃气发电发布包构建器。
 *
 * 此脚本为“现有燃气发电 Unity 场景 + 已确认燃气拓扑”生成本地测试、合作方联调或正式发布目录。
 * 它不会改写九场景正式清单，也不会把尚未交付的设备、三维节点、流程或状态映射伪造成真实内容。
 * 其余八个固定场景仅保留契约要求的空占位，外层测试宿主页只会初始化 gas-power（燃气发电）。
 */
const workspaceRoot = process.cwd()
const projectRoot = path.resolve(workspaceRoot, '..')
const releasesRoot = path.join(projectRoot, 'Builds', 'Releases')
/*
 * 默认复用当前工作区可读取的 Unity 正式基线。此标识必须与
 * Builds/Releases/<标识>/unity/webgl-protocol-capabilities.json（WebGL 协议能力清单）中的
 * unityReleaseId 完全一致；构建前会继续逐项复核结构版本和必需命令，避免同名目录或旧压缩产物绕过门禁。
 * 正式归档或合作方联调若需切换基线，必须通过 --unity-release-id 显式指定并接受同一套门禁校验。
 */
// 默认指向已经通过两阶段关键环节协议门禁的只读 Unity 网页图形基线；
// 调用方仍可显式指定其他发布标识，但结构版本、命令字段和发布标识必须全部通过同一套校验。
const defaultUnityReleaseId = 'three-layer-unity-demo-20260831-2300'
let unityReleaseId = defaultUnityReleaseId
let host = '127.0.0.1'
const defaultPort = 5523
let port = defaultPort
let addressMode = 'fixed-origin'
let hostOrigin = `http://${host}:${port}`
let platformParentOrigin = hostOrigin
let unityParentOrigin = hostOrigin
let unityEntryUrl = `${hostOrigin}/unity/index.html`
let topologyManifestUrl = `${hostOrigin}/scene-topology-manifest.json`
// 发布脚本默认仍构建燃气回归包；场景参数只在显式选择燃煤时切换清单和入口初始视图。
let releaseSceneId = 'gas-power'
const unitySceneMappingVersion = '2026.08.01-local.2'
const unityBuildId = 'local-webgl-topology-link'
const resourceDigest = 'local-webgl-topology-link'

/**
 * 网页壳按发布场景选择对应运行时键；两个键仍指向同一个九场景 Unity 构建和同一资源摘要。
 * 这样燃煤包的握手元数据不再伪装成燃气入口，同时继续满足全页只创建一个 Unity 实例的约束。
 */
function getUnityRuntimeKey(sceneId) {
  return sceneId === 'coal-power' ? 'coal-plant-release' : 'gas-plant-release'
}

const unityProtocolMetadataFileName = 'webgl-protocol-capabilities.json'
const expectedUnityProtocolMetadataSchemaVersion = 9
const expectedUnityProtocolChannel = 'power3d-unity'
const expectedUnityProtocolVersion = 2
const expectedSceneChangedSchemaVersion = 2
const expectedSwitchSceneRecoverySchemaVersion = 1
const expectedSetNodeVisualStateSchemaVersion = 3
const expectedClearNodeVisualStateSchemaVersion = 1
// 第九版元数据在第三层事务基础上增加独立命名镜头点命令；发布前必须与 Unity 构建保持一致。
const expectedProcessDetailCommandSchemaVersion = 2
const maximumUnityProtocolMetadataBytes = 16 * 1024
const requiredSceneChangedFields = Object.freeze(['requestId', 'sceneId', 'transitionId', 'sceneActivationId', 'success'])
const requiredSwitchSceneFields = Object.freeze(['sceneId', 'transitionId', 'sceneMappingVersion', 'forceReload'])
const requiredSwitchSceneRecoveryFields = Object.freeze(['requestId', 'success', 'sceneActivationId'])
const requiredSetNodeVisualStateFields = Object.freeze(['sceneNodeId', 'visualState', 'snapshotSequence', 'statusUpdatedAt', 'sourceRevision'])
const requiredClearNodeVisualStateFields = Object.freeze(['sceneNodeId', 'snapshotSequence'])
const requiredEnterProcessDetailFields = Object.freeze(['sceneId', 'processId', 'stepId', 'processDetailId', 'transitionId'])
const requiredPrepareProcessDetailFields = Object.freeze(['sceneId', 'processId', 'stepId', 'processDetailId', 'transitionId'])
const requiredCommitProcessDetailFields = Object.freeze(['sceneId', 'processDetailId', 'transitionId'])
const requiredAbortProcessDetailFields = Object.freeze(['sceneId', 'processDetailId', 'transitionId'])
const requiredExitProcessDetailFields = Object.freeze(['sceneId', 'processDetailId', 'transitionId'])
const requiredSetProcessDetailPlaybackFields = Object.freeze(['sceneId', 'processDetailId', 'playing'])
// 发布门禁必须逐项验证下行命令，尤其是空白点击依赖的 clearSelection；
// 否则旧 Unity 包会通过静态检查，却在正式握手或用户点击空白时才暴露不兼容。
const requiredUnityCommandCapabilities = Object.freeze([
  'init',
  'resize',
  'switchScene',
  'enterProcessStep',
  'moveCameraToPose',
  // enterProcessDetail 仅保留旧宿主兼容；新前端只通过以下三条事务命令进入或同场景切换关键环节。
  'enterProcessDetail',
  'prepareProcessDetail',
  'commitProcessDetail',
  'abortProcessDetail',
  'exitProcessDetail',
  'setProcessDetailPlayback',
  'resetScene',
  'focusNode',
  'clearSelection',
  'setNodeVisualState',
  'clearNodeVisualState',
  'setRouteFlow',
  'setNodeVisibility',
  'dispose',
])
// 双向选中依赖 objectSelected（对象选中）和 selectionCleared（选择清除）两类上行事件。
// 发布前必须校验完整事件能力，不能等到浏览器握手后才发现旧 Unity 包无法形成反向链路。
const requiredUnityEventCapabilities = Object.freeze([
  'ready',
  'ack',
  'commandResult',
  'sceneLoadProgress',
  'sceneChanged',
  'objectSelected',
  'selectionCleared',
  'disposed',
])

/**
 * 三类包拥有不同发布边界，不能继续用“是否含自测页”间接猜测用途。
 * `local-test`（本地测试包）允许回环地址；其余两类均面向独立服务内嵌，必须使用调用方显式提供的公开地址。
 */
const releasePackageTypes = Object.freeze(['local-test', 'partner-integration', 'standalone-formal'])
const loopbackHostNames = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'])
const localOnlyListenHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
// 合作方平台已固定使用 5575 访问联调服务；生成器和产物门禁共用该约束，避免说明文件、服务监听与平台配置漂移。
const partnerIntegrationPort = 5575
// 页面外层握手和收到初始化后的 Unity 稳定视图准备属于两个独立阶段。
// 外层不下载 Unity 大资源，保持15秒短门限；只有 Unity 启动与初始稳定视图使用120秒。
const outerReadyTimeoutMilliseconds = 15_000
const unityAndInitialViewTimeoutMilliseconds = 120_000
const supportedReleaseOptions = new Set([
  '--release-id', '--unity-release-id', '--package-type', '--listen-host', '--port', '--include-self-test',
  '--public-origin', '--platform-parent-origin', '--unity-parent-origin',
  '--unity-entry-url', '--manifest-url', '--scene',
])

/**
 * 仅登记已经在 GasPower.unity（燃气场景）与 PowerPlantProcessController（燃气流程控制器）中逐项核对的二维—三维节点映射。
 * 键和值即使文本相同也以显式映射保存；运行时绝不按节点名称、坐标或图元键推导三维对象。
 * 其余控制网络节点没有已登记的燃气三维目标，因此必须保持为纯二维节点，不会收到聚焦命令。
 * 本包仅开放总览动作；总览动作不聚焦单个二维节点，因此不会为它伪造节点映射。
 * 三维联动仍通过下方逐项核验的节点映射完成，不能根据相同字符串自动关联。
 */
const verifiedGasSceneNodeIdByTopologyNodeId = new Map([
  // 权威总图中的 Mark VIe 控制器是燃机流程的二维入口；它与 Unity 中已核验的燃机逻辑节点显式对应。
  ['inlet-duct', 'gas-turbine'],
  ['hrsg', 'hrsg'],
  ['steam-turbine', 'steam-turbine'],
])

/**
 * 仅发布已由 GasPower 场景播放模式逐项验证的“流程标识 + 步骤标识”组合。
 *
 * 新版仅保留总览。历史关键流程已按产品决策下线，不能继续作为外部动作或结构清单能力发布。
 * 这样后续动作清单只能引用总览组合，不能借标题、坐标或相邻节点补造流程入口。
 */
const verifiedGasProcessSteps = Object.freeze([
  Object.freeze({ processId: 'gas-power-generation', stepId: 'overview' }),
])

/**
 * 第三层关键环节目录使用稳定编号建立唯一映射，运行时不得根据预制体名称、层级路径或坐标猜测资源。
 * 目录结构本身支持零到多项；本轮只登记已经提供独立精细模型的燃气轮机，不生成其他环节占位。
 */
const gasProcessDetails = Object.freeze([
  Object.freeze({
    sceneId: 'gas-power',
    processId: 'gas-power-generation',
    stepId: 'gas-turbine',
    processDetailId: 'process-detail.gas-power.gas-turbine',
    resourceId: 'process-detail-resource.gas-power.gas-turbine',
    cameraPoseId: 'camera-pose.gas-power.gas-turbine',
    stateNodeId: 'gas-turbine',
  }),
])

/**
 * 参数只允许可安全放入发布目录名的稳定片段，避免构建命令被误用为任意路径写入工具。
 * 未指定版本时使用本地时间生成唯一版本；目录已存在时立即失败而不覆盖已有测试包。
 */
export function readReleaseConfiguration(argumentsList) {
  // 记录调用方是否显式指定端口，使合作方包既能省略参数自动使用 5575，也能明确拒绝误传的其他端口。
  let portWasExplicitlyConfigured = false
  const configuration = {
    releaseId: `gas-power-smoke-${formatTimestamp(new Date())}`,
    unityReleaseId: defaultUnityReleaseId,
    packageType: 'local-test',
    // 监听地址只决定 Node（JavaScript运行时）服务绑定的网络接口，不能当作浏览器公开访问地址。
    listenHost: '127.0.0.1',
    port: defaultPort,
    publicOrigin: undefined,
    platformParentOrigin: undefined,
    unityParentOrigin: undefined,
    unityEntryUrl: undefined,
    manifestUrl: undefined,
    // 所有包默认不生成内部自测页；仅本地测试包允许通过显式开关生成。
    includeSelfTest: false,
    // 合作方联调包和正式包在未提供实际来源时都使用运行时同源模式；固定来源仍可显式启用。
    addressMode: 'fixed-origin',
    // 默认保持历史燃气回归包；燃煤发布必须通过 --scene coal-power 显式选择。
    sceneId: 'gas-power',
  }

  for (let index = 0; index < argumentsList.length; index += 2) {
    const option = argumentsList[index]
    const value = argumentsList[index + 1]
    if (!value || !supportedReleaseOptions.has(option)) {
      throw new Error('发布参数不完整或包含未知选项；请按输出标准提供包类型、监听地址和可选独立服务来源。')
    }
    if (option === '--include-self-test') {
      if (value !== 'true' && value !== 'false') {
        throw new Error('内部自测页开关只能是 true 或 false。')
      }
      configuration.includeSelfTest = value === 'true'
      continue
    }
    if (option === '--package-type') {
      if (!releasePackageTypes.includes(value)) {
        throw new Error('包类型只能是 local-test、partner-integration 或 standalone-formal。')
      }
      configuration.packageType = value
      continue
    }
    if (option === '--scene') {
      if (value !== 'gas-power' && value !== 'coal-power') {
        throw new Error('发布场景只能是 gas-power 或 coal-power。')
      }
      configuration.sceneId = value
      continue
    }
    if (option === '--listen-host') {
      // 仅接收主机名或网络地址本体；协议、路径和空白会让生成的服务脚本产生歧义，因此直接拒绝。
      if (!/^[a-zA-Z0-9:[\].-]+$/.test(value) || value.length > 253) {
        throw new Error('监听地址必须是有效主机名或网络地址，不能包含协议、路径或空白。')
      }
      configuration.listenHost = value
      continue
    }
    if (option === '--port') {
      // 仅允许非特权 TCP 端口范围，避免误用系统保留端口或把非数字文本写入服务脚本。
      const parsedPort = Number.parseInt(value, 10)
      if (!Number.isInteger(parsedPort) || String(parsedPort) !== value || parsedPort < 1024 || parsedPort > 65535) {
        throw new Error('联调端口必须是 1024—65535 范围内的十进制整数。')
      }
      configuration.port = parsedPort
      portWasExplicitlyConfigured = true
      continue
    }
    if (option === '--release-id' || option === '--unity-release-id') {
      if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value) || value.length > 96) {
        throw new Error('发布标识只能包含小写字母、数字、连字符和点，且长度不能超过 96。')
      }
      if (option === '--release-id') configuration.releaseId = value
      if (option === '--unity-release-id') configuration.unityReleaseId = value
      continue
    }
    if (option === '--public-origin') configuration.publicOrigin = value
    if (option === '--platform-parent-origin') configuration.platformParentOrigin = value
    if (option === '--unity-parent-origin') configuration.unityParentOrigin = value
    if (option === '--unity-entry-url') configuration.unityEntryUrl = value
    if (option === '--manifest-url') configuration.manifestUrl = value
  }

  if (configuration.packageType === 'partner-integration') {
    if (portWasExplicitlyConfigured && configuration.port !== partnerIntegrationPort) {
      throw new Error(`合作方联调包端口固定为 ${partnerIntegrationPort}，不得使用其他端口。`)
    }
    // 未传 --port 时在写入公开说明、服务脚本和发布摘要前统一收敛为平台约定端口。
    configuration.port = partnerIntegrationPort
  }

  return finalizeReleaseConfiguration(configuration)
}

/**
 * 将来源与资源地址解析为标准形式，并在真正写文件前完成包类型门禁。
 * 地址校验只执行一次，后续构建、内容安全策略、说明文件和发布摘要复用同一不可变结果，避免字段间漂移。
 */
function finalizeReleaseConfiguration(configuration) {
  const localOrigin = `http://${configuration.listenHost}:${configuration.port}`
  const isLocalTest = configuration.packageType === 'local-test'

  if (isLocalTest) {
    const publicOrigin = readExactOrigin(configuration.publicOrigin ?? localOrigin, '浏览器公开来源')
    return Object.freeze({
      ...configuration,
      addressMode: 'fixed-origin',
      publicOrigin,
      platformParentOrigin: readExactOrigin(configuration.platformParentOrigin ?? publicOrigin, '平台父页面来源'),
      unityParentOrigin: readExactOrigin(configuration.unityParentOrigin ?? publicOrigin, 'Unity父页面来源'),
      unityEntryUrl: readHttpUrl(configuration.unityEntryUrl ?? `${publicOrigin}/unity/index.html`, 'Unity入口地址'),
      manifestUrl: readPackagedStructureManifestUrl(configuration.manifestUrl, publicOrigin),
    })
  }

  if (configuration.includeSelfTest) {
    throw new Error('合作方联调包和正式包禁止包含内部自测页。')
  }
  if (localOnlyListenHosts.has(configuration.listenHost.toLowerCase())) {
    throw new Error('合作方联调包和正式包不得只监听本机回环地址；请显式提供局域网接口地址或0.0.0.0。')
  }
  const sourceValues = [configuration.publicOrigin, configuration.platformParentOrigin, configuration.unityParentOrigin, configuration.unityEntryUrl]
  const providedSourceCount = sourceValues.filter((value) => typeof value === 'string' && value.trim().length > 0).length
  if ((configuration.packageType === 'partner-integration' || configuration.packageType === 'standalone-formal') && providedSourceCount === 0) {
    // 合作方联调包和正式包都允许完全不知道部署 IP：浏览器从当前服务地址派生同源资源，
    // 平台父来源由 iframe 查询参数在运行时传入；哨兵只存在构建产物内部，不会被当作真实 URL 使用。
    return Object.freeze({
      ...configuration,
      addressMode: 'runtime-self-origin',
      publicOrigin: '__RUNTIME_SELF_ORIGIN__',
      platformParentOrigin: '__RUNTIME_PARENT_ORIGIN__',
      unityParentOrigin: '__RUNTIME_SELF_ORIGIN__',
      unityEntryUrl: '__RUNTIME_SELF_ORIGIN__/unity/index.html',
      manifestUrl: '__RUNTIME_SELF_ORIGIN__/scene-topology-manifest.json',
    })
  }
  if (providedSourceCount !== sourceValues.length) {
    throw new Error('来源参数必须全部省略以启用运行时同源模式，或全部提供以启用固定来源模式。')
  }

  const publicOrigin = readExactOrigin(configuration.publicOrigin, '浏览器公开来源')
  const resolved = Object.freeze({
    ...configuration,
    addressMode: 'fixed-origin',
    publicOrigin,
    platformParentOrigin: readExactOrigin(configuration.platformParentOrigin, '平台父页面来源'),
    unityParentOrigin: readExactOrigin(configuration.unityParentOrigin, 'Unity父页面来源'),
    unityEntryUrl: readHttpUrl(configuration.unityEntryUrl, 'Unity入口地址'),
    manifestUrl: readPackagedStructureManifestUrl(configuration.manifestUrl, publicOrigin),
  })

  for (const [label, value] of [
    ['浏览器公开来源', resolved.publicOrigin],
    ['平台父页面来源', resolved.platformParentOrigin],
    ['Unity父页面来源', resolved.unityParentOrigin],
    ['Unity入口地址', resolved.unityEntryUrl],
    ['结构清单地址', resolved.manifestUrl],
  ]) {
    const parsed = new URL(value)
    if (loopbackHostNames.has(parsed.hostname.toLowerCase())) throw new Error(`${label}不得使用本机或监听通配地址。`)
    if (configuration.packageType === 'standalone-formal' && parsed.protocol !== 'https:') {
      throw new Error(`正式包的${label}必须使用 HTTPS（安全超文本传输协议）。`)
    }
  }
  return resolved
}

/**
 * 当前燃气包始终携带唯一结构清单，因此启动地址只能是我方公开来源下的固定同源文件。
 * `--manifest-url` 参数允许省略，构建器会根据已确认的浏览器公开来源派生同源文件地址；
 * 合作方包的浏览器公开来源本身仍必须在构建时确定，不能把未知地址伪装成 `0.0.0.0` 或示例域名。
 * 显式清单地址仅用于复核，不能把壳重新指向平台绑定接口。
 */
function readPackagedStructureManifestUrl(configuredValue, publicOrigin) {
  const expectedUrl = new URL('/scene-topology-manifest.json', publicOrigin).href
  if (configuredValue === undefined) return expectedUrl
  const configuredUrl = readHttpUrl(configuredValue, '结构清单地址')
  if (configuredUrl !== expectedUrl) {
    throw new Error('燃气包结构清单必须使用我方公开来源下的同源 scene-topology-manifest.json。')
  }
  return configuredUrl
}

/** 精确来源只能包含协议、主机和可选端口，禁止把路径误当成跨窗口消息来源。 */
function readExactOrigin(value, label) {
  const parsed = readHttpUrl(value, label, true)
  if (parsed !== new URL(parsed).origin) throw new Error(`${label}只能包含协议、主机和端口。`)
  return parsed
}

/** 统一拒绝凭据、查询参数和片段，避免将敏感配置写入发布摘要、日志或内容安全策略。 */
function readHttpUrl(value, label, originOnly = false) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label}必须是完整的 HTTP 或 HTTPS 地址。`)
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label}必须是不含凭据、查询参数和片段的 HTTP 或 HTTPS 地址。`)
  }
  if (originOnly && parsed.pathname !== '/') throw new Error(`${label}只能包含协议、主机和端口。`)
  return originOnly ? parsed.origin : parsed.href
}

/** 将本地时间压缩为目录安全格式，同时保留秒级唯一性，便于人工追溯本次构建。 */
function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** 只读检查避免在开始构建后才发现 Unity 基线或目标发布目录不存在。 */
async function ensureReadable(target, message) {
  try {
    await access(target, fileSystemConstants.R_OK)
  } catch {
    throw new Error(message)
  }
}

/** 目标目录一旦存在即保留，不执行删除、覆盖或复用，防止误伤用户保留的联调产物。 */
async function ensureAbsent(target, message) {
  try {
    await access(target, fileSystemConstants.F_OK)
  } catch {
    return
  }
  throw new Error(message)
}

/**
 * 在复制 Unity 目录前验证构建阶段生成的版本化协议元数据。
 * 字符串出现在数据传输对象或未执行代码中不能证明运行时会发送该字段，因此不再解压二进制搜索标记；
 * 元数据同时绑定 Unity 发布标识、场景完成、强制重载、失败自动恢复和四态复合因果水位。
 */
export async function ensureUnityBuildSupportsSceneActivation(unitySourceDirectory, expectedUnityReleaseId) {
  const metadataPath = path.join(unitySourceDirectory, unityProtocolMetadataFileName)
  let metadataStats
  try {
    // 先检查文件大小再读取，确保声明的 16KB 上限真正限制内存占用，而不是读取超大文件后才拒绝。
    metadataStats = await stat(metadataPath)
  } catch {
    throw new Error(`Unity 正式基线缺少版本化协议元数据 ${unityProtocolMetadataFileName}，必须使用当前正式构建入口重新生成。`)
  }
  if (!metadataStats.isFile() || metadataStats.size > maximumUnityProtocolMetadataBytes) {
    throw new Error(`Unity 协议元数据必须是普通文件且不能超过 ${maximumUnityProtocolMetadataBytes} 字节安全上限。`)
  }

  let metadataSource
  try {
    metadataSource = await readFile(metadataPath)
  } catch {
    throw new Error(`Unity 协议元数据 ${unityProtocolMetadataFileName} 无法读取。`)
  }

  let metadata
  try {
    metadata = JSON.parse(metadataSource.toString('utf8'))
  } catch {
    throw new Error('Unity 协议元数据不是合法 UTF-8 JSON。')
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Unity 协议元数据必须是对象。')
  }
  if (metadata.schemaVersion !== expectedUnityProtocolMetadataSchemaVersion ||
      metadata.channel !== expectedUnityProtocolChannel ||
      metadata.protocolVersion !== expectedUnityProtocolVersion ||
      metadata.sceneChangedSchemaVersion !== expectedSceneChangedSchemaVersion ||
      metadata.switchSceneRecoverySchemaVersion !== expectedSwitchSceneRecoverySchemaVersion ||
      metadata.setNodeVisualStateSchemaVersion !== expectedSetNodeVisualStateSchemaVersion ||
      metadata.clearNodeVisualStateSchemaVersion !== expectedClearNodeVisualStateSchemaVersion ||
      metadata.processDetailCommandSchemaVersion !== expectedProcessDetailCommandSchemaVersion) {
    throw new Error('Unity 协议元数据的结构版本、信封通道或协议版本与当前前端不一致。')
  }
  if (typeof expectedUnityReleaseId !== 'string' || metadata.unityReleaseId !== expectedUnityReleaseId) {
    throw new Error('Unity 协议元数据的发布标识与待复制基线不一致。')
  }

  const missingSceneChangedFields = findMissingRequiredFields(metadata.sceneChangedRequiredFields, requiredSceneChangedFields)
  const missingSwitchSceneFields = findMissingRequiredFields(metadata.switchSceneRequiredFields, requiredSwitchSceneFields)
  const missingSwitchSceneRecoveryFields = findMissingRequiredFields(
    metadata.switchSceneRecoveryRequiredFields,
    requiredSwitchSceneRecoveryFields,
  )
  const missingSetNodeVisualStateFields = findMissingRequiredFields(
    metadata.setNodeVisualStateRequiredFields,
    requiredSetNodeVisualStateFields,
  )
  const missingClearNodeVisualStateFields = findMissingRequiredFields(
    metadata.clearNodeVisualStateRequiredFields,
    requiredClearNodeVisualStateFields,
  )
  const missingEnterProcessDetailFields = findMissingRequiredFields(
    metadata.enterProcessDetailRequiredFields,
    requiredEnterProcessDetailFields,
  )
  const missingPrepareProcessDetailFields = findMissingRequiredFields(
    metadata.prepareProcessDetailRequiredFields,
    requiredPrepareProcessDetailFields,
  )
  const missingCommitProcessDetailFields = findMissingRequiredFields(
    metadata.commitProcessDetailRequiredFields,
    requiredCommitProcessDetailFields,
  )
  const missingAbortProcessDetailFields = findMissingRequiredFields(
    metadata.abortProcessDetailRequiredFields,
    requiredAbortProcessDetailFields,
  )
  const missingExitProcessDetailFields = findMissingRequiredFields(
    metadata.exitProcessDetailRequiredFields,
    requiredExitProcessDetailFields,
  )
  const missingSetProcessDetailPlaybackFields = findMissingRequiredFields(
    metadata.setProcessDetailPlaybackRequiredFields,
    requiredSetProcessDetailPlaybackFields,
  )
  const missingCommandCapabilities = findMissingRequiredFields(
    metadata.commandCapabilities,
    requiredUnityCommandCapabilities,
  )
  const missingEventCapabilities = findMissingRequiredFields(
    metadata.eventCapabilities,
    requiredUnityEventCapabilities,
  )
  if (missingSceneChangedFields.length > 0 ||
      missingSwitchSceneFields.length > 0 ||
      missingSwitchSceneRecoveryFields.length > 0 ||
      missingSetNodeVisualStateFields.length > 0 ||
      missingClearNodeVisualStateFields.length > 0 ||
      missingEnterProcessDetailFields.length > 0 ||
      missingPrepareProcessDetailFields.length > 0 ||
      missingCommitProcessDetailFields.length > 0 ||
      missingAbortProcessDetailFields.length > 0 ||
      missingExitProcessDetailFields.length > 0 ||
      missingSetProcessDetailPlaybackFields.length > 0 ||
      missingCommandCapabilities.length > 0 ||
      missingEventCapabilities.length > 0) {
    throw new Error(
      `Unity 正式基线缺少当前场景协议必填字段：${[
        ...missingSceneChangedFields,
        ...missingSwitchSceneFields,
        ...missingSwitchSceneRecoveryFields,
        ...missingSetNodeVisualStateFields,
        ...missingClearNodeVisualStateFields,
        ...missingEnterProcessDetailFields,
        ...missingPrepareProcessDetailFields,
        ...missingCommitProcessDetailFields,
        ...missingAbortProcessDetailFields,
        ...missingExitProcessDetailFields,
        ...missingSetProcessDetailPlaybackFields,
        ...missingCommandCapabilities,
        ...missingEventCapabilities,
      ].join('、')}。请重新构建 Unity 正式基线。`,
    )
  }
}

/** 小型元数据字段按集合检查，单次最多处理固定数量契约字段，不扫描或复制大型构建资源。 */
function findMissingRequiredFields(candidateFields, requiredFields) {
  if (!Array.isArray(candidateFields) || !candidateFields.every((field) => typeof field === 'string')) {
    return [...requiredFields]
  }
  const candidateFieldSet = new Set(candidateFields)
  return requiredFields.filter((field) => !candidateFieldSet.has(field))
}

/**
 * 子进程固定使用参数数组而非拼接命令字符串，既保留构建日志，也避免版本号或路径被 Shell 解释。
 * 调用失败立即中断，后续不会把未通过类型检查或契约校验的内容复制为“可运行包”。
 */
function execute(command, argumentsList, environment = process.env) {
  const result = spawnSync(command, argumentsList, {
    cwd: workspaceRoot,
    env: environment,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`构建命令失败：${command} ${argumentsList.join(' ')}`)
}

/**
 * 已确认的燃气联合循环（CCGT，联合循环燃气轮机）发电厂 OT（运营技术）网络总图。
 *
 * 节点、22 条连线、层级及协议标签逐项来自《通用拓扑图参考0810_AI友好版.md》第三节，
 * 不再从旧本地导览配置读取 24 节点版本，也不根据模型名称或页面截图补造节点。
 */
const ccgtOtTopology = Object.freeze({
  title: '燃气联合循环（CCGT）发电厂 OT 网络拓扑',
  layers: Object.freeze([
    Object.freeze({ layerId: 'enterprise-it', title: '企业 IT 层', y: 8, color: '#7dd3fc' }),
    Object.freeze({ layerId: 'production-dmz', title: '生产 DMZ 层', y: 28, color: '#60a5fa' }),
    Object.freeze({ layerId: 'plant-control', title: '厂级监控层', y: 50, color: '#38bdf8' }),
    Object.freeze({ layerId: 'unit-control', title: '单元控制层', y: 69, color: '#22c55e' }),
    Object.freeze({ layerId: 'field-device', title: '现场设备层', y: 88, color: '#fb923c' }),
  ]),
  nodes: Object.freeze([
    Object.freeze({ nodeId: 'ems-system', title: 'EMS 能量管理系统', iconKey: 'server', x: 24, y: 8, layerId: 'enterprise-it' }),
    Object.freeze({ nodeId: 'enterprise-core-switch', title: '企业核心交换机', iconKey: 'core-switch', x: 50, y: 8, layerId: 'enterprise-it' }),
    Object.freeze({ nodeId: 'enterprise-firewall', title: '企业防火墙', iconKey: 'firewall', x: 76, y: 8, layerId: 'enterprise-it' }),
    Object.freeze({ nodeId: 'historian-data-server', title: 'PI 历史数据服务器', iconKey: 'server', x: 24, y: 28, layerId: 'production-dmz' }),
    Object.freeze({ nodeId: 'dmz-industrial-firewall', title: 'DMZ 工业防火墙', iconKey: 'firewall', x: 50, y: 28, layerId: 'production-dmz' }),
    Object.freeze({ nodeId: 'scada-security-gateway', title: '燃气管网 SCADA 网关', iconKey: 'data-gateway', x: 76, y: 28, layerId: 'production-dmz' }),
    Object.freeze({ nodeId: 'operator-station', title: '机组操作员站', iconKey: 'workstation', x: 14, y: 50, layerId: 'plant-control' }),
    Object.freeze({ nodeId: 'gas-network', title: 'DCS 监控核心交换机', iconKey: 'core-switch', x: 38, y: 50, layerId: 'plant-control' }),
    Object.freeze({ nodeId: 'plant-engineering-station', title: '燃机专用工程师站', iconKey: 'workstation', x: 62, y: 50, layerId: 'plant-control' }),
    Object.freeze({ nodeId: 'plant-data-station', title: '性能优化工作站', iconKey: 'workstation', x: 86, y: 50, layerId: 'plant-control' }),
    Object.freeze({ nodeId: 'inlet-duct', title: '燃机 Mark VIe 控制器', iconKey: 'plc', x: 12, y: 69, layerId: 'unit-control' }),
    Object.freeze({ nodeId: 'hrsg', title: 'HRSG 余热锅炉 DCS', iconKey: 'dcs', x: 30, y: 69, layerId: 'unit-control' }),
    Object.freeze({ nodeId: 'steam-turbine', title: '蒸汽轮机控制器', iconKey: 'steam-turbine', x: 44, y: 69, layerId: 'unit-control' }),
    Object.freeze({ nodeId: 'generator', title: '发电机励磁保护装置', iconKey: 'excitation-system', x: 59, y: 69, layerId: 'unit-control' }),
    Object.freeze({ nodeId: 'auxiliary-plc', title: '辅机系统 PLC', iconKey: 'plc', x: 74, y: 69, layerId: 'unit-control' }),
    Object.freeze({ nodeId: 'grid-output', title: '燃机安全 SIL 控制器', iconKey: 'sis-system', x: 89, y: 69, layerId: 'unit-control' }),
    Object.freeze({ nodeId: 'fuel-gas-pressure-valve', title: '燃气调压控制阀组', iconKey: 'instrument', x: 6, y: 88, layerId: 'field-device' }),
    Object.freeze({ nodeId: 'fuel-gas-electric-actuator', title: '燃机燃烧器执行机构', iconKey: 'instrument', x: 18, y: 88, layerId: 'field-device' }),
    Object.freeze({ nodeId: 'hrsg-drum-level-sensor', title: '余热锅炉温度变送器', iconKey: 'instrument', x: 30, y: 88, layerId: 'field-device' }),
    Object.freeze({ nodeId: 'steam-main-control-valve', title: '汽机主汽调节阀', iconKey: 'instrument', x: 44, y: 88, layerId: 'field-device' }),
    Object.freeze({ nodeId: 'generator-outlet-breaker', title: '发电机出口断路器', iconKey: 'circuit-breaker', x: 59, y: 88, layerId: 'field-device' }),
    Object.freeze({ nodeId: 'condensate-pump-vfd', title: '循环水泵变频器', iconKey: 'plc', x: 74, y: 88, layerId: 'field-device' }),
    Object.freeze({ nodeId: 'fuel-gas-leak-detector', title: '燃气泄漏检测探头', iconKey: 'instrument', x: 89, y: 88, layerId: 'field-device' }),
  ]),
  /**
   * 总览图中与已核验三维入口对应的重点区域。成员集合显式登记，发布构建不会按标题、坐标或连线猜测子节点。
   * 过滤拓扑只保存筛选规则，注册表投影时会清空 focusRegions，确保重点框不出现在关键环节。
   */
  focusRegions: Object.freeze([
    Object.freeze({
      regionId: 'focus.gas-turbine-control',
      anchorNodeId: 'inlet-duct',
      nodeIds: Object.freeze(['inlet-duct', 'fuel-gas-pressure-valve', 'fuel-gas-electric-actuator']),
      label: '燃机控制区域',
    }),
    Object.freeze({
      regionId: 'focus.hrsg-control',
      anchorNodeId: 'hrsg',
      nodeIds: Object.freeze(['hrsg', 'hrsg-drum-level-sensor']),
      label: '余热锅炉控制区域',
    }),
    Object.freeze({
      regionId: 'focus.steam-turbine-control',
      anchorNodeId: 'steam-turbine',
      nodeIds: Object.freeze(['steam-turbine', 'steam-main-control-valve']),
      label: '蒸汽轮机控制区域',
    }),
  ]),
  /**
   * 连线颜色和实/虚线严格复用燃煤拓扑的四类颜色常量：灰色表示企业 IT，
   * 蓝色表示 DMZ/厂级网络，绿色表示厂级到单元控制层，橙色表示单元控制到现场设备层。
   * 颜色是资料中的二维视觉分类，不代表告警、故障、权限或实时通信状态；每条边显式登记，
   * 渲染器不得根据节点坐标、标题或层级运行时猜测。三-边15按资料保留绿色虚线。
   */
  edges: Object.freeze([
    Object.freeze({ edgeId: 'route.enterprise-core-to-ems', fromNodeId: 'enterprise-core-switch', toNodeId: 'ems-system', title: '企业管理网通信', lineColor: coalPowerEdgeColors.gray, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.enterprise-core-to-firewall', fromNodeId: 'enterprise-core-switch', toNodeId: 'enterprise-firewall', title: '企业网安全边界', lineColor: coalPowerEdgeColors.gray, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.enterprise-firewall-to-dmz', fromNodeId: 'enterprise-firewall', toNodeId: 'dmz-industrial-firewall', title: '企业网至生产 DMZ', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.dmz-to-dcs-core', fromNodeId: 'dmz-industrial-firewall', toNodeId: 'gas-network', title: '生产 DMZ 至 DCS 监控核心', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.dcs-core-to-historian', fromNodeId: 'gas-network', toNodeId: 'historian-data-server', title: '历史数据同步', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.dcs-core-to-scada', fromNodeId: 'gas-network', toNodeId: 'scada-security-gateway', title: 'SCADA 数据交换', protocolLabel: 'DNP3', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.dcs-core-to-operator', fromNodeId: 'gas-network', toNodeId: 'operator-station', title: '机组操作网络', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.dcs-core-to-engineering', fromNodeId: 'gas-network', toNodeId: 'plant-engineering-station', title: '燃机工程维护网络', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.dcs-core-to-performance', fromNodeId: 'gas-network', toNodeId: 'plant-data-station', title: '性能优化网络', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.dcs-core-to-markvie', fromNodeId: 'gas-network', toNodeId: 'inlet-duct', title: '燃机控制链路', protocolLabel: '专用控制总线', lineColor: coalPowerEdgeColors.green, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.dcs-core-to-hrsg', fromNodeId: 'gas-network', toNodeId: 'hrsg', title: '余热锅炉控制链路', lineColor: coalPowerEdgeColors.green, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.dcs-core-to-steam', fromNodeId: 'gas-network', toNodeId: 'steam-turbine', title: '汽机控制链路', lineColor: coalPowerEdgeColors.green, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.dcs-core-to-generator', fromNodeId: 'gas-network', toNodeId: 'generator', title: '发电机保护链路', lineColor: coalPowerEdgeColors.green, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.dcs-core-to-auxiliary', fromNodeId: 'gas-network', toNodeId: 'auxiliary-plc', title: '辅机控制链路', lineColor: coalPowerEdgeColors.green, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.dcs-core-to-sil', fromNodeId: 'gas-network', toNodeId: 'grid-output', title: '燃机安全联锁链路', lineColor: coalPowerEdgeColors.green, lineStyle: 'dashed' }),
    Object.freeze({ edgeId: 'route.markvie-to-pressure-valve', fromNodeId: 'inlet-duct', toNodeId: 'fuel-gas-pressure-valve', title: '燃气调压控制', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.markvie-to-actuator', fromNodeId: 'inlet-duct', toNodeId: 'fuel-gas-electric-actuator', title: '燃烧器执行控制', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.hrsg-to-temperature-transmitter', fromNodeId: 'hrsg', toNodeId: 'hrsg-drum-level-sensor', title: '余热锅炉温度采集', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.steam-to-main-control-valve', fromNodeId: 'steam-turbine', toNodeId: 'steam-main-control-valve', title: '主汽调节控制', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.generator-to-outlet-breaker', fromNodeId: 'generator', toNodeId: 'generator-outlet-breaker', title: '发电机出口保护', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.auxiliary-to-vfd', fromNodeId: 'auxiliary-plc', toNodeId: 'condensate-pump-vfd', title: '循环水泵控制', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
    Object.freeze({ edgeId: 'route.sil-to-leak-detector', fromNodeId: 'grid-output', toNodeId: 'fuel-gas-leak-detector', title: '燃气泄漏安全联锁', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
  ]),
})

/** 将唯一总图和只读流程过滤规则转换为当前发布清单格式。 */
function createCcgtTopologies(manifestVersion) {
  const overview = {
    topologyId: 'topology.gas-power.overview',
    sceneId: 'gas-power',
    title: ccgtOtTopology.title,
    configVersion: manifestVersion,
    layers: ccgtOtTopology.layers.map((layer) => ({ ...layer })),
    nodes: ccgtOtTopology.nodes.map((node) => {
      const sceneNodeId = verifiedGasSceneNodeIdByTopologyNodeId.get(node.nodeId)
      return {
        ...node,
        ...(sceneNodeId ? { sceneNodeId } : {}),
        deviceStatus: 'offline',
        /*
         * 所有来源节点都用稳定 nodeId（节点标识）参与外部协议。平台读取该标识并在自身系统内
         * 维护真实设备映射；本清单和运行时均不得保存、接收或推导平台设备编号。
         */
        doubleClickBehavior: 'emit-node',
      }
    }),
    edges: ccgtOtTopology.edges.map((edge) => ({ ...edge, evidenceStatus: 'verified' })),
    focusRegions: ccgtOtTopology.focusRegions.map((region) => ({
      ...region,
      nodeIds: [...region.nodeIds],
    })),
  }

  // 新 JSON 图纸完整承载总览，不再生成旧版关键流程过滤拓扑及其局部排布。
  return [overview]
}

/**
 * 固定九场景闭集由已验证夹具提供，燃气条目替换为一张权威总图。
 * 这既满足运行时的闭集契约，也明确表达另外八个场景仍没有业务内容，不能被本测试包初始化或验收。
 */
export async function createGasOnlyManifest(releaseId) {
  const fixturePath = path.join(workspaceRoot, 'tests', 'fixtures', 'scene-topology-contract-valid.json')
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
  const manifestVersion = `gas-power-smoke.${releaseId}`
  const gasTopologies = createCcgtTopologies(manifestVersion)
  const gasActionDefinitions = [
    {
      actionId: 'action.gas-power.overview',
      title: '返回燃气总览',
      targetSceneId: 'gas-power',
      targetViewMode: 'business',
      targetTopologyId: 'topology.gas-power.overview',
      allowedParameters: [],
      /*
       * 总览必须复用 Unity 已验证的流程入口：该步骤会清除流程与告警描边、恢复上下文材质、
       * 显示场景根模型并重新框选总场景。失败时保留原二维和三维上下文，禁止只恢复二维总图。
       */
      unityAction: { type: 'enterProcessStep', processId: 'gas-power-generation', stepId: 'overview', defaultUnitId: 'all', isolate: true },
      failurePolicy: 'keep-current-context',
      configVersion: manifestVersion,
    },
    {
      actionId: 'action.gas-power.gas-turbine',
      title: '进入燃气轮机关键环节',
      targetSceneId: 'gas-power',
      targetViewMode: 'process-detail',
      processDetailId: 'process-detail.gas-power.gas-turbine',
      allowedParameters: [],
      /*
       * 第三层只发送独立关键环节命令。流程步骤过滤、节点聚焦、上下文半透明和包围盒定位
       * 均不属于该事务，也不得通过动作参数绕过目录的固定资源、相机位和状态节点映射。
       */
      unityAction: { type: 'enterProcessDetail', processDetailId: 'process-detail.gas-power.gas-turbine' },
      failurePolicy: 'keep-current-context',
      configVersion: manifestVersion,
    },
  ]

  const scenes = fixture.scenes.map((scene) => ({
    ...scene,
    title: scene.sceneId === 'gas-power' ? '燃气发电' : `待交付场景：${scene.sceneId}`,
    // Unity 当前桥接器只接受该已验证映射版本；其余占位场景同样保持契约一致，但不会被测试宿主选择。
    sceneMappingVersion: unitySceneMappingVersion,
    resourceVersion: scene.sceneId === 'gas-power' ? `resource.${unityReleaseId}.gas-power` : `placeholder.${scene.sceneId}`,
    // 外层只可触发燃气总览和唯一独立燃机环节；不暴露 Unity 方法、模型名或临时步骤字符串。
    supportedActionIds: scene.sceneId === 'gas-power' ? gasActionDefinitions.map((action) => action.actionId) : [],
    topologyIds: scene.sceneId === 'gas-power' ? gasTopologies.map((topology) => topology.topologyId) : scene.topologyIds,
  }))

  const topologies = fixture.topologies.map((topology) => (
    topology.sceneId === 'gas-power'
      ? gasTopologies
      : {
          ...topology,
          title: `待交付拓扑：${topology.sceneId}`,
          configVersion: manifestVersion,
          nodes: [],
          edges: [],
        }
  )).flat()

  const unitySceneMappings = fixture.unitySceneMappings.map((mapping) => ({
    ...mapping,
    mappingVersion: unitySceneMappingVersion,
    // 只发布总览步骤及已核验的三维节点映射；没有三维路由证据，因此路径始终为空。
    sceneNodeIds: mapping.sceneId === 'gas-power' ? [...verifiedGasSceneNodeIdByTopologyNodeId.values()] : [],
    // 第二层流程能力独立于二维节点点击映射：这里只保留总览步骤；燃机第三层由 processDetails（关键环节目录）承载。
    // 复制对象而非复用冻结数组中的对象，防止后续清单处理代码意外修改共享声明。
    processSteps: mapping.sceneId === 'gas-power'
      ? verifiedGasProcessSteps.map((step) => ({ ...step }))
      : [],
    routeIds: [],
  }))

  return {
    manifestVersion,
    // 构建标识保留为当前正式 Unity 发布基线，方便定位该测试包究竟使用哪个网页图形产物。
    unityBuildId: unityReleaseId,
    unityRuntimeKey: getUnityRuntimeKey('gas-power'),
    scenes,
    topologies,
    // 产品已下线下钻，清单显式发布空集合，避免旧内容继续出现在注册表或外部接口中。
    drilldowns: [],
    actions: gasActionDefinitions,
    // 返回新对象，防止构建流程或测试意外修改冻结的唯一目录源。
    processDetails: gasProcessDetails.map((detail) => ({ ...detail })),
    unitySceneMappings,
  }
}

/**
 * 生成燃煤独立结构清单。
 *
 * 燃气自测包继续由 createGasOnlyManifest（燃气独立清单生成器）生成，避免改变既有燃气
 * 回归用例的 23 节点/22 连线基线；燃煤使用同一九场景闭集和相同协议边界，但只激活
 * coal-power 的总图、总览动作以及 Unity 属性面板已确认的映射。
 */
export async function createCoalPowerManifest(releaseId) {
  const fixturePath = path.join(workspaceRoot, 'tests', 'fixtures', 'scene-topology-contract-valid.json')
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
  const manifestVersion = `coal-power-smoke.${releaseId}`
  const coalTopologies = createCoalPowerTopologies(manifestVersion)
  const coalActionDefinitions = createCoalPowerActions(manifestVersion)

  const scenes = fixture.scenes.map((scene) => ({
    ...scene,
    title: scene.sceneId === 'coal-power' ? '燃煤发电' : `待交付场景：${scene.sceneId}`,
    // Unity 场景切换协议使用统一映射版本；煤电的三维节点清单另由 unitySceneMappings 显式登记。
    sceneMappingVersion: unitySceneMappingVersion,
    resourceVersion: scene.sceneId === 'coal-power' ? `resource.${unityReleaseId}.coal-power` : `placeholder.${scene.sceneId}`,
    supportedActionIds: scene.sceneId === 'coal-power' ? coalActionDefinitions.map((action) => action.actionId) : [],
    topologyIds: scene.sceneId === 'coal-power' ? coalTopologies.map((topology) => topology.topologyId) : scene.topologyIds,
  }))

  const topologies = fixture.topologies.map((topology) => (
    topology.sceneId === 'coal-power'
      ? coalTopologies
      : {
          ...topology,
          title: `待交付拓扑：${topology.sceneId}`,
          configVersion: manifestVersion,
          nodes: [],
          edges: [],
        }
  )).flat()

  const coalSceneNodeIds = coalPowerSceneNodeMappings.map((mapping) => mapping.sceneNodeId)
  const unitySceneMappings = fixture.unitySceneMappings.map((mapping) => ({
    ...mapping,
    mappingVersion: unitySceneMappingVersion,
    // 只发布属性面板中真实登记的三个节点和四个流程步骤；煤电当前没有已确认的三维路径。
    sceneNodeIds: mapping.sceneId === 'coal-power' ? [...coalSceneNodeIds] : [],
    processSteps: mapping.sceneId === 'coal-power'
      ? coalPowerProcessSteps.map((step) => ({ ...step }))
      : [],
    routeIds: [],
  }))

  return {
    manifestVersion,
    unityBuildId: unityReleaseId,
    unityRuntimeKey: getUnityRuntimeKey('coal-power'),
    scenes,
    topologies,
    // 产品已下线下钻，燃煤清单同样不再发布旧说明内容。
    drilldowns: [],
    actions: coalActionDefinitions,
    // 燃煤本轮没有第三层资源，显式空数组验证目录天然支持零项，而非伪造占位环节。
    processDetails: [],
    unitySceneMappings,
  }
}

/**
 * 生成同时承载燃气、燃煤真实配置的原子结构清单。
 *
 * 两个独立清单生成器继续保留为场景专项回归夹具；正式发布改用本函数一次装配两张真实总览拓扑、
 * 两个受控总览动作和六组三维映射。initialSceneId（初始场景标识）只决定当前入口使用的运行时别名，
 * 不再裁剪另一场景内容，因此同一 Unity 实例可在燃气、燃煤之间往返并保持双向选中。
 */
export async function createConfiguredPowerScenesManifest(releaseId, initialSceneId = 'gas-power') {
  if (initialSceneId !== 'gas-power' && initialSceneId !== 'coal-power') {
    throw new Error('联合清单初始场景只能是 gas-power 或 coal-power。')
  }

  const [gasManifest, coalManifest] = await Promise.all([
    createGasOnlyManifest(releaseId),
    createCoalPowerManifest(releaseId),
  ])
  const manifestVersion = `power-scenes.${releaseId}`
  const coalSceneById = new Map(coalManifest.scenes.map((scene) => [scene.sceneId, scene]))
  const coalMappingBySceneId = new Map(coalManifest.unitySceneMappings.map((mapping) => [mapping.sceneId, mapping]))

  const scenes = gasManifest.scenes.map((gasScene) => {
    if (gasScene.sceneId !== 'coal-power') return { ...gasScene }
    const coalScene = coalSceneById.get(gasScene.sceneId)
    if (!coalScene) throw new Error('燃煤场景定义缺失，无法生成联合清单。')
    return { ...coalScene }
  })
  const topologies = [
    ...gasManifest.topologies.filter((topology) => topology.sceneId !== 'coal-power'),
    ...coalManifest.topologies.filter((topology) => topology.sceneId === 'coal-power'),
  ].map((topology) => ({ ...topology, configVersion: manifestVersion }))
  const actions = [...gasManifest.actions, ...coalManifest.actions]
    .map((action) => ({ ...action, configVersion: manifestVersion }))
  const processDetails = [...gasManifest.processDetails, ...coalManifest.processDetails]
    .map((detail) => ({ ...detail }))
  // 两张新版图均不支持下钻，联合清单不再合并任何历史说明内容。
  const drilldowns = []
  const unitySceneMappings = gasManifest.unitySceneMappings.map((gasMapping) => {
    if (gasMapping.sceneId !== 'coal-power') return { ...gasMapping }
    const coalMapping = coalMappingBySceneId.get(gasMapping.sceneId)
    if (!coalMapping) throw new Error('燃煤 Unity 映射缺失，无法生成联合清单。')
    return { ...coalMapping }
  })

  return {
    manifestVersion,
    unityBuildId: unityReleaseId,
    // 两个键当前指向同一九场景构建；该字段与入口初始场景保持一致，但不会限制后续 switchScene（切换场景）。
    unityRuntimeKey: getUnityRuntimeKey(initialSceneId),
    scenes,
    topologies,
    drilldowns,
    actions,
    processDetails,
    unitySceneMappings,
  }
}

/**
 * 内部自测宿主页只覆盖本轮唯一纵向链路：全局沙盘 → 燃气业务总览 → 独立燃机关键环节。
 * 页面保留三层导航，并在关键环节稳定后显示播放/停止按钮。播放按钮只发送受控外层命令，
 * 由当前子应用从稳定上下文解析关键环节并转发 Unity，不使用设备四态模拟动态控制，也不直连 Unity 内嵌框架。
 */
export function createSelfTestPage(manifestVersion, initialSceneId = 'gas-power') {
  if (initialSceneId !== 'gas-power' && initialSceneId !== 'coal-power') {
    throw new Error('本地自测页初始场景只能是 gas-power 或 coal-power。')
  }

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <!-- 使用空数据站点图标，避免本地联调浏览器自动请求不存在的 /favicon.ico 并产生与业务无关的 404。 -->
    <link rel="icon" href="data:," />
    <title>燃气轮机关键环节全链路自测包</title>
    <style>
      html, body, #visualization-shell { inline-size: 100%; block-size: 100%; margin: 0; overflow: hidden; background: #061323; }
      #visualization-shell { display: block; border: 0; }
       .test-controls { position: fixed; z-index: 2; inset-inline-start: 12px; inset-block-start: 12px; display: grid; gap: 8px; inline-size: min(17rem, calc(100% - 24px)); padding: 10px; border: 1px solid rgb(103 232 249 / 45%); border-radius: 8px; color: #cffafe; background: rgb(8 47 73 / 92%); font: 12px/1.4 system-ui, sans-serif; }
       .test-controls__title { font-weight: 700; }
       .test-controls__hint { margin: 0; color: #bae6fd; }
       .test-controls__actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; padding-block-start: 6px; border-block-start: 1px solid rgb(103 232 249 / 25%); }
       .test-controls__playback { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
       .test-controls button { min-block-size: 32px; border: 1px solid rgb(103 232 249 / 45%); border-radius: 5px; color: #e0f2fe; background: #0c4a6e; cursor: pointer; }
       .test-controls button:hover:not(:disabled) { background: #075985; }
       .test-controls button:disabled { opacity: .55; cursor: wait; }
       .test-status { position: fixed; z-index: 2; inset-inline-end: 12px; inset-block-end: 12px; max-inline-size: min(30rem, calc(100% - 24px)); padding: 8px 10px; border: 1px solid rgb(103 232 249 / 45%); border-radius: 6px; color: #cffafe; background: rgb(8 47 73 / 88%); font: 12px/1.4 system-ui, sans-serif; pointer-events: none; }
    </style>
  </head>
  <body>
    <!-- 仅承载嵌入壳；真实 Unity iframe 由壳内唯一宿主创建，外层测试页绝不直连 Unity。 -->
    <iframe id="visualization-shell" title="燃气发电场景与拓扑嵌入壳" allow="fullscreen"></iframe>
    <section class="test-controls" aria-label="燃气轮机第三层外部消息测试操作">
      <span class="test-controls__title">燃气轮机单环节全链路自测</span>
      <p class="test-controls__hint">进入关键环节后可使用播放/停止控制；按钮仅通过外层受控协议操作当前三维模型。</p>
      <div class="test-controls__actions" aria-label="视图链路操作">
        <button type="button" data-command="overview" disabled>沙盘</button>
        <button type="button" data-action-id="action.gas-power.overview" disabled>燃气</button>
        <button type="button" data-action-id="action.gas-power.gas-turbine" disabled>关键环节</button>
      </div>
      <div class="test-controls__playback" aria-label="关键环节播放控制">
        <button type="button" data-playback="play" disabled>播放</button>
        <button type="button" data-playback="stop" disabled>停止</button>
      </div>
    </section>
     <output id="test-status" class="test-status" aria-live="polite">正在建立第二版协议并初始化全局沙盘。</output>
    <script>
      (() => {
        // 协议常量与 Vue 壳严格一致；只保留本次初始化需要的有限状态，避免测试页累积完整消息或业务载荷。
        const channel = 'power-scene-topology-shell';
        const version = ${expectedUnityProtocolVersion};
        const instanceId = 'gas-power-smoke-host';
        const shell = document.querySelector('#visualization-shell');
        const status = document.querySelector('#test-status');
        const actionButtons = Array.from(document.querySelectorAll('[data-action-id]'));
        const playbackButtons = Array.from(document.querySelectorAll('[data-playback]'));
        const overviewButton = document.querySelector('[data-command="overview"]');
        const commandButtons = [...actionButtons, overviewButton].filter(Boolean);
        // 页面只允许总览和唯一燃机关键环节动作，燃煤及其他燃气环节均不能通过页面构造。
        const allowedActionIds = new Set([
          'action.gas-power.overview',
          'action.gas-power.gas-turbine',
        ]);
        const shellOrigin = window.location.origin;
        let sessionId = '';
        let messageSequence = 0;
        let contextRevision;
        let stableViewMode = '';
        const pendingMessageIds = new Set();
        const completedMessageIds = new Set();

        /**
         * 所有可见导航按钮共用一个在途门禁，防止并发视图命令覆盖当前事务。
         */
        function setCommandButtonsDisabled(disabled) {
          commandButtons.forEach((button) => { button.disabled = disabled; });
        }

        /** 播放控制只在关键环节稳定态可用，导航切换或播放命令在途时临时锁定，避免重复下发。 */
        function setPlaybackButtonsDisabled(disabled) {
          playbackButtons.forEach((button) => { button.disabled = disabled; });
        }

        function refreshPlaybackButtons() {
          setPlaybackButtonsDisabled(stableViewMode !== 'process-detail' || pendingMessageIds.size > 0);
        }

        /** 所有命令共享同一第二版信封工厂，标识只由受控前缀和本地单调序号生成。 */
        function sendCommand(type, payload, prefix) {
          if (!sessionId) return;
          messageSequence += 1;
          const messageId = prefix + '-' + messageSequence;
          pendingMessageIds.add(messageId);
          shell.contentWindow?.postMessage({
            channel,
            version,
            instanceId,
            sessionId,
            messageId,
            type,
            timestamp: Date.now(),
            payload,
          }, shellOrigin);
          return messageId;
        }

        /** 初始化目标固定为全局沙盘；第一层没有拓扑，也不会预加载任何第三层资源。 */
        function initializeOverview() {
          sendCommand('system.init', {
            sceneId: 'overview',
            expectedManifestVersion: '${manifestVersion}',
          }, 'gas-turbine-self-test-init');
        }

        /**
         * 仅向当前已协商的嵌入壳发送两项清单动作之一，并携带最近稳定上下文版本。
         * 版本不匹配由壳返回明确冲突，页面不会绕过事务直接切换拓扑或调用 Unity 方法。
         */
        function triggerWorkflow(actionId) {
          if (!sessionId || !Number.isSafeInteger(contextRevision) || !allowedActionIds.has(actionId)) return;
          setCommandButtonsDisabled(true);
          status.textContent = '正在执行受控流程动作：' + actionId + '。';
          return sendCommand('workflow.trigger', { actionId, expectedContextRevision: contextRevision }, 'gas-turbine-self-test-workflow');
        }

        actionButtons.forEach((button) => {
          button.addEventListener('click', () => triggerWorkflow(button.dataset.actionId ?? ''));
        });

        /** 返回沙盘只调用外层受控视图命令，不能伪造一张空拓扑代表第一层。 */
        function returnToOverview() {
          if (!Number.isSafeInteger(contextRevision)) return;
          setCommandButtonsDisabled(true);
          sendCommand('view.open', { sceneId: 'overview', expectedContextRevision: contextRevision }, 'gas-turbine-self-test-overview');
        }

        overviewButton?.addEventListener('click', returnToOverview);

        /** 播放/停止只携带布尔开关和稳定上下文版本，场景与关键环节编号由子应用从当前上下文读取。 */
        function setProcessDetailPlayback(playing) {
          if (!sessionId || stableViewMode !== 'process-detail' || !Number.isSafeInteger(contextRevision)) return;
          setPlaybackButtonsDisabled(true);
          status.textContent = playing ? '正在请求播放关键环节动态。' : '正在请求停止关键环节动态。';
          return sendCommand('process-detail.playback', { playing, expectedContextRevision: contextRevision }, 'gas-turbine-self-test-playback');
        }

        playbackButtons.forEach((button) => {
          button.addEventListener('click', () => setProcessDetailPlayback(button.dataset.playback === 'play'));
        });

        /** 只接受来自当前嵌入壳、当前来源和当前实例的事件，防止同源旁路页面伪造初始化完成。 */
        window.addEventListener('message', (event) => {
          const message = event.data;
          if (event.origin !== shellOrigin || event.source !== shell.contentWindow) return;
          if (!message || message.channel !== channel || message.version !== version || message.instanceId !== instanceId) return;

          if (message.type === 'system.ready' && typeof message.sessionId === 'string') {
            sessionId = message.sessionId;
            status.textContent = '运行时已就绪，正在进入全局沙盘。';
            initializeOverview();
            return;
          }

          if (message.type === 'view.changed' && Number.isSafeInteger(message.payload?.contextRevision)) {
            if (typeof message.replyTo === 'string' && completedMessageIds.has(message.replyTo)) {
              // 已经结案的命令不得再次改变页面所认定的稳定视图；迟到结果必须在页面内部隔离，
              // 避免旧结果覆盖当前上下文或重新显示已移除的诊断列表。
              return;
            }
            contextRevision = message.payload.contextRevision;
            stableViewMode = message.payload.viewMode ?? (message.payload.sceneId === 'overview' ? 'overview' : 'business');
            setCommandButtonsDisabled(false);
            refreshPlaybackButtons();
            if (stableViewMode === 'process-detail') {
              const validDetail = message.payload.sceneId === 'gas-power' &&
                message.payload.processDetailId === 'process-detail.gas-power.gas-turbine' &&
                message.payload.topologyId === undefined;
              status.textContent = validDetail
                ? '燃气轮机独立模型已提交：全屏三维且无拓扑。'
                : '失败：第三层稳定状态包含错误编号或残留拓扑。';
            } else if (stableViewMode === 'business' &&
              message.payload.topologyId === 'topology.gas-power.overview' &&
              message.payload?.actionId === 'action.gas-power.overview') {
              // 业务层不能只凭同名二维拓扑显示成功，必须同时确认本次受控总览动作已经提交。
              status.textContent = '燃气业务场景与燃气总拓扑已稳定提交。';
            } else if (stableViewMode === 'overview' && message.payload.sceneId === 'overview' && message.payload.topologyId === undefined) {
              status.textContent = '全局沙盘已稳定提交，当前无拓扑。';
            } else {
              status.textContent = '失败：收到不属于本轮链路的稳定视图。';
            }
            return;
          }

          if (message.type === 'command.result' && typeof message.replyTo === 'string') {
            pendingMessageIds.delete(message.replyTo);
            completedMessageIds.add(message.replyTo);
            while (completedMessageIds.size > 32) completedMessageIds.delete(completedMessageIds.values().next().value);
            if (message.payload?.success !== true) {
              const errorCode = typeof message.payload?.error?.code === 'string' && /^[a-z0-9.-]{1,64}$/.test(message.payload.error.code)
                ? message.payload.error.code
                : 'unknown';
              status.textContent = '操作未完成，上一稳定视图保持不变（错误码：' + errorCode + '）。';
            }
            if (pendingMessageIds.size === 0 && Number.isSafeInteger(contextRevision)) setCommandButtonsDisabled(false);
            refreshPlaybackButtons();
            return;
          }

          if (message.type === 'system.ack' && typeof message.replyTo === 'string') {
            pendingMessageIds.delete(message.replyTo);
            if (message.payload?.success === true) {
              /*
               * system.ack（系统受理回执）只证明初始化命令已被壳接收；同一 replyTo 后面仍会收到
               * view.changed（稳定视图变更）。因此这里绝不能写入 completedMessageIds（已完成命令集合），
               * 否则首次沙盘稳定视图会被误判为迟到结果并被丢弃。真正终结业务命令的仍是 command.result。
               */
              return;
            }
          }

          if ((message.type === 'system.ack' || message.type === 'system.error') && message.payload?.success !== true) {
            /*
             * 联调包必须展示外层协议已经收敛的稳定错误码和阶段，否则运行诊断只剩通用失败文案，
             * 无法区分场景加载、拓扑激活或动作执行失败。这里只接受长度受限的标识字符，
             * 不显示下游自由文本、资源地址或异常内容，避免诊断增强破坏脱敏边界。
             */
            const errorCode = typeof message.payload?.error?.code === 'string' && /^[a-z0-9.-]{1,64}$/.test(message.payload.error.code)
              ? message.payload.error.code
              : 'unknown';
            const errorStage = typeof message.payload?.error?.stage === 'string' && /^[a-z0-9.-]{1,64}$/.test(message.payload.error.stage)
              ? message.payload.error.stage
              : 'unknown';
             status.textContent = '事务未完成，上一稳定视图应保持不变（错误码：' + errorCode + '；阶段：' + errorStage + '）。';
            if (Number.isSafeInteger(contextRevision)) setCommandButtonsDisabled(false);
          }
        });

        // 监听器先注册后设置地址，避免本机缓存命中时漏收 system.ready。
        const shellUrl = new URL('./shell/embed', window.location.href);
        shellUrl.searchParams.set('parentOrigin', shellOrigin);
        shellUrl.searchParams.set('instanceId', instanceId);
        shellUrl.searchParams.set('protocolVersion', String(version));
        shell.src = shellUrl.toString();
      })();
    </script>
  </body>
</html>
`
}

/**
 * 生成合作方联调包和正式包的根入口。
 *
 * 平台内嵌时该页面只在同一浏览器导航中进入协议壳，保证协议壳的 parent（直接父窗口）就是平台。
 * 直接打开根地址且没有查询参数时，入口补齐当前服务来源和 directAccess（直接访问）标记；壳只在顶层窗口
 * 通过同一套 system.ready → system.init（系统就绪→系统初始化）握手显示燃气总览，不改变平台嵌入路径。
 */
function createIndependentServiceEntryPage(sceneId = 'gas-power') {
  const sceneTitle = sceneId === 'coal-power' ? '燃煤' : '燃气'
  const directAccessInstanceId = `${sceneId}-direct-access`
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="power-entry-mode" content="platform-direct-shell-redirect" />
    <link rel="icon" href="data:," />
    <title>${sceneTitle}发电场景与拓扑</title>
  </head>
  <body>
    <script>
     (() => {
        const shellUrl = new URL('./shell/embed', window.location.href);
        // 平台地址原样保留；无平台参数时只补齐当前服务来源、实例和协议版本，初始化仍由壳内安全桥完成。
        if (window.location.search) {
          shellUrl.search = window.location.search;
        } else {
          shellUrl.searchParams.set('parentOrigin', window.location.origin);
          shellUrl.searchParams.set('instanceId', '${directAccessInstanceId}');
          shellUrl.searchParams.set('protocolVersion', '${expectedUnityProtocolVersion}');
          shellUrl.searchParams.set('directAccess', '1');
        }
        // 场景与总览参数由发布包固定，即使平台附带自身桥接参数也不能把燃煤壳退回燃气运行时登记。
        shellUrl.searchParams.set('sceneId', '${sceneId}');
        shellUrl.searchParams.set('topologyId', 'topology.${sceneId}.overview');
        window.location.replace(shellUrl.toString());
      })();
    </script>
  </body>
</html>
`
}

/**
 * 生成发布根入口。
 *
 * 本地测试包需要在没有合作方父页面时自动完成燃气初始化，因此保留同源宿主和唯一壳嵌入框架。
 * 合作方联调包和正式包则必须让平台成为协议壳的直接父页面，不能由我方根页面代替平台发送初始化命令。
 */
export function createHostPage(manifestVersion, packageType = 'local-test', sceneId = 'gas-power') {
  if (!releasePackageTypes.includes(packageType)) throw new Error('无法为未知包类型生成发布入口。')
  if (sceneId !== 'gas-power' && sceneId !== 'coal-power') throw new Error('无法为未知发布场景生成入口。')
  if (packageType !== 'local-test') return createIndependentServiceEntryPage(sceneId)

  const sceneTitle = sceneId === 'coal-power' ? '燃煤' : '燃气'
  const sceneInstanceId = `${sceneId}-platform-host`
  const sceneTopologyId = `topology.${sceneId}.overview`
  const sceneInitMessageId = `${sceneId}-platform-init-`
  const initializeFunctionName = sceneId === 'coal-power' ? 'initializeCoalPower' : 'initializeGasPower'

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="power-entry-mode" content="local-bootstrap-host" />
    <!-- 使用空数据站点图标，避免平台测试包产生与业务无关的 favicon 404 请求。 -->
    <link rel="icon" href="data:," />
    <title>${sceneTitle}发电场景与拓扑</title>
    <style>
      html, body, #visualization-shell { inline-size: 100%; block-size: 100%; margin: 0; overflow: hidden; background: #061323; }
      #visualization-shell { display: block; border: 0; }
    </style>
  </head>
  <body>
    <!-- 平台入口只承载嵌入壳；真实 Unity iframe 由壳内唯一宿主创建，外层不直连 Unity。 -->
    <iframe id="visualization-shell" title="${sceneTitle}发电场景与拓扑嵌入壳" allow="fullscreen"></iframe>
    <script>
      (() => {
        // 协议常量与 Vue 壳严格一致；平台入口只保留初始化所需的最小会话状态。
        const channel = 'power-scene-topology-shell';
        const version = ${expectedUnityProtocolVersion};
        const instanceId = '${sceneInstanceId}';
        const shell = document.querySelector('#visualization-shell');
        const shellOrigin = window.location.origin;
        let sessionId = '';
        let messageSequence = 0;

        /** 仅用当前会话生成一次受控初始化信封，不接受页面输入或任意场景、拓扑和 Unity 方法名。 */
        function ${initializeFunctionName}() {
          if (!sessionId) return;
          messageSequence += 1;
          shell.contentWindow?.postMessage({
            channel,
            version,
            instanceId,
            sessionId,
            messageId: '${sceneInitMessageId}' + messageSequence,
            type: 'system.init',
            timestamp: Date.now(),
            payload: {
              sceneId: '${sceneId}',
              topologyId: '${sceneTopologyId}',
              expectedManifestVersion: '${manifestVersion}',
            },
          }, shellOrigin);
        }

        /** 只接受当前嵌入壳回传的就绪事件，防止同源旁路页面伪造初始化完成。 */
        window.addEventListener('message', (event) => {
          const message = event.data;
          if (event.origin !== shellOrigin || event.source !== shell.contentWindow) return;
          if (!message || message.channel !== channel || message.version !== version || message.instanceId !== instanceId) return;
          if (message.type === 'system.ready' && typeof message.sessionId === 'string') {
            sessionId = message.sessionId;
            ${initializeFunctionName}();
          }
        });

        // 监听器先注册后设置地址，避免本地缓存命中时漏收 system.ready（系统就绪）。
        const shellUrl = new URL('./shell/embed', window.location.href);
        shellUrl.searchParams.set('parentOrigin', shellOrigin);
        shellUrl.searchParams.set('instanceId', instanceId);
        shellUrl.searchParams.set('protocolVersion', String(version));
        // 本地宿主虽然由父窗口发送初始化命令，壳仍需提前选择与发布场景一致的运行时登记。
        shellUrl.searchParams.set('sceneId', '${sceneId}');
        shellUrl.searchParams.set('topologyId', '${sceneTopologyId}');
        shell.src = shellUrl.toString();
      })();
    </script>
  </body>
</html>
`
}

/**
 * 运行服务根据 Unity WebGL 的压缩扩展名返回正确 Content-Encoding（内容编码）和 MIME（媒体类型），
 * 并为不可变发布目录设置入口短缓存、普通小型版本资源长期缓存及浏览器安全响应头。
 * Unity 主播放器和场景资源体积大、切换版本频繁，必须单独使用 no-store（禁止存储），不能沿用
 * 普通版本资源的长期缓存；这同时避免 .br 文件被误当作未压缩脚本，以及旧入口引用错误版本。
 */
// 导出生成函数供发布契约测试检查最终服务脚本文本；直接执行构建时仍只写入不可变发布目录。
export function createStaticServer(packageType = 'local-test') {
  if (!releasePackageTypes.includes(packageType)) throw new Error('无法为未知包类型生成静态服务。')
  const runtimeSelfOrigin = addressMode === 'runtime-self-origin'
  const unityOrigin = runtimeSelfOrigin ? undefined : new URL(unityEntryUrl).origin
  const manifestOrigin = runtimeSelfOrigin ? undefined : new URL(topologyManifestUrl).origin
  const publicOrigin = runtimeSelfOrigin ? undefined : hostOrigin
  const serviceLabel = releaseSceneId === 'coal-power' ? '燃煤' : '燃气'
  /**
   * 只有本地测试包生成清理旧回环缓存的路径分支。合作方和正式服务从源代码层面移除
   * 自测页名称与本机地址说明，避免不可达的死分支仍污染交付文本和安全审阅结果。
   */
  const localBrowserCacheResetSource = packageType === 'local-test'
    ? `  /*
   * 本地测试包通常复用 127.0.0.1 和固定端口。根入口在加载壳之前清理该来源的旧缓存，
   * 可恢复浏览器已经产生 ERR_CACHE_READ_FAILURE（缓存读取失败）的损坏条目；
   * 只对本地根入口和自测页生效，不影响其他包的不可变资源缓存。
   */
  const resetLocalBrowserCache = requestUrl.pathname === '/'
    || requestUrl.pathname === '/index.html'
    || requestUrl.pathname === '/self-test.html'`
    : '  const resetLocalBrowserCache = false'
  return `import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { brotliDecompress } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 联调服务仅提供当前发布目录内的只读静态资源，并为 Unity 的 Brotli 压缩文件补齐响应头。 */
const releaseRoot = path.dirname(fileURLToPath(import.meta.url))
const host = ${JSON.stringify(host)}
const port = ${port}
const packageType = ${JSON.stringify(packageType)}
const addressMode = ${JSON.stringify(addressMode)}
const configuredPlatformParentOrigin = ${JSON.stringify(runtimeSelfOrigin ? null : platformParentOrigin)}
const configuredUnityOrigin = ${JSON.stringify(unityOrigin ?? null)}
const configuredManifestOrigin = ${JSON.stringify(manifestOrigin ?? null)}
const configuredPublicOrigin = ${JSON.stringify(publicOrigin ?? null)}
const mimeByExtension = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.data', 'application/octet-stream'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
])

/** 运行时同源模式只允许当前服务提供 Unity、清单和脚本；固定模式继续使用发布时核验过的来源。 */
function createContentSecurityPolicy() {
  const connectSource = configuredManifestOrigin ? "connect-src 'self' blob: " + configuredManifestOrigin : "connect-src 'self' blob:"
  const frameSource = configuredUnityOrigin ? "frame-src 'self' " + configuredUnityOrigin : "frame-src 'self'"
  let frameAncestors = "frame-ancestors 'self'"
  if (addressMode === 'fixed-origin') {
    frameAncestors = "frame-ancestors 'self' " + configuredPlatformParentOrigin
  } else {
    // 局域网合作方包不预先知道平台地址，允许通过环境变量收紧；未设置时仅作为联调包放宽嵌入，不能当正式公网安全策略。
    const configured = (process.env.POWER_ALLOWED_FRAME_ANCESTORS ?? '').split(/\\s+/).filter(Boolean)
    const validOrigins = configured.filter((value) => value === '*' || isExactOrigin(value))
    frameAncestors = validOrigins.length > 0 ? "frame-ancestors 'self' " + validOrigins.join(' ') : 'frame-ancestors *'
  }

  return [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  connectSource,
  "worker-src 'self' blob:",
  frameSource,
  frameAncestors,
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  ].join('; ')
}

/** 只接受不含路径、查询或片段的 HTTP(S) 来源，防止部署环境变量放入任意 URL。 */
function isExactOrigin(value) {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
  } catch {
    return false
  }
}

/**
 * 所有响应共享最小安全基线；不禁用 fullscreen（全屏）和 gamepad（游戏手柄），
 * 避免破坏现有拓扑全屏及 Unity 输入，只关闭本联调包不使用的敏感浏览器能力。
 */
const baseSecurityHeaders = Object.freeze({
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
})

/** 解析请求时禁止越出发布根目录；目录请求固定回退到自身 index.html。 */
function resolveRequestPath(requestUrl) {
  const requestPath = new URL(requestUrl ?? '/', 'http://request.invalid').pathname
  const decodedPath = decodeURIComponent(requestPath)
  /*
   * 嵌入壳的 Vite 基地址为“./”，外层从根入口通过“./shell/embed”进入时，浏览器会把前端历史路由解析为“/embed”。
   * 两个地址都必须回退到同一个壳入口，否则首次路由重定向会请求不存在的根文件并导致 system.ready（系统就绪）永远不发送。
   */
  if (decodedPath === '/shell/embed' || decodedPath === '/embed') return path.join(releaseRoot, 'shell', 'index.html')
  const normalizedPath = decodedPath === '/' ? '/index.html' : decodedPath.endsWith('/') ? decodedPath + 'index.html' : decodedPath
  const candidate = path.resolve(releaseRoot, '.' + normalizedPath)
  return candidate.startsWith(releaseRoot + path.sep) || candidate === releaseRoot ? candidate : undefined
}

/** 按压缩后文件名反推原始资源扩展名，确保 .wasm.br、.js.br 等均拥有正确媒体类型。 */
function readContentType(filePath) {
  const withoutCompression = filePath.endsWith('.br') ? filePath.slice(0, -3) : filePath
  return mimeByExtension.get(path.extname(withoutCompression).toLowerCase()) ?? 'application/octet-stream'
}

/**
 * 判断请求是否来自本机回环地址。
 *
 * 回环访问继续交给浏览器原生解压；非回环访问则由服务端先解压 Brotli 资源，
 * 避免部分局域网浏览器或中间网络设备在 HTTP（超文本传输协议）传输 Brotli 响应时产生解码失败。
 * 判断只读取 Host（主机）头的主机部分，不把端口号或请求路径当成来源依据。
 */
function isLoopbackRequest(request) {
  const hostHeader = typeof request.headers.host === 'string' ? request.headers.host : ''
  const hostName = hostHeader.replace(/^\\[([^\\]]+)\\](?::\\d+)?$/, '$1').replace(/:\\d+$/, '')
  const loopbackIpv4 = ['127', '0', '0', '1'].join('.')
  const loopbackHostName = ['local', 'host'].join('')
  const loopbackIpv6 = ['::', '1'].join('')
  return hostName === loopbackIpv4 || hostName === loopbackHostName || hostName === loopbackIpv6
}

/** 将 Brotli 解压封装为 Promise，避免在请求处理器中阻塞事件循环。 */
function decodeBrotli(buffer) {
  return new Promise((resolve, reject) => {
    brotliDecompress(buffer, (error, result) => {
      if (error) reject(error)
      else resolve(result)
    })
  })
}

/**
 * HTML 入口和 JSON 清单每次复用前必须重新验证，确保宿主不会引用旧版本清单。
 * 本地测试会频繁在同一回环来源切换不可变包，因此壳脚本和样式禁止写入磁盘缓存，
 * 避免浏览器继续读取旧包留下的损坏缓存。Unity 播放器、场景包和关键环节资源同样禁止长期 HTTP 缓存；
 * Unity 构建还会关闭 WebGL dataCaching，双重避免大资源长期占用浏览器磁盘和旧版本空间。
 */
function readCacheControl(filePath) {
  const withoutCompression = filePath.endsWith('.br') ? filePath.slice(0, -3) : filePath
  const relativePath = path.relative(releaseRoot, withoutCompression).split(path.sep).join('/')
  const isLocalShellAsset = packageType === 'local-test' && relativePath.startsWith('shell/assets/')
  if (isLocalShellAsset) return 'no-store'
  // Unity 的主播放器、场景资源包和关键环节资源体积大且由发布标识管理；禁止浏览器长期 HTTP 缓存，
  // 使停止服务或更换包后可由操作系统回收临时响应，避免与 Unity 内部离线缓存叠加占用磁盘。
  const isUnityLargeAsset = relativePath.startsWith('unity/Build/')
    || relativePath.startsWith('unity/SceneBundles/')
    || relativePath.startsWith('unity/ProcessDetailBundles/')
  if (isUnityLargeAsset) return 'no-store'
  const extension = path.extname(withoutCompression).toLowerCase()
  return extension === '.html' || extension === '.json'
    ? 'no-cache, max-age=0, must-revalidate'
    : 'public, max-age=31536000, immutable'
}

/** 文本错误响应同样携带安全基线，避免异常路径成为策略缺口。 */
function createTextResponseHeaders(additionalHeaders = {}) {
  return {
    ...baseSecurityHeaders,
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    ...additionalHeaders,
  }
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, createTextResponseHeaders({ allow: 'GET, HEAD' }))
    response.end('联调服务仅支持只读请求。')
    return
  }

  /*
   * Vite 壳使用相对资源基址（./assets）。/embed 是历史兼容地址，若直接把 shell/index.html
   * 返回给它，浏览器会把脚本解析为 /assets/*，而真实文件位于 /shell/assets/*；路由重载后
   * 因此会出现空白壳。保留全部查询参数重定向到规范入口，既修复资源基址，又不丢失握手字段。
  */
  const requestUrl = new URL(request.url ?? '/', 'http://' + host)
${localBrowserCacheResetSource}
  if (requestUrl.pathname === '/embed') {
    response.writeHead(302, {
      ...baseSecurityHeaders,
      location: '/shell/embed' + requestUrl.search,
      'cache-control': 'no-store',
    })
    response.end()
    return
  }

  let filePath
  try {
    filePath = resolveRequestPath(request.url)
  } catch {
    filePath = undefined
  }
  if (!filePath) {
    response.writeHead(400, createTextResponseHeaders())
    response.end('请求路径无效。')
    return
  }

  try {
    const fileInfo = await stat(filePath)
    if (!fileInfo.isFile()) throw new Error('not-file')
    const compressedAsset = filePath.endsWith('.br')
    const decodeForNetworkClient = compressedAsset && !isLoopbackRequest(request)
    // 非回环请求只在命中 Brotli 资源时解压；HTML、清单和普通脚本仍按原文件直接发送。
    const body = decodeForNetworkClient
      ? await decodeBrotli(await readFile(filePath))
      : await readFile(filePath)
    const headers = {
      ...baseSecurityHeaders,
      'cache-control': readCacheControl(filePath),
      'content-length': body.byteLength,
      'content-type': readContentType(filePath),
    }
    // 内容安全策略只对 HTML 文档生效，避免给二进制大资源重复发送无意义的长响应头。
    if (path.extname(filePath).toLowerCase() === '.html') headers['content-security-policy'] = createContentSecurityPolicy()
    if (resetLocalBrowserCache) headers['clear-site-data'] = '"cache"'
    if (compressedAsset && !decodeForNetworkClient) headers['content-encoding'] = 'br'
    response.writeHead(200, headers)
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    response.end(body)
  } catch {
    response.writeHead(404, createTextResponseHeaders())
    response.end('未找到发布资源。')
  }
})

/**
 * 生成浏览器实际可访问的地址。
 *
 * 监听地址 0.0.0.0（所有网卡）只用于让 Node 服务接收局域网请求，不能直接复制到浏览器地址栏；
 * 因此运行时同源模式必须把回环地址和当前机器的非内部 IPv4（互联网协议第4版）网卡地址分别列出。
 * 网卡枚举只在服务启动时执行一次，不参与请求处理，避免每个请求重复查询系统网络信息。
 */
function readRuntimeAccessUrls() {
  const urls = new Set()
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      const isIpv4 = entry.family === 'IPv4' || entry.family === 4
      if (!isIpv4 || !entry.address) continue
      urls.add('http://' + entry.address + ':' + port + '/')
    }
  }
  return [...urls]
}

server.listen(port, host, () => {
  const accessUrls = addressMode === 'runtime-self-origin'
    ? readRuntimeAccessUrls()
    : [configuredPublicOrigin + '/']
  console.log('${serviceLabel}服务已启动。请使用下面列出的地址访问：')
  for (const url of accessUrls) console.log('  ' + url)
  console.log('服务监听：' + host + ':' + port + '（仅用于监听，不要直接作为浏览器地址）')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
`
}

/**
 * 从即将发布的最终清单中提取燃气 Unity 映射摘要。
 *
 * 发布说明和 release-manifest（发布摘要）绝不另行维护节点、流程或路径数量；
 * 它们只读取同一份已通过契约校验的清单。若燃气映射或三个数组缺失，构建在复制资源前失败，
 * 防止“清单无映射、说明却声称已发布”的版本漂移。
 */
function readUnityMappingSummary(manifest, sceneId) {
  const mapping = manifest.unitySceneMappings.find((candidate) => candidate.sceneId === sceneId)
  if (!mapping || !Array.isArray(mapping.sceneNodeIds) || !Array.isArray(mapping.processSteps) || !Array.isArray(mapping.routeIds)) {
    throw new Error(`${sceneId === 'coal-power' ? '燃煤' : '燃气'} Unity 映射摘要不完整，已停止生成可能与清单不一致的发布说明。`)
  }

  return Object.freeze({
    mappingVersion: mapping.mappingVersion,
    sceneNodeCount: mapping.sceneNodeIds.length,
    processStepCount: mapping.processSteps.length,
    routeCount: mapping.routeIds.length,
  })
}

/** 保留燃气摘要函数的稳定内部名称，旧测试和调用点仍可直接复用通用实现。 */
function readGasUnityMappingSummary(manifest) {
  return readUnityMappingSummary(manifest, 'gas-power')
}

/**
 * 平台随包说明只保留联调人员实际需要执行或确认的内容：版本识别、启动停止、平台内嵌、
 * 联调检查、交付边界和常见启动问题。构建过程、内部自测入口、测试证据及研发任务进度
 * 统一留在工程文档中，避免平台方把内部验证入口或研发状态误当成交付能力。
 */
function createReadme(releaseConfiguration, sourceNodeCount, sourceEdgeCount) {
  const sceneId = releaseConfiguration.sceneId ?? 'gas-power'
  const sceneTitle = sceneId === 'coal-power' ? '燃煤' : '燃气'
  const sceneTopologyId = `topology.${sceneId}.overview`
  const isLocalTest = releaseConfiguration.packageType === 'local-test'
  const isRuntimeSelfOrigin = releaseConfiguration.addressMode === 'runtime-self-origin'
  const packagePurpose = isLocalTest ? '本地测试' : releaseConfiguration.packageType === 'partner-integration' ? '合作方联调' : '正式发布'
  const publicEntryUrl = isLocalTest
    ? `${releaseConfiguration.publicOrigin}/`
    : isRuntimeSelfOrigin
      ? './'
    : `${releaseConfiguration.publicOrigin}/?parentOrigin=${encodeURIComponent(releaseConfiguration.platformParentOrigin)}&instanceId=${sceneId}-instance-01&protocolVersion=${expectedUnityProtocolVersion}`
  const platformEntryUrl = isRuntimeSelfOrigin
    ? `./?parentOrigin=<平台页面来源>&instanceId=${sceneId}-instance-01&protocolVersion=${expectedUnityProtocolVersion}`
    : publicEntryUrl
  const manifestGuidance = isRuntimeSelfOrigin
    ? '- 场景拓扑结构清单：服务当前地址下的 `/scene-topology-manifest.json`。平台读取其中的 `nodeId`（节点标识）并自行维护真实设备映射，不向本包注入设备编号或改写清单。'
    : `- 场景拓扑结构清单：\`${releaseConfiguration.manifestUrl}\`。平台读取其中的 \`nodeId\`（节点标识）并自行维护真实设备映射，不向本包注入设备编号或改写清单。`
  const localSelfTestGuidance = isLocalTest
    ? `
## 浏览器手动测试入口

打开同目录的 \`self-test.html\`，不要只打开根入口。页面会先初始化全局沙盘，提供“沙盘”“燃气”“关键环节”三个导航按钮。
进入燃气轮机关键环节后，使用页面“播放”“停止”按钮验收动态控制；按钮通过外层受控协议调用当前关键环节，不伪造设备状态。
加载失败测试应使用缺少第三层资源的专用内部构建；页面会显示受控错误码并保留上一稳定视图，不向正式协议注入模拟失败参数。
`
    : ''
  const localBoundary = isLocalTest
    ? `\n本包只监听本机地址 \`${releaseConfiguration.listenHost}\`，只能用于本机测试，不得作为平台联调或正式交付物。\n`
    : isRuntimeSelfOrigin
      ? `\n服务监听 \`${releaseConfiguration.listenHost}:${releaseConfiguration.port}\`；启动后终端会逐行打印可访问地址：回环地址用于本机验证，非内部 IPv4 地址用于同一局域网的其他电脑。请复制终端列出的实际地址，不要把 \`0.0.0.0\` 当作浏览器地址；地址变化不需要重新构建。直接打开根地址可以独立查看页面；嵌入平台时再附加 \'parentOrigin\'、\'instanceId\' 和 \'protocolVersion\' 查询参数。\n`
    : `\n服务监听 \`${releaseConfiguration.listenHost}:${releaseConfiguration.port}\`；浏览器和平台必须使用公开地址 \`${releaseConfiguration.publicOrigin}/\`，不得使用监听通配地址代替公开地址。\n`

  return `# ${sceneTitle}发电场景与拓扑联调启动说明

发布标识：${releaseConfiguration.releaseId}
包类型：${packagePurpose}

## 启动联调

运行环境：JavaScript 运行时（Node.js）18 或更高版本。

在当前目录执行：

\`\`\`powershell
node server.mjs
\`\`\`

浏览器访问：${publicEntryUrl}

终端显示“${sceneTitle}服务已启动”并列出至少一个访问地址，即表示静态服务已就绪；若没有局域网 IPv4 地址，请检查网卡状态、防火墙和端口放行规则。
${localBoundary}

停止服务：在运行服务的窗口按 \`Ctrl+C\`。
${localSelfTestGuidance}

## 平台内嵌

平台页面使用带协议查询参数的根地址；根入口会保留参数并直接进入协议壳，不要加载 \`unity/index.html\`：

\`\`\`html
<iframe
  src="${platformEntryUrl}"
  title="${sceneTitle}发电场景与拓扑"
  allow="fullscreen"
></iframe>
\`\`\`

平台外层内嵌框架必须允许全屏，否则三维和拓扑的全屏按钮只能受限于平台容器。
平台必须先注册跨窗口消息监听，再设置内嵌框架地址；收到 \`system.ready\`（系统就绪）后，使用其会话标识发送 \`system.init\`（系统初始化）。运行时同源模式不要求平台提前知道我方服务器 IP，平台只需把实际 iframe 父页面来源填入 \`parentOrigin\`。

## 加载表现

- 页面启动、Unity 握手和首个稳定视图提交前，三维与拓扑区域由不透明整区遮罩覆盖，完全挡住 Unity 内部加载画面。
- 遮罩只显示等待指示器，不显示百分比、进度文字或进度条；这些进度事件仅供内部诊断和控制台联调使用。
- Unity 就绪且首个稳定视图提交后遮罩自动解除；运行时失败或释放时显示固定中文状态，不展示原始错误码、关联标识或外部异常正文。

## 资源缓存要求

- Unity 网页图形离线数据缓存必须关闭；主播放器目录、场景资源包和关键环节资源必须返回 \`Cache-Control: no-store\`（禁止存储）。
- 反向代理不得覆盖上述响应头或改成长缓存；浏览器每次启动按当前发布包重新请求 Unity 大资源，避免旧版本和大文件长期占用站点缓存。
- HTML（超文本标记语言）、JSON（数据交换格式）和错误响应继续使用重新验证策略；普通小型版本化脚本、样式和图元可按部署策略缓存。

## 联调检查

- 页面显示${sceneTitle}发电三维模型。
- 页面显示${sceneTitle}总拓扑图，共 ${sourceNodeCount} 个节点、${sourceEdgeCount} 条连线。
- 页面只有一个三维实例和一个拓扑画布。
- 燃气轮机关键环节使用独立精细模型，全屏三维且不携带拓扑；返回后恢复原燃气总拓扑。
- 燃气轮机正常、告警、故障、离线只更新四态视觉，不改变旋转、粒子和气流的播放许可；播放与停止由独立 Unity 交互控制，协议壳不提供额外网页按钮。
- 单击已映射的拓扑节点，三维模型聚焦并显示描边。
- 单击拓扑空白区域，取消二维选中和三维交互描边。
- 支持三维全屏、拓扑全屏，以及拓扑缩放、平移和重置。
- ${sourceNodeCount} 个总览源节点都可上报稳定 \`nodeId\`；唯一燃气轮机第三层使用固定关键环节、资源、相机位和状态节点编号。
${manifestGuidance}

## 联调范围

- 本地测试包打开根地址后自动进入${sceneTitle}总览（${sceneTopologyId}）；合作方联调包可脱离平台直接打开查看，嵌入平台后再由平台在握手后发送初始化命令。
- 外层和 Unity 均使用第二版协议；第一版父页面不能与本包完成握手。
- 本包只携带不可变结构清单；平台读取 \`nodeId\` 后在平台内部维护真实设备映射，并按 \`nodeId\` 推送完整节点状态快照。
- ${sourceNodeCount} 个节点均可上报节点双击事件，但当前只有 3 个节点具备已核验三维映射；其余节点只更新二维状态。
- 平台只使用根地址并传入父来源、实例标识和协议版本，不得修改包内摘要脚本和 Unity 压缩资源。

## 启动问题

- 地址无法访问：确认 \`node server.mjs\` 仍在运行，并确认 ${releaseConfiguration.port} 端口、网络策略和反向代理配置正确。
- 页面仍显示旧内容：关闭旧联调页面，清理该地址的站点数据后重新打开。
- 三维加载失败或内存不足：关闭其他旧三维运行时（Unity）页面后重新打开本地址。
`
}

/**
 * 从新目录开始构建，并在最终 rename（重命名）前完成所有校验和拷贝。
 * 任一步失败会保留 .staging（暂存）目录供排障，绝不覆盖先前成功发布的同名目录。
 */
async function main() {
  const releaseConfiguration = readReleaseConfiguration(process.argv.slice(2))
  const releaseId = releaseConfiguration.releaseId
  const includeSelfTest = releaseConfiguration.includeSelfTest
  releaseSceneId = releaseConfiguration.sceneId
  unityReleaseId = releaseConfiguration.unityReleaseId
  addressMode = releaseConfiguration.addressMode
  /*
   * 打包前冻结监听地址、公开来源和三层通信地址。监听地址只供 server.listen（服务监听）使用；
   * 浏览器、跨窗口消息和内容安全策略必须使用公开来源，禁止把 0.0.0.0 误写进页面配置。
   */
  host = releaseConfiguration.listenHost
  port = releaseConfiguration.port
  hostOrigin = releaseConfiguration.publicOrigin ?? ''
  platformParentOrigin = releaseConfiguration.platformParentOrigin
  unityParentOrigin = releaseConfiguration.unityParentOrigin
  unityEntryUrl = releaseConfiguration.unityEntryUrl
  topologyManifestUrl = releaseConfiguration.manifestUrl
  const unitySourceDirectory = path.join(releasesRoot, unityReleaseId, 'unity')
  const finalDirectory = path.join(releasesRoot, releaseId)
  const stagingDirectory = path.join(releasesRoot, '.staging', releaseId)
  const manifestArtifactDirectory = path.join(workspaceRoot, 'artifacts', `${releaseSceneId}-smoke`, releaseId)
  const manifestPath = path.join(manifestArtifactDirectory, 'scene-topology-manifest.json')
  const reportPath = path.join(manifestArtifactDirectory, 'scene-topology-contract-report.json')

  await ensureReadable(unitySourceDirectory, `未找到 Unity 正式基线：${unitySourceDirectory}`)
  await ensureAbsent(finalDirectory, `目标发布目录已存在，已停止以保护原包：${finalDirectory}`)
  await ensureAbsent(stagingDirectory, `暂存目录已存在，已停止以保留上次失败证据：${stagingDirectory}`)
  // 此门禁必须位于写清单、创建暂存目录和启动前端构建之前，确保不兼容组合不会留下误导性的“待发布”产物。
  await ensureUnityBuildSupportsSceneActivation(unitySourceDirectory, unityReleaseId)
  await mkdir(manifestArtifactDirectory, { recursive: true })

  // 正式包始终携带燃气、燃煤两套真实配置；--scene 只决定根入口初始视图，不能再把另一场景降为空占位。
  const manifest = await createConfiguredPowerScenesManifest(releaseId, releaseSceneId)
  const selectedUnityRuntimeKey = getUnityRuntimeKey(releaseSceneId)
  const sourceTopology = manifest.topologies.find((topology) => topology.topologyId === `topology.${releaseSceneId}.overview`)
  if (!sourceTopology) throw new Error(`未生成${releaseSceneId === 'coal-power' ? '燃煤' : '燃气'}来源总拓扑，已停止打包。`)
  // 映射摘要和发布文件复用同一内存清单，避免发布说明、契约报告与运行时结构发生漂移。
  const unityMapping = readUnityMappingSummary(manifest, releaseSceneId)
  /*
   * 三类包只发布同一份结构清单。平台不再注入真实设备编号，也不再生成第二份运行时清单；
   * 节点状态通过外部消息按 nodeId 关联，避免结构配置与平台私有设备关系形成双事实源。
   */
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  // 构建前只校验一次实际交付的结构清单，不再维护基础/运行时双清单分支。
  const validationArguments = [
    './scripts/validate-scene-topology-manifest.mjs',
    '--manifest', path.relative(workspaceRoot, manifestPath),
    '--report', path.relative(workspaceRoot, reportPath),
  ]
  execute(process.execPath, validationArguments)
  execute(process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd run typecheck'] : ['run', 'typecheck'])

  await mkdir(stagingDirectory, { recursive: true })
  const shellDirectory = path.join(stagingDirectory, 'shell')
  const buildEnvironment = {
    ...process.env,
    // 四个地址分别来自已经通过包类型门禁的显式配置，禁止再次从同一字段隐式复制。
    VITE_POWER_PARENT_ORIGIN: platformParentOrigin,
    VITE_POWER_UNITY_PARENT_ORIGIN: unityParentOrigin,
    VITE_POWER_UNITY_ENTRY_URL: unityEntryUrl,
    VITE_POWER_MANIFEST_URL: topologyManifestUrl,
    // 此包供桌面联调使用；下限只阻止不足以同时展示 16:9 三维与拓扑的极小容器，不把推荐尺寸做成固定上限。
    VITE_POWER_MINIMUM_VIEWPORT_WIDTH: '600',
    VITE_POWER_MINIMUM_VIEWPORT_HEIGHT: '600',
  }
  /*
   * 直接以 Node（运行时）执行本地 Vite 命令入口，避免 Windows 命令解释器把绝对 outDir（输出目录）
   * 两侧的引号传递为真实路径字符。参数数组也让空格路径保持一个完整参数而无需手工转义。
   */
  execute(process.execPath, ['./node_modules/vite/bin/vite.js', 'build', '--base=./', '--outDir', shellDirectory], buildEnvironment)

  // Unity 产物按目录整体复制，保留 Build、TemplateData、SceneBundles 及其压缩文件的相对位置。
  await cp(unitySourceDirectory, path.join(stagingDirectory, 'unity'), { recursive: true, force: false, errorOnExist: true })
  // 本地、联调和正式包均携带壳实际消费的同一份结构清单，平台无需也不得派生第二份设备清单。
  await cp(manifestPath, path.join(stagingDirectory, 'scene-topology-manifest.json'), { force: false, errorOnExist: true })
  // 根入口交付给平台，绝不混入内部测试按钮；自测页仅在内部验证构建显式启用时生成。
  await writeFile(path.join(stagingDirectory, 'index.html'), createHostPage(manifest.manifestVersion, releaseConfiguration.packageType, releaseSceneId), 'utf8')
  if (includeSelfTest) {
    // 本地自测页使用联合清单，因此无论入口初始场景为何，都能在同一个 Unity 实例内往返燃气与燃煤。
    await writeFile(path.join(stagingDirectory, 'self-test.html'), createSelfTestPage(manifest.manifestVersion, releaseSceneId), 'utf8')
  }
  await writeFile(path.join(stagingDirectory, 'server.mjs'), createStaticServer(releaseConfiguration.packageType), 'utf8')
  await writeFile(path.join(stagingDirectory, 'README.md'), createReadme(releaseConfiguration, sourceTopology.nodes.length, sourceTopology.edges.length), 'utf8')
  await writeFile(path.join(stagingDirectory, 'release-manifest.json'), `${JSON.stringify({
    releaseId,
    sceneId: releaseSceneId,
    packageType: releaseConfiguration.packageType,
    deploymentMode: releaseConfiguration.packageType === 'local-test' ? 'local-loopback' : 'independent-service-iframe',
    platformArtifactPatchingAllowed: false,
    scope: 'overview-gas-business-and-single-gas-turbine-process-detail',
    unityReleaseId,
    unityRuntimeKey: selectedUnityRuntimeKey,
    manifestVersion: manifest.manifestVersion,
    // 外层和 Unity 同步升级到第二版，第一版父页面或第一版 Unity 基线均由握手与发布门禁拒绝。
    protocolVersions: { host: expectedUnityProtocolVersion, unity: expectedUnityProtocolVersion },
    // 两个阶段分别计时：外层就绪保持15秒；收到唯一初始化请求后，才开始120秒 Unity 和初始稳定视图等待。
    // 显式写入发布摘要可避免平台把 Unity 的120秒预算错误地从页面加载或外层握手开始计算。
    runtimeTimeouts: {
      outerReadyMilliseconds: outerReadyTimeoutMilliseconds,
      unityAndInitialViewMilliseconds: unityAndInitialViewTimeoutMilliseconds,
    },
    // 平台包必须为 false；该字段让交付审阅无需扫描 HTML 即可确认内部自测页是否随包生成。
    selfTestIncluded: includeSelfTest,
    sourceTopology: { topologyId: sourceTopology.topologyId, nodeCount: sourceTopology.nodes.length, edgeCount: sourceTopology.edges.length },
    // 兼容已有燃气发布审阅字段；燃煤包只使用通用 sourceTopology 摘要，避免伪造燃气数量。
    ...(releaseSceneId === 'gas-power' ? { gasTopology: { nodeCount: sourceTopology.nodes.length, edgeCount: sourceTopology.edges.length } } : {}),
    nodeProtocolPolicy: {
      mode: 'node-id-owned-by-shell',
      associationKey: 'nodeId',
      manifestKind: 'immutable-structure',
      sourceTopologyId: sourceTopology.topologyId,
      sourceNodeCount: sourceTopology.nodes.length,
      filteredViewsReuseSourceNodeIds: true,
    },
    deployment: {
      addressMode: releaseConfiguration.addressMode,
      listenHost: releaseConfiguration.listenHost,
      listenPort: releaseConfiguration.port,
      publicOrigin: releaseConfiguration.addressMode === 'runtime-self-origin' ? null : releaseConfiguration.publicOrigin,
      platformParentOrigin: releaseConfiguration.addressMode === 'runtime-self-origin' ? null : releaseConfiguration.platformParentOrigin,
      unityParentOrigin: releaseConfiguration.addressMode === 'runtime-self-origin' ? null : releaseConfiguration.unityParentOrigin,
      unityEntryUrl: releaseConfiguration.addressMode === 'runtime-self-origin' ? null : releaseConfiguration.unityEntryUrl,
      manifestUrl: releaseConfiguration.addressMode === 'runtime-self-origin' ? null : releaseConfiguration.manifestUrl,
      runtimeSourcePolicy: releaseConfiguration.addressMode === 'runtime-self-origin'
        ? {
          parentOriginQueryKey: 'parentOrigin',
          unityPath: '/unity/index.html',
          manifestPath: '/scene-topology-manifest.json',
          directAccessWithoutPlatform: true,
          cspFrameAncestors: 'deployment-env-or-lan-test-wildcard',
        }
        : undefined,
      // 本地包由同源宿主完成初始化；交付包只保留参数并导航到壳，使平台成为直接协议父页面。
      entryMode: releaseConfiguration.packageType === 'local-test' ? 'local-bootstrap-host' : 'platform-direct-shell-redirect',
      publicEntryUrl: releaseConfiguration.addressMode === 'runtime-self-origin' ? './' : `${releaseConfiguration.publicOrigin}/`,
    },
    /*
     * 缓存策略写入发布摘要并由产物门禁强制校验，防止后续打包或反向代理把 Unity 大资源
     * 误归入普通版本化静态文件。网页图形离线数据缓存和 HTTP 缓存是两层独立机制，必须同时关闭。
     */
    cachePolicy: {
      unityWebGLDataCaching: false,
      unityLargeResources: 'no-store',
      unityLargeResourcePaths: ['unity/Build/', 'unity/SceneBundles/', 'unity/ProcessDetailBundles/'],
    },
    // 此摘要完全由上方同一发布清单派生，供发布审阅快速确认真实三维能力边界。
    unityMapping,
    ...(releaseSceneId === 'gas-power' ? { gasUnityMapping: unityMapping } : {}),
    // 状态消息名称为兼容既有外层协议继续保留 device.states.update，但状态项主键和双击事件均只使用 nodeId。
    includedCapabilities: ['node-events', 'node-states', 'node-scene-mapping', 'process-detail'],
    workflowActions: manifest.actions.map((action) => ({
      actionId: action.actionId,
      targetViewMode: action.targetViewMode,
      ...(action.targetTopologyId ? { targetTopologyId: action.targetTopologyId } : {}),
      ...(action.processDetailId ? { processDetailId: action.processDetailId } : {}),
    })),
    excludedCapabilities: ['route-mapping', 'other-seven-scene-content'],
  }, null, 2)}\n`, 'utf8')

  /*
   * 所有文件完成后才生成流式摘要，并立即按实际目录执行发布门禁。
   * 任何自测页、本机地址、绑定能力倒退或摘要不一致都会在原子重命名前失败，旧发布目录不受影响。
   */
  await writeReleaseArtifactIntegrity(stagingDirectory, releaseId)
  await assertReleaseArtifact(stagingDirectory)

  // rename 在同一卷内为原子移动；成功后用户只会看到完整目录，不会看到半复制的正式发布包。
  await rename(stagingDirectory, finalDirectory)
  process.stdout.write(`${JSON.stringify({
    status: 'ready',
    releaseId,
    releaseDirectory: finalDirectory,
    url: addressMode === 'runtime-self-origin' ? 'runtime-self-origin' : `${hostOrigin}/`,
    sceneId: releaseSceneId,
    sourceTopologyNodes: sourceTopology.nodes.length,
    sourceTopologyEdges: sourceTopology.edges.length,
    unityMapping,
  }, null, 2)}\n`)
}

/**
 * 脚本被 Vitest（单元测试工具）导入时只暴露纯门禁函数，绝不触发构建、创建目录或启动 Vite（前端构建工具）。
 * 直接由 Node 执行时才进入真实发布流程，既保留命令行行为，又让兼容性门禁拥有不依赖 Unity 的自动回归。
 */
const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  main().catch(async (error) => {
    // 本脚本不自动清理失败目录：保留非破坏性证据可帮助定位构建、压缩资源或发布复制问题。
    process.stderr.write(`${error instanceof Error ? error.message : '燃气联调包构建失败。'}\n`)
    process.exitCode = 1
  })
}

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { formatProcessDetailTopologyIssue, validateProcessDetailTopologies } from './process-detail-topology-contract.mjs'

const integrityFileName = 'artifact-integrity.json'
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.svg'])
const loopbackAddressPattern = /(?:127\.0\.0\.1|\blocalhost\b|https?:\/\/0\.0\.0\.0(?=[:/]))/i
const internalTestMarkerPattern = /(?:self-test\.html|外部流程触发测试|data-action-id=|data-overview-command|test-status|synthetic-device-state|合成(?:设备|状态|数据)|测试状态)/i
// 合作方入口长期固定为 5575；即使目录由旧脚本或手工方式生成，交付复核也必须阻止端口漂移。
const partnerIntegrationPort = 5575
const internalArtifactPathPattern = /(?:^|\/)(?:tests?|self[-_]?tests?|diagnostics?|fixtures?|mocks?)(?:\/|\.|-|_|$)/i
const allowedDeliveryRootEntries = new Set([
  'index.html', 'server.mjs', 'README.md', 'release-manifest.json', 'scene-topology-manifest.json',
  'artifact-integrity.json', 'shell', 'unity',
])
const requiredUnityCommandCapabilities = Object.freeze([
  'init', 'resize', 'switchScene', 'moveCameraToPose', 'enterProcessDetail', 'prepareProcessDetail', 'commitProcessDetail', 'abortProcessDetail', 'exitProcessDetail', 'setProcessDetailPlayback', 'resetScene', 'resetCamera', 'focusNode', 'clearSelection',
  'setNodeVisualState', 'clearNodeVisualState', 'setRouteFlow', 'setNodeVisibility', 'dispose',
])
const requiredEnterProcessDetailFields = Object.freeze(['sceneId', 'processId', 'stepId', 'processDetailId', 'transitionId'])
const requiredPrepareProcessDetailFields = Object.freeze(['sceneId', 'processId', 'stepId', 'processDetailId', 'transitionId'])
const requiredCommitProcessDetailFields = Object.freeze(['sceneId', 'processDetailId', 'transitionId'])
const requiredAbortProcessDetailFields = Object.freeze(['sceneId', 'processDetailId', 'transitionId'])
const requiredExitProcessDetailFields = Object.freeze(['sceneId', 'processDetailId', 'transitionId'])
const requiredSetProcessDetailPlaybackFields = Object.freeze(['sceneId', 'processDetailId', 'playing'])
// 结构版本10在命名镜头点基础上增加独立相机复位能力；旧构建不得绕过右上角复位按钮发布门禁。
const requiredUnityEventCapabilities = Object.freeze([
  'ready', 'ack', 'commandResult', 'sceneLoadProgress', 'sceneChanged', 'objectSelected', 'selectionCleared', 'disposed',
])
/**
 * 当前合作方以动作摘要生成全部可绑定入口，因此十项公开动作属于发布契约本身，不能只做两份清单的相对一致性检查。
 * 目标、视图和三维动作类型一并固定，防止生成器与摘要同时回退，或把普通场景导航误写成未实现的流程能力。
 */
const requiredPublishedActionContracts = Object.freeze([
  { actionId: 'action.scene.overview', targetSceneId: 'overview', targetViewMode: 'overview', unityActionType: 'none' },
  { actionId: 'action.gas-power.overview', targetSceneId: 'gas-power', targetViewMode: 'business', targetTopologyId: 'topology.gas-power.overview', unityActionType: 'resetScene' },
  { actionId: 'action.gas-power.gas-turbine', targetSceneId: 'gas-power', targetViewMode: 'process-detail', processDetailId: 'process-detail.gas-power.gas-turbine', unityActionType: 'enterProcessDetail' },
  { actionId: 'action.coal-power.overview', targetSceneId: 'coal-power', targetViewMode: 'business', targetTopologyId: 'topology.coal-power.overview', unityActionType: 'resetScene' },
  { actionId: 'action.coal-power.steam-turbine', targetSceneId: 'coal-power', targetViewMode: 'process-detail', processDetailId: 'process-detail.coal-power.steam-turbine', unityActionType: 'enterProcessDetail' },
  { actionId: 'action.wind-power.overview', targetSceneId: 'wind-power', targetViewMode: 'business', targetTopologyId: 'topology.wind-power.overview', unityActionType: 'none' },
  { actionId: 'action.solar-power.overview', targetSceneId: 'solar-power', targetViewMode: 'business', targetTopologyId: 'topology.solar-power.overview', unityActionType: 'none' },
  { actionId: 'action.solar-power.inverter', targetSceneId: 'solar-power', targetViewMode: 'process-detail', processDetailId: 'process-detail.solar-power.inverter', unityActionType: 'enterProcessDetail' },
  { actionId: 'action.step-up-substation.overview', targetSceneId: 'step-up-substation', targetViewMode: 'business', targetTopologyId: 'topology.step-up-substation.overview', unityActionType: 'none' },
  { actionId: 'action.step-down-substation.overview', targetSceneId: 'step-down-substation', targetViewMode: 'business', targetTopologyId: 'topology.step-down-substation.overview', unityActionType: 'none' },
])
const navigationOnlySceneIds = Object.freeze([
  // 光伏已经交付逆变器关键环节，不再属于“仅总览导航”场景。
  'wind-power', 'step-up-substation', 'step-down-substation',
])
const deviceIdentifierSuffixes = new Set(['id', 'ids'])
const deviceMappingSuffixes = new Set(['mapping', 'mappings'])
const bindingMetadataSuffixes = new Set(['count', 'revision'])
const runtimeManifestSuffixes = new Set(['manifest'])
const maximumManifestContainers = 50_000
const maximumManifestEntries = 250_000

/** 与运行时校验器使用同一旧职责语义，只扫描对象键，避免标题或拒绝说明中的文本产生误报。 */
function classifyLegacyManifestField(field) {
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
  const compact = field.replace(/[^A-Za-z0-9]+/g, '').toLowerCase()
  const containsAdjacentWords = (first, suffixes) => words.some((word, index) => word === first && suffixes.has(words[index + 1] ?? ''))

  if (containsAdjacentWords('device', deviceIdentifierSuffixes) || compact === 'deviceid' || compact === 'deviceids' || compact.endsWith('deviceid') || compact.endsWith('deviceids')) return 'device-identifier'
  if (containsAdjacentWords('device', deviceMappingSuffixes) || compact.endsWith('devicemapping') || compact.endsWith('devicemappings')) return 'device-mapping'
  if (containsAdjacentWords('binding', bindingMetadataSuffixes) || compact.endsWith('bindingcount') || compact.endsWith('bindingrevision')) return 'binding-metadata'
  if (containsAdjacentWords('runtime', runtimeManifestSuffixes) || compact.endsWith('runtimemanifest')) return 'runtime-manifest'
  return undefined
}

/** 显式栈和容量限制让发布门禁可以安全检查任意嵌套位置，不依赖旧字段恰好位于根或节点。 */
function findLegacyManifestFieldKinds(manifest) {
  const stack = [manifest]
  const visited = new WeakSet()
  const kinds = new Set()
  let containerCount = 0
  let entryCount = 0

  while (stack.length > 0) {
    const value = stack.pop()
    if (!value || typeof value !== 'object' || visited.has(value)) continue
    visited.add(value)
    containerCount += 1
    if (containerCount > maximumManifestContainers) return new Set(['capacity'])

    if (Array.isArray(value)) {
      entryCount += value.length
      if (entryCount > maximumManifestEntries || stack.length + value.length > maximumManifestContainers) return new Set(['capacity'])
      for (const item of value) if (item && typeof item === 'object') stack.push(item)
      continue
    }

    const fields = Object.keys(value)
    entryCount += fields.length
    if (entryCount > maximumManifestEntries) return new Set(['capacity'])
    for (const field of fields) {
      if (field.length > 128) return new Set(['capacity'])
      const kind = classifyLegacyManifestField(field)
      if (kind) {
        kinds.add(kind)
        continue
      }
      const nested = value[field]
      if (nested && typeof nested === 'object') stack.push(nested)
    }
  }
  return kinds
}

/** 将相对路径统一为发布清单可跨平台比较的正斜杠格式。 */
function normalizeRelativePath(rootDirectory, filePath) {
  return path.relative(rootDirectory, filePath).split(path.sep).join('/')
}

/**
 * 单次深度遍历收集普通文件并稳定排序。发布目录中的文件数量受构建产物约束，
 * 不跟随设备、节点或状态数量增长；排序保证不同操作系统生成相同的完整性清单顺序。
 */
async function listReleaseFiles(rootDirectory) {
  const files = []
  const directories = [rootDirectory]
  while (directories.length > 0) {
    const currentDirectory = directories.pop()
    const entries = await readdir(currentDirectory, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name)
      if (entry.isDirectory()) directories.push(entryPath)
      else if (entry.isFile()) files.push(entryPath)
    }
  }
  return files.sort((left, right) => {
    const leftPath = normalizeRelativePath(rootDirectory, left)
    const rightPath = normalizeRelativePath(rootDirectory, right)
    return leftPath === rightPath ? 0 : leftPath < rightPath ? -1 : 1
  })
}

/** 采用流式读取计算摘要，避免 Unity 大型压缩资源被一次性读入内存。 */
async function calculateSha256(filePath) {
  const digest = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => digest.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return digest.digest('hex')
}

/**
 * 对指定目录的普通文件生成稳定资源摘要。聚合输入同时包含规范化相对路径、字节数和单文件摘要，
 * 因此文件改名、增删或内容变化都会改变结果；大型 Unity 文件始终流式读取，不占用整包内存。
 */
export async function calculateDirectoryResourceDigest(rootDirectory) {
  const digest = createHash('sha256')
  const files = await listReleaseFiles(rootDirectory)
  for (const filePath of files) {
    const relativePath = normalizeRelativePath(rootDirectory, filePath)
    const fileStats = await stat(filePath)
    const fileDigest = await calculateSha256(filePath)
    digest.update(`${relativePath}\0${fileStats.size}\0${fileDigest}\n`, 'utf8')
  }
  return `sha256:${digest.digest('hex')}`
}

/**
 * 为最终暂存目录生成不可变完整性清单。完整性文件不摘要自身，避免循环依赖；
 * 其余文件包含字节数和安全哈希算法（SHA-256）摘要，可用于部署前后检查是否被原位修改。
 */
export async function writeReleaseArtifactIntegrity(rootDirectory, releaseId) {
  const files = (await listReleaseFiles(rootDirectory))
    .filter((filePath) => normalizeRelativePath(rootDirectory, filePath) !== integrityFileName)
  const entries = []
  for (const filePath of files) {
    const fileStats = await stat(filePath)
    entries.push({
      path: normalizeRelativePath(rootDirectory, filePath),
      bytes: fileStats.size,
      sha256: await calculateSha256(filePath),
    })
  }
  const integrity = { schemaVersion: 1, releaseId, algorithm: 'sha256', files: entries }
  await writeFile(path.join(rootDirectory, integrityFileName), `${JSON.stringify(integrity, null, 2)}\n`, 'utf8')
  return integrity
}

/** 只返回是否存在，避免用异常控制后续具体文件规则。 */
async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * 校验发布目录本身，而不是只相信构建参数。该门禁在原子重命名前执行，
 * 同时可由发布流水线再次调用，以阻断自测页、本机地址、错误能力声明和构建后原位补丁。
 */
export async function validateReleaseArtifact(rootDirectory) {
  const issues = []
  let releaseManifest
  let topologyManifest
  let integrity
  let rootEntrySource = ''
  let unityProtocolMetadata
  try {
    releaseManifest = JSON.parse(await readFile(path.join(rootDirectory, 'release-manifest.json'), 'utf8'))
  } catch {
    issues.push('缺少或无法解析 release-manifest.json（发布摘要）。')
    return issues
  }
  try {
    topologyManifest = JSON.parse(await readFile(path.join(rootDirectory, 'scene-topology-manifest.json'), 'utf8'))
  } catch {
    issues.push('缺少或无法解析 scene-topology-manifest.json（场景拓扑结构清单）。')
  }
  try {
    integrity = JSON.parse(await readFile(path.join(rootDirectory, integrityFileName), 'utf8'))
  } catch {
    issues.push(`缺少或无法解析 ${integrityFileName}（产物完整性清单）。`)
  }
  try {
    rootEntrySource = await readFile(path.join(rootDirectory, 'index.html'), 'utf8')
  } catch {
    issues.push('缺少或无法读取 index.html（公开根入口）。')
  }
  try {
    unityProtocolMetadata = JSON.parse(await readFile(
      path.join(rootDirectory, 'unity', 'webgl-protocol-capabilities.json'),
      'utf8',
    ))
  } catch {
    issues.push('缺少或无法解析 Unity 版本化协议能力文件。')
  }

  /**
   * 构建工具会把 public/topology 原样复制到 shell/topology。门禁直接检查最终目录，确保清单登记的
   * 三项第三层上下文都有完整、未篡改且不夹带资源副本的独立二维拓扑，而非只相信源码审计结果。
   */
  const processDetailTopologyIssues = await validateProcessDetailTopologies(path.join(rootDirectory, 'shell', 'topology'))
  issues.push(...processDetailTopologyIssues.map(formatProcessDetailTopologyIssue))

  const packageType = releaseManifest.packageType
  const isLocalTest = packageType === 'local-test'
  if (!['local-test', 'partner-integration', 'standalone-formal'].includes(packageType)) {
    issues.push('发布摘要缺少合法包类型。')
  }
  const expectedDeploymentMode = isLocalTest ? 'local-loopback' : 'independent-service-iframe'
  if (releaseManifest.deploymentMode !== expectedDeploymentMode) issues.push('发布摘要的部署模式与包类型不一致。')
  const expectedEntryMode = isLocalTest ? 'local-bootstrap-host' : 'platform-direct-shell-redirect'
  if (releaseManifest.deployment?.entryMode !== expectedEntryMode) issues.push('发布摘要的入口模式与包类型不一致。')
  /*
   * Unity 大资源不能套用普通版本化文件的长期不可变缓存。这里校验摘要中的固定策略和全部受控目录，
   * 使遗漏任一目录、重新开启离线数据缓存或把 no-store 改成长缓存都会在发布目录落盘前失败。
   */
  const cachePolicy = releaseManifest.cachePolicy ?? {}
  const requiredUnityNoStorePaths = ['unity/Build/', 'unity/SceneBundles/', 'unity/ProcessDetailBundles/']
  const declaredUnityNoStorePaths = Array.isArray(cachePolicy.unityLargeResourcePaths)
    ? new Set(cachePolicy.unityLargeResourcePaths)
    : new Set()
  if (cachePolicy.unityWebGLDataCaching !== false ||
      cachePolicy.unityLargeResources !== 'no-store' ||
      requiredUnityNoStorePaths.some((resourcePath) => !declaredUnityNoStorePaths.has(resourcePath))) {
    issues.push('发布摘要必须关闭 Unity 网页图形离线数据缓存，并声明主播放器、场景资源包和关键环节资源使用 no-store（禁止存储）。')
  }
  if (releaseManifest.deployment?.addressMode !== 'runtime-self-origin' && releaseManifest.deployment?.publicEntryUrl !== `${releaseManifest.deployment?.publicOrigin}/`) {
    issues.push('发布摘要的公开根入口与浏览器公开来源不一致。')
  }
  if (isLocalTest) {
    if (!rootEntrySource.includes('content="local-bootstrap-host"')) issues.push('本地测试包根入口未声明本地自动初始化模式。')
  } else {
    /*
     * 独立服务交付时，协议壳的直接父窗口必须是平台。根页面只能保留查询参数并在同一窗口
     * 导航到壳；再套一层 iframe（内嵌框架）或代替平台发送 system.init 都会让精确来源校验失效。
     */
    const isDirectShellEntry = rootEntrySource.includes('content="platform-direct-shell-redirect"') &&
      rootEntrySource.includes("new URL('./shell/embed', window.location.href)") &&
      rootEntrySource.includes('shellUrl.search = window.location.search') &&
      rootEntrySource.includes('window.location.replace(shellUrl.toString())')
    if (!isDirectShellEntry || rootEntrySource.includes('id="visualization-shell"') || rootEntrySource.includes("type: 'system.init'")) {
      issues.push('合作方联调包和正式包必须让平台成为协议壳的直接父页面。')
    }
  }
  const hasSelfTestPage = await exists(path.join(rootDirectory, 'self-test.html'))
  if (Boolean(releaseManifest.selfTestIncluded) !== hasSelfTestPage) issues.push('发布摘要的自测页声明与目录不一致。')
  if (!isLocalTest && hasSelfTestPage) issues.push('合作方联调包和正式包禁止包含内部自测页。')
  /**
   * 播放/停止网页演示控件已经退出交付契约；播放能力仍由既有 Unity 交互和受控协议保留。
   * 摘要继续携带旧开关会让平台误以为壳提供按钮，因此三类新包都必须删除该过期字段。
   */
  if (Object.hasOwn(releaseManifest, 'playbackControlsIncluded')) {
    issues.push('发布摘要不得再声明已废弃的关键环节网页播放控件。')
  }
  if (await exists(path.join(rootDirectory, 'scene-topology-base-manifest.json'))) {
    issues.push('发布包不得携带已废弃的基础清单；三类包只允许一份场景拓扑结构清单。')
  }

  if (topologyManifest) {
    const legacyFieldKinds = findLegacyManifestFieldKinds(topologyManifest)
    if (legacyFieldKinds.has('capacity')) issues.push('结构清单嵌套对象、字段或数组项超过发布门禁上限。')
    if (legacyFieldKinds.has('device-identifier')) issues.push('结构清单任意层级不得包含平台设备编号字段。')
    if (legacyFieldKinds.has('device-mapping')) issues.push('结构清单任意层级不得包含平台设备映射字段。')
    if (legacyFieldKinds.has('binding-metadata')) issues.push('结构清单任意层级不得包含平台绑定元数据。')
    if (legacyFieldKinds.has('runtime-manifest')) issues.push('结构清单任意层级不得包含第二份运行时清单字段。')
    const sourceNodes = Array.isArray(topologyManifest.topologies)
      ? topologyManifest.topologies.flatMap((topology) => topology?.filter === undefined && Array.isArray(topology?.nodes) ? topology.nodes : [])
      : []
    const sourceNodeIds = sourceNodes.map((node) => node?.nodeId).filter((nodeId) => typeof nodeId === 'string')
    if (sourceNodes.some((node) => node?.doubleClickBehavior !== 'emit-node')) issues.push('结构清单的所有来源节点必须按节点标识上报双击事件。')
    if (new Set(sourceNodeIds).size !== sourceNodeIds.length) issues.push('结构清单的来源节点标识必须在资源内全局唯一。')
    if (topologyManifest.manifestVersion !== releaseManifest.manifestVersion) issues.push('结构清单版本与发布摘要不一致。')
    if (topologyManifest.unityBuildId !== releaseManifest.unityReleaseId) issues.push('Unity 构建标识在结构清单与发布摘要中不一致。')
    /**
     * 合作方绑定菜单直接消费 workflowActions（流程动作摘要），因此摘要必须逐项镜像结构清单中的公开导航信息。
     * 这里只比较有限稳定字段，不把 Unity 内部动作、参数白名单或失败策略重复暴露到发布摘要。
     */
    const expectedWorkflowActions = Array.isArray(topologyManifest.actions)
      ? topologyManifest.actions.map((action) => ({
          actionId: action?.actionId,
          title: action?.title,
          targetSceneId: action?.targetSceneId,
          targetViewMode: action?.targetViewMode,
          ...(action?.targetTopologyId ? { targetTopologyId: action.targetTopologyId } : {}),
          ...(action?.processDetailId ? { processDetailId: action.processDetailId } : {}),
        }))
      : []
    if (!Array.isArray(releaseManifest.workflowActions) || JSON.stringify(releaseManifest.workflowActions) !== JSON.stringify(expectedWorkflowActions)) {
      issues.push('发布摘要的流程动作必须与结构清单逐项一致，避免合作方遗漏新增场景或绑定到失效目标。')
    }
    const publishedActions = Array.isArray(topologyManifest.actions) ? topologyManifest.actions : []
    const actionById = new Map(publishedActions.map((action) => [action?.actionId, action]))
    const hasInvalidPublishedAction = requiredPublishedActionContracts.some((contract) => {
      const action = actionById.get(contract.actionId)
      if (!action || typeof action.title !== 'string' || action.title.trim().length === 0) return true
      if (action.targetSceneId !== contract.targetSceneId || action.targetViewMode !== contract.targetViewMode ||
          action.unityAction?.type !== contract.unityActionType || action.failurePolicy !== 'keep-current-context' ||
          !Array.isArray(action.allowedParameters) || action.allowedParameters.length !== 0) return true
      const topologyMatches = contract.targetTopologyId === undefined
        ? !Object.hasOwn(action, 'targetTopologyId')
        : action.targetTopologyId === contract.targetTopologyId
      const processDetailMatches = contract.processDetailId === undefined
        ? !Object.hasOwn(action, 'processDetailId')
        : action.processDetailId === contract.processDetailId
      return !topologyMatches || !processDetailMatches
    })
    const requiredActionIds = new Set(requiredPublishedActionContracts.map((contract) => contract.actionId))
    if (publishedActions.length !== requiredPublishedActionContracts.length || actionById.size !== requiredPublishedActionContracts.length ||
        [...actionById.keys()].some((actionId) => !requiredActionIds.has(actionId)) || hasInvalidPublishedAction) {
      issues.push('结构清单必须完整发布当前十项公开动作及其固定目标，禁止两份清单同时回退或伪造三维流程能力。')
    }

    /**
     * supportedActionIds（支持动作标识集合）是场景侧的反向索引，必须与动作目标双向一致。
     * 先按目标场景构建索引，再逐场景比较集合，避免嵌套扫描并同时发现遗漏、重复和越权引用。
     */
    const actionIdsBySceneId = new Map()
    for (const action of publishedActions) {
      if (action?.targetSceneId === 'overview' || typeof action?.targetSceneId !== 'string' || typeof action?.actionId !== 'string') continue
      const actionIds = actionIdsBySceneId.get(action.targetSceneId) ?? []
      actionIds.push(action.actionId)
      actionIdsBySceneId.set(action.targetSceneId, actionIds)
    }
    const scenes = Array.isArray(topologyManifest.scenes) ? topologyManifest.scenes : []
    const sceneById = new Map(scenes.map((scene) => [scene?.sceneId, scene]))
    const hasMissingTargetScene = [...actionIdsBySceneId.keys()].some((sceneId) => !sceneById.has(sceneId))
    const hasInvalidSceneActionIndex = hasMissingTargetScene || scenes.some((scene) => {
      const expectedActionIds = actionIdsBySceneId.get(scene?.sceneId) ?? []
      const supportedActionIds = scene?.supportedActionIds
      if (!Array.isArray(supportedActionIds)) return true
      const supportedActionIdSet = new Set(supportedActionIds)
      return supportedActionIds.length !== expectedActionIds.length || supportedActionIdSet.size !== supportedActionIds.length ||
        expectedActionIds.some((actionId) => !supportedActionIdSet.has(actionId))
    })
    if (hasInvalidSceneActionIndex) {
      issues.push('业务场景的支持动作标识必须与指向该场景的公开动作双向一致。')
    }

    /**
     * 风电和两站当前只提供场景导航：必须指向本场景默认总览拓扑，且不得登记流程步骤或第三层目录。
     * 该约束把“可从菜单进入场景”和“已实现三维工艺能力”明确分开。
     */
    const unityMappingBySceneId = new Map(
      (Array.isArray(topologyManifest.unitySceneMappings) ? topologyManifest.unitySceneMappings : [])
        .map((mapping) => [mapping?.sceneId, mapping]),
    )
    const hasInvalidNavigationScene = navigationOnlySceneIds.some((sceneId) => {
      const topologyId = `topology.${sceneId}.overview`
      const actionId = `action.${sceneId}.overview`
      const scene = sceneById.get(sceneId)
      const mapping = unityMappingBySceneId.get(sceneId)
      return !scene || scene.defaultTopologyId !== topologyId || !Array.isArray(scene.topologyIds) ||
        scene.topologyIds.length !== 1 || scene.topologyIds[0] !== topologyId ||
        !Array.isArray(scene.supportedActionIds) || scene.supportedActionIds.length !== 1 || scene.supportedActionIds[0] !== actionId ||
        !mapping
    })
    const processDetails = Array.isArray(topologyManifest.processDetails) ? topologyManifest.processDetails : []
    if (hasInvalidNavigationScene || processDetails.some((detail) => navigationOnlySceneIds.includes(detail?.sceneId))) {
      issues.push('风电、升压站和降压站只能发布无三维流程副作用的总览导航，流程步骤和第三层目录必须为空。')
    }
    const gasTurbineDetail = processDetails.find((detail) => detail?.processDetailId === 'process-detail.gas-power.gas-turbine')
    const coalSteamTurbineDetail = processDetails.find((detail) => detail?.processDetailId === 'process-detail.coal-power.steam-turbine')
    const solarInverterDetail = processDetails.find((detail) => detail?.processDetailId === 'process-detail.solar-power.inverter')
    const gasTurbineAction = Array.isArray(topologyManifest.actions)
      ? topologyManifest.actions.find((action) => action?.actionId === 'action.gas-power.gas-turbine')
      : undefined
    const coalSteamTurbineAction = Array.isArray(topologyManifest.actions)
      ? topologyManifest.actions.find((action) => action?.actionId === 'action.coal-power.steam-turbine')
      : undefined
    const solarInverterAction = Array.isArray(topologyManifest.actions)
      ? topologyManifest.actions.find((action) => action?.actionId === 'action.solar-power.inverter')
      : undefined
    const gasMapping = Array.isArray(topologyManifest.unitySceneMappings)
      ? topologyManifest.unitySceneMappings.find((mapping) => mapping?.sceneId === 'gas-power')
      : undefined
    const coalMapping = Array.isArray(topologyManifest.unitySceneMappings)
      ? topologyManifest.unitySceneMappings.find((mapping) => mapping?.sceneId === 'coal-power')
      : undefined
    if (processDetails.length !== 3 || !gasTurbineDetail ||
        gasTurbineDetail.sceneId !== 'gas-power' || gasTurbineDetail.processId !== 'gas-power-generation' ||
        gasTurbineDetail.stepId !== 'gas-turbine' ||
        gasTurbineDetail.resourceId !== 'process-detail-resource.gas-power.gas-turbine' ||
        gasTurbineDetail.cameraPoseId !== 'camera-pose.gas-power.gas-turbine' ||
        gasTurbineDetail.stateNodeId !== 'node.gas-turbine' ||
        gasTurbineDetail.topologyDataContextId !== 'process-detail.gas-power.gas-turbine' || !coalSteamTurbineDetail ||
        coalSteamTurbineDetail.sceneId !== 'coal-power' || coalSteamTurbineDetail.processId !== 'coal-power-generation' ||
        coalSteamTurbineDetail.stepId !== 'steam-turbine' ||
        coalSteamTurbineDetail.resourceId !== 'process-detail-resource.coal-power.steam-turbine' ||
        coalSteamTurbineDetail.cameraPoseId !== 'camera-pose.coal-power.steam-turbine' ||
        coalSteamTurbineDetail.stateNodeId !== 'node.coal-steam-turbine' ||
        coalSteamTurbineDetail.topologyDataContextId !== 'process-detail.coal-power.steam-turbine' || !solarInverterDetail ||
        solarInverterDetail.sceneId !== 'solar-power' || solarInverterDetail.processId !== 'solar-power-generation' ||
        solarInverterDetail.stepId !== 'inverter' ||
        solarInverterDetail.resourceId !== 'process-detail-resource.solar-power.inverter' ||
        solarInverterDetail.cameraPoseId !== 'camera-pose.solar-power.inverter' ||
        solarInverterDetail.stateNodeId !== 'node.solar-inverter' ||
        solarInverterDetail.topologyDataContextId !== 'process-detail.solar-power.inverter') {
      issues.push('结构清单必须且只能发布燃气轮机、燃煤汽轮机与光伏逆变器三项独立第三层目录。')
    }
    if (!gasTurbineAction || gasTurbineAction.targetViewMode !== 'process-detail' ||
        gasTurbineAction.processDetailId !== 'process-detail.gas-power.gas-turbine' ||
        Object.prototype.hasOwnProperty.call(gasTurbineAction, 'targetTopologyId') ||
        gasTurbineAction.unityAction?.type !== 'enterProcessDetail') {
      issues.push('燃气轮机动作必须进入不携带第二层拓扑编号的独立第三层，不能回退为旧流程步骤。')
    }
    if (!coalSteamTurbineAction || coalSteamTurbineAction.targetViewMode !== 'process-detail' ||
        coalSteamTurbineAction.processDetailId !== 'process-detail.coal-power.steam-turbine' ||
        Object.prototype.hasOwnProperty.call(coalSteamTurbineAction, 'targetTopologyId') ||
        coalSteamTurbineAction.unityAction?.type !== 'enterProcessDetail') {
      issues.push('燃煤汽轮机动作必须进入不携带第二层拓扑编号的独立第三层，不能回退为旧流程步骤。')
    }
    if (!solarInverterAction || solarInverterAction.targetViewMode !== 'process-detail' ||
        solarInverterAction.processDetailId !== 'process-detail.solar-power.inverter' ||
        Object.prototype.hasOwnProperty.call(solarInverterAction, 'targetTopologyId') ||
        solarInverterAction.unityAction?.type !== 'enterProcessDetail') {
      issues.push('光伏逆变器动作必须进入独立第三层，不能回退为普通总览导航或流程步骤。')
    }
    const sourceTopology = Array.isArray(topologyManifest.topologies)
      ? topologyManifest.topologies.find((topology) => topology?.topologyId === releaseManifest.nodeProtocolPolicy?.sourceTopologyId)
      : undefined
    if (!sourceTopology || !Array.isArray(sourceTopology.nodes) || !Array.isArray(sourceTopology.edges)) {
      // 保留燃气包的历史诊断文本；燃煤包使用通用来源拓扑提示，避免把燃煤误报为燃气。
      issues.push(releaseManifest.sceneId === 'coal-power' ? '发布摘要的燃煤来源总拓扑未在结构清单中找到。' : '发布摘要的燃气来源总拓扑未在结构清单中找到。')
    } else {
      const sourceSummary = releaseManifest.sourceTopology ?? releaseManifest.gasTopology
      if (sourceSummary?.nodeCount !== sourceTopology.nodes.length ||
        sourceSummary?.edgeCount !== sourceTopology.edges.length ||
        releaseManifest.nodeProtocolPolicy?.sourceNodeCount !== sourceTopology.nodes.length) {
        issues.push(releaseManifest.sceneId === 'coal-power' ? '燃煤节点数、连线数或节点协议数量与结构清单不一致。' : '燃气节点数、连线数或节点协议数量与结构清单不一致。')
      }
    }
  }

  if (unityProtocolMetadata) {
    const runtimeIdentity = releaseManifest.runtimeIdentity
    const unityDirectory = path.join(rootDirectory, 'unity')
    if (!runtimeIdentity || runtimeIdentity.buildId !== releaseManifest.unityReleaseId ||
        typeof runtimeIdentity.resourceDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(runtimeIdentity.resourceDigest)) {
      issues.push('发布摘要必须以 Unity 发布标识和有效 SHA-256 资源摘要声明运行时身份。')
    } else {
      const actualResourceDigest = await calculateDirectoryResourceDigest(unityDirectory)
      if (actualResourceDigest !== runtimeIdentity.resourceDigest) {
        issues.push('运行时资源摘要与发布目录中的 Unity 实际文件不一致。')
      }

      // 前端壳必须真正编译进同一身份值；只写发布摘要不能约束 iframe 握手使用哪个 Unity 产物。
      const shellDirectory = path.join(rootDirectory, 'shell')
      const shellFiles = await exists(shellDirectory) ? await listReleaseFiles(shellDirectory) : []
      let shellContainsBuildId = false
      let shellContainsResourceDigest = false
      for (const shellFile of shellFiles) {
        if (path.extname(shellFile).toLowerCase() !== '.js') continue
        const source = await readFile(shellFile, 'utf8')
        shellContainsBuildId ||= source.includes(runtimeIdentity.buildId)
        shellContainsResourceDigest ||= source.includes(runtimeIdentity.resourceDigest)
      }
      if (!shellContainsBuildId || !shellContainsResourceDigest) {
        issues.push('协议壳未编译进与 Unity 发布目录一致的构建标识和资源摘要。')
      }
    }

    const capabilities = new Set(Array.isArray(unityProtocolMetadata.commandCapabilities) ? unityProtocolMetadata.commandCapabilities : [])
    const eventCapabilities = new Set(Array.isArray(unityProtocolMetadata.eventCapabilities) ? unityProtocolMetadata.eventCapabilities : [])
    const missingEvents = requiredUnityEventCapabilities.some((capability) => !eventCapabilities.has(capability))
    const enterProcessDetailFields = new Set(Array.isArray(unityProtocolMetadata.enterProcessDetailRequiredFields)
      ? unityProtocolMetadata.enterProcessDetailRequiredFields
      : [])
    const prepareProcessDetailFields = new Set(Array.isArray(unityProtocolMetadata.prepareProcessDetailRequiredFields)
      ? unityProtocolMetadata.prepareProcessDetailRequiredFields
      : [])
    const commitProcessDetailFields = new Set(Array.isArray(unityProtocolMetadata.commitProcessDetailRequiredFields)
      ? unityProtocolMetadata.commitProcessDetailRequiredFields
      : [])
    const abortProcessDetailFields = new Set(Array.isArray(unityProtocolMetadata.abortProcessDetailRequiredFields)
      ? unityProtocolMetadata.abortProcessDetailRequiredFields
      : [])
    const exitProcessDetailFields = new Set(Array.isArray(unityProtocolMetadata.exitProcessDetailRequiredFields)
      ? unityProtocolMetadata.exitProcessDetailRequiredFields
      : [])
    const playbackFields = new Set(Array.isArray(unityProtocolMetadata.setProcessDetailPlaybackRequiredFields)
      ? unityProtocolMetadata.setProcessDetailPlaybackRequiredFields
      : [])
    const missingEnterProcessDetailFields = requiredEnterProcessDetailFields.some((field) => !enterProcessDetailFields.has(field))
    const missingPrepareProcessDetailFields = requiredPrepareProcessDetailFields.some((field) => !prepareProcessDetailFields.has(field))
    const missingCommitProcessDetailFields = requiredCommitProcessDetailFields.some((field) => !commitProcessDetailFields.has(field))
    const missingAbortProcessDetailFields = requiredAbortProcessDetailFields.some((field) => !abortProcessDetailFields.has(field))
    const missingExitProcessDetailFields = requiredExitProcessDetailFields.some((field) => !exitProcessDetailFields.has(field))
    const missingPlaybackFields = requiredSetProcessDetailPlaybackFields.some((field) => !playbackFields.has(field))
    if (unityProtocolMetadata.schemaVersion !== 10 || unityProtocolMetadata.channel !== 'power3d-unity' ||
      unityProtocolMetadata.protocolVersion !== 2 || unityProtocolMetadata.unityReleaseId !== releaseManifest.unityReleaseId ||
      unityProtocolMetadata.processDetailCommandSchemaVersion !== 2 ||
      requiredUnityCommandCapabilities.some((capability) => !capabilities.has(capability)) ||
      missingEvents || missingEnterProcessDetailFields || missingPrepareProcessDetailFields ||
      missingCommitProcessDetailFields || missingAbortProcessDetailFields || missingExitProcessDetailFields || missingPlaybackFields) {
      issues.push('Unity 协议能力文件的发布标识、结构版本或必需命令与发布摘要不一致。')
    }

    /*
     * 元数据只是声明，浏览器真正收到的 ready 能力来自 Unity 输出的 index.html 桥接脚本。
     * 两者必须同时包含同一组命令；若只改 JSON 而漏改 .jslib/模板，静态门禁会通过但运行时握手必然失败。
     * 兼容测试夹具允许没有 index.html，但真实交付包一旦包含该入口就必须逐项核对能力字符串。
     */
    const unityEntryPath = path.join(rootDirectory, 'unity', 'index.html')
    if (await exists(unityEntryPath)) {
      const unityEntrySource = await readFile(unityEntryPath, 'utf8')
      const missingBridgeCapabilities = requiredUnityCommandCapabilities.filter((capability) => (
        !unityEntrySource.includes(`'${capability}'`) && !unityEntrySource.includes(`\"${capability}\"`)
      ))
      if (missingBridgeCapabilities.length > 0) {
        issues.push(`Unity 实际网页桥接未声明必需命令：${missingBridgeCapabilities.join('、')}。`)
      }
    }
  }

  /**
   * 外层和 Unity 必须同时锁定第二版；第一版父页面不能把“不携带第二层 topologyId”误读为普通业务视图。
   * 第三层独立拓扑仍由发布目录的 topologyDataContextId 在内部绑定，不进入外层稳定视图载荷。
   */
  if (releaseManifest.protocolVersions?.host !== 2 || releaseManifest.protocolVersions?.unity !== 2) {
    issues.push('发布摘要必须声明外层与 Unity 均使用第二版协议。')
  }

  /**
   * 外层握手保持15秒短预算，Unity 初始稳定视图与场景终态各自拥有120秒预算。
   * 不能只声明一个含义模糊的总启动超时，否则平台无法按第二版协议正确分段计时。
   */
  if (releaseManifest.runtimeTimeouts?.outerReadyMilliseconds !== 15_000 ||
      releaseManifest.runtimeTimeouts?.unityAndInitialViewMilliseconds !== 120_000 ||
      releaseManifest.runtimeTimeouts?.sceneSwitchResultMilliseconds !== 120_000) {
    issues.push('发布摘要必须声明外层就绪15秒、Unity初始稳定视图120秒、场景终态120秒的分阶段超时。')
  }

  if (releaseManifest.platformArtifactPatchingAllowed !== false) issues.push('发布摘要必须明确禁止平台修改构建产物。')
  const releaseSummaryLegacyKinds = findLegacyManifestFieldKinds(releaseManifest)
  if (releaseSummaryLegacyKinds.has('device-identifier') || releaseSummaryLegacyKinds.has('device-mapping') ||
      releaseSummaryLegacyKinds.has('binding-metadata') || releaseSummaryLegacyKinds.has('runtime-manifest')) {
    issues.push('发布摘要不得输出设备编号、设备映射、绑定元数据或第二份运行时清单字段。')
  }
  if (!releaseManifest.includedCapabilities?.includes('node-events') ||
      !releaseManifest.includedCapabilities?.includes('node-states') ||
      !releaseManifest.includedCapabilities?.includes('node-scene-mapping') ||
      !releaseManifest.includedCapabilities?.includes('process-detail')) {
    // “节点到三维映射能力”作为固定诊断短语保留，便于发布流水线和既有联调检查精确识别能力缺失。
    issues.push('发布摘要必须声明节点事件、节点状态、节点到三维映射能力和独立第三层能力。')
  }
  if (releaseManifest.includedCapabilities?.includes('device-mapping') ||
      releaseManifest.excludedCapabilities?.includes('node-events') ||
      releaseManifest.excludedCapabilities?.includes('node-states') ||
      releaseManifest.excludedCapabilities?.includes('node-scene-mapping')) {
    issues.push('发布摘要不得声明我方设备映射能力，也不得排除节点事件、节点状态或节点到三维映射能力。')
  }
  const declaredSourceNodeCount = releaseManifest.sourceTopology?.nodeCount ?? releaseManifest.gasTopology?.nodeCount
  if (releaseManifest.nodeProtocolPolicy?.mode !== 'node-id-owned-by-shell' ||
      releaseManifest.nodeProtocolPolicy?.associationKey !== 'nodeId' ||
      releaseManifest.nodeProtocolPolicy?.manifestKind !== 'immutable-structure' ||
      (typeof declaredSourceNodeCount === 'number' && releaseManifest.nodeProtocolPolicy?.sourceNodeCount !== declaredSourceNodeCount) ||
      releaseManifest.nodeProtocolPolicy?.filteredViewsReuseSourceNodeIds !== true) {
    issues.push(releaseManifest.sceneId === 'coal-power'
      ? '燃煤发布摘要必须锁定nodeId关联键、不可变结构清单、来源节点数量和过滤视图复用规则。'
      : '燃气发布摘要必须锁定nodeId关联键、不可变结构清单、23个总览来源节点和过滤视图复用规则。')
  }

  const deployment = releaseManifest.deployment ?? {}
  if (packageType === 'partner-integration' && deployment.listenPort !== partnerIntegrationPort) {
    issues.push(`合作方联调包监听端口必须固定为 ${partnerIntegrationPort}。`)
  }
  const isRuntimeSelfOrigin = deployment.addressMode === 'runtime-self-origin'
  if (isRuntimeSelfOrigin) {
    const runtimePolicy = deployment.runtimeSourcePolicy ?? {}
    if (deployment.publicOrigin !== null || deployment.platformParentOrigin !== null || deployment.unityParentOrigin !== null ||
        deployment.unityEntryUrl !== null || deployment.manifestUrl !== null || deployment.publicEntryUrl !== './' ||
        runtimePolicy.parentOriginQueryKey !== 'parentOrigin' || runtimePolicy.unityPath !== '/unity/index.html' ||
        runtimePolicy.manifestPath !== '/scene-topology-manifest.json' || runtimePolicy.directAccessWithoutPlatform !== true) {
      issues.push('运行时同源包必须使用当前服务地址派生资源，并允许脱离平台直接访问。')
    }
  } else {
    try {
      const publicOriginUrl = new URL(deployment.publicOrigin)
      const manifestUrl = new URL(deployment.manifestUrl)
      const expectedManifestUrl = new URL('/scene-topology-manifest.json', publicOriginUrl.origin).href
      if (manifestUrl.href !== expectedManifestUrl) issues.push('燃气包必须从我方公开来源读取同源 scene-topology-manifest.json。')
    } catch {
      issues.push('无法校验燃气包同源结构清单地址。')
    }
  }

  if (!isLocalTest) {
    const deploymentUrls = []
    if (!isRuntimeSelfOrigin) {
      for (const [label, value] of [
        ['浏览器公开来源', deployment.publicOrigin],
        ['平台父页面来源', deployment.platformParentOrigin],
        ['Unity父页面来源', deployment.unityParentOrigin],
        ['Unity入口地址', deployment.unityEntryUrl],
        ['结构清单地址', deployment.manifestUrl],
      ]) {
        if (typeof value !== 'string' || loopbackAddressPattern.test(value)) {
          issues.push(`${label}缺失或仍为本机地址。`)
        } else {
          try {
            deploymentUrls.push([label, new URL(value)])
          } catch {
            issues.push(`${label}不是有效的 HTTP 或 HTTPS 地址。`)
          }
        }
      }
    }
    if (packageType === 'standalone-formal' && !isRuntimeSelfOrigin) {
      for (const [label, url] of deploymentUrls) {
        if (url.protocol !== 'https:') issues.push(`正式包的${label}必须使用 HTTPS（安全超文本传输协议）。`)
      }
    }

    const files = await listReleaseFiles(rootDirectory)
    let reportedUnexpectedPath = false
    let reportedInternalPath = false
    let reportedLegacyPlaybackControls = false
    for (const filePath of files) {
      const relativePath = normalizeRelativePath(rootDirectory, filePath)
      const rootEntry = relativePath.split('/')[0]
      if (!reportedUnexpectedPath && !allowedDeliveryRootEntries.has(rootEntry)) {
        issues.push('合作方联调包和正式包包含输出标准未允许的根级文件或目录。')
        reportedUnexpectedPath = true
      }
      if (!reportedInternalPath && internalArtifactPathPattern.test(relativePath)) {
        issues.push('合作方联调包和正式包不得包含测试、诊断、夹具或模拟数据目录与文件。')
        reportedInternalPath = true
      }
      if (!textExtensions.has(path.extname(relativePath).toLowerCase()) || relativePath === integrityFileName) continue
      const content = await readFile(filePath, 'utf8')
      // 旧播放控件带有稳定数据标记；只扫描壳文本即可阻止历史按钮回流，无需读取 Unity 大资源或匹配中文文案。
      if (!reportedLegacyPlaybackControls && relativePath.startsWith('shell/') && content.includes('data-partner-playback-controls')) {
        issues.push('协议壳不得携带已废弃的关键环节网页播放控件。')
        reportedLegacyPlaybackControls = true
      }
      /*
       * 第三方前端依赖可能内置“未配置主机时回退本机”的通用库文案，它不是本包部署配置且不可原位修改。
       * 本机地址门禁只扫描我方生成、会被联调人员读取或执行的根级入口、说明、摘要、清单和服务脚本；
       * Unity 官方加载器和供应商代码继续由完整性摘要保护，避免误把依赖默认值判成实际部署地址。
       */
      const shouldScanDeploymentAddress = !relativePath.includes('/') || relativePath === 'shell/index.html'
      if (shouldScanDeploymentAddress && loopbackAddressPattern.test(content)) issues.push(`正式交付文本仍包含本机地址：${relativePath}`)
      if (internalTestMarkerPattern.test(content)) issues.push(`正式交付文本仍包含内部自测内容：${relativePath}`)
    }
    const serverSource = await readFile(path.join(rootDirectory, 'server.mjs'), 'utf8').catch(() => '')
    if (isRuntimeSelfOrigin) {
      if (!serverSource.includes("const addressMode = \"runtime-self-origin\"") ||
          !serverSource.includes('POWER_ALLOWED_FRAME_ANCESTORS') || !serverSource.includes('frame-ancestors *')) {
        issues.push('运行时同源联调服务未声明局域网嵌入策略或部署时收紧入口。')
      }
    } else {
      const cspSources = new Set(deploymentUrls
        .filter(([label]) => label === '平台父页面来源' || label === 'Unity入口地址' || label === '结构清单地址')
        .map(([, url]) => url.origin))
      for (const expectedSource of cspSources) {
        if (!serverSource.includes(expectedSource)) issues.push('内容安全策略未包含实际平台父源、Unity来源或清单来源。')
      }
    }
  }

  if (integrity) {
    if (integrity.releaseId !== releaseManifest.releaseId || integrity.algorithm !== 'sha256' || !Array.isArray(integrity.files)) {
      issues.push('产物完整性清单与发布摘要不一致。')
    } else {
      const actualFiles = (await listReleaseFiles(rootDirectory))
        .filter((filePath) => normalizeRelativePath(rootDirectory, filePath) !== integrityFileName)
      const actualRelativePaths = actualFiles.map((filePath) => normalizeRelativePath(rootDirectory, filePath))
      if (actualRelativePaths.length !== integrity.files.length || actualRelativePaths.some((filePath, index) => filePath !== integrity.files[index]?.path)) {
        issues.push('产物完整性清单的文件集合与目录不一致。')
      } else {
        for (let index = 0; index < actualFiles.length; index += 1) {
          const fileStats = await stat(actualFiles[index])
          const expected = integrity.files[index]
          if (fileStats.size !== expected.bytes || await calculateSha256(actualFiles[index]) !== expected.sha256) {
            issues.push(`构建后关键文件已被修改：${expected.path}`)
          }
        }
      }
    }
  }
  return issues
}

/** 失败时输出稳定、有限的问题列表；调用方不得带着部分通过的暂存目录继续发布。 */
export async function assertReleaseArtifact(rootDirectory) {
  const issues = await validateReleaseArtifact(rootDirectory)
  if (issues.length > 0) throw new Error(`发布产物门禁失败：${issues.join('；')}`)
}

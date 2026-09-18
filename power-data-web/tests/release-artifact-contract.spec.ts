import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  calculateDirectoryResourceDigest,
  validateReleaseArtifact,
  writeReleaseArtifactIntegrity,
} from '../scripts/release-artifact-contract.mjs'

const webProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 生成发布门禁需要的最小联合结构清单。夹具保留当前十项公开动作和六个动作目标场景，
 * 使正向用例本身不能再把“只有燃气、燃煤动作”的旧清单当成合格发布基线。
 */
function createTopologyManifest() {
  const manifestVersion = 'gas-power-smoke.artifact-contract'
  const navigationScenes = [
    ['wind-power', '风力发电'],
    ['solar-power', '光伏发电'],
    ['step-up-substation', '升压站'],
    ['step-down-substation', '降压站'],
  ]
  return {
    manifestVersion,
    unityBuildId: 'unity-contract',
    unityRuntimeKey: 'gas-plant-release',
    scenes: [{
      sceneId: 'gas-power',
      defaultTopologyId: 'topology.gas-power.overview',
      topologyIds: ['topology.gas-power.overview'],
      supportedActionIds: ['action.gas-power.overview', 'action.gas-power.gas-turbine'],
    }, {
      sceneId: 'coal-power',
      defaultTopologyId: 'topology.coal-power.overview',
      topologyIds: ['topology.coal-power.overview'],
      supportedActionIds: ['action.coal-power.overview', 'action.coal-power.steam-turbine'],
    }, ...navigationScenes.map(([sceneId]) => ({
      sceneId,
      defaultTopologyId: `topology.${sceneId}.overview`,
      topologyIds: [`topology.${sceneId}.overview`],
      supportedActionIds: sceneId === 'solar-power'
        ? ['action.solar-power.overview', 'action.solar-power.inverter']
        : [`action.${sceneId}.overview`],
    }))],
    topologies: [{
      topologyId: 'topology.gas-power.overview',
      sceneId: 'gas-power',
      title: '燃气总览',
      configVersion: manifestVersion,
      nodes: Array.from({ length: 23 }, (_, index) => ({
        nodeId: `node-${index + 1}`,
        title: `节点${index + 1}`,
        iconKey: 'server',
        x: index,
        y: 50,
        deviceStatus: 'offline',
        doubleClickBehavior: 'emit-node',
      })),
      edges: [],
    }, ...['coal-power', ...navigationScenes.map(([sceneId]) => sceneId)].map((sceneId) => ({
      topologyId: `topology.${sceneId}.overview`,
      sceneId,
      title: `${sceneId}总览`,
      configVersion: manifestVersion,
      nodes: [],
      edges: [],
    }))],
    actions: [{
      actionId: 'action.scene.overview',
      title: '返回全局总览',
      targetSceneId: 'overview',
      targetViewMode: 'overview',
      allowedParameters: [],
      unityAction: { type: 'none' },
      failurePolicy: 'keep-current-context',
      configVersion: manifestVersion,
    }, {
      actionId: 'action.gas-power.overview',
      title: '返回燃气总览',
      targetSceneId: 'gas-power',
      targetViewMode: 'business',
      targetTopologyId: 'topology.gas-power.overview',
      allowedParameters: [],
      unityAction: { type: 'resetScene' },
      failurePolicy: 'keep-current-context',
      configVersion: manifestVersion,
    }, {
      actionId: 'action.gas-power.gas-turbine',
      title: '进入燃气轮机关键环节',
      targetSceneId: 'gas-power',
      targetViewMode: 'process-detail',
      processDetailId: 'process-detail.gas-power.gas-turbine',
      allowedParameters: [],
      unityAction: { type: 'enterProcessDetail', processDetailId: 'process-detail.gas-power.gas-turbine' },
      failurePolicy: 'keep-current-context',
      configVersion: manifestVersion,
    }, {
      actionId: 'action.coal-power.overview',
      title: '进入燃煤总览',
      targetSceneId: 'coal-power',
      targetViewMode: 'business',
      targetTopologyId: 'topology.coal-power.overview',
      allowedParameters: [],
      unityAction: { type: 'resetScene' },
      failurePolicy: 'keep-current-context',
      configVersion: manifestVersion,
    }, {
      actionId: 'action.coal-power.steam-turbine',
      title: '进入燃煤汽轮机关键环节',
      targetSceneId: 'coal-power',
      targetViewMode: 'process-detail',
      processDetailId: 'process-detail.coal-power.steam-turbine',
      allowedParameters: [],
      unityAction: { type: 'enterProcessDetail', processDetailId: 'process-detail.coal-power.steam-turbine' },
      failurePolicy: 'keep-current-context',
      configVersion: manifestVersion,
    }, ...navigationScenes.map(([sceneId, title]) => ({
      actionId: `action.${sceneId}.overview`,
      title: `进入${title}总览`,
      targetSceneId: sceneId,
      targetViewMode: 'business',
      targetTopologyId: `topology.${sceneId}.overview`,
      allowedParameters: [],
      unityAction: { type: 'none' },
      failurePolicy: 'keep-current-context',
      configVersion: manifestVersion,
    })), {
      actionId: 'action.solar-power.inverter',
      title: '进入光伏逆变器关键环节',
      targetSceneId: 'solar-power',
      targetViewMode: 'process-detail',
      processDetailId: 'process-detail.solar-power.inverter',
      allowedParameters: [],
      unityAction: { type: 'enterProcessDetail', processDetailId: 'process-detail.solar-power.inverter' },
      failurePolicy: 'keep-current-context',
      configVersion: manifestVersion,
    }],
    processDetails: [{
      sceneId: 'gas-power',
      processId: 'gas-power-generation',
      stepId: 'gas-turbine',
      processDetailId: 'process-detail.gas-power.gas-turbine',
      resourceId: 'process-detail-resource.gas-power.gas-turbine',
      cameraPoseId: 'camera-pose.gas-power.gas-turbine',
      stateNodeId: 'node.gas-turbine',
      topologyDataContextId: 'process-detail.gas-power.gas-turbine',
    }, {
      sceneId: 'coal-power',
      processId: 'coal-power-generation',
      stepId: 'steam-turbine',
      processDetailId: 'process-detail.coal-power.steam-turbine',
      resourceId: 'process-detail-resource.coal-power.steam-turbine',
      cameraPoseId: 'camera-pose.coal-power.steam-turbine',
      stateNodeId: 'node.coal-steam-turbine',
      topologyDataContextId: 'process-detail.coal-power.steam-turbine',
    }, {
      sceneId: 'solar-power',
      processId: 'solar-power-generation',
      stepId: 'inverter',
      processDetailId: 'process-detail.solar-power.inverter',
      resourceId: 'process-detail-resource.solar-power.inverter',
      cameraPoseId: 'camera-pose.solar-power.inverter',
      stateNodeId: 'node.solar-inverter',
      topologyDataContextId: 'process-detail.solar-power.inverter',
    }],
    unitySceneMappings: [{
      sceneId: 'gas-power',
      mappingVersion: 'mapping.gas-power.1',
      sceneNodeIds: ['node.gas-turbine'],
      routeIds: [],
    }, {
      sceneId: 'coal-power',
      mappingVersion: 'mapping.coal-power.1',
      sceneNodeIds: ['node.coal-steam-turbine'],
      routeIds: [],
    }, ...navigationScenes.map(([sceneId]) => ({
      sceneId,
      mappingVersion: `mapping.${sceneId}.1`,
      sceneNodeIds: [],
      routeIds: [],
    }))],
  }
}

function createReleaseManifest() {
  return {
    releaseId: 'artifact-contract-release',
    manifestVersion: 'gas-power-smoke.artifact-contract',
    unityReleaseId: 'unity-contract',
    runtimeIdentity: {
      buildId: 'unity-contract',
      resourceDigest: `sha256:${'0'.repeat(64)}`,
    },
    packageType: 'partner-integration',
    deploymentMode: 'independent-service-iframe',
    platformArtifactPatchingAllowed: false,
    selfTestIncluded: false,
    includedCapabilities: ['node-events', 'node-states', 'node-scene-mapping', 'process-detail'],
    protocolVersions: { host: 2, unity: 2 },
    // 第二版协议把15秒外层就绪、120秒 Unity 初始稳定视图与120秒场景终态拆成独立阶段。
    runtimeTimeouts: {
      outerReadyMilliseconds: 15_000,
      unityAndInitialViewMilliseconds: 120_000,
      sceneSwitchResultMilliseconds: 120_000,
    },
    // Unity 大资源缓存策略属于发布摘要强制字段，测试夹具必须与真实发布器保持一致。
    cachePolicy: {
      unityWebGLDataCaching: false,
      unityLargeResources: 'no-store',
      unityLargeResourcePaths: ['unity/Build/', 'unity/SceneBundles/', 'unity/ProcessDetailBundles/'],
    },
    excludedCapabilities: ['route-mapping', 'other-eight-scene-content'],
    // 合作方动作菜单读取该摘要；从当前十项结构动作生成相同公开投影，避免测试夹具手工维护时再次漏项。
    workflowActions: createTopologyManifest().actions.map((action) => ({
      actionId: action.actionId,
      title: action.title,
      targetSceneId: action.targetSceneId,
      targetViewMode: action.targetViewMode,
      ...('targetTopologyId' in action ? { targetTopologyId: action.targetTopologyId } : {}),
      ...('processDetailId' in action ? { processDetailId: action.processDetailId } : {}),
    })),
    gasTopology: { nodeCount: 23, edgeCount: 0 },
    nodeProtocolPolicy: {
      mode: 'node-id-owned-by-shell',
      associationKey: 'nodeId',
      manifestKind: 'immutable-structure',
      sourceTopologyId: 'topology.gas-power.overview',
      sourceNodeCount: 23,
      filteredViewsReuseSourceNodeIds: true,
    },
    deployment: {
      listenHost: '0.0.0.0',
      listenPort: 5575,
      publicOrigin: 'http://visual.example.com',
      platformParentOrigin: 'http://platform.example.com',
      unityParentOrigin: 'http://visual.example.com',
      unityEntryUrl: 'http://visual.example.com/unity/index.html',
      manifestUrl: 'http://visual.example.com/scene-topology-manifest.json',
      entryMode: 'platform-direct-shell-redirect',
      publicEntryUrl: 'http://visual.example.com/',
    },
  }
}

async function createArtifact() {
  const root = mkdtempSync(path.join(tmpdir(), 'gas-release-contract-'))
  writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(createReleaseManifest(), null, 2)}\n`, 'utf8')
  writeFileSync(path.join(root, 'scene-topology-manifest.json'), `${JSON.stringify(createTopologyManifest(), null, 2)}\n`, 'utf8')
  mkdirSync(path.join(root, 'unity'))
  writeFileSync(path.join(root, 'unity', 'webgl-protocol-capabilities.json'), `${JSON.stringify({
    schemaVersion: 10,
    channel: 'power3d-unity',
    protocolVersion: 2,
    unityReleaseId: 'unity-contract',
    commandCapabilities: [
      'init', 'resize', 'switchScene', 'moveCameraToPose', 'enterProcessDetail', 'prepareProcessDetail', 'commitProcessDetail', 'abortProcessDetail', 'exitProcessDetail', 'setProcessDetailPlayback', 'resetScene', 'resetCamera', 'focusNode', 'clearSelection',
      'setNodeVisualState', 'clearNodeVisualState', 'setRouteFlow', 'setNodeVisibility', 'dispose',
    ],
    eventCapabilities: ['ready', 'ack', 'commandResult', 'sceneLoadProgress', 'sceneChanged', 'objectSelected', 'selectionCleared', 'disposed'],
    processDetailCommandSchemaVersion: 2,
    enterProcessDetailRequiredFields: ['sceneId', 'processId', 'stepId', 'processDetailId', 'transitionId'],
    prepareProcessDetailRequiredFields: ['sceneId', 'processId', 'stepId', 'processDetailId', 'transitionId'],
    commitProcessDetailRequiredFields: ['sceneId', 'processDetailId', 'transitionId'],
    abortProcessDetailRequiredFields: ['sceneId', 'processDetailId', 'transitionId'],
    exitProcessDetailRequiredFields: ['sceneId', 'processDetailId', 'transitionId'],
    setProcessDetailPlaybackRequiredFields: ['sceneId', 'processDetailId', 'playing'],
  }, null, 2)}\n`, 'utf8')
  const unityResourceDigest = await calculateDirectoryResourceDigest(path.join(root, 'unity'))
  const releaseManifest = createReleaseManifest()
  releaseManifest.runtimeIdentity.resourceDigest = unityResourceDigest
  writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
  // 协议壳必须编译进与 Unity 目录相同的身份值，模拟真实前端构建后的静态脚本。
  mkdirSync(path.join(root, 'shell'), { recursive: true })
  writeFileSync(
    path.join(root, 'shell', 'index.js'),
    `const buildId = "unity-contract"; const resourceDigest = "${unityResourceDigest}";\n`,
    'utf8',
  )
  /**
   * 正向夹具复制经过散列锁定的真实第三层拓扑，使测试同时覆盖构建产物目录结构和内容合同；
   * 使用真实文件而非手造数据，可防止生产拓扑更新后测试基线静默偏离。
   */
  cpSync(
    path.join(webProjectRoot, 'public', 'topology', 'process-detail'),
    path.join(root, 'shell', 'topology', 'process-detail'),
    { recursive: true },
  )
  // 内容安全策略必须记录实际平台、Unity和清单来源；这里用最小静态服务文本模拟构建产物。
  writeFileSync(path.join(root, 'server.mjs'), 'frame-ancestors http://platform.example.com; frame-src http://visual.example.com; connect-src http://platform.example.com\n', 'utf8')
  writeFileSync(path.join(root, 'index.html'), `<!doctype html>
<meta name="power-entry-mode" content="platform-direct-shell-redirect">
<script>const shellUrl = new URL('./shell/embed', window.location.href); shellUrl.search = window.location.search; window.location.replace(shellUrl.toString())</script>\n`, 'utf8')
  writeFileSync(path.join(root, 'README.md'), '# 联调启动说明\n', 'utf8')
  await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')
  return root
}

describe('发布产物输出标准', () => {
  it('合作方联调包通过来源、绑定能力和不可变摘要门禁', async () => {
    const root = await createArtifact()
    try {
      expect(await validateReleaseArtifact(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('发布包缺少光伏逆变器独立拓扑时阻断交付', async () => {
    const root = await createArtifact()
    try {
      rmSync(path.join(root, 'shell', 'topology', 'process-detail', 'solar-power', 'inverter', 'topology.json'))
      // 重写普通完整性清单，证明专用拓扑合同能独立发现漏拷，而不是依赖通用文件摘要偶然报错。
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('第三层拓扑文件缺失：process-detail/solar-power/inverter/topology.json'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('发布包第三层拓扑被篡改且重写完整性清单时仍阻断交付', async () => {
    const root = await createArtifact()
    try {
      const topologyPath = path.join(root, 'shell', 'topology', 'process-detail', 'solar-power', 'inverter', 'topology.json')
      const topology = JSON.parse(readFileSync(topologyPath, 'utf8'))
      topology.pens[0].x += 1
      writeFileSync(topologyPath, `${JSON.stringify(topology)}\n`, 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('第三层拓扑文件散列与验收版本不一致'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('第三层拓扑目录混入未登记资源时阻断交付', async () => {
    const root = await createArtifact()
    try {
      const extraResourcePath = path.join(root, 'shell', 'topology', 'process-detail', 'solar-power', 'inverter', 'copied-image.png')
      // 即使额外文件被写入通用完整性清单，第三层目录合同仍只允许登记的 topology.json。
      writeFileSync(extraResourcePath, '不应进入第三层目录的资源副本', 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('第三层拓扑目录包含合同外资源'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('光伏逆变器状态绑定图元丢失时阻断交付', async () => {
    const root = await createArtifact()
    try {
      const topologyPath = path.join(root, 'shell', 'topology', 'process-detail', 'solar-power', 'inverter', 'topology.json')
      const topology = JSON.parse(readFileSync(topologyPath, 'utf8'))
      const bindingPen = topology.pens.find((pen: { id?: string }) => pen.id === 'df25e45')
      if (!bindingPen) throw new Error('测试夹具缺少光伏逆变器控制系统绑定图元。')
      bindingPen.id = 'binding-removed-for-test'
      writeFileSync(topologyPath, `${JSON.stringify(topology)}\n`, 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('第三层拓扑缺少已登记的状态绑定图元'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('发布摘要遗漏结构清单动作时阻断交付', async () => {
    const root = await createArtifact()
    try {
      const releaseManifest = createReleaseManifest()
      // 模拟结构清单已经新增场景动作、发布摘要仍停留在旧数量的合作方反馈场景。
      releaseManifest.workflowActions = releaseManifest.workflowActions.slice(0, 1)
      writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('流程动作必须与结构清单逐项一致'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('结构清单与发布摘要同时遗漏新增场景动作时仍阻断交付', async () => {
    const root = await createArtifact()
    try {
      const topologyManifest = createTopologyManifest()
      const releaseManifest = createReleaseManifest()
      // 模拟生成器整体回退：两份清单同时删除风电动作，并同步清空场景反向引用，旧相对一致性检查无法发现该问题。
      topologyManifest.actions = topologyManifest.actions.filter((action) => action.actionId !== 'action.wind-power.overview')
      const windScene = topologyManifest.scenes.find((scene) => scene.sceneId === 'wind-power')
      if (windScene) windScene.supportedActionIds = []
      releaseManifest.workflowActions = releaseManifest.workflowActions.filter((action) => action.actionId !== 'action.wind-power.overview')
      writeFileSync(path.join(root, 'scene-topology-manifest.json'), `${JSON.stringify(topologyManifest, null, 2)}\n`, 'utf8')
      writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('完整发布当前十项公开动作'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('新增场景导航伪造流程动作或流程步骤时阻断交付', async () => {
    const root = await createArtifact()
    try {
      const topologyManifest = createTopologyManifest()
      const windAction = topologyManifest.actions.find((action) => action.actionId === 'action.wind-power.overview')
      const windMapping = topologyManifest.unitySceneMappings.find((mapping) => mapping.sceneId === 'wind-power')
      if (!windAction || !windMapping) throw new Error('测试夹具缺少风电导航契约。')
      // 模拟旧版错误：普通场景导航被包装成控制器没有声明的流程步骤，公开摘要表面仍保持不变。
      windAction.unityAction = { type: 'enterProcessStep', processId: 'wind-power-generation', stepId: 'overview' } as never
      ;(windMapping as unknown as Record<string, unknown>).processSteps = [{ processId: 'wind-power-generation', stepId: 'overview' }]
      writeFileSync(path.join(root, 'scene-topology-manifest.json'), `${JSON.stringify(topologyManifest, null, 2)}\n`, 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('固定目标'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('全局总览动作使用旧标识时阻断交付', async () => {
    const root = await createArtifact()
    try {
      const topologyManifest = createTopologyManifest()
      const releaseManifest = createReleaseManifest()
      const overviewAction = topologyManifest.actions.find((action) => action.actionId === 'action.scene.overview')
      const overviewSummary = releaseManifest.workflowActions.find((action) => action.actionId === 'action.scene.overview')
      if (!overviewAction || !overviewSummary) throw new Error('测试夹具缺少全局总览动作。')
      // 两份清单同步写入曾被误用的大小写标识，证明门禁校验稳定值而不只比较两边相等。
      overviewAction.actionId = 'Scene.overview'
      overviewSummary.actionId = 'Scene.overview'
      writeFileSync(path.join(root, 'scene-topology-manifest.json'), `${JSON.stringify(topologyManifest, null, 2)}\n`, 'utf8')
      writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('完整发布当前十项公开动作'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('三类新包都不得回流已废弃的关键环节网页播放控件', async () => {
    const root = await createArtifact()
    try {
      const releaseManifest = createReleaseManifest()
      // 同时模拟旧摘要字段和旧壳标记，确保门禁分别报告两种过期产物而不是要求重新补齐按钮。
      ;(releaseManifest as Record<string, unknown>).playbackControlsIncluded = true
      writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
      mkdirSync(path.join(root, 'shell'), { recursive: true })
      writeFileSync(
        path.join(root, 'shell', 'index.js'),
        'const playbackMarker = "data-partner-playback-controls";\n',
        'utf8',
      )
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')
      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('发布摘要不得再声明'),
        expect.stringContaining('协议壳不得携带'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('Unity 实际网页桥接缺少登记命令时必须阻断发布', async () => {
    const root = await createArtifact()
    try {
      // 模拟“能力元数据已更新、实际 WebGL 桥接未更新”的真实回归场景。
      mkdirSync(path.join(root, 'unity'), { recursive: true })
      writeFileSync(path.join(root, 'unity', 'index.html'), "const commandCapabilities = ['init'];\n", 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('Unity 实际网页桥接未声明必需命令'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('Unity 大资源缺少禁止存储策略时阻断交付', async () => {
    const root = await createArtifact()
    try {
      const releaseManifest = createReleaseManifest()
      releaseManifest.cachePolicy.unityLargeResources = 'public, max-age=31536000, immutable'
      releaseManifest.cachePolicy.unityLargeResourcePaths = ['unity/Build/']
      writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('主播放器、场景资源包和关键环节资源使用 no-store'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('第一版父页面或第一版 Unity 声明均不能伪装成第二版第三层包', async () => {
    const root = await createArtifact()
    try {
      const releaseManifest = createReleaseManifest()
      releaseManifest.protocolVersions = { host: 1, unity: 2 }
      writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
      const unityMetadataPath = path.join(root, 'unity', 'webgl-protocol-capabilities.json')
      const unityMetadata = JSON.parse(readFileSync(unityMetadataPath, 'utf8'))
      unityMetadata.protocolVersion = 1
      writeFileSync(unityMetadataPath, `${JSON.stringify(unityMetadata, null, 2)}\n`, 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('第二版协议'),
        expect.stringContaining('Unity 协议能力文件'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('外层15秒、Unity初始视图120秒或场景终态120秒任一声明不正确时阻断交付', async () => {
    const root = await createArtifact()
    try {
      const releaseManifest = createReleaseManifest()
      // 模拟产物仍沿用旧三十秒场景终态等待值；门禁应在交付前明确拒绝，而不是留到冷缓存联调时超时。
      releaseManifest.runtimeTimeouts.sceneSwitchResultMilliseconds = 30_000
      writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('外层就绪15秒、Unity初始稳定视图120秒、场景终态120秒'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('缺少节点到三维映射能力或继续输出旧设备语义字段时阻断交付', async () => {
    const root = await createArtifact()
    try {
      const releaseManifest = createReleaseManifest()
      releaseManifest.includedCapabilities = ['node-events', 'node-states']
      ;(releaseManifest.nodeProtocolPolicy as Record<string, unknown>).platformInjectsDeviceIds = false
      writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('节点到三维映射能力'),
        expect.stringContaining('发布摘要不得输出设备编号'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('结构清单任意深层的旧字段变体都会被发布门禁拒绝', async () => {
    const root = await createArtifact()
    try {
      const topologyManifest = createTopologyManifest()
      ;(topologyManifest.topologies[0].nodes[0] as Record<string, unknown>).selectedDeviceId = 'legacy-device'
      ;(topologyManifest.topologies[0].nodes[1] as Record<string, unknown>).bindingRevision = 'legacy-revision'
      ;(topologyManifest.topologies[0] as Record<string, unknown>).runtime_manifest = { ignoredAfterParentRejection: true }
      writeFileSync(path.join(root, 'scene-topology-manifest.json'), `${JSON.stringify(topologyManifest, null, 2)}\n`, 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('任意层级不得包含平台设备编号'),
        expect.stringContaining('平台绑定元数据'),
        expect.stringContaining('第二份运行时清单'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('燃气包结构清单地址指向平台接口时即使摘要同步也阻断交付', async () => {
    const root = await createArtifact()
    try {
      const releaseManifest = createReleaseManifest()
      releaseManifest.deployment.manifestUrl = 'http://platform.example.com/api/runtime-manifest'
      writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('同源 scene-topology-manifest.json'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('即使重写完整性清单，Unity 内容变化仍会被运行时资源摘要阻断', async () => {
    const root = await createArtifact()
    try {
      const metadataPath = path.join(root, 'unity', 'webgl-protocol-capabilities.json')
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
      metadata.diagnosticMarker = 'changed-after-shell-build'
      writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
      // 模拟有人重新生成普通完整性清单以掩盖修改；运行时身份仍应绑定最初用于编译壳的 Unity 目录摘要。
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('运行时资源摘要与发布目录中的 Unity 实际文件不一致'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('构建后修改关键文件会被完整性门禁发现', async () => {
    const root = await createArtifact()
    try {
      writeFileSync(path.join(root, 'server.mjs'), '被平台修改的脚本\n', 'utf8')
      const issues = await validateReleaseArtifact(root)
      expect(issues).toEqual(expect.arrayContaining([expect.stringContaining('构建后关键文件已被修改：server.mjs')]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('独立服务包再嵌套一层本地宿主时即使摘要有效也会被阻断', async () => {
    const root = await createArtifact()
    try {
      writeFileSync(path.join(root, 'index.html'), '<iframe id="visualization-shell"></iframe><script>const command = { type: \'system.init\' }</script>\n', 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')
      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('平台成为协议壳的直接父页面'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('合作方联调包发布摘要使用非5575端口时阻断交付', async () => {
    const root = await createArtifact()
    try {
      const releaseManifest = createReleaseManifest()
      releaseManifest.deployment.listenPort = 5592
      writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('监听端口必须固定为 5575'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('正式包中的本机地址和内部自测标识会被阻断', async () => {
    const root = await createArtifact()
    try {
      const releaseManifest = createReleaseManifest()
      releaseManifest.packageType = 'standalone-formal'
      releaseManifest.deployment.publicOrigin = 'https://visual.example.com'
      releaseManifest.deployment.platformParentOrigin = 'https://platform.example.com'
      releaseManifest.deployment.unityParentOrigin = 'https://visual.example.com'
      releaseManifest.deployment.unityEntryUrl = 'https://visual.example.com/unity/index.html'
      releaseManifest.deployment.manifestUrl = 'https://visual.example.com/scene-topology-manifest.json'
      writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
      writeFileSync(path.join(root, 'server.mjs'), 'const old = "http://127.0.0.1:5555"; data-action-id="test"\n', 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')
      const issues = await validateReleaseArtifact(root)
      expect(issues).toEqual(expect.arrayContaining([
        expect.stringContaining('本机地址'),
        expect.stringContaining('内部自测内容'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('合作方包中的嵌套诊断页、测试状态和额外根目录会被阻断', async () => {
    const root = await createArtifact()
    try {
      mkdirSync(path.join(root, 'unity', 'diagnostics'), { recursive: true })
      writeFileSync(path.join(root, 'unity', 'diagnostics', 'status.html'), '<div id="test-status">合成状态</div>\n', 'utf8')
      mkdirSync(path.join(root, 'unexpected-root'), { recursive: true })
      writeFileSync(path.join(root, 'unexpected-root', 'readme.txt'), '不属于交付目录结构\n', 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('未允许的根级文件或目录'),
        expect.stringContaining('测试、诊断、夹具或模拟数据'),
        expect.stringContaining('内部自测内容'),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

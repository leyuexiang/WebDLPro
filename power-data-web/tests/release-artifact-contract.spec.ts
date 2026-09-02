import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  validateReleaseArtifact,
  writeReleaseArtifactIntegrity,
} from '../scripts/release-artifact-contract.mjs'

/** 生成发布门禁需要的最小燃气结构清单；23个来源节点数量直接锁定合作方联调契约。 */
function createTopologyManifest() {
  return {
    manifestVersion: 'gas-power-smoke.artifact-contract',
    unityBuildId: 'unity-contract',
    unityRuntimeKey: 'gas-plant-release',
    scenes: [],
    topologies: [{
      topologyId: 'topology.gas-power.overview',
      sceneId: 'gas-power',
      title: '燃气总览',
      configVersion: 'gas-power-smoke.artifact-contract',
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
    }],
    actions: [{
      actionId: 'action.gas-power.gas-turbine',
      title: '进入燃气轮机关键环节',
      targetSceneId: 'gas-power',
      targetViewMode: 'process-detail',
      processDetailId: 'process-detail.gas-power.gas-turbine',
      allowedParameters: [],
      unityAction: { type: 'enterProcessDetail', processDetailId: 'process-detail.gas-power.gas-turbine' },
      failurePolicy: 'keep-current-context',
      configVersion: 'gas-power-smoke.artifact-contract',
    }],
    processDetails: [{
      sceneId: 'gas-power',
      processId: 'gas-power-generation',
      stepId: 'gas-turbine',
      processDetailId: 'process-detail.gas-power.gas-turbine',
      resourceId: 'process-detail-resource.gas-power.gas-turbine',
      cameraPoseId: 'camera-pose.gas-power.gas-turbine',
      stateNodeId: 'gas-turbine',
    }],
    unitySceneMappings: [{
      sceneId: 'gas-power',
      mappingVersion: 'mapping.gas-power.1',
      processSteps: [{ processId: 'gas-power-generation', stepId: 'overview' }],
      sceneNodeIds: ['gas-turbine'],
      routeIds: [],
    }],
  }
}

function createReleaseManifest() {
  return {
    releaseId: 'artifact-contract-release',
    manifestVersion: 'gas-power-smoke.artifact-contract',
    unityReleaseId: 'unity-contract',
    packageType: 'partner-integration',
    deploymentMode: 'independent-service-iframe',
    platformArtifactPatchingAllowed: false,
    selfTestIncluded: false,
    includedCapabilities: ['node-events', 'node-states', 'node-scene-mapping', 'process-detail'],
    protocolVersions: { host: 2, unity: 2 },
    // 第二版协议把15秒外层就绪与120秒 Unity 初始稳定视图拆成两个独立阶段。
    runtimeTimeouts: {
      outerReadyMilliseconds: 15_000,
      unityAndInitialViewMilliseconds: 120_000,
    },
    // Unity 大资源缓存策略属于发布摘要强制字段，测试夹具必须与真实发布器保持一致。
    cachePolicy: {
      unityWebGLDataCaching: false,
      unityLargeResources: 'no-store',
      unityLargeResourcePaths: ['unity/Build/', 'unity/SceneBundles/', 'unity/ProcessDetailBundles/'],
    },
    excludedCapabilities: ['route-mapping', 'other-eight-scene-content'],
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
    schemaVersion: 9,
    channel: 'power3d-unity',
    protocolVersion: 2,
    unityReleaseId: 'unity-contract',
    commandCapabilities: [
      'init', 'resize', 'switchScene', 'enterProcessStep', 'moveCameraToPose', 'enterProcessDetail', 'prepareProcessDetail', 'commitProcessDetail', 'abortProcessDetail', 'exitProcessDetail', 'setProcessDetailPlayback', 'resetScene', 'focusNode', 'clearSelection',
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

  it('外层15秒或 Unity 120秒任一分阶段声明不正确时阻断交付', async () => {
    const root = await createArtifact()
    try {
      const releaseManifest = createReleaseManifest()
      // 模拟平台仍沿用旧 15 秒 Unity 等待值；门禁应在交付前明确拒绝，而不是留到联调现场超时。
      releaseManifest.runtimeTimeouts.unityAndInitialViewMilliseconds = 15_000
      writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
      await writeReleaseArtifactIntegrity(root, 'artifact-contract-release')

      expect(await validateReleaseArtifact(root)).toEqual(expect.arrayContaining([
        expect.stringContaining('外层就绪15秒、Unity与初始稳定视图120秒'),
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

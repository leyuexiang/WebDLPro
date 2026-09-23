import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    actions: [],
    unitySceneMappings: [],
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
    includedCapabilities: ['node-events', 'node-states', 'node-scene-mapping'],
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
    schemaVersion: 4,
    channel: 'power3d-unity',
    protocolVersion: 1,
    unityReleaseId: 'unity-contract',
    commandCapabilities: [
      'init', 'resize', 'switchScene', 'enterProcessStep', 'resetScene', 'focusNode', 'clearSelection',
      'setNodeVisualState', 'clearNodeVisualState', 'setRouteFlow', 'setNodeVisibility', 'dispose',
    ],
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

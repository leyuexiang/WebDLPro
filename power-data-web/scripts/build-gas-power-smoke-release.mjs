import { access, cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { constants as fileSystemConstants } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createServer } from 'vite'

/**
 * 燃气发电最小联调包构建器。
 *
 * 此脚本只为“现有燃气发电 Unity 场景 + 已确认燃气拓扑”生成一个可独立启动的测试发布目录。
 * 它不会改写九场景正式清单，也不会把尚未交付的设备、三维节点、流程或状态映射伪造成真实内容。
 * 其余八个固定场景仅保留契约要求的空占位，外层测试宿主页只会初始化 gas-power（燃气发电）。
 */
const workspaceRoot = process.cwd()
const projectRoot = path.resolve(workspaceRoot, '..')
const releasesRoot = path.join(projectRoot, 'Builds', 'Releases')
const defaultUnityReleaseId = 'task051-20260805-1400'
let unityReleaseId = defaultUnityReleaseId
const host = '127.0.0.1'
const port = 5523
const hostOrigin = `http://${host}:${port}`
const unitySceneMappingVersion = '2026.08.01-local.2'
const unityRuntimeKey = 'gas-plant-release'
const unityBuildId = 'local-webgl-topology-link'
const resourceDigest = 'local-webgl-topology-link'

/**
 * 仅登记已经在 GasPower.unity（燃气场景）与 PowerPlantProcessController（燃气流程控制器）中逐项核对的二维—三维节点映射。
 * 键和值即使文本相同也以显式映射保存；运行时绝不按节点名称、坐标或图元键推导三维对象。
 * 其余控制网络节点没有已登记的燃气三维目标，因此必须保持为纯二维节点，不会收到聚焦命令。
 */
const verifiedGasSceneNodeIdByTopologyNodeId = new Map([
  ['inlet-duct', 'inlet-duct'],
  ['gas-turbine', 'gas-turbine'],
  ['hrsg', 'hrsg'],
  ['steam-turbine', 'steam-turbine'],
  ['generator', 'generator'],
  ['grid-output', 'grid-output'],
])

/**
 * 参数只允许可安全放入发布目录名的稳定片段，避免构建命令被误用为任意路径写入工具。
 * 未指定版本时使用本地时间生成唯一版本；目录已存在时立即失败而不覆盖已有测试包。
 */
function readReleaseConfiguration(argumentsList) {
  const configuration = {
    releaseId: `gas-power-smoke-${formatTimestamp(new Date())}`,
    unityReleaseId: defaultUnityReleaseId,
  }

  for (let index = 0; index < argumentsList.length; index += 2) {
    const option = argumentsList[index]
    const value = argumentsList[index + 1]
    if (!value || (option !== '--release-id' && option !== '--unity-release-id')) {
      throw new Error('仅支持可选参数 --release-id <标识> 与 --unity-release-id <标识>。')
    }
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value) || value.length > 96) {
      throw new Error('发布标识只能包含小写字母、数字、连字符和点，且长度不能超过 96。')
    }
    if (option === '--release-id') configuration.releaseId = value
    if (option === '--unity-release-id') configuration.unityReleaseId = value
  }

  return configuration
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
 * 通过 Vite（前端构建工具）的服务端模块加载器读取现有燃气配置。
 * 这样测试包的节点坐标、分层、图标、离线基线和连线直接来自项目当前实现，避免按截图或名称另行猜测。
 */
async function readExistingGasTopology() {
  const viteServer = await createServer({
    root: workspaceRoot,
    logLevel: 'silent',
    server: { middlewareMode: true },
    appType: 'custom',
  })

  try {
    const module = await viteServer.ssrLoadModule('/src/config/process/local-process-config.ts')
    const loaded = module.localProcessConfigLoader.load('gas-overview')
    const topology = loaded?.bundle?.topology
    if (!topology || !Array.isArray(topology.nodes) || !Array.isArray(topology.edges)) {
      throw new Error('现有燃气拓扑未通过加载器校验，不能生成联调包。')
    }

    return topology
  } finally {
    await viteServer.close()
  }
}

/**
 * 从已通过项目加载器的燃气拓扑投影到新嵌入壳清单格式。
 * 旧配置没有正式 deviceId（设备标识）或 sceneNodeId（三维节点标识），故明确不填并禁用双击上报；
 * 但已核验的二维展示层级、节点层级、协议标签与连线证据必须完整透传，不能在清单迁移时降级为通用散点图。
 * 这保留真实二维关系，同时防止联调包把视觉节点误称为已确认的设备/三维映射。
 */
function projectGasTopology(topology, manifestVersion) {
  return {
    topologyId: 'topology.gas-power.overview',
    sceneId: 'gas-power',
    title: topology.title,
    configVersion: manifestVersion,
    // 层级只决定二维画布的分区、标题与颜色，不参与设备或 Unity 映射。
    layers: topology.layers?.map((layer) => ({
      layerId: String(layer.layerId),
      title: layer.title,
      y: layer.y,
      color: layer.color,
    })),
    nodes: topology.nodes.map((node) => {
      const topologyNodeId = String(node.nodeId)
      const sceneNodeId = verifiedGasSceneNodeIdByTopologyNodeId.get(topologyNodeId)

      return {
        nodeId: topologyNodeId,
        title: node.title,
        iconKey: node.iconKey,
        x: node.x,
        y: node.y,
        // 不通过坐标或名称推导层级，完全复用已校验燃气配置中的显式归属。
        ...(node.layerId ? { layerId: String(node.layerId) } : {}),
        // 只有上述显式表中存在的六个物理节点才能向 Unity 发送 focusNode（聚焦节点）命令。
        ...(sceneNodeId ? { sceneNodeId } : {}),
        deviceStatus: node.deviceStatus,
        // 本包没有设备标识和外层设备事件契约；单击仍可选中并聚焦已映射三维节点，双击不上报设备事件。
        doubleClickBehavior: 'none',
      }
    }),
    edges: topology.edges.map((edge) => ({
      edgeId: String(edge.edgeId),
      fromNodeId: String(edge.fromNodeId),
      toNodeId: String(edge.toNodeId),
      title: edge.title,
      // 协议和证据仅用于恢复既有二维视觉效果，不生成通信请求或三维路径命令。
      ...(edge.protocolLabel ? { protocolLabel: edge.protocolLabel } : {}),
      ...(edge.evidenceStatus ? { evidenceStatus: edge.evidenceStatus } : {}),
    })),
  }
}

/**
 * 固定九场景闭集由已验证夹具提供，而燃气条目替换为真实现有燃气拓扑。
 * 这既满足运行时的闭集契约，也明确表达另外八个场景仍没有业务内容，不能被本测试包初始化或验收。
 */
async function createGasOnlyManifest(releaseId) {
  const fixturePath = path.join(workspaceRoot, 'tests', 'fixtures', 'scene-topology-contract-valid.json')
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
  const manifestVersion = `gas-power-smoke.${releaseId}`
  const existingGasTopology = await readExistingGasTopology()

  const scenes = fixture.scenes.map((scene) => ({
    ...scene,
    title: scene.sceneId === 'gas-power' ? '燃气发电' : `待交付场景：${scene.sceneId}`,
    // Unity 当前桥接器只接受该已验证映射版本；其余占位场景同样保持契约一致，但不会被测试宿主选择。
    sceneMappingVersion: unitySceneMappingVersion,
    resourceVersion: scene.sceneId === 'gas-power' ? `resource.${unityReleaseId}.gas-power` : `placeholder.${scene.sceneId}`,
    supportedActionIds: [],
  }))

  const topologies = fixture.topologies.map((topology) => (
    topology.sceneId === 'gas-power'
      ? projectGasTopology(existingGasTopology, manifestVersion)
      : {
          ...topology,
          title: `待交付拓扑：${topology.sceneId}`,
          configVersion: manifestVersion,
          nodes: [],
          edges: [],
        }
  ))

  const unitySceneMappings = fixture.unitySceneMappings.map((mapping) => ({
    ...mapping,
    mappingVersion: unitySceneMappingVersion,
    // 只发布经过场景序列化配置核验的六个燃气三维节点；路径和流程步骤仍未作为本包能力发布。
    sceneNodeIds: mapping.sceneId === 'gas-power' ? [...verifiedGasSceneNodeIdByTopologyNodeId.values()] : [],
    processSteps: [],
    routeIds: [],
  }))

  return {
    manifestVersion,
    // 构建标识保留为当前正式 Unity 发布基线，方便定位该测试包究竟使用哪个网页图形产物。
    unityBuildId: unityReleaseId,
    unityRuntimeKey,
    scenes,
    topologies,
    actions: [],
    deviceMappings: [],
    unitySceneMappings,
  }
}

/**
 * 外层宿主页只完成真实三层通信的最小握手：收到 system.ready 后初始化燃气场景与燃气拓扑。
 * 它不直接访问 Unity iframe，也不添加动作、状态或设备消息，确保本包的验收范围严格限定为“显示并启动”。
 */
function createHostPage(manifestVersion) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>燃气发电场景与拓扑联调包</title>
    <style>
      html, body, #visualization-shell { inline-size: 100%; block-size: 100%; margin: 0; overflow: hidden; background: #061323; }
      #visualization-shell { display: block; border: 0; }
      .test-status { position: fixed; z-index: 2; inset-inline-end: 12px; inset-block-end: 12px; max-inline-size: min(30rem, calc(100% - 24px)); padding: 8px 10px; border: 1px solid rgb(103 232 249 / 45%); border-radius: 6px; color: #cffafe; background: rgb(8 47 73 / 88%); font: 12px/1.4 system-ui, sans-serif; pointer-events: none; }
    </style>
  </head>
  <body>
    <!-- 仅承载嵌入壳；真实 Unity iframe 由壳内唯一宿主创建，外层测试页绝不直连 Unity。 -->
    <iframe id="visualization-shell" title="燃气发电场景与拓扑嵌入壳" allow="fullscreen"></iframe>
    <output id="test-status" class="test-status" aria-live="polite">正在建立燃气发电联调链路。</output>
    <script>
      (() => {
        // 协议常量与 Vue 壳严格一致；只保留本次初始化需要的有限状态，避免测试页累积完整消息或业务载荷。
        const channel = 'power-scene-topology-shell';
        const version = 1;
        const instanceId = 'gas-power-smoke-host';
        const shell = document.querySelector('#visualization-shell');
        const status = document.querySelector('#test-status');
        const shellOrigin = window.location.origin;
        let sessionId = '';
        let messageSequence = 0;

        /** 仅用当前会话生成一次受控初始化信封，不接受页面输入或任意场景、拓扑、Unity 方法名。 */
        function initializeGasPower() {
          if (!sessionId) return;
          messageSequence += 1;
          shell.contentWindow?.postMessage({
            channel,
            version,
            instanceId,
            sessionId,
            messageId: 'gas-power-smoke-init-' + messageSequence,
            type: 'system.init',
            timestamp: Date.now(),
            payload: {
              sceneId: 'gas-power',
              topologyId: 'topology.gas-power.overview',
              expectedManifestVersion: '${manifestVersion}',
            },
          }, shellOrigin);
        }

        /** 只接受来自当前嵌入壳、当前来源和当前实例的事件，防止同源旁路页面伪造初始化完成。 */
        window.addEventListener('message', (event) => {
          const message = event.data;
          if (event.origin !== shellOrigin || event.source !== shell.contentWindow) return;
          if (!message || message.channel !== channel || message.version !== version || message.instanceId !== instanceId) return;

          if (message.type === 'system.ready' && typeof message.sessionId === 'string') {
            sessionId = message.sessionId;
            status.textContent = '燃气运行时已就绪，正在加载现有燃气发电场景与拓扑。';
            initializeGasPower();
            return;
          }

          if (message.type === 'view.changed' && message.payload?.sceneId === 'gas-power' && message.payload?.topologyId === 'topology.gas-power.overview') {
            status.textContent = '燃气发电场景与对应拓扑已完成联调初始化。';
            return;
          }

          if (message.type === 'system.ack' && message.payload?.success !== true) {
            status.textContent = '燃气联调初始化未完成，请检查发布日志。';
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
 * 运行服务根据 Unity WebGL 的压缩扩展名返回正确 Content-Encoding（内容编码）和 MIME（媒体类型）。
 * 这避免普通静态服务器把 .br 文件当成未压缩脚本，导致浏览器报“无法解析 framework.js.br”。
 */
function createStaticServer() {
  return `import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 联调服务仅提供当前发布目录内的只读静态资源，并为 Unity 的 Brotli 压缩文件补齐响应头。 */
const releaseRoot = path.dirname(fileURLToPath(import.meta.url))
const host = '${host}'
const port = ${port}
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

/** 解析请求时禁止越出发布根目录；目录请求固定回退到自身 index.html。 */
function resolveRequestPath(requestUrl) {
  const requestPath = new URL(requestUrl ?? '/', 'http://localhost').pathname
  const decodedPath = decodeURIComponent(requestPath)
  // Vite 的嵌入壳使用网页历史路由；/shell/embed 不是物理文件，必须回退到同一前端入口再由路由器解析。
  if (decodedPath === '/shell/embed') return path.join(releaseRoot, 'shell', 'index.html')
  const normalizedPath = decodedPath === '/' ? '/index.html' : decodedPath.endsWith('/') ? decodedPath + 'index.html' : decodedPath
  const candidate = path.resolve(releaseRoot, '.' + normalizedPath)
  return candidate.startsWith(releaseRoot + path.sep) || candidate === releaseRoot ? candidate : undefined
}

/** 按压缩后文件名反推原始资源扩展名，确保 .wasm.br、.js.br 等均拥有正确媒体类型。 */
function readContentType(filePath) {
  const withoutCompression = filePath.endsWith('.br') ? filePath.slice(0, -3) : filePath
  return mimeByExtension.get(path.extname(withoutCompression).toLowerCase()) ?? 'application/octet-stream'
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' })
    response.end('联调服务仅支持只读请求。')
    return
  }

  let filePath
  try {
    filePath = resolveRequestPath(request.url)
  } catch {
    filePath = undefined
  }
  if (!filePath) {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('请求路径无效。')
    return
  }

  try {
    const fileInfo = await stat(filePath)
    if (!fileInfo.isFile()) throw new Error('not-file')
    const headers = {
      'cache-control': 'no-store',
      'content-type': readContentType(filePath),
      // Unity WebGL 与跨窗口通信均只使用本包同源资源，隔离头可使浏览器提供共享内存等能力。
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-resource-policy': 'same-origin',
    }
    if (filePath.endsWith('.br')) headers['content-encoding'] = 'br'
    response.writeHead(200, headers)
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    response.end(await readFile(filePath))
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('未找到发布资源。')
  }
})

server.listen(port, host, () => {
  console.log('燃气联调包已启动：${hostOrigin}/')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
`
}

/** 发布说明与构建数据随包保存，便于后续任务将此最小闭环替换为正式九场景映射。 */
function createReadme(releaseId, gasNodeCount, gasEdgeCount) {
  return `# 燃气发电场景与拓扑联调包

发布标识：${releaseId}

## 启动

在本目录执行：

\`node server.mjs\`

然后打开：${hostOrigin}/

## 本包范围

- Unity 基线：${unityReleaseId} 的正式网页图形构建。
- 初始化目标：\`gas-power\`（燃气发电）。
- 拓扑来源：当前前端 \`gas-overview\` 已校验配置，包含 ${gasNodeCount} 个节点、${gasEdgeCount} 条连线。
- 其余八个场景仅为固定目录的空占位，不会被本宿主页初始化。

## 明确不包含

- 未提供的正式设备标识、三维节点、流程动作、路径及实时状态映射。
- 对其余八个业务场景的内容或验收结论。
`
}

/**
 * 从新目录开始构建，并在最终 rename（重命名）前完成所有校验和拷贝。
 * 任一步失败会保留 .staging（暂存）目录供排障，绝不覆盖先前成功发布的同名目录。
 */
async function main() {
  const releaseConfiguration = readReleaseConfiguration(process.argv.slice(2))
  const releaseId = releaseConfiguration.releaseId
  unityReleaseId = releaseConfiguration.unityReleaseId
  const unitySourceDirectory = path.join(releasesRoot, unityReleaseId, 'unity')
  const finalDirectory = path.join(releasesRoot, releaseId)
  const stagingDirectory = path.join(releasesRoot, '.staging', releaseId)
  const manifestArtifactDirectory = path.join(workspaceRoot, 'artifacts', 'gas-power-smoke', releaseId)
  const manifestPath = path.join(manifestArtifactDirectory, 'scene-topology-manifest.json')
  const reportPath = path.join(manifestArtifactDirectory, 'scene-topology-contract-report.json')

  await ensureReadable(unitySourceDirectory, `未找到 Unity 正式基线：${unitySourceDirectory}`)
  await ensureAbsent(finalDirectory, `目标发布目录已存在，已停止以保护原包：${finalDirectory}`)
  await ensureAbsent(stagingDirectory, `暂存目录已存在，已停止以保留上次失败证据：${stagingDirectory}`)
  await mkdir(manifestArtifactDirectory, { recursive: true })

  const manifest = await createGasOnlyManifest(releaseId)
  const gasTopology = manifest.topologies.find((topology) => topology.sceneId === 'gas-power')
  if (!gasTopology) throw new Error('未生成燃气拓扑，已停止打包。')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  // 先复用生产校验器验证最终生成的清单，再执行类型检查和前端构建；三道门禁任一失败都不会创建成品目录。
  execute(process.execPath, ['./scripts/validate-scene-topology-manifest.mjs', '--manifest', path.relative(workspaceRoot, manifestPath), '--report', path.relative(workspaceRoot, reportPath)])
  execute(process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd run typecheck'] : ['run', 'typecheck'])

  await mkdir(stagingDirectory, { recursive: true })
  const shellDirectory = path.join(stagingDirectory, 'shell')
  const buildEnvironment = {
    ...process.env,
    // 三层均使用同一联调来源，确保外层桥、嵌入壳和 Unity iframe 的精确来源校验真实生效。
    VITE_POWER_PARENT_ORIGIN: hostOrigin,
    VITE_POWER_UNITY_PARENT_ORIGIN: hostOrigin,
    VITE_POWER_UNITY_ENTRY_URL: `${hostOrigin}/unity/index.html`,
    VITE_POWER_MANIFEST_URL: `${hostOrigin}/scene-topology-manifest.json`,
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
  await cp(manifestPath, path.join(stagingDirectory, 'scene-topology-manifest.json'), { force: false, errorOnExist: true })
  await writeFile(path.join(stagingDirectory, 'index.html'), createHostPage(manifest.manifestVersion), 'utf8')
  await writeFile(path.join(stagingDirectory, 'server.mjs'), createStaticServer(), 'utf8')
  await writeFile(path.join(stagingDirectory, 'README.md'), createReadme(releaseId, gasTopology.nodes.length, gasTopology.edges.length), 'utf8')
  await writeFile(path.join(stagingDirectory, 'release-manifest.json'), `${JSON.stringify({
    releaseId,
    scope: 'gas-power-and-existing-topology-only',
    unityReleaseId,
    unityRuntimeKey,
    manifestVersion: manifest.manifestVersion,
    gasTopology: { nodeCount: gasTopology.nodes.length, edgeCount: gasTopology.edges.length },
    excludedCapabilities: ['device-mapping', 'scene-node-mapping', 'workflow-actions', 'device-states', 'other-eight-scene-content'],
  }, null, 2)}\n`, 'utf8')

  // rename 在同一卷内为原子移动；成功后用户只会看到完整目录，不会看到半复制的正式发布包。
  await rename(stagingDirectory, finalDirectory)
  process.stdout.write(`${JSON.stringify({
    status: 'ready',
    releaseId,
    releaseDirectory: finalDirectory,
    url: `${hostOrigin}/`,
    gasTopologyNodes: gasTopology.nodes.length,
    gasTopologyEdges: gasTopology.edges.length,
  }, null, 2)}\n`)
}

main().catch(async (error) => {
  // 本脚本不自动清理失败目录：保留非破坏性证据可帮助定位构建、压缩资源或发布复制问题。
  process.stderr.write(`${error instanceof Error ? error.message : '燃气联调包构建失败。'}\n`)
  process.exitCode = 1
})

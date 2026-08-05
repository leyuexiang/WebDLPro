import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * 任务-014测试专用的外层宿主与清单服务。
 * 它固定运行于 127.0.0.1:5510，仅提供测试宿主页和合成九场景清单；清单不包含 Unity 文件路径、
 * 正式设备资料或生产地址，绝不能作为任务-039—047的发布内容。
 */
const host = '127.0.0.1'
const port = 5510
const hostPagePath = fileURLToPath(new URL('./host/index.html', import.meta.url))
const visualBaselinePagePath = fileURLToPath(new URL('../visual-regression/host/index.html', import.meta.url))

/**
 * 构造完整闭集测试清单，使嵌入壳可以走真实远端加载、校验、注册和 `system.init` 事务。
 * 仅燃气拓扑设置一枚可双击测试节点；其余八个场景为空拓扑，明确表达夹具没有伪造业务设备内容。
 */
function createTestManifest() {
  const sceneIds = ['coal-power', 'gas-power', 'wind-power', 'solar-power', 'substation', 'distribution', 'consumption', 'microgrid', 'dispatch']
  const manifestVersion = 'local-shell-regression.1'
  const gasResetActionId = 'action.gas.reset'
  const windResetActionId = 'action.wind.reset'
  const scenes = sceneIds.map((sceneId) => ({
    sceneId,
    title: `测试场景-${sceneId}`,
    unitySceneKey: `scene.${sceneId}`,
    defaultTopologyId: `topology.${sceneId}.overview`,
    topologyIds: [`topology.${sceneId}.overview`],
    // 仅燃气声明一条可重复执行的本地回归动作，用于验证同场景流程触发不会改走场景切换路径。
    supportedActionIds: sceneId === 'gas-power'
      ? [gasResetActionId]
      : sceneId === 'wind-power'
        ? [windResetActionId]
        : [],
    // 当前 Unity 模拟页由既有燃气运行时登记启动，其握手只接受该受控映射版本；这不是正式九场景映射声明。
    sceneMappingVersion: '2026.08.01-local.2',
    resourceVersion: `resource.${sceneId}.1`,
    switchStrategy: 'unload-first',
  }))

  return {
    manifestVersion,
    unityBuildId: 'local-mock-build.1',
    unityRuntimeKey: 'local-mock-runtime',
    scenes,
    topologies: scenes.map((scene) => ({
      topologyId: scene.defaultTopologyId,
      sceneId: scene.sceneId,
      title: `测试拓扑-${scene.sceneId}`,
      configVersion: manifestVersion,
      nodes: scene.sceneId === 'gas-power'
        ? [{
            nodeId: 'node.gas-turbine',
            title: '测试燃气轮机',
            deviceId: 'device.gas-turbine',
            sceneNodeId: 'scene-node.gas-turbine',
            iconKey: 'generic-device',
            x: 50,
            y: 50,
            deviceStatus: 'normal',
            doubleClickBehavior: 'emit-device',
          }]
        : [],
      edges: [],
    })),
    actions: [
      {
        actionId: gasResetActionId,
        title: '测试燃气场景重置',
        targetSceneId: 'gas-power',
        targetTopologyId: 'topology.gas-power.overview',
        allowedParameters: [],
        unityAction: { type: 'resetScene' },
        failurePolicy: 'keep-current-context',
        configVersion: manifestVersion,
      },
      {
        actionId: windResetActionId,
        title: '测试风电场景重置',
        targetSceneId: 'wind-power',
        targetTopologyId: 'topology.wind-power.overview',
        allowedParameters: [],
        unityAction: { type: 'resetScene' },
        failurePolicy: 'keep-current-context',
        configVersion: manifestVersion,
      },
    ],
    deviceMappings: [{
      deviceId: 'device.gas-turbine',
      sceneId: 'gas-power',
      topologyNodeRefs: [{ topologyId: 'topology.gas-power.overview', nodeId: 'node.gas-turbine' }],
      sceneNodeId: 'scene-node.gas-turbine',
      configVersion: manifestVersion,
    }],
    unitySceneMappings: scenes.map((scene) => ({
      sceneId: scene.sceneId,
      mappingVersion: scene.sceneMappingVersion,
      processSteps: [],
      sceneNodeIds: scene.sceneId === 'gas-power' ? ['scene-node.gas-turbine'] : [],
      routeIds: [],
    })),
  }
}

/** 所有测试响应统一附加最小 CORS 头，允许 Vite 开发服务器读取测试清单，但不开放任何写接口。 */
function writeResponse(response, statusCode, contentType, body) {
  response.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-type': contentType,
  })
  response.end(body)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`)
  if (request.method !== 'GET') {
    writeResponse(response, 405, 'text/plain; charset=utf-8', '测试服务仅支持只读请求。')
    return
  }

  if (url.pathname === '/manifest.json') {
    writeResponse(response, 200, 'application/json; charset=utf-8', JSON.stringify(createTestManifest()))
    return
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    try {
      writeResponse(response, 200, 'text/html; charset=utf-8', await readFile(hostPagePath, 'utf8'))
    } catch {
      writeResponse(response, 500, 'text/plain; charset=utf-8', '测试宿主页读取失败。')
    }
    return
  }

  /**
   * 任务-050的视觉基准页复用同一份合成清单和嵌入壳，却移除外层控制栏与时间戳日志。
   * 它只读地呈现初始化后的双容器，既不会向 Unity 直发消息，也不会把合成资料当作生产发布内容。
   */
  if (url.pathname === '/visual-baseline.html') {
    try {
      writeResponse(response, 200, 'text/html; charset=utf-8', await readFile(visualBaselinePagePath, 'utf8'))
    } catch {
      writeResponse(response, 500, 'text/plain; charset=utf-8', '视觉基准宿主页读取失败。')
    }
    return
  }

  writeResponse(response, 404, 'text/plain; charset=utf-8', '未找到测试资源。')
})

server.listen(port, host, () => {
  console.log(`任务-014测试宿主已启动：http://${host}:${port}`)
})

/** 进程被终止时关闭监听端口，避免下一轮测试误连到旧宿主。 */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}

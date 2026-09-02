import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * 任务-014测试专用的外层宿主与清单服务。
 * 它固定运行于 127.0.0.1:5510，仅提供测试宿主页和合成九场景清单；清单不包含 Unity 文件路径、
 * 正式设备资料或生产地址，绝不能作为任务-039—047的发布内容。
 */
const host = '127.0.0.1'
// 默认端口保持既有浏览器夹具契约；命令行合同测试可注入临时端口，避免抢占用户正在使用的5510。
const port = Number.parseInt(process.env.LOCAL_SHELL_PORT ?? '5510', 10)
const hostPagePath = fileURLToPath(new URL('./host/index.html', import.meta.url))
const retryControllerPath = fileURLToPath(new URL('./host/device-state-retry-controller.js', import.meta.url))
const visualBaselinePagePath = fileURLToPath(new URL('../visual-regression/host/index.html', import.meta.url))

/**
 * 构造完整闭集测试清单，使嵌入壳可以走真实远端加载、校验、注册和 `system.init` 事务。
 * 仅燃气拓扑设置两枚可双击测试节点；其余八个场景为空拓扑，明确表达夹具没有伪造业务设备内容。
 * 两枚节点服务于“完整快照缺失已绑定设备”的回归，避免为了测试清除语义而构造正式协议禁止的空状态数组。
 */
function createTestManifest() {
  const sceneIds = ['coal-power', 'gas-power', 'wind-power', 'solar-power', 'substation', 'distribution', 'consumption', 'microgrid', 'dispatch']
  const manifestVersion = 'local-shell-regression.1'
  const gasResetActionId = 'action.gas.reset'
  const windResetActionId = 'action.wind.reset'
  const scenes = sceneIds.map((sceneId) => {
    const topologyIds = [`topology.${sceneId}.overview`]
    // 燃气明细图仅验证“同场景动作成功后才切换另一张映射拓扑”，不携带或推断正式业务设备资料。
    if (sceneId === 'gas-power') topologyIds.push('topology.gas-power.detail')

    return {
      sceneId,
      title: `测试场景-${sceneId}`,
      unitySceneKey: `scene.${sceneId}`,
      defaultTopologyId: topologyIds[0],
      topologyIds,
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
    }
  })

  return {
    manifestVersion,
    unityBuildId: 'local-mock-build.1',
    unityRuntimeKey: 'local-mock-runtime',
    scenes,
    topologies: scenes.flatMap((scene) => scene.topologyIds.map((topologyId) => ({
      topologyId,
      sceneId: scene.sceneId,
      title: `测试拓扑-${topologyId}`,
      configVersion: manifestVersion,
      // 设备测试节点只保留在燃气总览；明细图保持空白，避免把夹具当作正式设备映射。
      // 两条映射分别具有不同二维和三维标识，确保后续完整快照省略其中一项时可验证独立二维恢复与三维清除。
      nodes: topologyId === 'topology.gas-power.overview'
        ? [
            {
              nodeId: 'node.gas-turbine',
              title: '测试燃气轮机',
              sceneNodeId: 'scene-node.gas-turbine',
              iconKey: 'generic-device',
              x: 40,
              y: 50,
              deviceStatus: 'normal',
              doubleClickBehavior: 'emit-node',
            },
            {
              nodeId: 'node.gas-generator',
              title: '测试燃气发电机',
              sceneNodeId: 'scene-node.gas-generator',
              iconKey: 'generic-device',
              x: 60,
              y: 50,
              deviceStatus: 'normal',
              doubleClickBehavior: 'emit-node',
            },
          ]
        : [],
      edges: [],
    }))),
    actions: [
      {
        actionId: gasResetActionId,
        title: '测试燃气场景重置',
        targetSceneId: 'gas-power',
        // 夹具仍只验证第二层业务动作；显式视图模式避免旧清单格式被第二版校验器静默接受。
        targetViewMode: 'business',
        targetTopologyId: 'topology.gas-power.detail',
        allowedParameters: [],
        unityAction: { type: 'resetScene' },
        failurePolicy: 'keep-current-context',
        configVersion: manifestVersion,
      },
      {
        actionId: windResetActionId,
        title: '测试风电场景重置',
        targetSceneId: 'wind-power',
        // 风电同样保持业务拓扑视图，不创建与本轮无关的关键环节占位资源。
        targetViewMode: 'business',
        targetTopologyId: 'topology.wind-power.overview',
        allowedParameters: [],
        unityAction: { type: 'resetScene' },
        failurePolicy: 'keep-current-context',
        configVersion: manifestVersion,
      },
    ],
    unitySceneMappings: scenes.map((scene) => ({
      sceneId: scene.sceneId,
      mappingVersion: scene.sceneMappingVersion,
      processSteps: [],
      // 三维节点清单与上方二维节点一一对应，保证壳从二维引用派生三维目标的真实路径能够通过校验。
      sceneNodeIds: scene.sceneId === 'gas-power' ? ['scene-node.gas-turbine', 'scene-node.gas-generator'] : [],
      routeIds: [],
    })),
  }
}

/**
 * 构造与默认资源内容等价的结构清单副本，用于验证同一结构在不同只读地址下仍能稳定加载。
 * 平台设备编号关系属于平台私有数据，因此该副本只复制我方结构字段，不注入任何绑定事实。
 */
function createStructureManifestCopy() {
  const manifest = createTestManifest()
  return {
    ...manifest,
    topologies: manifest.topologies.map((topology) => ({ ...topology })),
  }
}

/**
 * 测试服务响应统一附加最小 CORS 头，允许嵌入壳读取合成清单，但不开放任何写接口。
 * 默认响应使用 no-store（不存储）；清单接口单独传入 no-cache（禁止缓存），模拟正式结构清单的
 * 版本重载契约，避免本地夹具因缓存策略过宽而掩盖生产部署问题。
 */
function writeResponse(response, statusCode, contentType, body, additionalHeaders = {}) {
  response.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-type': contentType,
    ...additionalHeaders,
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
    writeResponse(
      response,
      200,
      'application/json; charset=utf-8',
      JSON.stringify(createTestManifest()),
      // 与生产清单接口一致：每次壳重载都必须重新验证当前完整绑定响应。
      { 'cache-control': 'no-cache, max-age=0, must-revalidate' },
    )
    return
  }

  if (url.pathname === '/manifest-empty.json') {
    writeResponse(
      response,
      200,
      'application/json; charset=utf-8',
      JSON.stringify(createStructureManifestCopy()),
      { 'cache-control': 'no-cache, max-age=0, must-revalidate' },
    )
    return
  }

  // 这两个路径只用于复现合作方约定的稳定404，不读取或显示任何服务器文件路径。
  if (url.pathname === '/missing-package/manifest.json') {
    writeResponse(response, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'package not found' }))
    return
  }
  if (url.pathname === '/missing-file/manifest.json') {
    writeResponse(response, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'manifest file missing' }))
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

  // 状态重试控制器只属于任务-014测试宿主页；显式限制为单一文件，避免夹具变成任意文件服务器。
  if (url.pathname === '/device-state-retry-controller.js') {
    try {
      writeResponse(response, 200, 'application/javascript; charset=utf-8', await readFile(retryControllerPath, 'utf8'))
    } catch {
      writeResponse(response, 500, 'text/plain; charset=utf-8', '状态重试测试控制器读取失败。')
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

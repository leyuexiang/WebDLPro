import { chromium } from 'file:///C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'

/**
 * 燃煤发布包三层浏览器回归。
 *
 * 测试仅使用平台公开协议、正式场景拓扑清单和真实画布点击，验证二维拓扑、Unity 场景、
 * 节点聚焦与流程动作的完整链路。脚本不会读取 Unity 模型名称或层级，也不会直接调用
 * Unity 方法；旁路监听只记录页面本来就会发送的有限协议消息，用于断言交互结果。
 */
const baseUrl = process.env.COAL_RELEASE_URL ?? 'http://127.0.0.1:5523/'
const screenshotPath = process.env.COAL_SCREENSHOT_PATH
const executablePath = 'D:/PlaywrightBrowsers/chromium-1187/chrome-win/chrome.exe'
const instanceId = 'coal-power-platform-host'
const overviewTopologyId = 'topology.coal-power.overview'
const overviewTitle = '燃煤火力发电厂 OT 网络拓扑'
const workflowCases = Object.freeze([
  Object.freeze({ actionId: 'action.coal-power.combustion', topologyId: 'topology.coal-power.combustion', title: '燃烧系统', nodeCount: 11, edgeCount: 10 }),
  Object.freeze({ actionId: 'action.coal-power.water-steam-cycle', topologyId: 'topology.coal-power.water-steam-cycle', title: '汽水循环系统', nodeCount: 9, edgeCount: 8 }),
  Object.freeze({ actionId: 'action.coal-power.power-output', topologyId: 'topology.coal-power.power-output', title: '发电输出', nodeCount: 11, edgeCount: 10 }),
])

const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const consoleErrors = []
const httpErrors = []

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(error.message))
page.on('response', (response) => {
  if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() })
})

/**
 * 在根入口脚本执行前安装只读观察器，避免漏掉 system.ready（系统就绪）事件。
 * 观察器只保留当前固定实例的外层协议消息，不保存其他窗口或任意页面消息。
 */
await page.addInitScript(({ expectedInstanceId }) => {
  window.__coalObservedHostEvents = []
  window.addEventListener('message', (event) => {
    const message = event.data
    if (message?.channel !== 'power-scene-topology-shell' || message?.instanceId !== expectedInstanceId) return
    window.__coalObservedHostEvents.push(JSON.parse(JSON.stringify(message)))
  })
}, { expectedInstanceId: instanceId })

/** 返回最新稳定视图，发送下一条命令时据此携带并发控制版本。 */
async function readLatestViewChanged() {
  return page.evaluate(() => {
    const events = window.__coalObservedHostEvents ?? []
    return events.filter((event) => event.type === 'view.changed').at(-1) ?? null
  })
}

/**
 * 通过根入口持有的真实壳窗口发送一条受控平台命令。
 * 会话标识只取当前 system.ready 信封，场景、拓扑和动作均由调用点固定声明。
 */
async function sendHostCommand(type, payload, messageSuffix) {
  const messageId = `coal-power-browser-${messageSuffix}-${Date.now()}`
  await page.evaluate(({ expectedInstanceId, commandType, commandPayload, commandMessageId }) => {
    const events = window.__coalObservedHostEvents ?? []
    const ready = events.find((event) => event.type === 'system.ready')
    const shell = document.querySelector('#visualization-shell')
    if (!ready?.sessionId || !shell?.contentWindow) throw new Error('燃煤嵌入壳尚未建立可用会话。')

    shell.contentWindow.postMessage({
      channel: 'power-scene-topology-shell',
      version: 1,
      instanceId: expectedInstanceId,
      sessionId: ready.sessionId,
      messageId: commandMessageId,
      type: commandType,
      timestamp: Date.now(),
      payload: commandPayload,
    }, window.location.origin)
  }, {
    expectedInstanceId: instanceId,
    commandType: type,
    commandPayload: payload,
    commandMessageId: messageId,
  })
  return messageId
}

/** 等待命令对应的新稳定视图；同时拒绝只有失败回执、没有视图提交的伪成功。 */
async function waitForViewChanged(messageId, sceneId, topologyId, actionId, timeout = 90_000) {
  await page.waitForFunction(({ replyTo, expectedSceneId, expectedTopologyId, expectedActionId }) => {
    const events = window.__coalObservedHostEvents ?? []
    return events.some((event) => event.type === 'view.changed' &&
      event.replyTo === replyTo &&
      event.payload?.sceneId === expectedSceneId &&
      event.payload?.topologyId === expectedTopologyId &&
      event.payload?.actionId === expectedActionId)
  }, {
    replyTo: messageId,
    expectedSceneId: sceneId,
    expectedTopologyId: topologyId,
    expectedActionId: actionId,
  }, { timeout })
}

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })

  const manifestResponse = await page.request.get(new URL('scene-topology-manifest.json', baseUrl).toString())
  if (!manifestResponse.ok()) throw new Error(`燃煤发布清单请求失败：${manifestResponse.status()}。`)
  const manifest = await manifestResponse.json()
  const overview = manifest.topologies.find((topology) => topology.topologyId === overviewTopologyId)
  if (!overview || overview.filter !== undefined || overview.nodes?.length !== 27 || overview.edges?.length !== 27) {
    throw new Error('燃煤来源总图不是未过滤的 27 节点、27 连线定义。')
  }
  if (manifest.unityRuntimeKey !== 'coal-plant-release') {
    throw new Error(`燃煤清单仍使用错误运行时键：${manifest.unityRuntimeKey ?? 'missing'}。`)
  }

  await page.waitForFunction(({ expectedTopologyId }) => {
    const events = window.__coalObservedHostEvents ?? []
    return events.some((event) => event.type === 'view.changed' &&
      event.payload?.sceneId === 'coal-power' &&
      event.payload?.topologyId === expectedTopologyId)
  }, { expectedTopologyId: overviewTopologyId }, { timeout: 120_000 })

  const shellFrame = page.locator('#visualization-shell').contentFrame()
  await shellFrame.getByRole('heading', { name: overviewTitle, exact: true }).waitFor({ timeout: 20_000 })
  await shellFrame.getByText(/当前拓扑已配置 27 个节点、27 条连线/).waitFor({ timeout: 20_000 })

  const unityFrameCount = await shellFrame.locator('iframe').count()
  const topologyCanvasCount = await shellFrame.locator('canvas').count()
  if (unityFrameCount !== 1 || topologyCanvasCount !== 1) {
    throw new Error(`初始化实例数量异常：Unity=${unityFrameCount}，拓扑画布=${topologyCanvasCount}。`)
  }

  const unityFrame = shellFrame.locator('iframe').contentFrame()
  await unityFrame.locator('html').waitFor({ timeout: 20_000 })
  await unityFrame.locator('html').waitFor({ state: 'visible', timeout: 20_000 })
  const unityMetadata = await unityFrame.locator('html').evaluate(() => ({
    startupStage: window.__power3dStartupStage,
    runtimeKey: new URLSearchParams(window.location.search).get('runtimeKey'),
    buildId: new URLSearchParams(window.location.search).get('buildId'),
    sceneMappingVersion: new URLSearchParams(window.location.search).get('sceneMappingVersion'),
  }))
  if (unityMetadata.startupStage !== 'instance-ready' || unityMetadata.runtimeKey !== 'coal-plant-release') {
    throw new Error(`Unity 启动或运行时元数据异常：${JSON.stringify(unityMetadata)}。`)
  }

  // 旁路观察二维点击产生的公开 Unity 命令，只验证类型与三维稳定标识，不读取模型对象。
  await unityFrame.locator('html').evaluate(() => {
    window.__coalObservedUnityCommands = []
    window.addEventListener('message', (event) => {
      const message = event.data
      if (message?.channel !== 'power3d-unity' || !['focusNode', 'clearSelection'].includes(message.type)) return
      window.__coalObservedUnityCommands.push(JSON.parse(JSON.stringify(message)))
    })
  })

  const focusNode = overview.nodes.find((node) => node.nodeId === 'system.boiler-dcs')
  if (focusNode?.sceneNodeId !== 'node.coal-boiler') throw new Error('锅炉 DCS 节点缺少已确认的三维映射。')
  const topologyCanvas = shellFrame.locator('canvas')
  const canvasSize = await topologyCanvas.evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect()
    return { width: bounds.width, height: bounds.height }
  })
  const layerLabelGutter = Math.min(124, Math.max(88, Math.round(canvasSize.width * 0.13)))
  const rightPadding = Math.max(14, Math.round(canvasSize.width * 0.02))
  const contentWidth = Math.max(1, canvasSize.width - layerLabelGutter - rightPadding)
  const focusPosition = {
    x: layerLabelGutter + (focusNode.x / 100) * contentWidth,
    y: (focusNode.y / 100) * canvasSize.height,
  }

  await topologyCanvas.click({ position: focusPosition })
  await unityFrame.locator('html').waitFor({ timeout: 5_000 })
  await page.waitForFunction(() => {
    const unityWindow = document.querySelector('#visualization-shell')?.contentWindow
    return Boolean(unityWindow)
  })
  const waitForUnityCommand = async (type, expectedSceneNodeId) => {
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      const commands = await unityFrame.locator('html').evaluate(() => window.__coalObservedUnityCommands ?? [])
      const matched = commands.find((command) => command.type === type &&
        (expectedSceneNodeId === undefined || command.payload?.sceneNodeId === expectedSceneNodeId))
      if (matched) return commands
      await page.waitForTimeout(50)
    }
    throw new Error(`二维画布没有下发预期 Unity 命令：${type}。`)
  }
  let unityCommands = await waitForUnityCommand('focusNode', 'node.coal-boiler')
  if (unityCommands.filter((command) => command.type === 'focusNode').length !== 1) {
    throw new Error('锅炉节点单击没有生成唯一三维聚焦命令。')
  }

  // 画布右侧中部没有节点；空白点击必须只清除交互描边，不能重载场景或重建实例。
  await topologyCanvas.click({ position: { x: canvasSize.width - 4, y: canvasSize.height / 2 } })
  unityCommands = await waitForUnityCommand('clearSelection')
  if (unityCommands.filter((command) => command.type === 'clearSelection').length !== 1) {
    throw new Error('拓扑空白点击没有生成唯一清除选择命令。')
  }

  await page.evaluate(() => { window.__coalObservedHostEvents = (window.__coalObservedHostEvents ?? []).filter((event) => event.type !== 'topology.node.dblclick') })
  await topologyCanvas.dblclick({ position: focusPosition })
  await page.waitForFunction(({ nodeId }) => {
    const events = window.__coalObservedHostEvents ?? []
    return events.filter((event) => event.type === 'topology.node.dblclick' && event.payload?.nodeId === nodeId).length === 1
  }, { nodeId: focusNode.nodeId }, { timeout: 8_000 })

  for (const workflow of workflowCases) {
    const currentView = await readLatestViewChanged()
    const messageId = await sendHostCommand('workflow.trigger', {
      actionId: workflow.actionId,
      expectedContextRevision: currentView.payload.contextRevision,
    }, workflow.actionId.split('.').at(-1))
    await waitForViewChanged(messageId, 'coal-power', workflow.topologyId, workflow.actionId)
    await shellFrame.getByRole('heading', { name: workflow.title, exact: true }).waitFor({ timeout: 20_000 })
    await shellFrame.getByText(new RegExp(`当前拓扑已配置 ${workflow.nodeCount} 个节点、${workflow.edgeCount} 条连线`)).waitFor({ timeout: 20_000 })
    if (await shellFrame.locator('iframe').count() !== unityFrameCount || await shellFrame.locator('canvas').count() !== topologyCanvasCount) {
      throw new Error(`${workflow.topologyId} 切换后出现重复 Unity 或拓扑实例。`)
    }
  }

  // 用正式 view.open（打开视图）协议跨场景往返，验证切换模型成功且始终复用同一个 Unity iframe。
  let currentView = await readLatestViewChanged()
  let messageId = await sendHostCommand('view.open', {
    sceneId: 'gas-power',
    topologyId: 'topology.gas-power.overview',
    expectedContextRevision: currentView.payload.contextRevision,
  }, 'open-gas')
  await waitForViewChanged(messageId, 'gas-power', 'topology.gas-power.overview', null, 120_000)
  if (await shellFrame.locator('iframe').count() !== unityFrameCount) throw new Error('切换燃气场景时创建了第二个 Unity 实例。')

  currentView = await readLatestViewChanged()
  messageId = await sendHostCommand('view.open', {
    sceneId: 'coal-power',
    topologyId: overviewTopologyId,
    expectedContextRevision: currentView.payload.contextRevision,
  }, 'return-coal')
  await waitForViewChanged(messageId, 'coal-power', overviewTopologyId, null, 120_000)
  await shellFrame.getByRole('heading', { name: overviewTitle, exact: true }).waitFor({ timeout: 20_000 })
  await shellFrame.getByText(/当前拓扑已配置 27 个节点、27 条连线/).waitFor({ timeout: 20_000 })
  if (await shellFrame.locator('iframe').count() !== unityFrameCount || await shellFrame.locator('canvas').count() !== topologyCanvasCount) {
    throw new Error('燃气回切燃煤后出现重复运行时实例。')
  }

  if (httpErrors.length > 0) throw new Error(`发现业务资源请求失败：${JSON.stringify(httpErrors)}。`)
  if (consoleErrors.length > 0) throw new Error(`浏览器控制台存在错误：${JSON.stringify(consoleErrors)}。`)

  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true })
  const doubleClickEvents = await page.evaluate(() => (
    window.__coalObservedHostEvents ?? []
  ).filter((event) => event.type === 'topology.node.dblclick'))
  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    baseUrl,
    runtimeKey: unityMetadata.runtimeKey,
    unityStartupStage: unityMetadata.startupStage,
    overviewNodeCount: overview.nodes.length,
    overviewEdgeCount: overview.edges.length,
    workflowCount: workflowCases.length,
    workflowTopologyCounts: workflowCases.map(({ topologyId, nodeCount, edgeCount }) => ({ topologyId, nodeCount, edgeCount })),
    focusedNodeId: focusNode.nodeId,
    focusedSceneNodeId: focusNode.sceneNodeId,
    clearSelectionCommandCount: 1,
    nodeDoubleClickEventCount: doubleClickEvents.length,
    crossSceneRoundTrip: ['coal-power', 'gas-power', 'coal-power'],
    unityFrameCount,
    topologyCanvasCount,
    consoleErrors,
    httpErrors,
    screenshotPath: screenshotPath ?? null,
  }, null, 2)}\n`)
} catch (error) {
  const diagnostics = {
    frameUrls: page.frames().map((frame) => frame.url()),
    latestView: await readLatestViewChanged().catch(() => null),
    hostEvents: await page.evaluate(() => (window.__coalObservedHostEvents ?? []).slice(-12)).catch(() => []),
    consoleErrors,
    httpErrors,
  }
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  throw new Error(`${error instanceof Error ? error.message : '燃煤浏览器回归失败。'}\n${JSON.stringify(diagnostics)}`)
} finally {
  await browser.close()
}

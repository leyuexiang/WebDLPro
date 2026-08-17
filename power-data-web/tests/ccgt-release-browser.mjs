import { chromium } from 'file:///C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { spawn } from 'node:child_process'

/**
 * 燃气联合循环测试包的最小三层浏览器回归。
 *
 * 此脚本只使用内部自测页和真实拓扑画布的公开交互，验证总图初始化、节点单击/双击/空白清除、
 * 三个同场景动作的视图提交，以及嵌入壳内 Unity iframe（内嵌框架）始终只有一个；
 * 它不向 Unity 直接注入命令，也不依赖模型名称、内部层级路径或非公开调试接口。测试监听器只观察
 * 两层页面原本就会发送的结构化消息，用于断言节点协议字段，不能更改或代发业务消息。
 */
const baseUrl = process.env.CCGT_RELEASE_URL ?? 'http://127.0.0.1:5524/'
const screenshotPath = process.env.CCGT_SCREENSHOT_PATH
const releaseDirectory = process.env.CCGT_RELEASE_DIRECTORY
const executablePath = 'D:/PlaywrightBrowsers/chromium-1187/chrome-win/chrome.exe'
const actionCases = Object.freeze([
  Object.freeze({ buttonName: '燃气轮机关键环节', topologyId: 'topology.gas-power.gas-turbine', nodeCount: 16, edgeCount: 13 }),
  Object.freeze({ buttonName: '余热锅炉关键环节', topologyId: 'topology.gas-power.hrsg', nodeCount: 13, edgeCount: 6 }),
  Object.freeze({ buttonName: '蒸汽轮机关键环节', topologyId: 'topology.gas-power.steam-turbine', nodeCount: 15, edgeCount: 10 }),
])
const overviewActionId = 'action.gas-power.overview'
const overviewTitle = '燃气联合循环（CCGT）发电厂 OT 网络拓扑'

/**
 * 浏览器回归可临时托管指定的不可变发布目录，退出时仅停止本次创建的子进程。
 * 不覆盖、不清理发布文件，也不依赖人工常驻的开发服务器，保证测试结果可重复。
 */
const releaseServer = releaseDirectory
  ? spawn(process.execPath, ['server.mjs'], { cwd: releaseDirectory, stdio: 'pipe', windowsHide: true })
  : undefined

if (releaseServer) {
  const serverReady = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('联调静态服务在十秒内未启动。')), 10_000)
    releaseServer.stdout.on('data', (chunk) => {
      if (chunk.toString('utf8').includes('已启动')) {
        clearTimeout(timeout)
        resolve(undefined)
      }
    })
    releaseServer.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    releaseServer.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`联调静态服务提前退出，退出码：${code ?? 'unknown'}。`))
    })
  })
  await serverReady
}

const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const consoleErrors = []
const httpErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(error.message))
// 记录精确失败资源，避免只有浏览器通用“资源加载失败”文字而无法区分站点图标与业务资源。
page.on('response', (response) => {
  if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() })
})

try {
  // 平台根入口不包含测试控件；流程回归明确进入同包的内部自测页，避免把测试面板误当作交付界面。
  const selfTestUrl = new URL('self-test.html', baseUrl).toString()
  await page.goto(selfTestUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })

  /*
   * 浏览器画布不会为每条连线创建 DOM（文档对象模型）元素，因此不能用元素数量猜测连线。
   * 直接读取页面同源发布清单，确认外部返回目标是未带 filter（过滤定义）的23/22来源总图；
   * 随后的标题与节点断言再证明页面确实激活了这份定义，而不是停留在任一过滤视图。
   */
  const manifestResponse = await page.request.get(new URL('scene-topology-manifest.json', baseUrl).toString())
  if (!manifestResponse.ok()) throw new Error(`发布清单请求失败：${manifestResponse.status()}。`)
  const manifest = await manifestResponse.json()
  const overviewDefinition = manifest?.topologies?.find?.((topology) => topology?.topologyId === 'topology.gas-power.overview')
  if (!overviewDefinition || overviewDefinition.filter !== undefined || overviewDefinition.nodes?.length !== 23 || overviewDefinition.edges?.length !== 22) {
    throw new Error('燃气来源总图不是未过滤的23节点、22连线定义。')
  }
  /*
   * “返回燃气总览”不是单纯换回二维定义：它必须通过清单中的稳定动作进入现有原子事务，
   * 由事务先等待 Unity 总览命令成功，再激活23/22来源总图并发布唯一 view.changed（视图已变化）事件。
   * 这里逐字段核对，防止按钮文案显示成功、实际清单却仍以 actionId: null 跳过三维复位。
   */
  const overviewAction = manifest?.actions?.find?.((action) => action?.actionId === overviewActionId)
  const gasScene = manifest?.scenes?.find?.((scene) => scene?.sceneId === 'gas-power')
  if (!overviewAction ||
      overviewAction.targetSceneId !== 'gas-power' ||
      overviewAction.targetTopologyId !== 'topology.gas-power.overview' ||
      overviewAction.unityAction?.type !== 'enterProcessStep' ||
      overviewAction.unityAction.processId !== 'gas-power-generation' ||
      overviewAction.unityAction.stepId !== 'overview' ||
      overviewAction.unityAction.defaultUnitId !== 'all' ||
      overviewAction.unityAction.isolate !== true ||
      !gasScene?.supportedActionIds?.includes?.(overviewActionId)) {
    throw new Error('燃气总览动作未按受控清单完整登记，无法证明二维恢复前 Unity 已执行总览复位。')
  }

  await page.getByText('燃气总图与三维场景已完成初始化。').waitFor({ timeout: 30_000 })

  /*
   * 通过宿主页唯一的嵌入壳元素取得框架上下文，让定位器自动跟随 `/shell/embed` 到 `/embed`
   * 的受控导航；禁止依赖页面框架数组的瞬时顺序或按任意地址猜测哪个框架是嵌入壳。
   */
  const shellFrame = page.locator('#visualization-shell').contentFrame()
  await shellFrame.getByText(/当前拓扑已配置 23 个节点/).waitFor({ timeout: 10_000 })
  const unityFrameCountBefore = await shellFrame.locator('iframe').count()
  if (unityFrameCountBefore !== 1) throw new Error(`初始化后 Unity 内嵌框架数量异常：${unityFrameCountBefore}。`)
  const topologyCanvasCountBefore = await shellFrame.locator('canvas').count()
  if (topologyCanvasCountBefore !== 1) throw new Error(`初始化后拓扑画布数量异常：${topologyCanvasCountBefore}。`)

  /*
   * 用来源总图中已显式登记 `sceneNodeId` 的燃机控制节点验证真实组件链路。
   * 点击位置由清单坐标和画布公开尺寸计算，不读取 Canvas（画布）私有缓存，也不根据标题或图元猜测。
   * 外层页只旁路观察壳已经发出的节点双击事件；Unity 页只旁路观察壳已经发出的受控命令。
   */
  const focusNodeDefinition = overviewDefinition.nodes.find((node) => node.nodeId === 'inlet-duct')
  if (!focusNodeDefinition || focusNodeDefinition.sceneNodeId !== 'gas-turbine') {
    throw new Error('燃机拓扑节点没有登记预期的 nodeId 到 sceneNodeId 静态映射。')
  }
  await page.evaluate(() => {
    window.__ccgtObservedShellEvents = []
    window.addEventListener('message', (event) => {
      const message = event.data
      if (message?.channel !== 'power-scene-topology-shell' || message?.type !== 'topology.node.dblclick') return
      window.__ccgtObservedShellEvents.push(JSON.parse(JSON.stringify(message)))
    })
  })
  const unityFrame = shellFrame.locator('iframe').contentFrame()
  await unityFrame.locator('html').evaluate(() => {
    window.__ccgtObservedUnityCommands = []
    window.addEventListener('message', (event) => {
      const message = event.data
      if (message?.channel !== 'power3d-unity' || (message?.type !== 'focusNode' && message?.type !== 'clearSelection')) return
      window.__ccgtObservedUnityCommands.push(JSON.parse(JSON.stringify(message)))
    })
  })

  const topologyCanvas = shellFrame.locator('canvas')
  const canvasSize = await topologyCanvas.evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect()
    return { width: bounds.width, height: bounds.height }
  })
  const layerLabelGutter = Math.min(124, Math.max(88, Math.round(canvasSize.width * 0.13)))
  const rightPadding = Math.max(14, Math.round(canvasSize.width * 0.02))
  const topologyContentWidth = Math.max(1, canvasSize.width - layerLabelGutter - rightPadding)
  const focusNodePosition = {
    x: layerLabelGutter + (focusNodeDefinition.x / 100) * topologyContentWidth,
    y: (focusNodeDefinition.y / 100) * canvasSize.height,
  }
  const readUnityInteractionCommands = () => unityFrame.locator('html').evaluate(() => window.__ccgtObservedUnityCommands ?? [])
  const waitForUnityCommand = async (type, description) => {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const commands = await readUnityInteractionCommands()
      if (commands.some((command) => command.type === type)) return commands
      await page.waitForTimeout(50)
    }
    throw new Error(description)
  }

  // 单击必须先提交二维选择，再且仅向显式三维映射发送一次聚焦；Unity 命令不得携带平台设备编号。
  await topologyCanvas.click({ position: focusNodePosition })
  let unityInteractionCommands = await waitForUnityCommand('focusNode', '燃机拓扑节点单击未下发三维聚焦命令。')
  const singleClickFocusCommands = unityInteractionCommands.filter((command) => command.type === 'focusNode')
  if (singleClickFocusCommands.length !== 1 ||
      singleClickFocusCommands[0]?.payload?.sceneNodeId !== focusNodeDefinition.sceneNodeId ||
      Object.hasOwn(singleClickFocusCommands[0]?.payload ?? {}, 'deviceId') ||
      Object.hasOwn(singleClickFocusCommands[0]?.payload ?? {}, 'nodeId')) {
    throw new Error('节点单击没有按静态 sceneNodeId 映射生成唯一三维聚焦命令。')
  }

  // 画布最右侧中部不在任何节点命中边界内；空白点击必须发出独立清除命令，不能复位场景或镜头。
  await topologyCanvas.click({ position: { x: canvasSize.width - 4, y: canvasSize.height / 2 } })
  unityInteractionCommands = await waitForUnityCommand('clearSelection', '拓扑空白点击未下发三维清除选择命令。')
  if (unityInteractionCommands.filter((command) => command.type === 'clearSelection').length !== 1) {
    throw new Error('拓扑空白点击没有生成唯一三维清除选择命令。')
  }

  // 清空旁路观察结果后执行真实双击，锁定“一个外层节点事件 + 一个单击聚焦”的去重语义。
  await page.evaluate(() => { window.__ccgtObservedShellEvents = [] })
  await unityFrame.locator('html').evaluate(() => { window.__ccgtObservedUnityCommands = [] })
  await topologyCanvas.dblclick({ position: focusNodePosition })
  await page.waitForFunction(() => window.__ccgtObservedShellEvents?.length === 1, undefined, { timeout: 5_000 })
  unityInteractionCommands = await waitForUnityCommand('focusNode', '燃机拓扑节点双击派生的单击未下发三维聚焦命令。')
  const observedNodeDoubleClickEvents = await page.evaluate(() => window.__ccgtObservedShellEvents ?? [])
  const doubleClickFocusCommands = unityInteractionCommands.filter((command) => command.type === 'focusNode')
  const observedNodeEvent = observedNodeDoubleClickEvents[0]
  if (observedNodeDoubleClickEvents.length !== 1 ||
      observedNodeEvent?.payload?.sceneId !== 'gas-power' ||
      observedNodeEvent?.payload?.topologyId !== 'topology.gas-power.overview' ||
      observedNodeEvent?.payload?.nodeId !== focusNodeDefinition.nodeId ||
      Object.keys(observedNodeEvent?.payload ?? {}).sort().join(',') !== 'nodeId,sceneId,topologyId') {
    throw new Error('拓扑节点双击没有严格上报 sceneId、topologyId 和 nodeId 三个字段。')
  }
  if (doubleClickFocusCommands.length !== 1) throw new Error(`节点双击重复下发三维聚焦命令：${doubleClickFocusCommands.length}次。`)
  if (await shellFrame.locator('iframe').count() !== unityFrameCountBefore || await shellFrame.locator('canvas').count() !== topologyCanvasCountBefore) {
    throw new Error('节点交互后 Unity 内嵌框架或拓扑画布实例数量发生变化。')
  }

  /*
   * 拓扑必须与三维视口共用浏览器原生 Fullscreen API（全屏接口），不能只用 fixed（固定定位）
   * 覆盖嵌入壳的内容区。点击后直接读取壳文档的 fullscreenElement（全屏元素），可区分这两种实现；
   * 退出后还要确认原面板和唯一 Unity 内嵌框架仍在，防止全屏切换通过重建组件伪装成功。
   */
  const overviewPanel = shellFrame.getByRole('region', { name: overviewTitle, exact: true })
  await overviewPanel.getByRole('button', { name: '全屏展示拓扑图', exact: true }).click()
  await shellFrame.getByRole('button', { name: '退出拓扑图全屏展示', exact: true }).waitFor({ timeout: 10_000 })
  const enteredNativeTopologyFullscreen = await shellFrame.locator('html').evaluate(() => document.fullscreenElement?.classList.contains('topology-panel') ?? false)
  if (!enteredNativeTopologyFullscreen) throw new Error('拓扑按钮未使面板进入浏览器原生全屏。')
  /*
   * 嵌套文档进入原生全屏时，最外层文档应把承载它的 iframe（内嵌框架）登记为全屏元素。
   * 该断言专门防止“子文档状态为全屏、实际仍被平台容器裁剪”的伪通过。
   */
  const enteredHostLevelFullscreen = await page.locator('#visualization-shell').evaluate((shellElement) => document.fullscreenElement === shellElement)
  if (!enteredHostLevelFullscreen) throw new Error('拓扑原生全屏未提升到最外层宿主页。')
  await shellFrame.getByRole('button', { name: '退出拓扑图全屏展示', exact: true }).click()
  await overviewPanel.getByRole('button', { name: '全屏展示拓扑图', exact: true }).waitFor({ timeout: 10_000 })
  const fullscreenElementAfterExit = await shellFrame.locator('html').evaluate(() => document.fullscreenElement?.className ?? null)
  if (fullscreenElementAfterExit !== null) throw new Error(`退出拓扑全屏后仍有全屏元素：${fullscreenElementAfterExit}。`)
  const hostFullscreenElementAfterExit = await page.locator('html').evaluate(() => document.fullscreenElement?.id ?? null)
  if (hostFullscreenElementAfterExit !== null) throw new Error(`退出拓扑全屏后最外层宿主页仍有全屏元素：${hostFullscreenElementAfterExit}。`)
  if (await shellFrame.locator('iframe').count() !== unityFrameCountBefore) throw new Error('拓扑全屏往返后 Unity 内嵌框架数量发生变化。')

  for (const actionCase of actionCases) {
    await page.getByRole('button', { name: actionCase.buttonName }).click()
    await page.getByText(new RegExp(`关键环节已切换为 ${actionCase.topologyId}，三维聚焦已按动作结果提交。`)).waitFor({ timeout: 15_000 })
    /*
     * 标题与节点数量同时校验：余热锅炉和蒸汽轮机均为六个节点，只验数量会让前一流程的旧画面误通过。
     * 节点数量来自发布清单的显式过滤结果，用于阻止流程切换后仍绘制总图全部节点的回归。
     */
    await shellFrame.getByRole('heading', { name: actionCase.buttonName, exact: true }).waitFor({ timeout: 10_000 })
    await shellFrame.getByText(new RegExp(`当前拓扑已配置 ${actionCase.nodeCount} 个节点`)).waitFor({ timeout: 10_000 })
    await shellFrame.getByText(new RegExp(`当前拓扑已配置 ${actionCase.nodeCount} 个节点、${actionCase.edgeCount} 条连线`)).waitFor({ timeout: 10_000 })
    const unityFrameCountAfter = await shellFrame.locator('iframe').count()
    if (unityFrameCountAfter !== unityFrameCountBefore) {
      throw new Error(`${actionCase.topologyId} 触发后 Unity 内嵌框架数量发生变化：${unityFrameCountBefore} → ${unityFrameCountAfter}。`)
    }
  }

  /*
   * 外部平台通过受控总览动作返回来源总图时，运行时必须先收到 Unity 总览成功回执，再用总图定义
   * 替换当前过滤投影。标题与23节点同时断言，避免旧流程画面或仅状态文案误通过。
   */
  await page.getByRole('button', { name: '返回燃气总览', exact: true }).click()
  await page.getByText('燃气总拓扑与三维总览已完成复位。', { exact: true }).waitFor({ timeout: 15_000 })
  await shellFrame.getByRole('heading', { name: overviewTitle, exact: true }).waitFor({ timeout: 10_000 })
  await shellFrame.getByText(/当前拓扑已配置 23 个节点/).waitFor({ timeout: 10_000 })
  if (await shellFrame.locator('canvas').count() !== topologyCanvasCountBefore) throw new Error('返回燃气总图后拓扑画布数量发生变化。')
  if (await shellFrame.locator('iframe').count() !== unityFrameCountBefore) throw new Error('返回燃气总图后 Unity 内嵌框架数量发生变化。')

  /*
   * 5539 是已固化的历史联调目录，生成时尚未声明空数据站点图标，因此允许且只允许它的
   * `/favicon.ico` 404；任何 Unity、清单、脚本、样式或图元资源错误都必须使回归失败。
   * 新构建模板已经声明空数据站点图标，后续发布正常情况下不会再进入该兼容分支。
   */
  const unexpectedHttpErrors = httpErrors.filter(({ status, url }) => status !== 404 || new URL(url).pathname !== '/favicon.ico')
  if (unexpectedHttpErrors.length > 0) {
    throw new Error(`发现业务资源请求失败：${JSON.stringify(unexpectedHttpErrors)}`)
  }

  // 截图路径由调用方显式传入，避免测试脚本向浏览器服务根目录或用户未知位置写入文件。
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true })
  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    baseUrl,
    unityFrameCount: unityFrameCountBefore,
    topologyCanvasCount: topologyCanvasCountBefore,
    actionCount: actionCases.length,
    overviewRestored: true,
    overviewNodeCount: overviewDefinition.nodes.length,
    overviewEdgeCount: overviewDefinition.edges.length,
    focusedNodeId: focusNodeDefinition.nodeId,
    focusedSceneNodeId: focusNodeDefinition.sceneNodeId,
    nodeDoubleClickEventCount: observedNodeDoubleClickEvents.length,
    nodeDoubleClickPayloadKeys: Object.keys(observedNodeEvent.payload).sort(),
    clearSelectionCommandCount: 1,
    ignoredHttpErrors: httpErrors,
    consoleErrors,
    screenshotPath: screenshotPath ?? null,
  }, null, 2)}\n`)
} catch (error) {
  /*
   * 三层初始化失败时输出有限、可审计的页面证据，避免只留下等待超时。
   * 不采集跨框架业务载荷、Unity 对象名或用户数据；仅记录外层状态文案、框架地址和浏览器错误。
   */
  const diagnostics = {
    statusText: await page.locator('#test-status').textContent().catch(() => null),
    frameUrls: page.frames().map((frame) => frame.url()),
    httpErrors,
    consoleErrors,
  }
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  throw new Error(`${error instanceof Error ? error.message : '浏览器回归失败。'}\n${JSON.stringify(diagnostics)}`)
} finally {
  await browser.close()
  // 只终止本测试创建的服务进程；外部传入 CCGT_RELEASE_URL 时绝不影响用户已有服务。
  if (releaseServer && !releaseServer.killed) releaseServer.kill('SIGTERM')
}

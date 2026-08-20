import { chromium } from 'file:///C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'

const baseUrl = process.env.LOCAL_PACKAGE_URL ?? 'http://127.0.0.1:5587/'
const executablePath = 'D:/PlaywrightBrowsers/chromium-1187/chrome-win/chrome.exe'
const browser = await chromium.launch({ executablePath, headless: process.env.LOCAL_HEADLESS !== '0' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', (error) => errors.push(error.message))

/**
 * 等待外部消息驱动的状态文案收敛。
 *
 * 初始总览可能通过“初始化复位”动作进入，也可能通过普通“总览切换”动作进入；
 * 两者都代表燃气总览已经完成，测试因此只放宽这一处等价文案，不放宽后续场景和流程断言。
 */
const waitForStatus = async (text) => {
  const expectedStatuses = Array.isArray(text) ? text : [text]
  await page.waitForFunction(
    (statuses) => statuses.includes(document.querySelector('#test-status')?.textContent?.trim()),
    expectedStatuses,
    { timeout: 20_000 },
  )
}

try {
  await page.goto(new URL('self-test.html', baseUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await waitForStatus(['燃气总览与三维场景已完成切换。', '燃气总拓扑与三维总览已完成复位。'])
  const shellFrame = page.locator('#visualization-shell').contentFrame()
  await shellFrame.getByRole('heading', { name: '燃气联合循环（CCGT）发电厂 OT 网络拓扑', exact: true }).waitFor({ timeout: 10_000 })
  const initialCounts = {
    unityFrames: await shellFrame.locator('iframe').count(),
    topologyCanvases: await shellFrame.locator('canvas').count(),
  }
  if (initialCounts.unityFrames !== 1 || initialCounts.topologyCanvases !== 1) {
    throw new Error(`初始化实例数量异常：${JSON.stringify(initialCounts)}`)
  }

  // 监听壳已发出的真实 Unity 命令，只观察不代发消息。
  const unityFrame = shellFrame.locator('iframe').contentFrame()
  await unityFrame.locator('html').evaluate(() => {
    window.__observedCommands = []
    window.addEventListener('message', (event) => {
      const message = event.data
      if (message?.channel === 'power3d-unity' && ['focusNode', 'clearSelection', 'enterProcessStep', 'switchScene'].includes(message.type)) {
        window.__observedCommands.push(JSON.parse(JSON.stringify(message)))
      }
    })
  })

  // 点击已登记三维映射节点，验证二维选择只生成一个 focusNode 命令。
  const manifest = await page.request.get(new URL('scene-topology-manifest.json', baseUrl).toString()).then((response) => response.json())
  const node = manifest.topologies.find((item) => item.topologyId === 'topology.gas-power.overview').nodes.find((item) => item.nodeId === 'inlet-duct')
  const canvas = shellFrame.locator('canvas')
  const canvasSize = await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  const layerGutter = Math.min(124, Math.max(88, Math.round(canvasSize.width * 0.13)))
  const contentWidth = canvasSize.width - layerGutter - Math.max(14, Math.round(canvasSize.width * 0.02))
  await canvas.click({ position: { x: layerGutter + (node.x / 100) * contentWidth, y: (node.y / 100) * canvasSize.height } })
  await page.waitForFunction(() => window.frames.length > 0)
  const commandsAfterNodeClick = await unityFrame.locator('html').evaluate(() => window.__observedCommands ?? [])
  const focusCommands = commandsAfterNodeClick.filter((command) => command.type === 'focusNode')
  if (focusCommands.length !== 1 || focusCommands[0].payload?.sceneNodeId !== node.sceneNodeId) {
    throw new Error(`拓扑节点聚焦命令异常：${JSON.stringify(focusCommands)}`)
  }

  // 依次切换燃气流程、燃煤总览、燃煤关键流程，再返回燃气总览，验证同一实例跨场景往返。
  const switches = [
    ['燃气轮机关键流程', '燃气关键流程已切换为 topology.gas-power.gas-turbine，三维动作已完成提交。', '燃气轮机关键环节'],
    ['燃煤总览', '燃煤总览与三维场景已完成切换。', '燃煤火力发电厂 OT 网络拓扑'],
    ['燃烧系统关键流程', '燃煤关键流程已切换为 topology.coal-power.combustion，三维动作已完成提交。', '燃烧系统'],
    // 燃气总览动作在当前测试页会明确标记为“复位”，与普通场景总览切换语义等价。
    ['燃气总览', ['燃气总览与三维场景已完成切换。', '燃气总拓扑与三维总览已完成复位。'], '燃气联合循环（CCGT）发电厂 OT 网络拓扑'],
  ]
  for (const [buttonName, statusText, topologyText] of switches) {
    await page.getByRole('button', { name: buttonName, exact: true }).click()
    await waitForStatus(statusText)
    await shellFrame.getByRole('heading', { name: topologyText, exact: true }).waitFor({ timeout: 15_000 })
    if (await shellFrame.locator('iframe').count() !== 1 || await shellFrame.locator('canvas').count() !== 1) {
      throw new Error(`${buttonName} 后实例数量发生变化。`)
    }
  }

  process.stdout.write(`${JSON.stringify({ status: 'passed', initialCounts, focusNodeId: node.nodeId, focusSceneNodeId: node.sceneNodeId, sceneSwitchCount: switches.length, consoleErrors: errors }, null, 2)}\n`)
} catch (error) {
  const shellFrame = page.locator('#visualization-shell').contentFrame()
  process.stderr.write(`${JSON.stringify({
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
    statusText: await page.locator('#test-status').textContent().catch(() => null),
    shellText: await shellFrame.locator('body').innerText().catch(() => ''),
    consoleErrors: errors,
  }, null, 2)}\n`)
  throw error
} finally {
  await browser.close()
}

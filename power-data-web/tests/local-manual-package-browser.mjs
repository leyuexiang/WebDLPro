import { chromium } from 'file:///C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const baseUrl = process.env.LOCAL_PACKAGE_URL ?? 'http://127.0.0.1:5586/'
const screenshotDirectory = resolve(process.env.LOCAL_PACKAGE_SCREENSHOT_DIR ?? 'artifacts/action-menu-browser')
const executablePath = 'D:/PlaywrightBrowsers/chromium-1187/chrome-win/chrome.exe'
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
// 在导航前安装消息旁路记录，只用于诊断握手字段，不修改或代发业务消息。
await page.addInitScript(() => {
  window.__observedMessages = []
  window.addEventListener('message', (event) => {
    const data = event.data
    if (data?.channel === 'power3d-unity' || data?.channel === 'power-scene-topology-shell') {
      window.__observedMessages.push(JSON.parse(JSON.stringify(data)))
    }
  })
})
page.on('console', (message) => logs.push({ type: message.type(), text: message.text() }))
page.on('pageerror', (error) => logs.push({ type: 'pageerror', text: error.message }))
page.on('requestfailed', (request) => logs.push({ type: 'requestfailed', text: `${request.url()} ${request.failure()?.errorText ?? ''}` }))

try {
  await mkdir(screenshotDirectory, { recursive: true })
  await page.goto(new URL('self-test.html', baseUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 20_000 })
  /**
   * 首次 Unity 场景在冷缓存下可能需要较长时间；以动作按钮解除禁用作为完整协议就绪条件，
   * 不使用固定短等待掩盖 system.init（系统初始化）或首个稳定视图尚未完成的问题。
   */
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-action-id="action.wind-power.overview"]')
    return button instanceof HTMLButtonElement && !button.disabled
  }, undefined, { timeout: 180_000 })

  const actionChecks = [
    { actionId: 'action.wind-power.overview', expectedText: '新增场景 wind-power 已稳定提交', screenshotName: '01-wind-power.png' },
    { actionId: 'action.solar-power.overview', expectedText: '新增场景 solar-power 已稳定提交', screenshotName: '02-solar-power.png' },
    { actionId: 'action.step-up-substation.overview', expectedText: '新增场景 step-up-substation 已稳定提交', screenshotName: '03-step-up-substation.png' },
    { actionId: 'action.step-down-substation.overview', expectedText: '新增场景 step-down-substation 已稳定提交', screenshotName: '04-step-down-substation.png' },
    { actionId: 'action.scene.overview', expectedText: '全局沙盘已稳定提交', screenshotName: '05-overview.png' },
  ]
  const actionResults = []
  for (const check of actionChecks) {
    const button = page.locator(`[data-action-id="${check.actionId}"]`)
    await button.click({ timeout: 10_000 })
    await page.waitForFunction(
      (expectedText) => document.querySelector('#test-status')?.textContent?.includes(expectedText),
      check.expectedText,
      { timeout: 180_000 },
    )
    const statusText = await page.locator('#test-status').textContent()
    const screenshotPath = resolve(screenshotDirectory, check.screenshotName)
    await page.screenshot({ path: screenshotPath, fullPage: true })
    actionResults.push({ actionId: check.actionId, statusText, screenshotPath })
  }

  const frameInfo = await Promise.all(page.frames().map(async (frame) => ({
    url: frame.url(),
    messages: await frame.evaluate(() => window.__observedMessages ?? []).catch(() => []),
  })))
  const shellFrame = page.locator('#visualization-shell').contentFrame()
  const shellText = await shellFrame.locator('body').innerText().catch(() => '')
  const observedWorkflowActionIds = frameInfo
    .flatMap((frame) => frame.messages)
    .filter((message) => message?.type === 'workflow.trigger')
    .map((message) => message.payload?.actionId)
  process.stdout.write(`${JSON.stringify({
    statusText: await page.locator('#test-status').textContent(),
    buttonCount: await page.locator('button').count(),
    actionResults,
    observedWorkflowActionIds,
    frameInfo,
    shellText: shellText.slice(0, 1200),
    logs,
  }, null, 2)}\n`)
} finally {
  await browser.close()
}

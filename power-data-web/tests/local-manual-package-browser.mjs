import { chromium } from 'file:///C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'

const baseUrl = process.env.LOCAL_PACKAGE_URL ?? 'http://127.0.0.1:5586/'
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
  await page.goto(new URL('self-test.html', baseUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await page.waitForTimeout(4_000)
  const frameInfo = await Promise.all(page.frames().map(async (frame) => ({
    url: frame.url(),
    messages: await frame.evaluate(() => window.__observedMessages ?? []).catch(() => []),
  })))
  const shellFrame = page.locator('#visualization-shell').contentFrame()
  const shellText = await shellFrame.locator('body').innerText().catch(() => '')
  process.stdout.write(`${JSON.stringify({
    statusText: await page.locator('#test-status').textContent(),
    buttonCount: await page.locator('button').count(),
    frameInfo,
    shellText: shellText.slice(0, 1200),
    logs,
  }, null, 2)}\n`)
} finally {
  await browser.close()
}

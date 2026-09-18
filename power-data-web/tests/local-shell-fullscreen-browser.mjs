import assert from 'node:assert/strict'
import { join } from 'node:path'

// 复用本地三层夹具；浏览器库及可执行文件允许由测试环境提供，不修改项目依赖或生产入口。
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL ?? 'playwright')
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.setDefaultTimeout(10_000)
const pageErrors = []
// 记录异常发生的阶段，避免把后台拓扑绘制与步骤控件布局错误混为一谈。
let stage = '初始化'
page.on('pageerror', (error) => pageErrors.push({ stage, message: error.message, stack: error.stack }))

// 只记录来自当前壳的会话及视图确认，供宿主页发送合法外层命令；不访问或替换运行时内部对象。
await page.addInitScript(() => {
  window.__fullscreenRegression = { session: null, view: null }
  window.addEventListener('message', (event) => {
    const frame = document.querySelector('#shell-frame')
    const message = event.data
    if (event.origin !== 'http://127.0.0.1:5174' || event.source !== frame?.contentWindow
      || message?.channel !== 'power-scene-topology-shell') return
    if (message.type === 'system.ready') {
      const { channel, version, instanceId, sessionId } = message
      window.__fullscreenRegression.session = { channel, version, instanceId, sessionId }
    }
    if (message.type === 'view.changed') window.__fullscreenRegression.view = message
  })
})

/** 只请求合成清单中登记的业务场景，等待相同消息标识的稳定视图确认后再检查布局。 */
async function openScene(sceneId) {
  const messageId = await page.evaluate((targetSceneId) => {
    const messageId = `fullscreen-regression-${crypto.randomUUID()}`
    document.querySelector('#shell-frame').contentWindow.postMessage({
      ...window.__fullscreenRegression.session,
      messageId,
      type: 'view.open',
      timestamp: Date.now(),
      payload: { sceneId: targetSceneId, topologyId: `topology.${targetSceneId}.overview` },
    }, 'http://127.0.0.1:5174')
    return messageId
  }, sceneId)
  await page.waitForFunction((requestId) => window.__fullscreenRegression.view?.replyTo === requestId, messageId)
}

/** 一次读取真实边界与点击命中目标，避免“元素有尺寸但被原生全屏顶层排除”的假通过。 */
async function readLayout(shell) {
  return shell.evaluate(() => {
    const viewport = document.querySelector('.process-scene__runtime')
    const legend = document.querySelector('.process-scene__pipeline-legend')
    const nav = document.querySelector('.embedded-visualization-shell__camera-steps')
    const bubble = document.querySelector('.camera-pose-information-bubble')
    const buttons = Array.from(nav.querySelectorAll('button'))
    const viewportRect = viewport.getBoundingClientRect()
    const legendRect = legend?.getBoundingClientRect()
    const navRect = nav.getBoundingClientRect()
    return {
      viewport: viewportRect.toJSON(),
      nav: navRect.toJSON(),
      bubble: bubble?.getBoundingClientRect().toJSON(),
      fullscreen: document.fullscreenElement === viewport,
      legend: legendRect?.toJSON(),
      legendSource: legend?.getAttribute('src') ?? null,
      legendInViewport: Boolean(legend && viewport.contains(legend)),
      legendPointerEvents: legend ? getComputedStyle(legend).pointerEvents : null,
      legendPassesThroughPointer: legendRect
        ? !legend.contains(document.elementFromPoint(legendRect.x + legendRect.width / 2, legendRect.y + legendRect.height / 2))
        : false,
      controlsInViewport: viewport.contains(nav) && (!bubble || viewport.contains(bubble)),
      buttonCount: buttons.length,
      buttonsInside: buttons.every((button) => {
        const rect = button.getBoundingClientRect()
        return rect.left >= navRect.left && rect.right <= navRect.right
      }),
      buttonsHittable: buttons.every((button) => {
        const rect = button.getBoundingClientRect()
        return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      }),
      iframeCount: viewport.querySelectorAll('iframe').length,
    }
  })
}

/**
 * 二维引擎有内置 100 毫秒窗口尺寸防抖；测试需让其完成再采样或切换场景，
 * 否则连续自动化操作会把上一画布的延迟绘制带入卸载阶段，无法代表稳定全屏布局。
 */
async function waitForResizeSettlement() {
  await page.waitForTimeout(150)
}

/** 导航外框与实际画布等宽且贴近底部；气泡始终按实际画布高度和原始矢量图比例缩放。 */
function assertLayout(layout, fullscreen, expectedLegendAsset) {
  assert.equal(layout.fullscreen, fullscreen, '浏览器必须实际切换全屏状态')
  assert.equal(layout.legendInViewport, true, '第二层管线图例必须属于真正的全屏视口')
  assert.equal(layout.legendPointerEvents, 'none', '管线图例不能接管任何鼠标交互')
  assert.equal(layout.legendPassesThroughPointer, true, '管线图例覆盖区域必须继续命中下方三维画面')
  assert.ok(layout.legend.width > 0 && layout.legend.height > 0, '管线图例必须完成可见绘制')
  assert.ok(layout.legendSource?.includes(expectedLegendAsset), `当前场景必须加载 ${expectedLegendAsset} 图例资源`)
  const legendCenter = layout.legend.left + layout.legend.width / 2
  const viewportCenter = layout.viewport.left + layout.viewport.width / 2
  assert.ok(Math.abs(legendCenter - viewportCenter) <= 1, '管线图例必须位于三维视口顶部正中')
  assert.ok(layout.legend.top >= layout.viewport.top, '管线图例必须位于三维视口顶部内')
  assert.ok(layout.legend.right <= layout.viewport.right && layout.legend.bottom <= layout.viewport.bottom, '管线图例不能溢出三维视口')
  assert.ok(layout.legend.width <= 420 + 1, '管线图例默认宽度应比原始资源适度缩小')
  assert.equal(layout.controlsInViewport, true, '步骤按钮和气泡必须属于真正的全屏视口')
  assert.equal(layout.buttonCount, 6, '燃气、燃煤均应显示六个步骤')
  assert.equal(layout.buttonsInside, true, '单个按钮不能超出导航边界')
  assert.equal(layout.buttonsHittable, true, '步骤必须在全屏顶层内可点击')
  assert.equal(layout.iframeCount, 1, '必须复用唯一运行时内嵌框架')
  assert.ok(Math.abs(layout.nav.left - layout.viewport.left) <= 1)
  assert.ok(Math.abs(layout.nav.right - layout.viewport.right) <= 1)
  const bottomGap = layout.viewport.bottom - layout.nav.bottom
  assert.ok(bottomGap >= 11 && bottomGap <= 30, `导航应贴近视口底部，实际间距 ${bottomGap}`)
  assert.ok(Math.abs(layout.bubble.height - layout.viewport.height / 3) <= 1, '气泡高应为视口高的三分之一')
  assert.ok(Math.abs(layout.bubble.width / layout.bubble.height - 613.868 / 432.543) < 0.01)
}

try {
  await page.goto('http://127.0.0.1:5510/visual-baseline.html', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__fullscreenRegression.view?.payload.sceneId === 'gas-power')
  const shell = page.frames().find((frame) => frame.url().startsWith('http://127.0.0.1:5174/'))
  assert.ok(shell, '嵌入壳必须完成加载')
  const buttons = shell.locator('.embedded-visualization-shell__camera-step-button')
  const bubble = shell.locator('.camera-pose-information-bubble')
  const runtimeFrame = await shell.locator('.process-scene__runtime iframe').elementHandle()
  const results = []

  // 两个场景分别验证最小桌面、常见桌面和超宽屏；同一个运行时跨尺寸与全屏往返必须保持身份。
  for (const sceneId of ['gas-power', 'coal-power']) {
    // 燃煤图例与既有燃气图例资源独立，普通与全屏往返都必须保持当前场景对应的那一份资源。
    const expectedLegendAsset = sceneId === 'coal-power'
      ? 'pipeline-legend-horizontal-coal.png'
      : 'pipeline-legend-horizontal.png'
    await openScene(sceneId)
    assert.equal(await bubble.count(), 0, '场景切换必须清空旧说明')
    // 视图协议确认早于二维资源加载完成；本测试针对已加载视图的全屏操作，先等实际画布就绪。
    const topologyClass = sceneId === 'gas-power' ? 'gas-topology-runtime-canvas' : 'coal-topology-runtime-canvas'
    await shell.locator(`.${topologyClass}`).waitFor()
    await shell.locator(`.${topologyClass}__state`).waitFor({ state: 'hidden' })
    await waitForResizeSettlement()
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 3440, height: 1440 }]) {
      stage = `${sceneId} ${viewport.width} 调整尺寸`
      await page.setViewportSize(viewport)
      await waitForResizeSettlement()
      await buttons.first().click()
      await bubble.waitFor()
      const normal = await readLayout(shell)
      // 先点击真实按钮，再检查原生全屏元素，不能通过伪造全屏类名掩盖结构错误。
      stage = `${sceneId} ${viewport.width} 进入全屏`
      await shell.getByRole('button', { name: '进入三维全屏', exact: true }).click()
      await shell.waitForFunction(() => document.fullscreenElement?.classList.contains('process-scene__runtime'))
      await waitForResizeSettlement()
      assertLayout(await readLayout(shell), true, expectedLegendAsset)
      assertLayout(normal, false, expectedLegendAsset)
      await buttons.last().click()
      assert.equal(await bubble.locator('h2').innerText(), (await buttons.last().innerText()).replace(/^06\s*/, ''))
      // 可选截图供人工核对真实全屏视觉；输出目录由调用方准备，不写入正式发布资源。
      if (process.env.FULLSCREEN_SCREENSHOT_DIR && viewport.width === 1920) {
        await page.screenshot({ path: join(process.env.FULLSCREEN_SCREENSHOT_DIR, `${sceneId}-fullscreen.png`) })
      }
      await shell.getByRole('button', { name: '关闭关键环节说明', exact: true }).click()
      assert.equal(await bubble.count(), 0)
      await buttons.first().click()
      stage = `${sceneId} ${viewport.width} 退出全屏`
      await shell.getByRole('button', { name: '退出三维全屏', exact: true }).click()
      await shell.waitForFunction(() => document.fullscreenElement === null)
      await waitForResizeSettlement()
      const restored = await readLayout(shell)
      assertLayout(restored, false, expectedLegendAsset)
      assert.ok(Math.abs(restored.viewport.width - normal.viewport.width) <= 1, '退出全屏后恢复原视口宽度')
      assert.equal(await runtimeFrame.evaluate((frame) => frame === document.querySelector('.process-scene__runtime iframe')), true)
      // 覆盖层空白必须命中原内嵌框架，且点击三维画面不能改变“仅关闭按钮主动关闭”的规则。
      const blankHitsRuntime = await shell.evaluate(() => {
        const rect = document.querySelector('.process-scene__runtime').getBoundingClientRect()
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.tagName === 'IFRAME'
      })
      assert.equal(blankHitsRuntime, true, '覆盖层留白不能阻断三维操作')
      results.push({ sceneId, ...viewport, normalWidth: normal.nav.width, fullscreenWidth: viewport.width })
    }
  }
  stage = '切换风电'
  await openScene('wind-power')
  assert.equal(await bubble.count(), 0, '切换场景后不残留气泡')
  assert.equal(await buttons.count(), 0, '非燃气燃煤场景不残留步骤按钮')
  assert.equal(await shell.locator('.process-scene__pipeline-legend').count(), 1, '其他第二层业务场景也必须显示公共管线图例')
  assert.ok((await readLayout(shell)).legendSource?.includes('pipeline-legend-horizontal.png'), '当前非燃煤第二层场景保持既有燃气图例资源')
  // 分开报告控件断言与整页异常；即使所有布局项通过，也不得把其他页面异常静默当作成功。
  console.log(JSON.stringify({ layoutResult: '全屏步骤导航断言通过', cases: results, pageErrorCount: pageErrors.length }, null, 2))
  assert.deepEqual(pageErrors, [], '页面不应存在未处理异常，完整回归仍需处理上方异常')
} catch (error) {
  // 失败时只输出本地夹具的可见文本与页面异常，便于区分协议启动失败和布局断言失败。
  console.error(JSON.stringify({ pageErrors, frames: await Promise.all(page.frames().map(async (frame) => ({
    url: frame.url(), text: (await frame.locator('body').innerText().catch(() => '')).slice(0, 1500),
  }))) }, null, 2))
  throw error
} finally {
  // 即使断言失败也关闭受控浏览器，避免留下内嵌框架、浏览器进程或页面监听。
  await browser.close()
}

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createGasOnlyManifest,
  createHostPage,
  createSelfTestPage,
 readReleaseConfiguration,
  createStaticServer,
} from '../scripts/build-gas-power-smoke-release.mjs'
import { validateSceneTopologyManifest } from '../src/config/scene-topology/validator'

/**
 * 总览恢复横跨外层按钮、清单动作白名单和 Unity 流程映射，任一处漏配都会造成二维已恢复、
 * 三维仍停留在关键流程的分裂状态。本测试从构建器生成的同一份正式清单核对完整闭环，
 * 避免使用与真实发布脚本分离的手写夹具而产生误报。
 */
describe('燃气总览发布契约', () => {
  it('总览显式发布三组重点区域，且新版不发布过滤拓扑', async () => {
    const manifest = await createGasOnlyManifest('focus-region-contract-test')
    const overview = manifest.topologies.find((candidate) => candidate.topologyId === 'topology.gas-power.overview')
    expect(overview?.focusRegions).toEqual([
      {
        regionId: 'focus.gas-turbine-control',
        anchorNodeId: 'inlet-duct',
        nodeIds: ['inlet-duct', 'fuel-gas-pressure-valve', 'fuel-gas-electric-actuator'],
        label: '燃机控制区域',
      },
      {
        regionId: 'focus.hrsg-control',
        anchorNodeId: 'hrsg',
        nodeIds: ['hrsg', 'hrsg-drum-level-sensor'],
        label: '余热锅炉控制区域',
      },
      {
        regionId: 'focus.steam-turbine-control',
        anchorNodeId: 'steam-turbine',
        nodeIds: ['steam-turbine', 'steam-main-control-valve'],
        label: '蒸汽轮机控制区域',
      },
    ])
    /**
     * 关键流程已下线，不能只隐藏导航按钮；正式清单也必须仅保留总览，避免外部协议通过
     * topologyId（拓扑标识）访问未发布的过滤视图。
     */
    const gasTopologies = manifest.topologies.filter((topology) => topology.sceneId === 'gas-power')
    expect(gasTopologies).toHaveLength(1)
    expect(gasTopologies[0]?.topologyId).toBe('topology.gas-power.overview')
    expect(gasTopologies.every((topology) => topology.filter === undefined)).toBe(true)
    expect(validateSceneTopologyManifest(manifest)).toEqual([])
  })

  it('运行时同源服务打印实际访问地址而不是内部占位符', () => {
    const serverSource = createStaticServer()
    expect(serverSource).toContain("import { networkInterfaces } from 'node:os'")
    expect(serverSource).toContain('const urls = new Set()')
    expect(serverSource).toContain("addressMode === 'runtime-self-origin'")
    expect(serverSource).toContain("console.log('燃气服务已启动。请使用下面列出的地址访问：')")
    expect(serverSource).not.toContain('公开访问地址：${hostOrigin}/')
    expect(serverSource).not.toContain('__RUNTIME_SELF_ORIGIN__')
  })

  it('本地测试入口清理同源旧缓存且壳资源不写入长期磁盘缓存', () => {
    const localServerSource = createStaticServer('local-test')
    const partnerServerSource = createStaticServer('partner-integration')

    /**
     * 多个不可变测试包可能复用同一回环来源。根入口必须先清理该来源遗留的浏览器缓存，
     * 否则旧包写入的损坏模块会在新包启动前触发 ERR_CACHE_READ_FAILURE（缓存读取失败）。
     */
    expect(localServerSource).toContain('const packageType = "local-test"')
    expect(localServerSource).toContain("requestUrl.pathname === '/self-test.html'")
    expect(localServerSource).toContain("headers['clear-site-data'] = '\"cache\"'")
    expect(partnerServerSource).toContain('const resetLocalBrowserCache = false')
    expect(partnerServerSource).not.toContain('self-test.html')

    /**
     * 本地壳体积较小且会频繁重建，使用 no-store（禁止存储）可直接绕开损坏的磁盘缓存；
     * Unity 播放器和场景大资源也必须 no-store，避免长期 HTTP 缓存与 Unity 资源占用叠加。
     */
    expect(localServerSource).toContain("const isLocalShellAsset = packageType === 'local-test'")
    expect(localServerSource).toContain("if (isLocalShellAsset) return 'no-store'")
    expect(localServerSource).toContain("const isUnityLargeAsset = relativePath.startsWith('unity/Build/')")
    expect(localServerSource).toContain("if (isUnityLargeAsset) return 'no-store'")
    expect(partnerServerSource).toContain('const packageType = "partner-integration"')
  })

  it('总览23个源节点全部按 nodeId 上报且结构清单不预置平台设备事实', async () => {
    const manifest = await createGasOnlyManifest('node-protocol-contract-test')
    const overview = manifest.topologies.find((candidate) => candidate.topologyId === 'topology.gas-power.overview')

    expect(overview?.nodes).toHaveLength(23)
    expect(new Set(overview?.nodes.map((node) => node.nodeId))).toHaveLength(23)
    expect(overview?.nodes.every((node) => node.doubleClickBehavior === 'emit-node')).toBe(true)
    expect(overview?.nodes.every((node) => !Object.prototype.hasOwnProperty.call(node, 'deviceId'))).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(manifest, 'deviceMappings')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(manifest, 'platformBindingCount')).toBe(false)
    expect(validateSceneTopologyManifest(manifest)).toEqual([])

    // 新版只发布总览，所有节点状态、二维选择和三维映射均以这一份来源数据为准。
    expect(manifest.topologies.filter((topology) => topology.sceneId === 'gas-power')).toEqual([overview])
  })

  it('总览按钮只通过已登记动作恢复 Unity 总览和完整拓扑', async () => {
    const manifest = await createGasOnlyManifest('overview-contract-test')
    const overviewAction = manifest.actions.find((action) => action.actionId === 'action.gas-power.overview')
    const gasScene = manifest.scenes.find((scene) => scene.sceneId === 'gas-power')
    const gasUnityMapping = manifest.unitySceneMappings.find((mapping) => mapping.sceneId === 'gas-power')
    const hostPage = createSelfTestPage(manifest.manifestVersion)

    expect(overviewAction).toMatchObject({
      targetSceneId: 'gas-power',
      targetViewMode: 'business',
      targetTopologyId: 'topology.gas-power.overview',
      failurePolicy: 'keep-current-context',
      unityAction: {
        type: 'enterProcessStep',
        processId: 'gas-power-generation',
        stepId: 'overview',
        defaultUnitId: 'all',
        isolate: true,
      },
    })
    expect(gasScene?.supportedActionIds).toContain('action.gas-power.overview')
    expect(gasUnityMapping?.processSteps).toContainEqual({
      processId: 'gas-power-generation',
      stepId: 'overview',
    })

    // 外层必须走 workflow.trigger（工作流触发）事务，禁止退回只切二维拓扑的 view.open（打开视图）命令。
    expect(hostPage).toContain('data-action-id="action.gas-power.overview"')
    expect(hostPage).toContain("button.addEventListener('click', () => triggerWorkflow")
    expect(hostPage).not.toContain("actionId: null,\n              expectedContextRevision")
    // 成功文案还必须核对视图变更携带的动作标识，不能让同名二维总图误报为三维已经复位。
    expect(hostPage).toContain("message.payload?.actionId === 'action.gas-power.overview'")
  })

  it('只发布燃气轮机一个独立第三层目录和无拓扑动作', async () => {
    const manifest = await createGasOnlyManifest('single-gas-turbine-detail-contract')
    const detailAction = manifest.actions.find((action) => action.actionId === 'action.gas-power.gas-turbine')

    expect(manifest.processDetails).toEqual([{
      sceneId: 'gas-power',
      processId: 'gas-power-generation',
      stepId: 'gas-turbine',
      processDetailId: 'process-detail.gas-power.gas-turbine',
      resourceId: 'process-detail-resource.gas-power.gas-turbine',
      cameraPoseId: 'camera-pose.gas-power.gas-turbine',
      stateNodeId: 'gas-turbine',
    }])
    expect(detailAction).toEqual(expect.objectContaining({
      targetSceneId: 'gas-power',
      targetViewMode: 'process-detail',
      processDetailId: 'process-detail.gas-power.gas-turbine',
      unityAction: { type: 'enterProcessDetail', processDetailId: 'process-detail.gas-power.gas-turbine' },
    }))
    expect(detailAction).not.toHaveProperty('targetTopologyId')
    expect(JSON.stringify(detailAction)).not.toContain('enterProcessStep')
    expect(manifest.unitySceneMappings.find((mapping) => mapping.sceneId === 'gas-power')?.processSteps)
      .not.toContainEqual(expect.objectContaining({ stepId: 'gas-turbine' }))
  })

  it('本地根入口保留自动初始化，独立服务根入口将平台直接导航到协议壳', () => {
    const localPage = createHostPage('local-entry-contract-test', 'local-test')
    const partnerPage = createHostPage('partner-entry-contract-test', 'partner-integration')
    const formalPage = createHostPage('formal-entry-contract-test', 'standalone-formal')
    const selfTestPage = createSelfTestPage('self-test-entry-contract-test')

    // 只有 local-test（本地测试包）可在没有真实平台时代替父页面发送初始化命令。
    expect(localPage).toContain('content="local-bootstrap-host"')
    expect(localPage).toContain("type: 'system.init'")
    expect(localPage).toContain('topology.gas-power.overview')

    // 交付入口只做同窗口导航：查询参数保持不变，且不得再嵌套壳或伪造平台初始化。
    for (const deliveryPage of [partnerPage, formalPage]) {
      expect(deliveryPage).toContain('content="platform-direct-shell-redirect"')
      expect(deliveryPage).toContain("new URL('./shell/embed', window.location.href)")
      expect(deliveryPage).toContain('shellUrl.search = window.location.search')
      expect(deliveryPage).toContain('window.location.replace(shellUrl.toString())')
      expect(deliveryPage).not.toContain('id="visualization-shell"')
      expect(deliveryPage).not.toContain("type: 'system.init'")
      expect(deliveryPage).not.toContain('gas-power-platform-init')
    }
    expect(() => createHostPage('invalid-entry-contract-test', 'unknown-package')).toThrow('未知包类型')

    // 内部自测页从沙盘开始，关键环节稳定后通过受控协议提供播放/停止按钮；不得用设备四态伪装动态控制。
    expect(selfTestPage).toContain('燃气轮机单环节全链路自测')
    expect(selfTestPage).toContain("sceneId: 'overview'")
    expect(selfTestPage).toContain('data-command="overview" disabled>沙盘</button>')
    expect(selfTestPage).toContain('data-action-id="action.gas-power.overview"')
    expect(selfTestPage).toContain('data-action-id="action.gas-power.gas-turbine"')
    expect(selfTestPage).toContain('disabled>燃气</button>')
    expect(selfTestPage).toContain('disabled>关键环节</button>')
    expect(selfTestPage).toContain('data-playback="play"')
    expect(selfTestPage).toContain('data-playback="stop"')
    expect(selfTestPage).toContain("process-detail.playback")
    expect(selfTestPage).not.toContain("items: [{ nodeId: 'inlet-duct', deviceStatus")
    expect(selfTestPage).not.toContain('data-device-status=')
    expect(selfTestPage).not.toContain('燃气轮机动态已停止。')
    expect(selfTestPage).not.toContain('燃气轮机动态已开始播放。')
    expect(selfTestPage).toContain('按钮仅通过外层受控协议操作当前三维模型')
    expect(selfTestPage).toContain('message.payload.topologyId === undefined')
    expect(selfTestPage).toContain('test-status')
    expect(selfTestPage).not.toContain('data-device-status="alarm"')
    expect(selfTestPage).not.toContain('data-device-status="offline"')
    expect(selfTestPage).not.toContain('快速重复进入两次')
    expect(selfTestPage).not.toContain('data-command="rapid-enter"')
    expect(selfTestPage).not.toContain('data-command="snapshot"')
    expect(selfTestPage).not.toContain('test-events')
    expect(selfTestPage).not.toMatch(/action\.gas-power\.(hrsg|steam-turbine)/)
    expect(selfTestPage).not.toContain('action.coal-power')
    expect(selfTestPage).toContain('const version = 2')
    expect(selfTestPage).not.toContain('const version = 1')

    // system.ack 只是初始化已受理，同一 replyTo 随后必须允许提交首个稳定 view.changed；
    // 将它提前写入已完成集合会把沙盘首帧误报为迟到结果并永久禁用测试按钮。
    const systemAcknowledgementHandler = selfTestPage.match(
      /if \(message\.type === 'system\.ack'[\s\S]*?(?=\n\s*if \(\(message\.type === 'system\.ack')/,
    )?.[0]
    expect(systemAcknowledgementHandler).toBeDefined()
    expect(systemAcknowledgementHandler).not.toContain('completedMessageIds.add')
  })

  it('平台构建默认不交付自测页，内部验证必须显式启用', () => {
    // 默认关闭是交付安全边界，避免调用者忘记参数时把内部按钮页带入平台目录。
    expect(readReleaseConfiguration([]).includeSelfTest).toBe(false)
    expect(readReleaseConfiguration(['--include-self-test', 'true']).includeSelfTest).toBe(true)
    expect(() => readReleaseConfiguration(['--include-self-test', 'yes'])).toThrow('只能是 true 或 false')
  })

  it('默认 Unity 基线与当前可发布协议基线保持一致', () => {
    // 此断言只锁定发布器的默认标识，避免已归档目录变更后无参数构建仍指向不存在的旧基线。
    // 目录可读性、标识一致性和命令能力由真实发布流程的 Unity 协议门禁负责校验，不在单元测试依赖构建产物。
    // 默认发布输入已切换到通过结构版本8、关键环节命令版本2门禁的 Unity 网页图形基线。
    expect(readReleaseConfiguration([]).unityReleaseId).toBe('three-layer-unity-demo-20260831-2300')
  })

  it('合作方联调包显式区分监听地址与三层公开来源', () => {
    const configuration = readReleaseConfiguration([
      '--package-type', 'partner-integration',
      '--listen-host', '0.0.0.0',
      '--port', '5575',
      '--public-origin', 'http://visual.example.com',
      '--platform-parent-origin', 'http://platform.example.com',
      '--unity-parent-origin', 'http://visual.example.com',
      '--unity-entry-url', 'http://visual.example.com/unity/index.html',
    ])

    expect(configuration).toMatchObject({
      packageType: 'partner-integration',
      listenHost: '0.0.0.0',
      port: 5575,
      publicOrigin: 'http://visual.example.com',
      platformParentOrigin: 'http://platform.example.com',
      unityParentOrigin: 'http://visual.example.com',
      unityEntryUrl: 'http://visual.example.com/unity/index.html',
      manifestUrl: 'http://visual.example.com/scene-topology-manifest.json',
      includeSelfTest: false,
      addressMode: 'fixed-origin',
    })
    expect(() => readReleaseConfiguration([
      '--package-type', 'partner-integration', '--listen-host', '0.0.0.0',
      '--public-origin', 'http://visual.example.com', '--platform-parent-origin', 'http://platform.example.com',
      '--unity-parent-origin', 'http://visual.example.com', '--unity-entry-url', 'http://visual.example.com/unity/index.html',
      '--manifest-url', 'http://platform.example.com/api/goview/linkage-package/manifest/gas',
    ])).toThrow('必须使用我方公开来源下的同源')
    const runtimeConfiguration = readReleaseConfiguration(['--package-type', 'partner-integration', '--listen-host', '0.0.0.0'])
    expect(runtimeConfiguration).toMatchObject({
      port: 5575,
      addressMode: 'runtime-self-origin',
      publicOrigin: '__RUNTIME_SELF_ORIGIN__',
      platformParentOrigin: '__RUNTIME_PARENT_ORIGIN__',
      unityEntryUrl: '__RUNTIME_SELF_ORIGIN__/unity/index.html',
      manifestUrl: '__RUNTIME_SELF_ORIGIN__/scene-topology-manifest.json',
    })
    expect(() => readReleaseConfiguration([
      '--package-type', 'partner-integration', '--listen-host', '0.0.0.0', '--port', '5555',
    ])).toThrow('端口固定为 5575')
    expect(() => readReleaseConfiguration([
      '--package-type', 'partner-integration', '--include-self-test', 'true',
      '--public-origin', 'http://visual.example.com', '--platform-parent-origin', 'http://platform.example.com',
      '--unity-parent-origin', 'http://visual.example.com', '--unity-entry-url', 'http://visual.example.com/unity/index.html',
    ])).toThrow('禁止包含内部自测页')
    expect(() => readReleaseConfiguration([
      '--package-type', 'partner-integration', '--listen-host', '127.0.0.1',
      '--public-origin', 'http://visual.example.com', '--platform-parent-origin', 'http://platform.example.com',
      '--unity-parent-origin', 'http://visual.example.com', '--unity-entry-url', 'http://visual.example.com/unity/index.html',
    ])).toThrow('不得只监听本机回环地址')
  })

  it('已废弃的关键环节网页播放控件开关不得继续用于打包', () => {
    // 播放能力仍保留在 Unity 与受控协议中；发布器拒绝旧网页按钮开关，避免历史联调命令静默生成不同界面。
    expect(() => readReleaseConfiguration([
      '--package-type', 'partner-integration',
      '--listen-host', '0.0.0.0',
      '--include-playback-controls', 'true',
    ])).toThrow('包含未知选项')
  })

  it('生产环境示例不会把燃气结构清单重新指向平台接口', () => {
    const environmentSource = readFileSync(`${process.cwd()}/.env.example`, 'utf8')
    const values = new Map(environmentSource
      .split(/\r?\n/)
      .filter((line) => line.startsWith('VITE_POWER_'))
      .map((line) => {
        const separatorIndex = line.indexOf('=')
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)] as const
      }))
    const unityParentOrigin = values.get('VITE_POWER_UNITY_PARENT_ORIGIN')
    const manifestUrl = values.get('VITE_POWER_MANIFEST_URL')

    expect(unityParentOrigin).toBeDefined()
    expect(manifestUrl).toBeDefined()
    expect(new URL(manifestUrl!).origin).toBe(unityParentOrigin)
    expect(new URL(manifestUrl!).pathname).toBe('/scene-topology-manifest.json')
    expect(manifestUrl).not.toContain('/api/')
  })

  it('正式包固定来源模式拒绝回环地址和非安全传输地址，运行时模式允许局域网独立访问', () => {
    const sharedArguments = [
      '--package-type', 'standalone-formal', '--listen-host', '0.0.0.0', '--public-origin', 'https://visual.example.com',
      '--platform-parent-origin', 'https://platform.example.com', '--unity-parent-origin', 'https://visual.example.com',
      '--unity-entry-url', 'https://visual.example.com/unity/index.html',
    ]
    expect(readReleaseConfiguration(sharedArguments).manifestUrl).toBe('https://visual.example.com/scene-topology-manifest.json')
    expect(() => readReleaseConfiguration([...sharedArguments, '--manifest-url', 'http://platform.example.com/api/manifest/gas'])).toThrow('必须使用我方公开来源下的同源')
    expect(() => readReleaseConfiguration([
      ...sharedArguments,
      '--manifest-url', 'https://127.0.0.1:8080/api/manifest/gas',
    ])).toThrow('必须使用我方公开来源下的同源')

    const runtimeFormal = readReleaseConfiguration([
      '--package-type', 'standalone-formal', '--listen-host', '0.0.0.0', '--port', '5556',
    ])
    expect(runtimeFormal).toMatchObject({
      addressMode: 'runtime-self-origin',
      publicOrigin: '__RUNTIME_SELF_ORIGIN__',
      platformParentOrigin: '__RUNTIME_PARENT_ORIGIN__',
      unityEntryUrl: '__RUNTIME_SELF_ORIGIN__/unity/index.html',
      manifestUrl: '__RUNTIME_SELF_ORIGIN__/scene-topology-manifest.json',
    })
  })
})

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
  /*
   * 下列顺序逐项对应《通用拓扑图参考0810_AI友好版》第3.1至3.3节。
   * 不能只断言数量：节点或连线被同数量的错误标识替换时，数量断言仍会误通过，
   * 而正式页面会展示不属于当前关键环节的设备或隐藏资料明确要求保留的孤立节点。
   */
  const expectedFlowDefinitions = {
    'topology.gas-power.gas-turbine': {
      nodeIds: [
        'scada-security-gateway', 'operator-station', 'gas-network', 'plant-engineering-station', 'plant-data-station',
        'inlet-duct', 'generator', 'auxiliary-plc', 'grid-output',
        'fuel-gas-pressure-valve', 'fuel-gas-electric-actuator', 'hrsg-drum-level-sensor', 'steam-main-control-valve',
        'generator-outlet-breaker', 'condensate-pump-vfd', 'fuel-gas-leak-detector',
      ],
      edgeIds: [
        'route.dcs-core-to-scada', 'route.dcs-core-to-operator', 'route.dcs-core-to-engineering', 'route.dcs-core-to-performance',
        'route.dcs-core-to-markvie', 'route.dcs-core-to-generator', 'route.dcs-core-to-auxiliary', 'route.dcs-core-to-sil',
        'route.markvie-to-pressure-valve', 'route.markvie-to-actuator', 'route.generator-to-outlet-breaker',
        'route.auxiliary-to-vfd', 'route.sil-to-leak-detector',
      ],
      allowedOrphans: ['hrsg-drum-level-sensor', 'steam-main-control-valve'],
    },
    'topology.gas-power.hrsg': {
      nodeIds: [
        'scada-security-gateway', 'operator-station', 'gas-network', 'plant-engineering-station', 'plant-data-station', 'hrsg',
        'fuel-gas-pressure-valve', 'fuel-gas-electric-actuator', 'hrsg-drum-level-sensor', 'steam-main-control-valve',
        'generator-outlet-breaker', 'condensate-pump-vfd', 'fuel-gas-leak-detector',
      ],
      edgeIds: [
        'route.dcs-core-to-scada', 'route.dcs-core-to-operator', 'route.dcs-core-to-engineering', 'route.dcs-core-to-performance',
        'route.dcs-core-to-hrsg', 'route.hrsg-to-temperature-transmitter',
      ],
      allowedOrphans: [
        'fuel-gas-pressure-valve', 'fuel-gas-electric-actuator', 'steam-main-control-valve',
        'generator-outlet-breaker', 'condensate-pump-vfd', 'fuel-gas-leak-detector',
      ],
    },
    'topology.gas-power.steam-turbine': {
      nodeIds: [
        'scada-security-gateway', 'operator-station', 'gas-network', 'plant-engineering-station', 'plant-data-station',
        'steam-turbine', 'generator', 'auxiliary-plc',
        'fuel-gas-pressure-valve', 'fuel-gas-electric-actuator', 'hrsg-drum-level-sensor', 'steam-main-control-valve',
        'generator-outlet-breaker', 'condensate-pump-vfd', 'fuel-gas-leak-detector',
      ],
      edgeIds: [
        'route.dcs-core-to-scada', 'route.dcs-core-to-operator', 'route.dcs-core-to-engineering', 'route.dcs-core-to-performance',
        'route.dcs-core-to-steam', 'route.dcs-core-to-generator', 'route.dcs-core-to-auxiliary',
        'route.steam-to-main-control-valve', 'route.generator-to-outlet-breaker', 'route.auxiliary-to-vfd',
      ],
      allowedOrphans: [
        'fuel-gas-pressure-valve', 'fuel-gas-electric-actuator', 'hrsg-drum-level-sensor', 'fuel-gas-leak-detector',
      ],
    },
  } as const

  it('关键环节严格复用资料规定的节点和已核验连线集合', async () => {
    const manifest = await createGasOnlyManifest('flow-filter-contract-test')
    const overview = manifest.topologies.find((candidate) => candidate.topologyId === 'topology.gas-power.overview')
    const overviewPositionByNodeId = new Map(overview?.nodes.map((node) => [node.nodeId, { x: node.x, y: node.y }]))
    expect(overview?.nodes).toHaveLength(23)
    expect(overview?.edges).toHaveLength(22)

    for (const [topologyId, expected] of Object.entries(expectedFlowDefinitions)) {
      const topology = manifest.topologies.find((candidate) => candidate.topologyId === topologyId)
      expect(topology?.filter).toBeDefined()
      expect(topology?.nodes).toHaveLength(0)
      expect(topology?.edges).toHaveLength(0)
      // 顺序也是资料事实：画布按总图层级投影时必须保持子表的层级与列内顺序。
      expect(topology?.filter?.visibleNodeIds).toEqual(expected.nodeIds)
      // 子表没有独立连线，所有连线必须是总图已核验连接的精确子集，不得按工艺常识补造。
      expect(topology?.filter?.visibleEdgeIds).toEqual(expected.edgeIds)
      expect(topology?.filter?.allowedOrphanNodeIds ?? []).toEqual(expected.allowedOrphans)
      // 子图不再维护独立坐标表；每个可见节点必须与总图位置完全相同，切换时才不会跳位或漂移层级。
      for (const override of topology?.filter?.nodeLayoutOverrides ?? []) {
        expect({ x: override.x, y: override.y }).toEqual(overviewPositionByNodeId.get(override.nodeId))
      }
    }
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

    // 三个流程视图没有本地节点，只引用总览；平台只能绑定总览源节点，不能为流程视图重复生成设备关系。
    const filteredTopologies = manifest.topologies.filter((topology) => topology.filter !== undefined)
    expect(filteredTopologies).toHaveLength(3)
    expect(filteredTopologies.every((topology) => topology.nodes.length === 0 && topology.filter?.sourceTopologyId === overview?.topologyId)).toBe(true)
  })

  it('总览按钮只通过已登记动作恢复 Unity 总览和完整拓扑', async () => {
    const manifest = await createGasOnlyManifest('overview-contract-test')
    const overviewAction = manifest.actions.find((action) => action.actionId === 'action.gas-power.overview')
    const gasScene = manifest.scenes.find((scene) => scene.sceneId === 'gas-power')
    const gasUnityMapping = manifest.unitySceneMappings.find((mapping) => mapping.sceneId === 'gas-power')
    const hostPage = createSelfTestPage(manifest.manifestVersion)

    expect(overviewAction).toMatchObject({
      targetSceneId: 'gas-power',
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
    expect(hostPage).toContain("triggerWorkflow('action.gas-power.overview')")
    expect(hostPage).not.toContain("actionId: null,\n              expectedContextRevision")
    // 成功文案还必须核对视图变更携带的动作标识，不能让同名二维总图误报为三维已经复位。
    expect(hostPage).toContain("message.payload?.actionId === 'action.gas-power.overview'")
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

    // 内部自测页必须继续保留四项动作和稳定状态回归所需的消息处理逻辑。
    expect(selfTestPage).toContain('外部流程触发测试')
    expect(selfTestPage).toContain('data-action-id="action.gas-power.gas-turbine"')
    expect(selfTestPage).toContain('data-overview-command')
    expect(selfTestPage).toContain("triggerWorkflow('action.gas-power.overview')")
    expect(selfTestPage).toContain('test-status')
  })

  it('平台构建默认不交付自测页，内部验证必须显式启用', () => {
    // 默认关闭是交付安全边界，避免调用者忘记参数时把内部按钮页带入平台目录。
    expect(readReleaseConfiguration([]).includeSelfTest).toBe(false)
    expect(readReleaseConfiguration(['--include-self-test', 'true']).includeSelfTest).toBe(true)
    expect(() => readReleaseConfiguration(['--include-self-test', 'yes'])).toThrow('只能是 true 或 false')
  })

  it('合作方联调包显式区分监听地址与三层公开来源', () => {
    const configuration = readReleaseConfiguration([
      '--package-type', 'partner-integration',
      '--listen-host', '0.0.0.0',
      '--port', '5555',
      '--public-origin', 'http://visual.example.com',
      '--platform-parent-origin', 'http://platform.example.com',
      '--unity-parent-origin', 'http://visual.example.com',
      '--unity-entry-url', 'http://visual.example.com/unity/index.html',
    ])

    expect(configuration).toMatchObject({
      packageType: 'partner-integration',
      listenHost: '0.0.0.0',
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
      addressMode: 'runtime-self-origin',
      publicOrigin: '__RUNTIME_SELF_ORIGIN__',
      platformParentOrigin: '__RUNTIME_PARENT_ORIGIN__',
      unityEntryUrl: '__RUNTIME_SELF_ORIGIN__/unity/index.html',
      manifestUrl: '__RUNTIME_SELF_ORIGIN__/scene-topology-manifest.json',
    })
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

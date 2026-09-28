import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { toSceneId, toSceneNodeId } from '../src/config/scene-topology/identifiers'
import { TopologyRegistry } from '../src/config/scene-topology/topology-registry'
import { validateSceneTopologyManifest } from '../src/config/scene-topology/validator'
import { LOCAL_PROCESS_CONFIG_VERSION } from '../src/config/process/config-version'
import { createConfiguredPowerScenesManifest, createSelfTestPage } from '../scripts/build-gas-power-smoke-release.mjs'
import { coalPowerEdgeColors } from '../scripts/coal-power-topology.mjs'

/** 七个已交付场景只允许使用资料和 Unity 属性面板已经核验的三十九对映射，测试不得按名称自动扩充。 */
const verifiedMappings = Object.freeze([
  Object.freeze({ sceneId: 'gas-power', nodeId: 'system.gas-turbine-control', sceneNodeId: 'unit.gas-turbine.control' }),
  Object.freeze({ sceneId: 'gas-power', nodeId: 'system.gas-hrsg-control', sceneNodeId: 'unit.gas-hrsg.control' }),
  Object.freeze({ sceneId: 'gas-power', nodeId: 'system.gas-steam-turbine-control', sceneNodeId: 'unit.gas-steam-turbine.control' }),
  Object.freeze({ sceneId: 'gas-power', nodeId: 'system.gas-generator-control', sceneNodeId: 'unit.gas-generator.control' }),
  Object.freeze({ sceneId: 'gas-power', nodeId: 'asset.gas-turbine', sceneNodeId: 'node.gas-turbine' }),
  Object.freeze({ sceneId: 'gas-power', nodeId: 'asset.gas-hrsg', sceneNodeId: 'node.gas-hrsg' }),
  Object.freeze({ sceneId: 'gas-power', nodeId: 'asset.gas-steam-turbine', sceneNodeId: 'node.gas-steam-turbine' }),
  Object.freeze({ sceneId: 'gas-power', nodeId: 'asset.gas-generator', sceneNodeId: 'node.gas-generator' }),
  Object.freeze({ sceneId: 'coal-power', nodeId: 'asset.coal-mill-actuator', sceneNodeId: 'node.coal-feeder' }),
  Object.freeze({ sceneId: 'coal-power', nodeId: 'system.coal-boiler-control', sceneNodeId: 'unit.coal-boiler.control' }),
  Object.freeze({ sceneId: 'coal-power', nodeId: 'system.coal-steam-turbine-control', sceneNodeId: 'unit.coal-steam-turbine.control' }),
  Object.freeze({ sceneId: 'coal-power', nodeId: 'system.coal-generator-control', sceneNodeId: 'unit.coal-generator.control' }),
  Object.freeze({ sceneId: 'coal-power', nodeId: 'asset.coal-boiler', sceneNodeId: 'node.coal-boiler' }),
  Object.freeze({ sceneId: 'coal-power', nodeId: 'asset.coal-steam-turbine', sceneNodeId: 'node.coal-steam-turbine' }),
  Object.freeze({ sceneId: 'coal-power', nodeId: 'asset.coal-generator', sceneNodeId: 'node.coal-generator' }),
  Object.freeze({ sceneId: 'coal-power', nodeId: 'system.coal-handling-ash-plc', sceneNodeId: 'node.coal-precipitator' }),
  Object.freeze({ sceneId: 'solar-power', nodeId: 'system.solar-inverter-control', sceneNodeId: 'unit.solar-inverter.control' }),
  Object.freeze({ sceneId: 'solar-power', nodeId: 'asset.solar-inverter', sceneNodeId: 'node.solar-inverter' }),
])

/**
 * 组态文件包含换行及中英文括号混排；名称契约只折叠这些视觉排版差异，不做同义词替换。
 * 清单额外增加的场景前缀和同场景位置限定词也在比较前移除，基础设备名必须逐字命中当前拓扑。
 */
function normalizeTopologyTitle(title: string): string {
  return title.replace(/\s+/g, '').replace(/\(/g, '（').replace(/\)/g, '）')
}

function readVisibleTopologyTitles(relativePath: string): ReadonlySet<string> {
  const topology = JSON.parse(readFileSync(`${process.cwd()}/${relativePath}`, 'utf8')) as {
    readonly pens?: readonly { readonly text?: unknown }[]
  }
  return new Set((topology.pens ?? [])
    .map((pen) => typeof pen.text === 'string' ? normalizeTopologyTitle(pen.text) : '')
    .filter(Boolean))
}

function readManifestBaseTitle(title: string): string {
  return normalizeTopologyTitle(title
    .replace(/^(?:燃气|燃煤)-/, '')
    .replace(/（(?:企业办公网|监控层|监控层主|监控层备|机组|辅控|性能)）$/, ''))
}

describe('燃气、燃煤与光伏联合场景清单', () => {
  it('本地自测可见按钮恰好覆盖全部公开动作，包含风机和齿轮箱关键环节', async () => {
    const manifest = await createConfiguredPowerScenesManifest('self-test-complete-action-coverage')
    const page = createSelfTestPage(manifest.manifestVersion)
    // 只读取真实按钮的动作属性，不能让脚本白名单中的标识掩盖页面缺少入口的问题。
    // 数组精确相等同时阻止漏项、多项和重复项，预期集合来自本次正式联合清单。
    const visibleActionIds = Array.from(page.matchAll(/<button\b[^>]*\bdata-action-id="([^"]+)"/g), (match) => match[1])
    expect(visibleActionIds.sort()).toEqual(manifest.actions.map((action) => action.actionId).sort())
    expect(page).toContain('覆盖当前发布清单的全部公开动作')
  })

  it('光伏发布场景只选择运行时登记，自测页仍从沙盘开始', async () => {
    const manifest = await createConfiguredPowerScenesManifest('solar-runtime-selection-contract', 'solar-power')
    expect(manifest.unityRuntimeKey).toBe('solar-plant-release')
    expect(manifest.actions.find((action) => action.actionId === 'action.solar-power.overview')?.targetSceneId).toBe('solar-power')
    expect(createSelfTestPage(manifest.manifestVersion)).toContain("sceneId: 'overview'")
    expect(() => createSelfTestPage(manifest.manifestVersion, 'invalid-scene')).toThrow('只能是 gas-power 或 coal-power')
  })

  it('在同一原子清单中装配三场景总览和十六项已核验第三层', async () => {
    const manifest = await createConfiguredPowerScenesManifest('dual-selection-contract', 'coal-power')

    expect(validateSceneTopologyManifest(manifest)).toEqual([])
    expect(manifest.unityRuntimeKey).toBe('coal-plant-release')
    expect(manifest.topologies.filter((topology) => topology.sceneId === 'gas-power')).toHaveLength(1)
    expect(manifest.topologies.filter((topology) => topology.sceneId === 'coal-power')).toHaveLength(1)
    expect(manifest.actions.filter((action) => action.targetSceneId === 'gas-power')).toHaveLength(2)
    expect(manifest.actions.filter((action) => action.targetSceneId === 'coal-power')).toHaveLength(2)
    expect(manifest.actions.filter((action) => action.targetSceneId === 'solar-power')).toHaveLength(2)
    expect(manifest.actions).toHaveLength(25)
    expect(manifest.actions.find((action) => action.actionId === 'action.scene.overview')).toEqual({
      actionId: 'action.scene.overview',
      title: '返回全局总览',
      targetSceneId: 'overview',
      targetViewMode: 'overview',
      allowedParameters: [],
      unityAction: { type: 'none' },
      failurePolicy: 'keep-current-context',
      configVersion: manifest.manifestVersion,
    })
    // 新版产品范围取消流程子图和下钻；联合清单必须发布空的下钻集合，避免旧入口被协议直接调用。
    expect(manifest.drilldowns).toEqual([])
    expect(manifest.processDetails.filter((detail) => ['gas-power', 'coal-power', 'wind-power'].includes(detail.sceneId))).toEqual([{
      sceneId: 'gas-power',
      processId: 'gas-power-generation',
      stepId: 'gas-turbine',
      processDetailId: 'process-detail.gas-power.gas-turbine',
      resourceId: 'process-detail-resource.gas-power.gas-turbine',
      cameraPoseId: 'camera-pose.gas-power.gas-turbine',
      stateNodeId: 'node.gas-turbine',
      topologyDataContextId: 'process-detail.gas-power.gas-turbine',
    }, {
      sceneId: 'coal-power',
      processId: 'coal-power-generation',
      stepId: 'steam-turbine',
      processDetailId: 'process-detail.coal-power.steam-turbine',
      resourceId: 'process-detail-resource.coal-power.steam-turbine',
      cameraPoseId: 'camera-pose.coal-power.steam-turbine',
      stateNodeId: 'node.coal-steam-turbine',
      topologyDataContextId: 'process-detail.coal-power.steam-turbine',
    }, {
      sceneId: 'wind-power',
      processId: 'wind-power-generation',
      stepId: 'wind-turbine',
      processDetailId: 'process-detail.wind-power.wind-turbine',
      resourceId: 'process-detail-resource.wind-power.wind-turbine',
      cameraPoseId: 'camera-pose.wind-power.wind-turbine',
      stateNodeId: 'node.wind-turbine',
      topologyDataContextId: 'process-detail.wind-power.wind-turbine',
    }, {
      sceneId: 'wind-power',
      processId: 'wind-power-generation',
      stepId: 'gearbox',
      processDetailId: 'process-detail.wind-power.gearbox',
      resourceId: 'process-detail-resource.wind-power.gearbox',
      cameraPoseId: 'camera-pose.wind-power.gearbox',
      stateNodeId: 'node.wind-gearbox',
      topologyDataContextId: 'process-detail.wind-power.gearbox',
    }])
    expect(manifest.processDetails.filter((detail) => detail.sceneId === 'step-up-substation')).toHaveLength(3)
    expect(manifest.processDetails.filter((detail) => detail.sceneId === 'step-down-substation')).toHaveLength(3)
    expect(manifest.processDetails.filter((detail) => detail.sceneId === 'converter-station')).toHaveLength(3)
    expect(manifest.processDetails).toHaveLength(16)
    expect(manifest.processDetails.filter((detail) => detail.sceneId === 'wind-power')).toHaveLength(2)
    expect(manifest.processDetails.filter((detail) => detail.sceneId === 'switching-station')).toHaveLength(2)

    const gasOverview = manifest.topologies.find((topology) => topology.topologyId === 'topology.gas-power.overview')
    const coalOverview = manifest.topologies.find((topology) => topology.topologyId === 'topology.coal-power.overview')
    expect([gasOverview?.nodes.length, gasOverview?.edges.length]).toEqual([23, 22])
    expect([coalOverview?.nodes.length, coalOverview?.edges.length]).toEqual([27, 27])
    const solarOverview = manifest.topologies.find((topology) => topology.topologyId === 'topology.solar-power.overview')
    expect([solarOverview?.nodes.length, solarOverview?.edges.length]).toEqual([2, 0])
  })

  it('对外节点名称使用当前拓扑名称并显式区分燃气与燃煤场景', async () => {
    const manifest = await createConfiguredPowerScenesManifest('scene-qualified-node-title-contract')
    const gasOverview = manifest.topologies.find((topology) => topology.topologyId === 'topology.gas-power.overview')
    const coalOverview = manifest.topologies.find((topology) => topology.topologyId === 'topology.coal-power.overview')
    const gasTitlesByNodeId = new Map(gasOverview?.nodes.map((node) => [node.nodeId, node.title]))
    const coalTitlesByNodeId = new Map(coalOverview?.nodes.map((node) => [node.nodeId, node.title]))

    /**
     * 合作方可能脱离 sceneId（场景标识）单独展示节点名称，因此所有名称必须自带场景前缀。
     * 同时锁定拓扑图中跨场景重复出现的核心设备，避免回退为“发电机”等无法判别归属的裸名称。
     */
    expect([...gasTitlesByNodeId.values()].every((title) => title.startsWith('燃气-'))).toBe(true)
    expect([...coalTitlesByNodeId.values()].every((title) => title.startsWith('燃煤-'))).toBe(true)
    expect(gasTitlesByNodeId.get('asset.gas-generator')).toBe('燃气-发电机')
    expect(coalTitlesByNodeId.get('asset.coal-generator')).toBe('燃煤-发电机')
    expect(gasTitlesByNodeId.get('asset.gas-steam-turbine')).toBe('燃气-蒸汽轮机')
    expect(coalTitlesByNodeId.get('asset.coal-steam-turbine')).toBe('燃煤-汽轮机')
    expect(gasTitlesByNodeId.get('historian-data-server')).toBe('燃气-历史服务器')
    expect(coalTitlesByNodeId.get('system.pi-historian')).toBe('燃煤-历史服务器')

    /**
     * 直接读取当前默认拓扑文件建立可见文字集合。每个清单基础名称必须命中该集合，
     * 以后拓扑改名却遗漏发布源时，本测试会在打包前失败，阻断旧名称再次交付。
     */
    const gasVisibleTitles = readVisibleTopologyTitles('public/topology/gas-v3-json-preview/variants/network-business-key-process/topology.json')
    const coalVisibleTitles = readVisibleTopologyTitles('public/topology/coal-json-preview/variants/network-business-key-process/topology.json')
    expect([...gasTitlesByNodeId.values()].every((title) => gasVisibleTitles.has(readManifestBaseTitle(title)))).toBe(true)
    expect([...coalTitlesByNodeId.values()].every((title) => coalVisibleTitles.has(readManifestBaseTitle(title)))).toBe(true)

    // 名称变更只能影响 title；稳定编号、二维数量、三维映射和整份清单结构仍须通过原有契约。
    expect(gasTitlesByNodeId).toHaveLength(23)
    expect(coalTitlesByNodeId).toHaveLength(27)
    expect(validateSceneTopologyManifest(manifest)).toEqual([])
  })

  it('燃气总览逐条复用燃煤的灰蓝绿橙连线分类和虚线规则', async () => {
    const manifest = await createConfiguredPowerScenesManifest('gas-edge-style-contract')
    const gasOverview = manifest.topologies.find((topology) => topology.topologyId === 'topology.gas-power.overview')
    const edgesById = new Map(gasOverview?.edges.map((edge) => [edge.edgeId, edge]))
    const expectedColors = [
      ...Array.from({ length: 2 }, () => coalPowerEdgeColors.gray),
      ...Array.from({ length: 7 }, () => coalPowerEdgeColors.blue),
      ...Array.from({ length: 6 }, () => coalPowerEdgeColors.green),
      ...Array.from({ length: 7 }, () => coalPowerEdgeColors.orange),
    ]
    const expectedStyles = [
      ...Array.from({ length: 14 }, () => 'solid'),
      'dashed',
      ...Array.from({ length: 7 }, () => 'solid'),
    ]

    expect(gasOverview?.edges).toHaveLength(22)
    expect(gasOverview?.edges.map((edge) => edge.lineColor)).toEqual(expectedColors)
    expect(gasOverview?.edges.map((edge) => edge.lineStyle)).toEqual(expectedStyles)
    expect(edgesById.get('route.dcs-core-to-sil')).toEqual(expect.objectContaining({
      lineColor: coalPowerEdgeColors.green,
      lineStyle: 'dashed',
    }))
  })

  it('十六对显式映射均可常数时间反查且不会产生额外猜测映射', async () => {
    const manifest = await createConfiguredPowerScenesManifest('dual-selection-reverse-index')
    const result = TopologyRegistry.create(manifest)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    for (const mapping of verifiedMappings) {
      expect(result.registry.getNodeIdForSceneNode(
        toSceneId(mapping.sceneId),
        toSceneNodeId(mapping.sceneNodeId),
      )).toBe(mapping.nodeId)
    }

    const publishedMappedNodes = manifest.topologies
      .filter((topology) => topology.filter === undefined && ['gas-power', 'coal-power', 'solar-power'].includes(topology.sceneId))
      .flatMap((topology) => topology.nodes.filter((node) => node.sceneNodeId !== undefined))
    expect(publishedMappedNodes).toHaveLength(verifiedMappings.length)
  })

  it('发布场景选择只改变运行时入口别名而不裁剪另一场景内容', async () => {
    const [gasInitial, coalInitial, solarInitial] = await Promise.all([
      createConfiguredPowerScenesManifest('dual-selection-initial-gas', 'gas-power'),
      createConfiguredPowerScenesManifest('dual-selection-initial-coal', 'coal-power'),
      createConfiguredPowerScenesManifest('dual-selection-initial-solar', 'solar-power'),
    ])

    expect(gasInitial.unityRuntimeKey).toBe('gas-plant-release')
    expect(coalInitial.unityRuntimeKey).toBe('coal-plant-release')
    expect(solarInitial.unityRuntimeKey).toBe('solar-plant-release')
    for (const manifest of [gasInitial, coalInitial, solarInitial]) {
      expect(manifest.scenes.find((scene) => scene.sceneId === 'gas-power')?.topologyIds).toEqual(['topology.gas-power.overview'])
      expect(manifest.scenes.find((scene) => scene.sceneId === 'coal-power')?.topologyIds).toEqual(['topology.coal-power.overview'])
      expect(manifest.scenes.find((scene) => scene.sceneId === 'gas-power')?.supportedActionIds).toEqual([
        'action.gas-power.overview',
        'action.gas-power.gas-turbine',
      ])
      expect(manifest.scenes.find((scene) => scene.sceneId === 'coal-power')?.supportedActionIds).toEqual([
        'action.coal-power.overview',
        'action.coal-power.steam-turbine',
      ])
      expect(manifest.scenes.find((scene) => scene.sceneId === 'solar-power')?.supportedActionIds).toEqual([
        'action.solar-power.overview',
        'action.solar-power.inverter',
      ])
      /**
       * 合作方菜单只消费动作清单；风电已登记总览、风机和齿轮箱两个并列控制模拟，开关站登记总览、母线保护和线路保护，另外三个变电场景各登记三项保护关键环节。
       * processSteps（流程步骤）字段必须不存在，防止导航兼容层被误解为控制器已实现的工艺能力。
       */
      for (const sceneId of ['wind-power']) {
        const actionId = `action.${sceneId}.overview`
        expect(manifest.scenes.find((scene) => scene.sceneId === sceneId)?.supportedActionIds).toEqual([
          actionId,
          'action.wind-power.wind-turbine',
          'action.wind-power.gearbox',
        ])
        expect(manifest.unitySceneMappings.find((mapping) => mapping.sceneId === sceneId)).not.toHaveProperty('processSteps')
        expect(manifest.actions.find((action) => action.actionId === actionId)).toEqual(expect.objectContaining({
          targetSceneId: sceneId,
          targetViewMode: 'business',
          targetTopologyId: `topology.${sceneId}.overview`,
          allowedParameters: [],
          unityAction: ['step-up-substation', 'step-down-substation', 'converter-station', 'switching-station'].includes(sceneId)
            ? { type: 'resetScene' }
            : { type: 'none' },
          failurePolicy: 'keep-current-context',
        }))
      }
      expect(manifest.scenes.find((scene) => scene.sceneId === 'switching-station')?.supportedActionIds).toEqual([
        'action.switching-station.overview',
        'action.switching-station.busbar-protection',
        'action.switching-station.line-protection',
      ])
      expect(manifest.actions.filter((action) => action.targetSceneId === 'switching-station' && action.targetViewMode === 'process-detail')).toHaveLength(2)
      expect(manifest.unitySceneMappings.find((mapping) => mapping.sceneId === 'switching-station')).not.toHaveProperty('processSteps')
      for (const sceneId of ['step-up-substation', 'step-down-substation', 'converter-station']) {
        expect(manifest.scenes.find((scene) => scene.sceneId === sceneId)?.supportedActionIds).toHaveLength(4)
        expect(manifest.actions.filter((action) => action.targetSceneId === sceneId && action.targetViewMode === 'process-detail')).toHaveLength(3)
      }
    }
  })

  it('发布清单映射版本必须与内嵌框架传给 Unity 的运行时版本一致', async () => {
    const manifest = await createConfiguredPowerScenesManifest('scene-mapping-version-lock')

    /*
     * runtime-registry（运行时登记表）会将 LOCAL_PROCESS_CONFIG_VERSION 写入 Unity iframe
     * 的 sceneMappingVersion 查询参数；这里锁定其与所有发布场景、映射条目的值一致。
     * 任一处升级遗漏都会在构建前失败，避免重现 Unity 拒绝场景切换的线上问题。
     */
    expect(manifest.scenes.map((scene) => scene.sceneMappingVersion))
      .toEqual(Array.from({ length: manifest.scenes.length }, () => LOCAL_PROCESS_CONFIG_VERSION))
    expect(manifest.unitySceneMappings.map((mapping) => mapping.mappingVersion))
      .toEqual(Array.from({ length: manifest.unitySceneMappings.length }, () => LOCAL_PROCESS_CONFIG_VERSION))
  })
})

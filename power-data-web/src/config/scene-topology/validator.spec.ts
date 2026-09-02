import { describe, expect, it } from 'vitest'
import {
  toActionId,
  SCENE_IDS,
  toNodeId,
  toRouteId,
  toSceneId,
  toSceneNodeId,
  toTopologyId,
  toUnityRuntimeKey,
  toUnitySceneKey,
} from '@/config/scene-topology/identifiers'
import { SceneTopologyManifestLoader } from '@/config/scene-topology/loader'
import type { SceneTopologyManifest } from '@/config/scene-topology/types'
import { MAX_DEVICE_STATE_SCENE_NODE_TARGETS_PER_SCENE, validateSceneTopologyManifest } from '@/config/scene-topology/validator'

const manifestVersion = 'node-protocol-test.1'

/**
 * 构造一份九场景、单燃气来源拓扑的完整清单。
 * 测试只使用逻辑 nodeId（节点标识）；真实设备编号属于平台自己的映射表，不出现在夹具中。
 */
function createValidManifest(options: { gasNodes?: SceneTopologyManifest['topologies'][number]['nodes']; gasEdges?: SceneTopologyManifest['topologies'][number]['edges']; flow?: SceneTopologyManifest['topologies'][number] } = {}): SceneTopologyManifest {
  const gasOverviewId = toTopologyId('topology.gas-power.overview')
  const gasNodes = options.gasNodes ?? [
    {
      nodeId: toNodeId('node.gas.turbine'),
      title: '燃气轮机',
      sceneNodeId: toSceneNodeId('scene-node.gas.turbine'),
      iconKey: 'gas-turbine',
      x: 30,
      y: 50,
      deviceStatus: 'offline' as const,
      doubleClickBehavior: 'emit-node' as const,
    },
    {
      nodeId: toNodeId('node.gas.generator'),
      title: '发电机',
      sceneNodeId: toSceneNodeId('scene-node.gas.generator'),
      iconKey: 'generator',
      x: 70,
      y: 50,
      deviceStatus: 'offline' as const,
      doubleClickBehavior: 'emit-node' as const,
    },
  ]
  const gasEdges = options.gasEdges ?? [{
    edgeId: toRouteId('route.gas.turbine-generator'),
    fromNodeId: gasNodes[0]!.nodeId,
    toNodeId: gasNodes[1]!.nodeId,
    title: '机械连接',
  }]
  const scenes = SCENE_IDS.map((sceneId) => {
    const topologyId = toTopologyId(`topology.${sceneId}.overview`)
    return {
      sceneId,
      title: `测试场景-${sceneId}`,
      unitySceneKey: toUnitySceneKey(`scene.${sceneId}`),
      defaultTopologyId: topologyId,
      topologyIds: [topologyId],
      supportedActionIds: [],
      sceneMappingVersion: `${manifestVersion}.${sceneId}`,
      resourceVersion: `${manifestVersion}.${sceneId}`,
      switchStrategy: 'unload-first' as const,
    }
  })
  const topologies = scenes.map((scene) => scene.sceneId === 'gas-power'
    ? {
        topologyId: gasOverviewId,
        sceneId: scene.sceneId,
        title: '燃气总览',
        configVersion: manifestVersion,
        nodes: gasNodes,
        edges: gasEdges,
      }
    : {
        topologyId: scene.defaultTopologyId,
        sceneId: scene.sceneId,
        title: `测试拓扑-${scene.sceneId}`,
        configVersion: manifestVersion,
        nodes: [],
        edges: [],
      })
  return {
    manifestVersion,
    unityBuildId: 'node-protocol-build.1',
    unityRuntimeKey: toUnityRuntimeKey('node-protocol-runtime'),
    scenes,
    topologies: options.flow ? [...topologies, options.flow] : topologies,
    actions: [],
    unitySceneMappings: scenes.map((scene) => ({
      sceneId: scene.sceneId,
      mappingVersion: scene.sceneMappingVersion,
      processSteps: [],
      sceneNodeIds: scene.sceneId === 'gas-power' ? gasNodes.flatMap((node) => node.sceneNodeId ? [node.sceneNodeId] : []) : [],
      routeIds: [],
    })),
  }
}

function issueCodes(manifest: unknown): readonly string[] {
  return validateSceneTopologyManifest(manifest).map((issue) => issue.code)
}

describe('场景拓扑节点协议清单校验', () => {
  it('接受九场景闭集和节点主键清单', () => {
    expect(validateSceneTopologyManifest(createValidManifest())).toEqual([])
  })

  it('接受总览重点区域，并拒绝未绑定锚点或关键环节区域声明', () => {
    const baseManifest = createValidManifest()
    const gasTopology = baseManifest.topologies.find((topology) => topology.sceneId === 'gas-power')!
    const flowTopologyId = toTopologyId('topology.gas-power.focus-flow')
    const manifest = {
      ...baseManifest,
      scenes: baseManifest.scenes.map((scene) => scene.sceneId === 'gas-power'
        ? { ...scene, topologyIds: [...scene.topologyIds, flowTopologyId] }
        : scene),
      topologies: [
        ...baseManifest.topologies.map((topology) => topology === gasTopology
          ? {
              ...topology,
              focusRegions: [{
                regionId: 'focus.gas-control',
                anchorNodeId: gasTopology.nodes[0]!.nodeId,
                nodeIds: [gasTopology.nodes[0]!.nodeId, gasTopology.nodes[1]!.nodeId],
                label: '燃机控制区域',
              }],
            }
          : topology),
        {
          topologyId: flowTopologyId,
          sceneId: toSceneId('gas-power'),
          title: '重点区域过滤视图',
          configVersion: manifestVersion,
          nodes: [],
          edges: [],
          filter: {
            sourceTopologyId: gasTopology.topologyId,
            visibleNodeIds: [gasTopology.nodes[0]!.nodeId, gasTopology.nodes[1]!.nodeId],
            visibleEdgeIds: [gasTopology.edges[0]!.edgeId],
            nodeLayoutOverrides: [
              { nodeId: gasTopology.nodes[0]!.nodeId, x: 30, y: 50 },
              { nodeId: gasTopology.nodes[1]!.nodeId, x: 70, y: 50 },
            ],
          },
        },
      ],
    }
    expect(validateSceneTopologyManifest(manifest)).toEqual([])

    const invalid = structuredClone(manifest) as unknown as Record<string, unknown>
    const invalidOverview = (invalid.topologies as Array<Record<string, unknown>>).find((topology) => topology.topologyId === gasTopology.topologyId)!
    const invalidFlow = (invalid.topologies as Array<Record<string, unknown>>).find((topology) => topology.topologyId === flowTopologyId)!
    invalidFlow.focusRegions = [{
      regionId: 'focus.invalid-on-flow',
      anchorNodeId: gasTopology.nodes[0]!.nodeId,
      nodeIds: [gasTopology.nodes[0]!.nodeId],
    }]
    const invalidOverviewNodes = invalidOverview.nodes as Array<Record<string, unknown>>
    delete invalidOverviewNodes[0]!.sceneNodeId
    invalidOverview.focusRegions = [{
      regionId: 'focus.invalid-anchor',
      anchorNodeId: gasTopology.nodes[0]!.nodeId,
      nodeIds: [gasTopology.nodes[0]!.nodeId],
    }]
    const invalidCodes = issueCodes(invalid)
    expect(invalidCodes).toContain('topology.focus-region-anchor-binding')
    expect(invalidCodes).toContain('topology.filter-focus-regions')
  })

  it('接受资料声明的连线颜色与线型，并拒绝非法样式值', () => {
    const manifest = createValidManifest()
    const gasTopology = manifest.topologies.find((topology) => topology.sceneId === 'gas-power')!
    const styledManifest: SceneTopologyManifest = {
      ...manifest,
      topologies: manifest.topologies.map((topology) => topology === gasTopology
        ? {
            ...topology,
            edges: [{ ...topology.edges[0]!, lineColor: '#3b82f6', lineStyle: 'dashed' as const }],
          }
        : topology),
    }
    expect(validateSceneTopologyManifest(styledManifest)).toEqual([])

    const invalid = structuredClone(styledManifest) as unknown as Record<string, unknown>
    const invalidGasTopology = (invalid.topologies as Array<Record<string, unknown>>).find((topology) => topology.sceneId === 'gas-power')!
    invalidGasTopology.edges = [{ ...(invalidGasTopology.edges as Array<Record<string, unknown>>)[0], lineColor: 'blue', lineStyle: 'dot' }]
    expect(issueCodes(invalid)).toEqual(expect.arrayContaining(['topology.edge-line-color', 'topology.edge-line-style']))
  })

  it('严格拒绝旧设备映射、平台绑定计数、运行时清单和节点设备编号字段', () => {
    const manifest = createValidManifest() as unknown as Record<string, unknown>
    manifest.deviceMappings = []
    manifest.platformBindingCount = 0
    manifest.runtimeManifest = {}
    const gasTopology = (manifest.topologies as Array<Record<string, unknown>>).find((topology) => topology.sceneId === 'gas-power')!
    gasTopology.nodes = [{ ...(gasTopology.nodes as Array<Record<string, unknown>>)[0], deviceId: 'node.legacy' }]
    const codes = issueCodes(manifest)
    expect(codes).toEqual(expect.arrayContaining([
      'manifest.legacy-device-identifier',
      'manifest.legacy-device-mapping',
      'manifest.legacy-binding-metadata',
      'manifest.legacy-runtime-manifest',
    ]))
  })

  it('递归拒绝任意层级、大小写和分隔符变体的旧绑定职责', () => {
    const flowTopologyId = toTopologyId('topology.gas-power.flow')
    const actionId = toActionId('action.gas-power.reset')
    const baseManifest = createValidManifest({
      flow: {
        topologyId: flowTopologyId,
        sceneId: toSceneId('gas-power'),
        title: '燃气流程',
        configVersion: manifestVersion,
        nodes: [],
        edges: [],
        filter: {
          sourceTopologyId: toTopologyId('topology.gas-power.overview'),
          visibleNodeIds: [toNodeId('node.gas.turbine'), toNodeId('node.gas.generator')],
          visibleEdgeIds: [toRouteId('route.gas.turbine-generator')],
          nodeLayoutOverrides: [
            { nodeId: toNodeId('node.gas.turbine'), x: 30, y: 50 },
            { nodeId: toNodeId('node.gas.generator'), x: 70, y: 50 },
          ],
        },
      },
    })
    const validManifest: SceneTopologyManifest = {
      ...baseManifest,
      scenes: baseManifest.scenes.map((scene) => scene.sceneId === 'gas-power'
        ? { ...scene, topologyIds: [...scene.topologyIds, flowTopologyId], supportedActionIds: [actionId] }
        : scene),
      actions: [{
        actionId,
        title: '燃气复位',
        targetSceneId: toSceneId('gas-power'),
        // 该夹具验证第二层旧动作仍遵守新版显式视图模式契约。
        targetViewMode: 'business',
        targetTopologyId: toTopologyId('topology.gas-power.overview'),
        allowedParameters: [],
        unityAction: { type: 'resetScene' },
        failurePolicy: 'keep-current-context',
        configVersion: manifestVersion,
      }],
    }
    expect(validateSceneTopologyManifest(validManifest)).toEqual([])

    type MutableManifest = Record<string, unknown>
    const cases: ReadonlyArray<{
      code: string
      field: string
      select: (manifest: MutableManifest) => Record<string, unknown>
    }> = [
      { code: 'manifest.legacy-device-identifier', field: 'DeviceId', select: (manifest) => manifest },
      { code: 'manifest.legacy-device-identifier', field: 'selected-device-id', select: (manifest) => (manifest.scenes as Record<string, unknown>[])[0]! },
      { code: 'manifest.legacy-device-mapping', field: 'DEVICE_MAPPINGS', select: (manifest) => (manifest.topologies as Record<string, unknown>[])[0]! },
      { code: 'manifest.legacy-device-identifier', field: 'selectedDeviceId', select: (manifest) => ((manifest.topologies as Record<string, unknown>[]).find((topology) => topology.sceneId === 'gas-power')!.nodes as Record<string, unknown>[])[0]! },
      { code: 'manifest.legacy-runtime-manifest', field: 'injected.runtime.manifest', select: (manifest) => ((manifest.topologies as Record<string, unknown>[]).find((topology) => topology.filter)!.filter as Record<string, unknown>) },
      { code: 'manifest.legacy-binding-metadata', field: 'bindingRevision', select: (manifest) => (manifest.actions as Record<string, unknown>[])[0]! },
      { code: 'manifest.legacy-device-identifier', field: 'platformInjectsDeviceIds', select: (manifest) => ((manifest.actions as Record<string, unknown>[])[0]!.unityAction as Record<string, unknown>) },
      { code: 'manifest.legacy-device-mapping', field: 'DeviceMappings', select: (manifest) => (manifest.unitySceneMappings as Record<string, unknown>[])[0]! },
    ]

    for (const testCase of cases) {
      const candidate = structuredClone(validManifest) as unknown as MutableManifest
      testCase.select(candidate)[testCase.field] = '旧字段不得进入运行时'
      expect(issueCodes(candidate), testCase.field).toEqual([testCase.code])
    }
  })

  it('保留合法节点字段和安全扩展，只按键名拒绝旧职责且不会递归溢出', () => {
    const manifest = createValidManifest() as unknown as Record<string, unknown>
    const extension: Record<string, unknown> = {
      deviceStatusPalette: { offline: '#888888' },
      deviceIdentity: '仅为普通扩展名称，不是设备编号字段',
      note: '字段值提到 deviceId 不得触发键名规则',
    }
    extension.self = extension
    manifest.extensions = extension

    expect(validateSceneTopologyManifest(manifest)).toEqual([])
  })

  it('旧字段清单不会替换加载器最近一次合法快照', () => {
    const loader = new SceneTopologyManifestLoader()
    const validManifest = createValidManifest()
    expect(loader.load(validManifest).status).toBe('ready')

    const invalidManifest = structuredClone(validManifest) as unknown as Record<string, unknown>
    invalidManifest.selectedDeviceId = 'legacy-device'
    expect(loader.load(invalidManifest)).toMatchObject({
      status: 'invalid',
      issues: [{ code: 'manifest.legacy-device-identifier' }],
    })
    expect(loader.getLastValidManifest()).toBe(validManifest)
  })

  it('要求来源拓扑所有节点统一声明 emit-node，并保证 nodeId 与 sceneNodeId 唯一', () => {
    const manifest = createValidManifest()
    const gasTopology = manifest.topologies.find((topology) => topology.sceneId === 'gas-power')!
    const duplicateNode = { ...gasTopology.nodes[1]!, nodeId: gasTopology.nodes[0]!.nodeId, doubleClickBehavior: 'none' as const }
    const duplicateSceneNode = { ...gasTopology.nodes[1]!, nodeId: toNodeId('node.gas.other'), sceneNodeId: gasTopology.nodes[0]!.sceneNodeId }
    const invalid = {
      ...manifest,
      topologies: manifest.topologies.map((topology) => topology === gasTopology
        ? { ...topology, nodes: [gasTopology.nodes[0]!, duplicateNode, duplicateSceneNode] }
        : topology),
    }
    const codes = issueCodes(invalid)
    expect(codes).toEqual(expect.arrayContaining([
      'topology.duplicate-source-node',
      'topology.source-node-reporting-permission',
      'topology.scene-node-duplicate',
    ]))
  })

  it('过滤拓扑只能引用来源总图的节点和连线，并为每个可见节点给出排布', () => {
    const manifest = createValidManifest({
      flow: {
        topologyId: toTopologyId('topology.gas-power.flow'),
        sceneId: toSceneId('gas-power'),
        title: '燃机流程',
        configVersion: manifestVersion,
        nodes: [],
        edges: [],
        filter: {
          sourceTopologyId: toTopologyId('topology.gas-power.overview'),
          visibleNodeIds: [toNodeId('node.gas.turbine'), toNodeId('node.unknown')],
          visibleEdgeIds: [toRouteId('route.unknown')],
          nodeLayoutOverrides: [{ nodeId: toNodeId('node.gas.turbine'), x: 30, y: 50 }],
        },
      },
    })
    const codes = issueCodes(manifest)
    expect(codes).toEqual(expect.arrayContaining(['topology.filter-node', 'topology.filter-edge']))
  })

  it('限制单场景三维状态目标数量，防止状态快照造成无界三维任务', () => {
    const nodes = Array.from({ length: MAX_DEVICE_STATE_SCENE_NODE_TARGETS_PER_SCENE + 1 }, (_, index) => ({
      nodeId: toNodeId(`node.capacity.${index}`),
      title: `节点${index}`,
      sceneNodeId: toSceneNodeId(`scene-node.capacity.${index}`),
      iconKey: 'generic-device',
      x: index % 100,
      y: Math.floor(index / 10),
      deviceStatus: 'offline' as const,
      doubleClickBehavior: 'emit-node' as const,
    }))
    const manifest = createValidManifest({ gasNodes: nodes })
    expect(issueCodes(manifest)).toContain('topology.scene-node-capacity')
  })
})

import { describe, expect, it } from 'vitest'
import {
  SCENE_IDS,
  toActionId,
  toDeviceId,
  toNodeId,
  toSceneNodeId,
  toTopologyId,
  toUnityRuntimeKey,
  toUnitySceneKey,
} from '@/config/scene-topology/identifiers'
import { SceneTopologyManifestLoader } from '@/config/scene-topology/loader'
import type { SceneTopologyManifest } from '@/config/scene-topology/types'
import { validateSceneTopologyManifest } from '@/config/scene-topology/validator'

const manifestVersion = 'test-manifest.1'

/**
 * 构造完整九场景测试清单而非生产资料。
 * 测试数据仅用于证明校验器能识别九场景闭集，不代表任何 Unity 文件名、正式拓扑或业务映射。
 */
function createValidManifest(): SceneTopologyManifest {
  const scenes = SCENE_IDS.map((sceneId) => {
    const topologyId = toTopologyId(`topology.${sceneId}.overview`)
    return {
      sceneId,
      title: `测试场景-${sceneId}`,
      unitySceneKey: toUnitySceneKey(`scene.${sceneId}`),
      defaultTopologyId: topologyId,
      topologyIds: [topologyId],
      supportedActionIds: [],
      sceneMappingVersion: `mapping.${sceneId}.1`,
      resourceVersion: `resource.${sceneId}.1`,
      switchStrategy: 'unload-first' as const,
    }
  })

  return {
    manifestVersion,
    unityBuildId: 'test-build.1',
    unityRuntimeKey: toUnityRuntimeKey('test-runtime'),
    scenes,
    topologies: scenes.map((scene) => ({
      topologyId: scene.defaultTopologyId,
      sceneId: scene.sceneId,
      title: `测试拓扑-${scene.sceneId}`,
      configVersion: manifestVersion,
      nodes: [],
      edges: [],
    })),
    actions: [],
    deviceMappings: [],
    unitySceneMappings: scenes.map((scene) => ({
      sceneId: scene.sceneId,
      mappingVersion: scene.sceneMappingVersion,
      processSteps: [],
      sceneNodeIds: [],
      routeIds: [],
    })),
  }
}

/** 任务-005回归：每个原子发布缺口必须显式阻止加载，不得根据标题或数组顺序补全。 */
describe('场景拓扑原子清单校验器', () => {
  it('接受包含九个固定场景及一致版本的完整测试清单', () => {
    expect(validateSceneTopologyManifest(createValidManifest())).toEqual([])
  })

  it('拒绝缺失固定场景的清单', () => {
    const manifest = createValidManifest()
    const missingScene = {
      ...manifest,
      scenes: manifest.scenes.filter((scene) => scene.sceneId !== SCENE_IDS[0]),
    }

    expect(validateSceneTopologyManifest(missingScene).some((issue) => issue.code === 'scene.missing')).toBe(true)
  })

  it('拒绝不属于所属场景的默认拓扑', () => {
    const manifest = createValidManifest()
    const gasScene = manifest.scenes.find((scene) => scene.sceneId === 'gas-power')
    const coalScene = manifest.scenes.find((scene) => scene.sceneId === 'coal-power')
    if (!gasScene || !coalScene) throw new Error('测试清单必须包含燃气和燃煤场景。')

    const invalid = {
      ...manifest,
      scenes: manifest.scenes.map((scene) =>
        scene.sceneId === gasScene.sceneId
          ? { ...scene, defaultTopologyId: coalScene.defaultTopologyId, topologyIds: [coalScene.defaultTopologyId] }
          : scene,
      ),
    }

    const issues = validateSceneTopologyManifest(invalid).map((issue) => issue.code)
    expect(issues).toContain('scene.default-topology')
    expect(issues).toContain('scene.topology-scene')
  })

  it('拒绝场景、拓扑、动作和设备映射之间的发布版本错配', () => {
    const manifest = createValidManifest()
    const gasScene = manifest.scenes.find((scene) => scene.sceneId === 'gas-power')
    if (!gasScene) throw new Error('测试清单必须包含燃气场景。')
    const deviceId = toDeviceId('device.gas-turbine.01')
    const nodeId = toNodeId('gas-power.turbine-node')
    const sceneNodeId = toSceneNodeId('scene-node.gas-turbine.01')

    const invalid = {
      ...manifest,
      topologies: manifest.topologies.map((topology) =>
        topology.topologyId === gasScene.defaultTopologyId
          ? {
              ...topology,
              configVersion: 'stale-topology.1',
              nodes: [{ nodeId, title: '测试燃机节点', deviceId, sceneNodeId, iconKey: 'gas-turbine', x: 50, y: 50, deviceStatus: 'offline' as const, doubleClickBehavior: 'emit-device' as const }],
            }
          : topology,
      ),
      deviceMappings: [{ deviceId, sceneId: gasScene.sceneId, topologyNodeRefs: [{ topologyId: gasScene.defaultTopologyId, nodeId }], sceneNodeId, configVersion: 'stale-device.1' }],
    }

    const issues = validateSceneTopologyManifest(invalid).map((issue) => issue.code)
    expect(issues).toContain('topology.version')
    expect(issues).toContain('device-mapping.version')
  })

  it('拒绝可双击但未登记设备标识的节点', () => {
    const manifest = createValidManifest()
    const gasScene = manifest.scenes.find((scene) => scene.sceneId === 'gas-power')
    if (!gasScene) throw new Error('测试清单必须包含燃气场景。')

    const invalid = {
      ...manifest,
      topologies: manifest.topologies.map((topology) =>
        topology.topologyId === gasScene.defaultTopologyId
          ? {
              ...topology,
              nodes: [
                {
                  nodeId: toNodeId('gas-power.turbine-node'),
                  title: '测试燃机节点',
                  iconKey: 'gas-turbine',
                  x: 50,
                  y: 50,
                  deviceStatus: 'offline' as const,
                  doubleClickBehavior: 'emit-device' as const,
                },
              ],
            }
          : topology,
      ),
    }

    expect(validateSceneTopologyManifest(invalid).some((issue) => issue.code === 'topology.double-click-device')).toBe(true)
  })

  it('拒绝设备映射存在但未显式引用可双击二维节点的清单', () => {
    const manifest = createValidManifest()
    const gasScene = manifest.scenes.find((scene) => scene.sceneId === 'gas-power')
    if (!gasScene) throw new Error('测试清单必须包含燃气场景。')
    const deviceId = toDeviceId('device.gas-turbine.01')
    const nodeId = toNodeId('gas-power.turbine-node')

    const invalid = {
      ...manifest,
      topologies: manifest.topologies.map((topology) => topology.topologyId === gasScene.defaultTopologyId
        ? {
            ...topology,
            nodes: [{
              nodeId,
              title: '测试燃机节点',
              deviceId,
              iconKey: 'gas-turbine',
              x: 50,
              y: 50,
              deviceStatus: 'offline' as const,
              doubleClickBehavior: 'emit-device' as const,
            }],
          }
        : topology),
      // 设备本身存在但没有关联到二维节点；旧校验会误将其视为完整映射。
      deviceMappings: [{
        deviceId,
        sceneId: gasScene.sceneId,
        topologyNodeRefs: [],
        configVersion: manifestVersion,
      }],
    }

    expect(validateSceneTopologyManifest(invalid).some((issue) => issue.code === 'device-mapping.node-unmapped')).toBe(true)
  })

  it('拒绝二维设备节点与设备映射之间缺失三维节点标识的情况', () => {
    const manifest = createValidManifest()
    const gasScene = manifest.scenes.find((scene) => scene.sceneId === 'gas-power')
    if (!gasScene) throw new Error('测试清单必须包含燃气场景。')
    const deviceId = toDeviceId('device.gas-turbine.01')
    const sceneNodeId = toSceneNodeId('gas-turbine')
    const nodeId = toNodeId('gas-power.turbine-node')

    const invalid = {
      ...manifest,
      topologies: manifest.topologies.map((topology) =>
        topology.topologyId === gasScene.defaultTopologyId
          ? {
              ...topology,
              nodes: [
                {
                  nodeId,
                  title: '测试燃机节点',
                  deviceId,
                  sceneNodeId,
                  iconKey: 'gas-turbine',
                  x: 50,
                  y: 50,
                  deviceStatus: 'offline' as const,
                  doubleClickBehavior: 'emit-device' as const,
                },
              ],
            }
          : topology,
      ),
      deviceMappings: [
        {
          deviceId,
          sceneId: gasScene.sceneId,
          topologyNodeRefs: [{ topologyId: gasScene.defaultTopologyId, nodeId }],
          configVersion: manifestVersion,
        },
      ],
    }

    expect(validateSceneTopologyManifest(invalid).some((issue) => issue.code === 'device-mapping.scene-node')).toBe(true)
  })

  it('拒绝二维节点与设备映射共同引用所属Unity场景未登记的三维节点', () => {
    const manifest = createValidManifest()
    const gasScene = manifest.scenes.find((scene) => scene.sceneId === 'gas-power')
    if (!gasScene) throw new Error('测试清单必须包含燃气场景。')
    const deviceId = toDeviceId('device.gas-turbine.01')
    const nodeId = toNodeId('gas-power.turbine-node')
    const missingSceneNodeId = toSceneNodeId('scene-node.unregistered')

    const invalid = {
      ...manifest,
      topologies: manifest.topologies.map((topology) => topology.topologyId === gasScene.defaultTopologyId
        ? {
            ...topology,
            nodes: [{
              nodeId,
              title: '测试燃机节点',
              deviceId,
              sceneNodeId: missingSceneNodeId,
              iconKey: 'gas-turbine',
              x: 50,
              y: 50,
              deviceStatus: 'offline' as const,
              doubleClickBehavior: 'emit-device' as const,
            }],
          }
        : topology),
      deviceMappings: [{
        deviceId,
        sceneId: gasScene.sceneId,
        topologyNodeRefs: [{ topologyId: gasScene.defaultTopologyId, nodeId }],
        sceneNodeId: missingSceneNodeId,
        configVersion: manifestVersion,
      }],
      // 燃气 Unity 映射保持为空，明确模拟“二维已声明、三维未发布”的错误组合。
      unitySceneMappings: manifest.unitySceneMappings,
    }

    const issueCodes = validateSceneTopologyManifest(invalid).map((issue) => issue.code)
    expect(issueCodes).toContain('topology.scene-node-unregistered')
    expect(issueCodes).toContain('device-mapping.scene-node-unregistered')
  })

  it('拒绝Unity场景映射中重复登记的节点、路径和流程步骤', () => {
    const manifest = createValidManifest()
    const gasScene = manifest.scenes.find((scene) => scene.sceneId === 'gas-power')
    if (!gasScene) throw new Error('测试清单必须包含燃气场景。')

    const duplicateSceneNodeId = toSceneNodeId('scene-node.gas-turbine')
    const invalid = {
      ...manifest,
      unitySceneMappings: manifest.unitySceneMappings.map((mapping) => mapping.sceneId === gasScene.sceneId
        ? {
            ...mapping,
            // 三类重复都来自显式映射字段；测试不依赖标题、数组下标或对象名称推断归属。
            sceneNodeIds: [duplicateSceneNodeId, duplicateSceneNodeId],
            routeIds: ['route.gas-turbine.exhaust', 'route.gas-turbine.exhaust'],
            processSteps: [
              { processId: 'gas-power-generation', stepId: 'gas-turbine' },
              { processId: 'gas-power-generation', stepId: 'gas-turbine' },
            ],
          }
        : mapping),
    }

    const issueCodes = validateSceneTopologyManifest(invalid).map((issue) => issue.code)
    expect(issueCodes).toContain('unity-mapping.duplicate-node')
    expect(issueCodes).toContain('unity-mapping.duplicate-route')
    expect(issueCodes).toContain('unity-mapping.duplicate-process-step')
  })

  it('拒绝多个设备状态源映射到同一场景三维节点', () => {
    const manifest = createValidManifest()
    const gasScene = manifest.scenes.find((scene) => scene.sceneId === 'gas-power')
    if (!gasScene) throw new Error('测试清单必须包含燃气场景。')
    const sharedSceneNodeId = toSceneNodeId('scene-node.shared')
    const firstDeviceId = toDeviceId('device.gas-turbine.01')
    const secondDeviceId = toDeviceId('device.gas-turbine.02')
    const firstNodeId = toNodeId('node.gas-turbine.01')
    const secondNodeId = toNodeId('node.gas-turbine.02')

    const invalid = {
      ...manifest,
      topologies: manifest.topologies.map((topology) => topology.topologyId === gasScene.defaultTopologyId
        ? {
            ...topology,
            nodes: [
              { nodeId: firstNodeId, title: '设备一', deviceId: firstDeviceId, sceneNodeId: sharedSceneNodeId, iconKey: 'generic-device', x: 30, y: 50, deviceStatus: 'offline' as const, doubleClickBehavior: 'none' as const },
              { nodeId: secondNodeId, title: '设备二', deviceId: secondDeviceId, sceneNodeId: sharedSceneNodeId, iconKey: 'generic-device', x: 70, y: 50, deviceStatus: 'offline' as const, doubleClickBehavior: 'none' as const },
            ],
          }
        : topology),
      deviceMappings: [
        { deviceId: firstDeviceId, sceneId: gasScene.sceneId, topologyNodeRefs: [{ topologyId: gasScene.defaultTopologyId, nodeId: firstNodeId }], sceneNodeId: sharedSceneNodeId, configVersion: manifestVersion },
        { deviceId: secondDeviceId, sceneId: gasScene.sceneId, topologyNodeRefs: [{ topologyId: gasScene.defaultTopologyId, nodeId: secondNodeId }], sceneNodeId: sharedSceneNodeId, configVersion: manifestVersion },
      ],
      unitySceneMappings: manifest.unitySceneMappings.map((mapping) => mapping.sceneId === gasScene.sceneId
        ? { ...mapping, sceneNodeIds: [sharedSceneNodeId] }
        : mapping),
    }

    expect(validateSceneTopologyManifest(invalid).some((issue) => issue.code === 'device-mapping.scene-node-duplicate')).toBe(true)
  })

  it('拒绝目标拓扑不属于动作目标场景的动作', () => {
    const manifest = createValidManifest()
    const gasScene = manifest.scenes.find((scene) => scene.sceneId === 'gas-power')
    const coalScene = manifest.scenes.find((scene) => scene.sceneId === 'coal-power')
    if (!gasScene || !coalScene) throw new Error('测试清单必须包含燃气和燃煤场景。')

    const invalid = {
      ...manifest,
      scenes: manifest.scenes.map((scene) =>
        scene.sceneId === 'gas-power' ? { ...scene, supportedActionIds: [toActionId('gas-power.invalid-target')] } : scene,
      ),
      actions: [
        {
          actionId: toActionId('gas-power.invalid-target'),
          title: '无效目标动作',
          targetSceneId: gasScene.sceneId,
          targetTopologyId: coalScene.defaultTopologyId,
          allowedParameters: [],
          unityAction: { type: 'none' as const },
          failurePolicy: 'keep-current-context' as const,
          configVersion: manifestVersion,
        },
      ],
    }

    expect(validateSceneTopologyManifest(invalid).some((issue) => issue.code === 'action.topology-scene')).toBe(true)
  })

  it('无效更新不会覆盖加载器最近一次验证通过的清单', () => {
    const loader = new SceneTopologyManifestLoader()
    const validManifest = createValidManifest()
    expect(loader.load(validManifest).status).toBe('ready')
    expect(loader.load({ manifestVersion: 'invalid' }).status).toBe('invalid')
    expect(loader.getLastValidManifest()).toBe(validManifest)
    loader.dispose()
    expect(loader.getLastValidManifest()).toBeUndefined()
  })
})

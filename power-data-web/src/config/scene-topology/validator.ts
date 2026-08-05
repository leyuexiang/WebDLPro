import { SCENE_IDS, isSceneId, validateStableIdentifier } from '@/config/scene-topology/identifiers'
import type { SceneTopologyManifest, SceneTopologyManifestValidationIssue } from '@/config/scene-topology/types'

/** 非可信外部清单只能先当作普通记录处理，完成字段校验后才允许断言为领域类型。 */
type UnknownRecord = Record<string, unknown>

/** 集中追加问题，避免各校验分支输出不一致的错误对象结构。 */
function appendIssue(issues: SceneTopologyManifestValidationIssue[], code: string, message: string): void {
  issues.push({ code, message })
}

/** 运行时对象守卫不接受数组、空值和函数，防止将原型对象或可执行对象带入配置缓存。 */
function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** 通用字符串字段检查；只校验存在性，不把不可信的完整字段值放入错误消息。 */
function hasNonEmptyString(record: UnknownRecord, field: string, issues: SceneTopologyManifestValidationIssue[], code: string): boolean {
  if (typeof record[field] === 'string' && (record[field] as string).length > 0) return true
  appendIssue(issues, code, `缺少有效字段：${field}。`)
  return false
}

/** 统一校验稳定标识字段并附加所属对象名称，方便发布侧定位而不泄露外部载荷。 */
function validateIdentifier(
  value: unknown,
  field: string,
  issues: SceneTopologyManifestValidationIssue[],
): value is string {
  const identifierIssues = validateStableIdentifier(value)
  if (identifierIssues.length === 0) return true
  appendIssue(issues, identifierIssues[0]?.code ?? 'identifier.invalid', `${field}不是有效稳定标识。`)
  return false
}

/** 将未知数组转换为只读项数组；不是数组时保留空数组并记录一个结构化问题。 */
function readArray(record: UnknownRecord, field: string, issues: SceneTopologyManifestValidationIssue[], code: string): readonly unknown[] {
  if (Array.isArray(record[field])) return record[field]
  appendIssue(issues, code, `字段${field}必须是数组。`)
  return []
}

/**
 * 校验完整原子清单。
 * 该函数没有网络、缓存或组件副作用，可在部署前、子应用加载前和单元测试中使用同一规则。
 */
export function validateSceneTopologyManifest(input: unknown): readonly SceneTopologyManifestValidationIssue[] {
  const issues: SceneTopologyManifestValidationIssue[] = []
  if (!isRecord(input)) {
    appendIssue(issues, 'manifest.shape', '场景拓扑清单必须是对象。')
    return issues
  }

  const manifest = input
  hasNonEmptyString(manifest, 'manifestVersion', issues, 'manifest.version')
  hasNonEmptyString(manifest, 'unityBuildId', issues, 'manifest.unity-build')
  validateIdentifier(manifest.unityRuntimeKey, 'Unity运行时键', issues)

  const sceneItems = readArray(manifest, 'scenes', issues, 'manifest.scenes')
  const topologyItems = readArray(manifest, 'topologies', issues, 'manifest.topologies')
  const actionItems = readArray(manifest, 'actions', issues, 'manifest.actions')
  const deviceMappingItems = readArray(manifest, 'deviceMappings', issues, 'manifest.device-mappings')
  const unityMappingItems = readArray(manifest, 'unitySceneMappings', issues, 'manifest.unity-scene-mappings')
  const manifestVersion = typeof manifest.manifestVersion === 'string' ? manifest.manifestVersion : ''

  const scenesById = new Map<string, UnknownRecord>()
  for (const item of sceneItems) {
    if (!isRecord(item)) {
      appendIssue(issues, 'scene.shape', '场景定义必须是对象。')
      continue
    }

    const sceneId = item.sceneId
    if (!isSceneId(sceneId)) {
      appendIssue(issues, 'scene.id', '场景定义使用了非固定九场景标识。')
      continue
    }

    if (scenesById.has(sceneId)) appendIssue(issues, 'scene.duplicate', '场景标识重复。')
    scenesById.set(sceneId, item)
    hasNonEmptyString(item, 'title', issues, 'scene.title')
    validateIdentifier(item.unitySceneKey, 'Unity场景键', issues)
    validateIdentifier(item.defaultTopologyId, '场景默认拓扑标识', issues)
    hasNonEmptyString(item, 'sceneMappingVersion', issues, 'scene.mapping-version')
    hasNonEmptyString(item, 'resourceVersion', issues, 'scene.resource-version')
    if (item.switchStrategy !== 'unload-first' && item.switchStrategy !== 'preload-then-unload') {
      appendIssue(issues, 'scene.switch-strategy', '场景切换策略无效。')
    }
    for (const topologyId of readArray(item, 'topologyIds', issues, 'scene.topology-ids')) {
      validateIdentifier(topologyId, '场景拓扑标识', issues)
    }
    for (const actionId of readArray(item, 'supportedActionIds', issues, 'scene.action-ids')) {
      validateIdentifier(actionId, '场景动作标识', issues)
    }
  }

  for (const sceneId of SCENE_IDS) {
    if (!scenesById.has(sceneId)) appendIssue(issues, 'scene.missing', `固定场景${sceneId}未登记。`)
  }

  const topologiesById = new Map<string, UnknownRecord>()
  const topologyNodesByRef = new Map<string, UnknownRecord>()
  /** 节点归属场景在解析拓扑时固定记录，后续校验三维节点时不从标题、文件名或当前 UI 回推场景。 */
  const sceneIdByTopologyNodeReference = new Map<string, string>()
  for (const item of topologyItems) {
    if (!isRecord(item)) {
      appendIssue(issues, 'topology.shape', '拓扑定义必须是对象。')
      continue
    }

    const topologyId = item.topologyId
    const sceneId = item.sceneId
    if (!validateIdentifier(topologyId, '拓扑标识', issues) || !isSceneId(sceneId)) {
      appendIssue(issues, 'topology.reference', '拓扑必须引用有效场景和稳定拓扑标识。')
      continue
    }

    if (topologiesById.has(topologyId)) appendIssue(issues, 'topology.duplicate', '拓扑标识重复。')
    topologiesById.set(topologyId, item)
    hasNonEmptyString(item, 'title', issues, 'topology.title')
    if (item.configVersion !== manifestVersion) appendIssue(issues, 'topology.version', '拓扑版本与清单版本不一致。')

    /*
     * 展示层级是可选的纯二维元数据。只要清单声明了它，就必须在此完成完整校验，
     * 以避免节点层级、分层色带和标题在不同客户端出现不一致；它不参与设备或三维映射校验。
     */
    const layerIds = new Set<string>()
    if (item.layers !== undefined) {
      for (const layerItem of readArray(item, 'layers', issues, 'topology.layers')) {
        if (!isRecord(layerItem) || !validateIdentifier(layerItem.layerId, '拓扑展示层级标识', issues)) {
          appendIssue(issues, 'topology.layer-shape', '拓扑展示层级缺少有效稳定标识。')
          continue
        }

        const layerId = layerItem.layerId as string
        if (layerIds.has(layerId)) appendIssue(issues, 'topology.duplicate-layer', '同一拓扑内展示层级标识重复。')
        layerIds.add(layerId)
        hasNonEmptyString(layerItem, 'title', issues, 'topology.layer-title')
        if (typeof layerItem.y !== 'number' || !Number.isFinite(layerItem.y) || layerItem.y < 0 || layerItem.y > 100) {
          appendIssue(issues, 'topology.layer-position', '拓扑展示层级纵坐标必须是 0 到 100 的有限数字。')
        }
        if (typeof layerItem.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(layerItem.color)) {
          appendIssue(issues, 'topology.layer-color', '拓扑展示层级颜色必须是六位十六进制颜色值。')
        }
      }
    }

    const nodeIds = new Set<string>()
    const nodeItems = readArray(item, 'nodes', issues, 'topology.nodes')
    for (const nodeItem of nodeItems) {
      if (!isRecord(nodeItem) || !validateIdentifier(nodeItem.nodeId, '拓扑节点标识', issues)) {
        appendIssue(issues, 'topology.node-shape', '拓扑节点缺少有效稳定标识。')
        continue
      }

      const nodeId = nodeItem.nodeId as string
      if (nodeIds.has(nodeId)) appendIssue(issues, 'topology.duplicate-node', '同一拓扑内节点标识重复。')
      nodeIds.add(nodeId)
      const topologyNodeReference = `${topologyId}:${nodeId}`
      topologyNodesByRef.set(topologyNodeReference, nodeItem)
      sceneIdByTopologyNodeReference.set(topologyNodeReference, sceneId as string)
      hasNonEmptyString(nodeItem, 'title', issues, 'topology.node-title')
      validateIdentifier(nodeItem.iconKey, '拓扑图元键', issues)
      if (typeof nodeItem.x !== 'number' || !Number.isFinite(nodeItem.x) || typeof nodeItem.y !== 'number' || !Number.isFinite(nodeItem.y)) {
        appendIssue(issues, 'topology.node-position', '拓扑节点坐标必须是有限数字。')
      }
      // 节点只允许引用同一拓扑已显式发布的展示层级；未提供层级时保留通用布局语义。
      if (nodeItem.layerId !== undefined && (!validateIdentifier(nodeItem.layerId, '拓扑节点展示层级标识', issues) || !layerIds.has(String(nodeItem.layerId)))) {
        appendIssue(issues, 'topology.node-layer-reference', '拓扑节点引用了不存在的展示层级。')
      }
      if (!['normal', 'alarm', 'fault', 'offline'].includes(String(nodeItem.deviceStatus))) appendIssue(issues, 'topology.node-status', '拓扑节点设备状态无效。')
      if (nodeItem.deviceId !== undefined) validateIdentifier(nodeItem.deviceId, '设备标识', issues)
      if (nodeItem.sceneNodeId !== undefined) validateIdentifier(nodeItem.sceneNodeId, '三维节点标识', issues)
      if (nodeItem.doubleClickBehavior !== 'emit-device' && nodeItem.doubleClickBehavior !== 'none') appendIssue(issues, 'topology.double-click', '节点双击行为无效。')
      if (nodeItem.doubleClickBehavior === 'emit-device' && nodeItem.deviceId === undefined) appendIssue(issues, 'topology.double-click-device', '可上报双击的节点必须有设备标识。')
    }

    const routeIds = new Set<string>()
    for (const edgeItem of readArray(item, 'edges', issues, 'topology.edges')) {
      if (!isRecord(edgeItem) || !validateIdentifier(edgeItem.edgeId, '拓扑连线标识', issues)) {
        appendIssue(issues, 'topology.edge-shape', '拓扑连线缺少有效稳定标识。')
        continue
      }

      const edgeId = edgeItem.edgeId as string
      if (routeIds.has(edgeId)) appendIssue(issues, 'topology.duplicate-edge', '同一拓扑内连线标识重复。')
      routeIds.add(edgeId)
      if (!nodeIds.has(String(edgeItem.fromNodeId)) || !nodeIds.has(String(edgeItem.toNodeId))) {
        appendIssue(issues, 'topology.edge-node-reference', '拓扑连线引用了不存在的节点。')
      }
      // 协议标签与连线证据是只读二维展示字段，显式提供时校验其结构，缺失时由画布显示为中性状态。
      if (edgeItem.protocolLabel !== undefined && (typeof edgeItem.protocolLabel !== 'string' || edgeItem.protocolLabel.length === 0)) {
        appendIssue(issues, 'topology.edge-protocol-label', '拓扑连线协议标签必须是非空字符串。')
      }
      if (edgeItem.evidenceStatus !== undefined && !['verified', 'pending-confirmation', 'conceptual'].includes(String(edgeItem.evidenceStatus))) {
        appendIssue(issues, 'topology.edge-evidence-status', '拓扑连线证据状态无效。')
      }
    }
  }

  const actionsById = new Map<string, UnknownRecord>()
  for (const item of actionItems) {
    if (!isRecord(item) || !validateIdentifier(item.actionId, '动作标识', issues)) {
      appendIssue(issues, 'action.shape', '动作定义缺少有效稳定标识。')
      continue
    }

    const actionId = item.actionId as string
    if (actionsById.has(actionId)) appendIssue(issues, 'action.duplicate', '动作标识重复。')
    actionsById.set(actionId, item)
    if (!isSceneId(item.targetSceneId) || !validateIdentifier(item.targetTopologyId, '动作目标拓扑标识', issues)) {
      appendIssue(issues, 'action.target', '动作目标场景或拓扑无效。')
    }
    if (item.configVersion !== manifestVersion) appendIssue(issues, 'action.version', '动作版本与清单版本不一致。')
    if (!['keep-current-context', 'commit-view-with-warning'].includes(String(item.failurePolicy))) appendIssue(issues, 'action.failure-policy', '动作失败策略无效。')
    readArray(item, 'allowedParameters', issues, 'action.parameters').forEach((parameter) => validateIdentifier(parameter, '动作参数标识', issues))
    if (!isRecord(item.unityAction) || !['none', 'enterProcessStep', 'focusNode', 'resetScene', 'setRouteFlow'].includes(String(item.unityAction.type))) {
      appendIssue(issues, 'action.unity-action', '动作必须包含受控Unity动作。')
    }
  }

  const unityMappingsBySceneId = new Map<string, UnknownRecord>()
  for (const item of unityMappingItems) {
    if (!isRecord(item) || !isSceneId(item.sceneId)) {
      appendIssue(issues, 'unity-mapping.shape', 'Unity场景映射必须引用固定场景。')
      continue
    }
    if (unityMappingsBySceneId.has(item.sceneId)) appendIssue(issues, 'unity-mapping.duplicate', 'Unity场景映射重复。')
    unityMappingsBySceneId.set(item.sceneId, item)
    const scene = scenesById.get(item.sceneId)
    if (!scene || item.mappingVersion !== scene.sceneMappingVersion) appendIssue(issues, 'unity-mapping.version', 'Unity场景映射版本与场景登记不一致。')
    readArray(item, 'sceneNodeIds', issues, 'unity-mapping.nodes').forEach((sceneNodeId) => validateIdentifier(sceneNodeId, 'Unity场景节点标识', issues))
    readArray(item, 'routeIds', issues, 'unity-mapping.routes').forEach((routeId) => validateIdentifier(routeId, 'Unity场景路径标识', issues))
    for (const processStep of readArray(item, 'processSteps', issues, 'unity-mapping.process-steps')) {
      if (!isRecord(processStep) || !validateIdentifier(processStep.processId, '流程标识', issues) || !validateIdentifier(processStep.stepId, '步骤标识', issues)) {
        appendIssue(issues, 'unity-mapping.process-step', 'Unity流程步骤映射无效。')
      }
    }
  }

  /**
   * 每个 Unity 场景已发布的三维节点索引。
   * 二维节点与设备映射的 sceneNodeId（场景三维节点标识）必须命中该索引，
   * 否则前端虽然拥有格式正确的字符串，仍可能向 Unity 发送不存在对象的聚焦或状态命令。
   */
  const registeredSceneNodeIdsBySceneId = new Map<string, ReadonlySet<string>>()
  for (const [sceneId, mapping] of unityMappingsBySceneId) {
    const sceneNodeIds = readArray(mapping, 'sceneNodeIds', issues, 'unity-mapping.nodes')
      .filter((sceneNodeId): sceneNodeId is string => typeof sceneNodeId === 'string')
    registeredSceneNodeIdsBySceneId.set(sceneId, new Set(sceneNodeIds))
  }

  for (const [sceneId, scene] of scenesById) {
    if (!unityMappingsBySceneId.has(sceneId)) appendIssue(issues, 'unity-mapping.missing', `场景${sceneId}缺少Unity映射。`)
    const defaultTopologyId = String(scene.defaultTopologyId)
    const topology = topologiesById.get(defaultTopologyId)
    const topologyIds = readArray(scene, 'topologyIds', issues, 'scene.topology-ids').map(String)
    if (!topologyIds.includes(defaultTopologyId) || !topology || topology.sceneId !== sceneId) {
      appendIssue(issues, 'scene.default-topology', `场景${sceneId}默认拓扑无效。`)
    }
    for (const topologyId of topologyIds) {
      if (topologiesById.get(topologyId)?.sceneId !== sceneId) appendIssue(issues, 'scene.topology-scene', `场景${sceneId}引用了其他场景拓扑。`)
    }
    for (const actionId of readArray(scene, 'supportedActionIds', issues, 'scene.action-ids').map(String)) {
      if (actionsById.get(actionId)?.targetSceneId !== sceneId) appendIssue(issues, 'scene.action-scene', `场景${sceneId}引用了不存在或目标不一致的动作。`)
    }
  }

  for (const action of actionsById.values()) {
    const targetTopology = topologiesById.get(String(action.targetTopologyId))
    const targetSceneId = String(action.targetSceneId)
    if (!targetTopology || targetTopology.sceneId !== targetSceneId) appendIssue(issues, 'action.topology-scene', '动作目标拓扑不属于目标场景。')
    validateUnityAction(action.unityAction, targetSceneId, unityMappingsBySceneId, issues)
  }

  const devicesById = new Map<string, UnknownRecord>()
  /** 同一场景三维节点只能由一个设备状态源驱动，避免批量更新按到达顺序互相覆盖。 */
  const deviceBySceneNodeReference = new Map<string, string>()
  /**
   * 设备映射实际覆盖的二维节点引用。
   * 不能只因 deviceId（设备标识）出现在映射表就允许节点双击上报；每个设备节点必须被映射表逐项引用，
   * 否则多拓扑中同名设备、遗漏明细图或错误引用会绕过发布校验并形成不完整的外部事件载荷。
   */
  const mappedTopologyNodeReferences = new Set<string>()
  for (const item of deviceMappingItems) {
    if (!isRecord(item) || !validateIdentifier(item.deviceId, '设备映射标识', issues) || !isSceneId(item.sceneId)) {
      appendIssue(issues, 'device-mapping.shape', '设备映射必须包含设备标识和固定场景。')
      continue
    }
    const deviceId = item.deviceId as string
    if (devicesById.has(deviceId)) appendIssue(issues, 'device-mapping.duplicate', '设备映射标识重复。')
    devicesById.set(deviceId, item)
    if (item.configVersion !== manifestVersion) appendIssue(issues, 'device-mapping.version', '设备映射版本与清单版本不一致。')
    if (item.sceneNodeId !== undefined && validateIdentifier(item.sceneNodeId, '设备三维节点标识', issues)) {
      const sceneNodeReference = `${item.sceneId}:${item.sceneNodeId}`
      const registeredSceneNodeIds = registeredSceneNodeIdsBySceneId.get(String(item.sceneId))
      if (!registeredSceneNodeIds?.has(String(item.sceneNodeId))) {
        appendIssue(issues, 'device-mapping.scene-node-unregistered', '设备映射引用了当前Unity场景未登记的三维节点。')
      }
      const previousDeviceId = deviceBySceneNodeReference.get(sceneNodeReference)
      if (previousDeviceId !== undefined && previousDeviceId !== deviceId) {
        appendIssue(issues, 'device-mapping.scene-node-duplicate', '同一场景三维节点不能映射多个设备状态源。')
      } else {
        deviceBySceneNodeReference.set(sceneNodeReference, deviceId)
      }
    }
    for (const nodeReference of readArray(item, 'topologyNodeRefs', issues, 'device-mapping.nodes')) {
      if (!isRecord(nodeReference) || !validateIdentifier(nodeReference.topologyId, '设备映射拓扑标识', issues) || !validateIdentifier(nodeReference.nodeId, '设备映射节点标识', issues)) {
        appendIssue(issues, 'device-mapping.node-shape', '设备映射节点引用无效。')
        continue
      }
      const node = topologyNodesByRef.get(`${nodeReference.topologyId}:${nodeReference.nodeId}`)
      const topologyNodeReference = `${nodeReference.topologyId}:${nodeReference.nodeId}`
      if (!node || node.deviceId !== deviceId) {
        appendIssue(issues, 'device-mapping.node-reference', '设备映射未显式对应二维设备节点。')
      } else {
        // 只记录已经验证设备归属的引用，错误设备映射不能借引用键让节点通过后续闭环校验。
        mappedTopologyNodeReferences.add(topologyNodeReference)
      }
      if (topologiesById.get(String(nodeReference.topologyId))?.sceneId !== item.sceneId) {
        appendIssue(issues, 'device-mapping.scene', '设备映射引用了其他场景的二维节点。')
      }
      if (node?.sceneNodeId !== undefined && item.sceneNodeId !== node.sceneNodeId) appendIssue(issues, 'device-mapping.scene-node', '二维三维映射缺少或不一致的三维节点标识。')
    }
  }

  for (const [topologyReference, node] of topologyNodesByRef) {
    if (node.sceneNodeId !== undefined) {
      const sceneId = sceneIdByTopologyNodeReference.get(topologyReference)
      const registeredSceneNodeIds = sceneId ? registeredSceneNodeIdsBySceneId.get(sceneId) : undefined
      if (!registeredSceneNodeIds?.has(String(node.sceneNodeId))) {
        appendIssue(issues, 'topology.scene-node-unregistered', `拓扑节点${topologyReference}引用了所属Unity场景未登记的三维节点。`)
      }
    }
    if (node.deviceId !== undefined && !devicesById.has(String(node.deviceId))) {
      appendIssue(issues, 'device-mapping.missing', `设备节点${topologyReference}缺少设备映射。`)
    }
    if (node.deviceId !== undefined && !mappedTopologyNodeReferences.has(topologyReference)) {
      appendIssue(issues, 'device-mapping.node-unmapped', `设备节点${topologyReference}未被设备映射显式引用。`)
    }
  }

  return issues
}

/**
 * 校验动作引用的 Unity 映射；只有清单已登记的节点、路径和流程步骤才能形成下行命令。
 * 使用映射集合进行一次查找，避免在发布校验期间重复扫描整个清单。
 */
function validateUnityAction(
  action: unknown,
  targetSceneId: string,
  unityMappingsBySceneId: ReadonlyMap<string, UnknownRecord>,
  issues: SceneTopologyManifestValidationIssue[],
): void {
  if (!isRecord(action) || typeof action.type !== 'string') return
  const mapping = unityMappingsBySceneId.get(targetSceneId)
  if (!mapping) return
  const sceneNodeIds = new Set(readArray(mapping, 'sceneNodeIds', issues, 'unity-mapping.nodes').map(String))
  const routeIds = new Set(readArray(mapping, 'routeIds', issues, 'unity-mapping.routes').map(String))
  const processSteps = new Set(
    readArray(mapping, 'processSteps', issues, 'unity-mapping.process-steps')
      .filter(isRecord)
      .map((step) => `${String(step.processId)}:${String(step.stepId)}`),
  )

  if (action.type === 'focusNode' && !sceneNodeIds.has(String(action.sceneNodeId))) {
    appendIssue(issues, 'action.scene-node', '聚焦动作引用了未登记的三维节点。')
  }
  if (action.type === 'setRouteFlow' && !routeIds.has(String(action.routeId))) {
    appendIssue(issues, 'action.route', '路径动作引用了未登记的Unity路径。')
  }
  if (action.type === 'enterProcessStep' && !processSteps.has(`${String(action.processId)}:${String(action.stepId)}`)) {
    appendIssue(issues, 'action.process-step', '流程动作引用了未登记的Unity流程步骤。')
  }
}

/** 校验成功后才转换为领域清单类型；调用方不能绕过此函数把未知对象直接写入运行时。 */
export function isValidSceneTopologyManifest(input: unknown): input is SceneTopologyManifest {
  return validateSceneTopologyManifest(input).length === 0
}

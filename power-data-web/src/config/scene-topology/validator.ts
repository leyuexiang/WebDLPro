import { SCENE_IDS, isSceneId, validateStableIdentifier } from '@/config/scene-topology/identifiers'
import type { SceneTopologyManifest, SceneTopologyManifestValidationIssue } from '@/config/scene-topology/types'
import { MAX_TOPOLOGY_DRILLDOWN_CONTENT_COUNT } from '@/config/scene-topology/topology-drilldown-registry'

/** 与 Unity 节点快照水位表一致；结构清单超过该值会使清除补偿无法保证完整交付。 */
export const MAX_DEVICE_STATE_SCENE_NODE_TARGETS_PER_SCENE = 500

/** 非可信外部清单只能先当作普通记录处理，完成字段校验后才允许断言为领域类型。 */
type UnknownRecord = Record<string, unknown>

/** 集中追加问题，避免各校验分支输出不一致的错误对象结构。 */
function appendIssue(issues: SceneTopologyManifestValidationIssue[], code: string, message: string): void {
  issues.push({ code, message })
}

/**
 * 运行时对象守卫只接受普通对象或无原型对象，不接受数组、空值、函数、类实例或继承属性对象。
 * 远程响应经 JSON（JavaScript 对象表示法）解析后应天然满足该条件；在直接调用校验器时仍要拒绝
 * 原型链上的意外字段，避免配置缓存读取到调用方注入的方法或继承状态。
 */
function isRecord(value: unknown): value is UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** 清单扫描容量远高于当前九场景规模，用于阻断恶意宽对象和深层对象消耗主线程。 */
const MAX_MANIFEST_CONTAINER_COUNT = 50_000
const MAX_MANIFEST_ENTRY_COUNT = 250_000
const MAX_MANIFEST_FIELD_NAME_LENGTH = 128

type LegacyManifestFieldKind = 'device-identifier' | 'device-mapping' | 'binding-metadata' | 'runtime-manifest'
const DEVICE_IDENTIFIER_SUFFIXES = new Set(['id', 'ids'])
const DEVICE_MAPPING_SUFFIXES = new Set(['mapping', 'mappings'])
const BINDING_METADATA_SUFFIXES = new Set(['count', 'revision'])
const RUNTIME_MANIFEST_SUFFIXES = new Set(['manifest'])

const LEGACY_MANIFEST_ISSUES: Readonly<Record<LegacyManifestFieldKind, SceneTopologyManifestValidationIssue>> = Object.freeze({
  'device-identifier': Object.freeze({ code: 'manifest.legacy-device-identifier', message: '结构清单不得包含平台设备编号字段。' }),
  'device-mapping': Object.freeze({ code: 'manifest.legacy-device-mapping', message: '结构清单不得包含平台设备映射字段。' }),
  'binding-metadata': Object.freeze({ code: 'manifest.legacy-binding-metadata', message: '结构清单不得包含平台绑定元数据。' }),
  'runtime-manifest': Object.freeze({ code: 'manifest.legacy-runtime-manifest', message: '结构清单不得包含第二份运行时清单字段。' }),
})

/**
 * 把驼峰、连续大写和常见分隔符统一拆为小写词元；只分析键名，不扫描标题或协议标签值。
 * 词元识别可区分合法的 deviceStatus 与非法的 deviceId，也不会把 deviceIdentity 误判为 device + id。
 */
function classifyLegacyManifestField(field: string): LegacyManifestFieldKind | undefined {
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
  const compact = field.replace(/[^A-Za-z0-9]+/g, '').toLowerCase()
  const containsAdjacentWords = (first: string, seconds: ReadonlySet<string>): boolean =>
    words.some((word, index) => word === first && seconds.has(words[index + 1] ?? ''))

  if (containsAdjacentWords('device', DEVICE_IDENTIFIER_SUFFIXES) || compact === 'deviceid' || compact === 'deviceids' || compact.endsWith('deviceid') || compact.endsWith('deviceids')) {
    return 'device-identifier'
  }
  if (containsAdjacentWords('device', DEVICE_MAPPING_SUFFIXES) || compact.endsWith('devicemapping') || compact.endsWith('devicemappings')) {
    return 'device-mapping'
  }
  if (containsAdjacentWords('binding', BINDING_METADATA_SUFFIXES) || compact.endsWith('bindingcount') || compact.endsWith('bindingrevision')) {
    return 'binding-metadata'
  }
  if (containsAdjacentWords('runtime', RUNTIME_MANIFEST_SUFFIXES) || compact.endsWith('runtimemanifest')) {
    return 'runtime-manifest'
  }
  return undefined
}

/**
 * 使用显式栈扫描不可信清单，避免递归深度导致栈溢出。每个容器只访问一次，每类旧字段最多返回一个固定问题；
 * 命中旧字段后不再遍历其子树，因为整份清单已经必须拒绝，继续读取只会扩大外部输入的处理成本。
 */
function findLegacyManifestIssues(input: UnknownRecord): readonly SceneTopologyManifestValidationIssue[] {
  const stack: unknown[] = [input]
  const visited = new WeakSet<object>()
  const foundKinds = new Set<LegacyManifestFieldKind>()
  let containerCount = 0
  let entryCount = 0

  while (stack.length > 0) {
    const value = stack.pop()
    if ((!isRecord(value) && !Array.isArray(value)) || visited.has(value)) continue
    visited.add(value)
    containerCount += 1
    if (containerCount > MAX_MANIFEST_CONTAINER_COUNT) {
      return [{ code: 'manifest.capacity', message: '结构清单嵌套对象数量超过上限。' }]
    }

    if (Array.isArray(value)) {
      entryCount += value.length
      if (entryCount > MAX_MANIFEST_ENTRY_COUNT || stack.length + value.length > MAX_MANIFEST_CONTAINER_COUNT) {
        return [{ code: 'manifest.capacity', message: '结构清单字段和数组项数量超过上限。' }]
      }
      for (const item of value) {
        if (item && typeof item === 'object') stack.push(item)
      }
      continue
    }

    const fields = Object.keys(value)
    entryCount += fields.length
    if (entryCount > MAX_MANIFEST_ENTRY_COUNT) {
      return [{ code: 'manifest.capacity', message: '结构清单字段和数组项数量超过上限。' }]
    }
    for (const field of fields) {
      if (field.length > MAX_MANIFEST_FIELD_NAME_LENGTH) {
        return [{ code: 'manifest.capacity', message: '结构清单字段名称超过长度上限。' }]
      }
      const legacyKind = classifyLegacyManifestField(field)
      if (legacyKind) {
        foundKinds.add(legacyKind)
        continue
      }
      const nestedValue = value[field]
      if (nestedValue && typeof nestedValue === 'object') stack.push(nestedValue)
    }
  }

  return (Object.keys(LEGACY_MANIFEST_ISSUES) as LegacyManifestFieldKind[])
    .filter((kind) => foundKinds.has(kind))
    .map((kind) => LEGACY_MANIFEST_ISSUES[kind])
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
 * 校验 Unity 映射中的稳定标识既合法又唯一。
 *
 * 映射数组允许为空，以表达“当前场景尚未交付该类能力”；但一旦登记同一节点或路径两次，
 * 后续动作校验会被 Set（集合）去重而掩盖配置录入错误。因此必须在发布门禁中保留重复项错误。
 */
function validateUniqueIdentifierArray(
  record: UnknownRecord,
  field: string,
  label: string,
  issues: SceneTopologyManifestValidationIssue[],
  missingArrayCode: string,
  duplicateCode: string,
  duplicateMessage: string,
): void {
  const identifiers = new Set<string>()
  for (const value of readArray(record, field, issues, missingArrayCode)) {
    if (!validateIdentifier(value, label, issues)) continue
    if (identifiers.has(value)) {
      appendIssue(issues, duplicateCode, duplicateMessage)
      continue
    }
    identifiers.add(value)
  }
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

  const legacyManifestIssues = findLegacyManifestIssues(input)
  if (legacyManifestIssues.length > 0) return legacyManifestIssues

  const manifest = input
  hasNonEmptyString(manifest, 'manifestVersion', issues, 'manifest.version')
  hasNonEmptyString(manifest, 'unityBuildId', issues, 'manifest.unity-build')
  validateIdentifier(manifest.unityRuntimeKey, 'Unity运行时键', issues)

  const sceneItems = readArray(manifest, 'scenes', issues, 'manifest.scenes')
  const topologyItems = readArray(manifest, 'topologies', issues, 'manifest.topologies')
  // 旧场景清单允许完全没有说明层；一旦节点声明引用，后续交叉校验会要求同版本正式内容存在。
  const drilldownItems = manifest.drilldowns === undefined
    ? []
    : readArray(manifest, 'drilldowns', issues, 'manifest.drilldowns')
  if (drilldownItems.length > MAX_TOPOLOGY_DRILLDOWN_CONTENT_COUNT) {
    appendIssue(issues, 'drilldown.capacity', '下钻说明内容数量超过固定容量。')
  }
  const actionItems = readArray(manifest, 'actions', issues, 'manifest.actions')
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
  /** 只统计来源拓扑中的节点定义；过滤视图引用同一节点不构成第二次定义。 */
  const sourceNodeIds = new Set<string>()
  /** 同一场景三维节点最多反向对应一个逻辑节点，保证 Unity 反选结果确定。 */
  const nodeIdBySceneNodeReference = new Map<string, string>()
  /** 三维状态目标按场景限制为500个，避免一次完整快照产生无界 Unity 投影。 */
  const sceneNodeReferencesBySceneId = new Map<string, Set<string>>()
  /** 节点归属场景在解析拓扑时固定记录，后续校验三维节点时不从标题、文件名或当前 UI 回推场景。 */
  const sceneIdByTopologyNodeReference = new Map<string, string>()
  /** 下钻引用只在来源节点上登记一次，过滤视图复用节点对象而不复制或裁剪内容。 */
  const drilldownReferenceBySourceNodeId = new Map<string, string>()
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
    const nodeById = new Map<string, UnknownRecord>()
    const nodeItems = readArray(item, 'nodes', issues, 'topology.nodes')
    // 业务源拓扑的全部节点都必须允许上报 nodeId；每张图只记录一次问题，避免大清单产生重复报告。
    let sourceTopologyContainsNonReportableNode = false
    for (const nodeItem of nodeItems) {
      if (!isRecord(nodeItem) || !validateIdentifier(nodeItem.nodeId, '拓扑节点标识', issues)) {
        appendIssue(issues, 'topology.node-shape', '拓扑节点缺少有效稳定标识。')
        continue
      }


      const nodeId = nodeItem.nodeId as string
      if (nodeIds.has(nodeId)) appendIssue(issues, 'topology.duplicate-node', '同一拓扑内节点标识重复。')
      nodeIds.add(nodeId)
      nodeById.set(nodeId, nodeItem)
      if (item.filter === undefined) {
        if (sourceNodeIds.has(nodeId)) appendIssue(issues, 'topology.duplicate-source-node', '同一联动资源内来源节点标识必须全局唯一。')
        sourceNodeIds.add(nodeId)
      }
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
      if (nodeItem.sceneNodeId !== undefined && validateIdentifier(nodeItem.sceneNodeId, '三维节点标识', issues) && item.filter === undefined) {
        const sceneNodeReference = `${sceneId}:${nodeItem.sceneNodeId}`
        const previousNodeId = nodeIdBySceneNodeReference.get(sceneNodeReference)
        if (previousNodeId !== undefined && previousNodeId !== nodeId) {
          appendIssue(issues, 'topology.scene-node-duplicate', '同一场景三维节点不能映射多个逻辑节点。')
        } else {
          nodeIdBySceneNodeReference.set(sceneNodeReference, nodeId)
          const sceneTargets = sceneNodeReferencesBySceneId.get(sceneId as string) ?? new Set<string>()
          sceneTargets.add(sceneNodeReference)
          sceneNodeReferencesBySceneId.set(sceneId as string, sceneTargets)
        }
      }
      if (nodeItem.doubleClickBehavior !== 'emit-node' && nodeItem.doubleClickBehavior !== 'none') appendIssue(issues, 'topology.double-click', '节点双击行为无效。')
      if (nodeItem.doubleClickBehavior !== 'emit-node') sourceTopologyContainsNonReportableNode = true
      if (nodeItem.drilldown !== undefined) {
        if (!isRecord(nodeItem.drilldown) || nodeItem.drilldown.enabled !== true || nodeItem.drilldown.trigger !== 'button' ||
            !validateIdentifier(nodeItem.drilldown.contentKey, '下钻内容键', issues)) {
          appendIssue(issues, 'topology.drilldown-reference', '节点下钻引用必须启用独立按钮并包含有效内容键。')
        } else if (item.filter !== undefined) {
          appendIssue(issues, 'topology.filter-drilldown-reference', '过滤拓扑不得重新定义或改写来源节点的下钻引用。')
        } else {
          if (nodeItem.layerId !== 'unit-control') {
            appendIssue(issues, 'topology.drilldown-source-layer', '只有单元控制层正式节点可以声明下钻入口。')
          }
          drilldownReferenceBySourceNodeId.set(nodeId, String(nodeItem.drilldown.contentKey))
        }
      }
    }
    /*
     * 只有保存真实节点的来源总图参加门禁。流程过滤视图必须保持 nodes 为空并从来源图投影，
     * 因而会自然复用来源节点的上报能力和三维映射，不需要维护第二份节点声明。
     */
    if (item.filter === undefined && nodeItems.length > 0 && sourceTopologyContainsNonReportableNode) {
      appendIssue(issues, 'topology.source-node-reporting-permission', '业务源拓扑的所有节点都必须允许上报节点编号。')
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
      // 线色和线型只负责复现资料图片；显式校验格式，禁止把任意字符串当成样式注入画布。
      if (edgeItem.lineColor !== undefined && (typeof edgeItem.lineColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(edgeItem.lineColor))) {
        appendIssue(issues, 'topology.edge-line-color', '拓扑连线颜色必须是六位十六进制颜色值。')
      }
      if (edgeItem.lineStyle !== undefined && edgeItem.lineStyle !== 'solid' && edgeItem.lineStyle !== 'dashed') {
        appendIssue(issues, 'topology.edge-line-style', '拓扑连线线型只能是 solid 或 dashed。')
      }
      if (edgeItem.evidenceStatus !== undefined && !['verified', 'pending-confirmation', 'conceptual'].includes(String(edgeItem.evidenceStatus))) {
        appendIssue(issues, 'topology.edge-evidence-status', '拓扑连线证据状态无效。')
      }
    }

    /*
     * 重点区域是总览图专属的显式视觉声明。校验阶段同时检查入口三维绑定、成员闭环和唯一性，
     * 这样画布无需在运行时扫描标题或坐标，也不会因配置遗漏而绘制出虚假的模型范围。
     */
    if (item.filter !== undefined && item.focusRegions !== undefined) {
      appendIssue(issues, 'topology.filter-focus-regions', '关键环节过滤拓扑不得声明重点区域。')
    }
    if (item.focusRegions !== undefined) {
      const focusRegionItems = readArray(item, 'focusRegions', issues, 'topology.focus-regions')
      const regionIds = new Set<string>()
      for (const regionItem of focusRegionItems) {
        if (!isRecord(regionItem)) {
          appendIssue(issues, 'topology.focus-region-shape', '重点区域定义必须是对象。')
          continue
        }
        if (!validateIdentifier(regionItem.regionId, '重点区域标识', issues)) continue
        const regionId = String(regionItem.regionId)
        if (regionIds.has(regionId)) appendIssue(issues, 'topology.focus-region-duplicate', '同一拓扑内重点区域标识重复。')
        regionIds.add(regionId)

        const anchorNodeId = regionItem.anchorNodeId
        const anchorValid = validateIdentifier(anchorNodeId, '重点区域锚点节点标识', issues)
        const anchorNode = anchorValid ? nodeById.get(String(anchorNodeId)) : undefined
        if (!anchorNode) {
          appendIssue(issues, 'topology.focus-region-anchor', '重点区域锚点节点必须存在于当前总览拓扑。')
        } else if (typeof anchorNode.sceneNodeId !== 'string' || anchorNode.sceneNodeId.length === 0) {
          appendIssue(issues, 'topology.focus-region-anchor-binding', '重点区域锚点节点必须显式绑定三维节点。')
        }

        const memberIds = new Set<string>()
        const memberItems = readArray(regionItem, 'nodeIds', issues, 'topology.focus-region-nodes')
        for (const memberId of memberItems) {
          if (!validateIdentifier(memberId, '重点区域成员节点标识', issues)) continue
          const normalizedMemberId = String(memberId)
          if (memberIds.has(normalizedMemberId)) {
            appendIssue(issues, 'topology.focus-region-duplicate-node', '重点区域不得重复声明成员节点。')
            continue
          }
          memberIds.add(normalizedMemberId)
          if (!nodeIds.has(normalizedMemberId)) appendIssue(issues, 'topology.focus-region-node', '重点区域成员节点必须存在于当前总览拓扑。')
        }
        if (memberIds.size === 0) appendIssue(issues, 'topology.focus-region-empty', '重点区域至少需要一个成员节点。')
        if (anchorValid && !memberIds.has(String(anchorNodeId))) {
          appendIssue(issues, 'topology.focus-region-anchor-member', '重点区域成员集合必须包含锚点节点。')
        }
        if (regionItem.label !== undefined && (typeof regionItem.label !== 'string' || regionItem.label.length === 0)) {
          appendIssue(issues, 'topology.focus-region-label', '重点区域名称必须是非空字符串。')
        }
      }
    }
  }

  /*
   * 过滤拓扑必须在所有总图完成基础解析后再校验：这样来源图的节点和连线可用 Map（映射表）
   * 常数时间查询，既避免嵌套扫描整份清单，也不会把流程视图误当成另一份独立拓扑事实。
   */
  for (const topology of topologiesById.values()) {
    if (topology.filter === undefined) continue
    if (!isRecord(topology.filter)) {
      appendIssue(issues, 'topology.filter-shape', '流程拓扑过滤规则必须是对象。')
      continue
    }

    const topologyId = String(topology.topologyId)
    const sourceTopologyId = topology.filter.sourceTopologyId
    if (!validateIdentifier(sourceTopologyId, '流程拓扑来源标识', issues)) {
      appendIssue(issues, 'topology.filter-source', '流程拓扑必须显式引用来源总拓扑。')
      continue
    }

    const sourceTopology = topologiesById.get(sourceTopologyId)
    if (!sourceTopology) {
      appendIssue(issues, 'topology.filter-source', '流程拓扑引用的来源总拓扑不存在。')
      continue
    }
    if (sourceTopology.sceneId !== topology.sceneId) {
      appendIssue(issues, 'topology.filter-scene', '流程拓扑只能引用同一场景的来源总拓扑。')
    }
    if (sourceTopology.filter !== undefined) {
      appendIssue(issues, 'topology.filter-nested', '流程拓扑不能继续引用另一张流程拓扑，必须直接引用总拓扑。')
    }
    if (readArray(topology, 'nodes', issues, 'topology.nodes').length > 0 || readArray(topology, 'edges', issues, 'topology.edges').length > 0) {
      appendIssue(issues, 'topology.filter-local-content', '流程拓扑不得复制节点或连线，必须完全由来源总拓扑过滤派生。')
    }
    if (topology.layers !== undefined) {
      appendIssue(issues, 'topology.filter-local-layers', '流程拓扑不得复制展示层级，必须复用来源总拓扑的层级。')
    }

    const sourceNodesById = new Map<string, UnknownRecord>()
    for (const sourceNode of readArray(sourceTopology, 'nodes', issues, 'topology.nodes')) {
      if (isRecord(sourceNode) && typeof sourceNode.nodeId === 'string') sourceNodesById.set(sourceNode.nodeId, sourceNode)
    }
    const sourceEdgesById = new Map<string, UnknownRecord>()
    for (const sourceEdge of readArray(sourceTopology, 'edges', issues, 'topology.edges')) {
      if (isRecord(sourceEdge) && typeof sourceEdge.edgeId === 'string') sourceEdgesById.set(sourceEdge.edgeId, sourceEdge)
    }

    const visibleNodeIds = new Set<string>()
    for (const nodeId of readArray(topology.filter, 'visibleNodeIds', issues, 'topology.filter-nodes')) {
      if (!validateIdentifier(nodeId, '流程拓扑可见节点标识', issues)) continue
      if (visibleNodeIds.has(nodeId)) {
        appendIssue(issues, 'topology.filter-duplicate-node', '流程拓扑重复声明了可见节点。')
        continue
      }
      visibleNodeIds.add(nodeId)
      if (!sourceNodesById.has(nodeId)) appendIssue(issues, 'topology.filter-node', '流程拓扑引用了来源总拓扑中不存在的节点。')
    }
    if (visibleNodeIds.size < 2) appendIssue(issues, 'topology.filter-minimum-nodes', '流程拓扑至少应保留两个相连节点。')

    const visibleEdgeIds = new Set<string>()
    const visibleNodeDegrees = new Map<string, number>()
    for (const edgeId of readArray(topology.filter, 'visibleEdgeIds', issues, 'topology.filter-edges')) {
      if (!validateIdentifier(edgeId, '流程拓扑可见连线标识', issues)) continue
      if (visibleEdgeIds.has(edgeId)) {
        appendIssue(issues, 'topology.filter-duplicate-edge', '流程拓扑重复声明了可见连线。')
        continue
      }
      visibleEdgeIds.add(edgeId)
      const edge = sourceEdgesById.get(edgeId)
      if (!edge) {
        appendIssue(issues, 'topology.filter-edge', '流程拓扑引用了来源总拓扑中不存在的连线。')
        continue
      }
      const fromNodeId = String(edge.fromNodeId)
      const toNodeId = String(edge.toNodeId)
      if (!visibleNodeIds.has(fromNodeId) || !visibleNodeIds.has(toNodeId)) {
        appendIssue(issues, 'topology.filter-edge-node', '流程拓扑的可见连线两端必须同时保留为可见节点。')
        continue
      }
      visibleNodeDegrees.set(fromNodeId, (visibleNodeDegrees.get(fromNodeId) ?? 0) + 1)
      visibleNodeDegrees.set(toNodeId, (visibleNodeDegrees.get(toNodeId) ?? 0) + 1)
    }
    if (visibleEdgeIds.size === 0) appendIssue(issues, 'topology.filter-minimum-edges', '流程拓扑至少应保留一条来源总图连线。')

    /*
     * 少数业务资料会明确要求显示当前子图内没有合法连线的节点。这里采用“精确集合”豁免：
     * 声明项必须可见且实际孤立，实际孤立项也必须逐项声明。这样既忠实展示资料，又不会为了通过
     * 校验伪造来源总图中不存在的连线，或让遗漏连线的普通节点静默通过。
     */
    const allowedOrphanNodeIds = new Set<string>()
    if (topology.filter.allowedOrphanNodeIds !== undefined) {
      for (const nodeId of readArray(topology.filter, 'allowedOrphanNodeIds', issues, 'topology.filter-allowed-orphans')) {
        if (!validateIdentifier(nodeId, '流程拓扑允许孤立节点标识', issues)) continue
        if (allowedOrphanNodeIds.has(nodeId)) {
          appendIssue(issues, 'topology.filter-duplicate-allowed-orphan', '流程拓扑重复声明了允许孤立节点。')
          continue
        }
        allowedOrphanNodeIds.add(nodeId)
        if (!visibleNodeIds.has(nodeId)) {
          appendIssue(issues, 'topology.filter-allowed-orphan-hidden', '流程拓扑只能为可见节点声明孤立豁免。')
        }
      }
    }
    for (const nodeId of visibleNodeIds) {
      const isOrphan = (visibleNodeDegrees.get(nodeId) ?? 0) === 0
      const isExplicitlyAllowed = allowedOrphanNodeIds.has(nodeId)
      if (isOrphan && !isExplicitlyAllowed) {
        appendIssue(issues, 'topology.filter-orphan-node', '流程拓扑的孤立节点必须由业务资料逐项显式声明。')
      }
      if (!isOrphan && isExplicitlyAllowed) {
        appendIssue(issues, 'topology.filter-allowed-orphan-connected', '流程拓扑不得把已有可见连线的节点声明为孤立节点。')
      }
    }

    const overriddenNodeIds = new Set<string>()
    for (const override of readArray(topology.filter, 'nodeLayoutOverrides', issues, 'topology.filter-layouts')) {
      if (!isRecord(override) || !validateIdentifier(override.nodeId, '流程拓扑排布节点标识', issues)) {
        appendIssue(issues, 'topology.filter-layout-shape', '流程拓扑排布项必须包含有效节点标识。')
        continue
      }
      const nodeId = override.nodeId as string
      if (overriddenNodeIds.has(nodeId)) appendIssue(issues, 'topology.filter-duplicate-layout', '流程拓扑重复声明了节点排布。')
      overriddenNodeIds.add(nodeId)
      if (!visibleNodeIds.has(nodeId)) appendIssue(issues, 'topology.filter-layout-node', '流程拓扑只能为可见节点声明排布。')
      if (typeof override.x !== 'number' || !Number.isFinite(override.x) || override.x < 0 || override.x > 100 ||
          typeof override.y !== 'number' || !Number.isFinite(override.y) || override.y < 0 || override.y > 100) {
        appendIssue(issues, 'topology.filter-layout-position', '流程拓扑节点排布坐标必须是 0 到 100 的有限数字。')
      }
    }
    for (const nodeId of visibleNodeIds) {
      if (!overriddenNodeIds.has(nodeId)) appendIssue(issues, 'topology.filter-layout-missing', '流程拓扑必须为每个可见节点提供显式排布。')
    }

    // 为运行时设备投影和三维状态派生补齐过滤视图节点引用，仍复用来源节点对象，绝不复制一份状态事实。
    for (const nodeId of visibleNodeIds) {
      const sourceNode = sourceNodesById.get(nodeId)
      if (!sourceNode) continue
      const topologyNodeReference = `${topologyId}:${nodeId}`
      topologyNodesByRef.set(topologyNodeReference, sourceNode)
      sceneIdByTopologyNodeReference.set(topologyNodeReference, String(topology.sceneId))
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
    // 节点与路径是动作解析的唯一目标集合；重复声明不能被后续 Set 去重后静默吞掉。
    validateUniqueIdentifierArray(
      item,
      'sceneNodeIds',
      'Unity场景节点标识',
      issues,
      'unity-mapping.nodes',
      'unity-mapping.duplicate-node',
      'Unity场景映射重复登记了三维节点标识。',
    )
    validateUniqueIdentifierArray(
      item,
      'routeIds',
      'Unity场景路径标识',
      issues,
      'unity-mapping.routes',
      'unity-mapping.duplicate-route',
      'Unity场景映射重复登记了路径标识。',
    )

    /** 流程唯一性按“流程标识 + 步骤标识”判断；同一流程可合法拥有多个不同步骤。 */
    const processStepReferences = new Set<string>()
    for (const processStep of readArray(item, 'processSteps', issues, 'unity-mapping.process-steps')) {
      if (!isRecord(processStep) || !validateIdentifier(processStep.processId, '流程标识', issues) || !validateIdentifier(processStep.stepId, '步骤标识', issues)) {
        appendIssue(issues, 'unity-mapping.process-step', 'Unity流程步骤映射无效。')
        continue
      }
      const processStepReference = `${processStep.processId}:${processStep.stepId}`
      if (processStepReferences.has(processStepReference)) {
        appendIssue(issues, 'unity-mapping.duplicate-process-step', 'Unity场景映射重复登记了流程步骤。')
      } else {
        processStepReferences.add(processStepReference)
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

  /*
   * 说明内容在正式拓扑节点完成索引后统一校验。所有查询都使用 Set/Map（集合/映射），
   * 每个节点和连线只访问一次，避免“内容数 × 总拓扑节点数”的嵌套扫描。
   */
  const drilldownContentByKey = new Map<string, UnknownRecord>()
  const sourceNodeIdByContentKey = new Map<string, string>()
  for (const contentItem of drilldownItems) {
    if (!isRecord(contentItem) || !validateIdentifier(contentItem.contentKey, '下钻内容键', issues)) {
      appendIssue(issues, 'drilldown.shape', '下钻内容必须是包含有效内容键的对象。')
      continue
    }
    const contentKey = String(contentItem.contentKey)
    if (drilldownContentByKey.has(contentKey)) appendIssue(issues, 'drilldown.duplicate', '下钻内容键重复。')
    drilldownContentByKey.set(contentKey, contentItem)
    if (contentItem.version !== manifestVersion) appendIssue(issues, 'drilldown.version', '下钻内容版本与清单版本不一致。')
    hasNonEmptyString(contentItem, 'title', issues, 'drilldown.title')
    if (validateIdentifier(contentItem.sourceNodeId, '下钻来源节点标识', issues)) {
      sourceNodeIdByContentKey.set(contentKey, String(contentItem.sourceNodeId))
    }
    if (contentItem.duplicateSingleBranch !== undefined && typeof contentItem.duplicateSingleBranch !== 'boolean') {
      appendIssue(issues, 'drilldown.duplicate-layout', '单分支复制布局声明必须是布尔值。')
    }

    const localNodeIds = new Set<string>()
    const localNodeKinds = new Map<string, string>()
    let sourceCount = 0
    let sourceY = Number.POSITIVE_INFINITY
    const localNodeItems = readArray(contentItem, 'nodes', issues, 'drilldown.nodes')
    for (const localNode of localNodeItems) {
      if (!isRecord(localNode) || !validateIdentifier(localNode.id, '下钻局部节点标识', issues)) {
        appendIssue(issues, 'drilldown.node-shape', '下钻局部节点缺少有效标识。')
        continue
      }
      const localNodeId = String(localNode.id)
      if (localNodeIds.has(localNodeId)) appendIssue(issues, 'drilldown.duplicate-node', '同一下钻内容内局部节点标识重复。')
      localNodeIds.add(localNodeId)
      if (sourceNodeIds.has(localNodeId)) {
        appendIssue(issues, 'drilldown.node-id-collision', '下钻局部节点标识不得复用正式拓扑节点标识。')
      }
      hasNonEmptyString(localNode, 'title', issues, 'drilldown.node-title')
      if (localNode.kind !== 'source' && localNode.kind !== 'logic' && localNode.kind !== 'boundary') {
        appendIssue(issues, 'drilldown.node-kind', '下钻局部节点类型无效。')
      } else {
        localNodeKinds.set(localNodeId, localNode.kind)
        if (localNode.kind === 'source') {
          sourceCount += 1
          if (typeof localNode.y === 'number') sourceY = localNode.y
        }
      }
      if (typeof localNode.x !== 'number' || !Number.isFinite(localNode.x) || localNode.x < 0 || localNode.x > 100 ||
          typeof localNode.y !== 'number' || !Number.isFinite(localNode.y) || localNode.y < 0 || localNode.y > 100) {
        appendIssue(issues, 'drilldown.node-position', '下钻局部节点坐标必须是 0 到 100 的有限数字。')
      }
      if (localNode.description !== undefined && (typeof localNode.description !== 'string' || localNode.description.length === 0)) {
        appendIssue(issues, 'drilldown.node-description', '下钻局部节点说明必须是非空字符串。')
      }
      // 说明节点字段采用白名单边界，明确阻断设备状态、正式节点和三维映射混入短生命周期内容。
      for (const forbiddenField of ['nodeId', 'sceneNodeId', 'deviceStatus', 'doubleClickBehavior', 'drilldown']) {
        if (forbiddenField in localNode) appendIssue(issues, 'drilldown.node-business-field', '下钻局部节点不得包含正式拓扑、设备状态或三维交互字段。')
      }
    }
    if (localNodeItems.length === 0) appendIssue(issues, 'drilldown.empty', '下钻内容不得为空。')
    if (sourceCount !== 1) appendIssue(issues, 'drilldown.source-count', '每份下钻内容必须且只能包含一个来源节点。')
    for (const localNode of localNodeItems) {
      if (isRecord(localNode) && localNode.kind !== 'source' && typeof localNode.y === 'number' && localNode.y <= sourceY) {
        appendIssue(issues, 'drilldown.source-position', '下钻来源节点必须独自位于说明图最顶层。')
      }
    }

    const localEdgeIds = new Set<string>()
    const localEdgeItems = readArray(contentItem, 'edges', issues, 'drilldown.edges')
    for (const localEdge of localEdgeItems) {
      if (!isRecord(localEdge) || !validateIdentifier(localEdge.id, '下钻局部连线标识', issues)) {
        appendIssue(issues, 'drilldown.edge-shape', '下钻局部连线缺少有效标识。')
        continue
      }
      const localEdgeId = String(localEdge.id)
      if (localEdgeIds.has(localEdgeId)) appendIssue(issues, 'drilldown.duplicate-edge', '同一下钻内容内局部连线标识重复。')
      localEdgeIds.add(localEdgeId)
      if (!localNodeIds.has(String(localEdge.fromId)) || !localNodeIds.has(String(localEdge.toId))) {
        appendIssue(issues, 'drilldown.edge-node-reference', '下钻局部连线只能连接当前内容中的节点。')
      }
      if (localEdge.label !== undefined && (typeof localEdge.label !== 'string' || localEdge.label.length === 0)) {
        appendIssue(issues, 'drilldown.edge-label', '下钻局部连线标签必须是非空字符串。')
      }
    }
    if (localEdgeItems.length === 0) appendIssue(issues, 'drilldown.empty-edges', '下钻内容至少需要一条明确连线。')

    if (contentItem.duplicateSingleBranch === true) {
      const logicCount = [...localNodeKinds.values()].filter((kind) => kind === 'logic').length
      const boundaryCount = [...localNodeKinds.values()].filter((kind) => kind === 'boundary').length
      if (localNodeIds.size !== 3 || localEdgeIds.size !== 2 || logicCount !== 1 || boundaryCount !== 1) {
        appendIssue(issues, 'drilldown.duplicate-layout-shape', '单分支复制布局必须保持三个语义节点和两条真实连线。')
      }
    }
  }

  for (const [sourceNodeId, contentKey] of drilldownReferenceBySourceNodeId) {
    const content = drilldownContentByKey.get(contentKey)
    if (!content) {
      appendIssue(issues, 'drilldown.content-missing', '节点下钻引用的同版本说明内容不存在。')
      continue
    }
    if (String(content.sourceNodeId) !== sourceNodeId) {
      appendIssue(issues, 'drilldown.source-reference', '下钻内容来源节点与入口引用不一致。')
    }
  }
  for (const [contentKey, sourceNodeId] of sourceNodeIdByContentKey) {
    if (drilldownReferenceBySourceNodeId.get(sourceNodeId) !== contentKey) {
      appendIssue(issues, 'drilldown.unreferenced', '下钻内容必须由其正式来源节点唯一引用。')
    }
  }

  /*
   * 正向校验只能证明“场景声明的对象存在”；这里补齐反向校验，确保清单中每一张拓扑都真正被所属场景
   * 收录。没有入口的拓扑会使平台能够注入并维护一份永远不可见的设备关系，必须在发布前阻断。
   */
  for (const [topologyId, topology] of topologiesById) {
    const scene = scenesById.get(String(topology.sceneId))
    const declaredTopologyIds = scene ? readArray(scene, 'topologyIds', issues, 'scene.topology-ids').map(String) : []
    if (!scene || !declaredTopologyIds.includes(topologyId)) {
      appendIssue(issues, 'topology.scene-unlisted', '拓扑未被所属场景的拓扑列表显式收录。')
    }
  }

  for (const action of actionsById.values()) {
    const targetTopology = topologiesById.get(String(action.targetTopologyId))
    const targetSceneId = String(action.targetSceneId)
    if (!targetTopology || targetTopology.sceneId !== targetSceneId) appendIssue(issues, 'action.topology-scene', '动作目标拓扑不属于目标场景。')
    validateUnityAction(action.unityAction, targetSceneId, unityMappingsBySceneId, issues)
  }

  /*
   * 动作也必须从目标场景的受控入口可达。仅校验目标场景和拓扑正确不足以阻止“孤立动作”绕过菜单、
   * 权限与事务编排；反向收录检查让动作与场景声明形成双向闭环。
   */
  for (const [actionId, action] of actionsById) {
    const scene = scenesById.get(String(action.targetSceneId))
    const declaredActionIds = scene ? readArray(scene, 'supportedActionIds', issues, 'scene.action-ids').map(String) : []
    if (!scene || !declaredActionIds.includes(actionId)) {
      appendIssue(issues, 'action.scene-unlisted', '动作未被目标场景的动作列表显式收录。')
    }
  }

  for (const sceneTargets of sceneNodeReferencesBySceneId.values()) {
    if (sceneTargets.size > MAX_DEVICE_STATE_SCENE_NODE_TARGETS_PER_SCENE) {
      appendIssue(
        issues,
        'topology.scene-node-capacity',
        `单个场景最多允许${MAX_DEVICE_STATE_SCENE_NODE_TARGETS_PER_SCENE}个不同节点状态三维目标。`,
      )
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

import { validateStableIdentifier } from '@/config/process/identifiers'
import { validateRuntimeRegistration } from '@/config/process/runtime-registry'
import type { ProcessConfigValidationIssue, ProcessConfigurationBundle } from '@/config/process/types'

/** 将标识校验问题转换为配置发布统一错误格式。 */
function appendIdentifierIssues(value: string, field: string, issues: ProcessConfigValidationIssue[]): void {
  for (const issue of validateStableIdentifier(value)) {
    issues.push({ code: issue.code, message: `${field}：${issue.message}` })
  }
}

/**
 * 校验页面、拓扑、导览、详情、场景映射与运行时登记的引用完整性。
 * 该函数纯粹且无网络、副作用，可在配置发布前、前端加载前和单元测试中重复复用。
 */
export function validateProcessConfiguration(bundle: ProcessConfigurationBundle): ProcessConfigValidationIssue[] {
  const issues: ProcessConfigValidationIssue[] = []
  const { page, topology, guide, details, sceneMapping, runtime } = bundle
  const versions = [topology.configVersion, guide.configVersion, details.configVersion, sceneMapping.configVersion]

  appendIdentifierIssues(page.processPageId, '页面标识', issues)
  appendIdentifierIssues(page.processId, '流程标识', issues)
  appendIdentifierIssues(page.permissionCode, '页面权限码', issues)

  if (versions.some((version) => version !== page.configVersion)) {
    issues.push({ code: 'config.version-mismatch', message: '页面、拓扑、导览、详情和场景映射必须使用同一配置版本。' })
  }

  const nodeIds = new Set<string>()
  for (const node of topology.nodes) {
    appendIdentifierIssues(node.nodeId, '拓扑节点标识', issues)

    if (nodeIds.has(node.nodeId)) {
      issues.push({ code: 'topology.duplicate-node', message: `拓扑节点“${node.nodeId}”重复。` })
    }

    nodeIds.add(node.nodeId)
  }

  const edgeIds = new Set<string>()
  for (const edge of topology.edges) {
    appendIdentifierIssues(edge.edgeId, '拓扑连线标识', issues)

    if (edgeIds.has(edge.edgeId)) {
      issues.push({ code: 'topology.duplicate-edge', message: `拓扑连线“${edge.edgeId}”重复。` })
    }

    edgeIds.add(edge.edgeId)

    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      issues.push({ code: 'topology.node-reference', message: `拓扑连线“${edge.edgeId}”引用了不存在的节点。` })
    }

    if (edge.evidenceStatus !== 'verified' && edge.sceneRouteIds.length > 0) {
      issues.push({ code: 'topology.unverified-scene-route', message: `未确认连线“${edge.edgeId}”不能驱动三维路由。` })
    }
  }

  const stepIds = new Set<string>()
  for (const step of guide.steps) {
    appendIdentifierIssues(step.stepId, '流程步骤标识', issues)

    if (stepIds.has(step.stepId)) {
      issues.push({ code: 'guide.duplicate-step', message: `流程步骤“${step.stepId}”重复。` })
    }

    stepIds.add(step.stepId)

    for (const nodeId of step.nodeIds) {
      if (!nodeIds.has(nodeId)) {
        issues.push({ code: 'guide.node-reference', message: `流程步骤“${step.stepId}”引用了不存在的节点。` })
      }
    }
  }

  if (page.defaultStepId && !stepIds.has(page.defaultStepId)) {
    issues.push({ code: 'page.default-step', message: '页面默认步骤未在导览定义中找到。' })
  }

  for (const nodeId of Object.keys(details.blocksByNodeId)) {
    if (!nodeIds.has(nodeId)) {
      issues.push({ code: 'detail.node-reference', message: `详情配置引用了不存在的节点“${nodeId}”。` })
    }
  }

  const mappedNodeIds = new Set(sceneMapping.mappedNodeIds)
  const mappedRouteIds = new Set(sceneMapping.mappedRouteIds)
  for (const nodeId of mappedNodeIds) {
    if (!nodeIds.has(nodeId)) {
      issues.push({ code: 'scene.node-reference', message: `场景映射引用了不存在的节点“${nodeId}”。` })
    }
  }

  for (const step of guide.steps) {
    for (const routeId of step.activeRouteIds) {
      if (!mappedRouteIds.has(routeId)) {
        issues.push({ code: 'scene.route-reference', message: `步骤“${step.stepId}”引用了未登记的场景路由“${routeId}”。` })
      }
    }
  }

  if (page.runtimeMode === 'webgl') {
    if (!page.runtimeKey || !runtime) {
      issues.push({ code: 'runtime.registration-missing', message: '网页图形运行时尚未完成正式登记，页面将安全降级。' })
    } else {
      if (runtime.runtimeKey !== page.runtimeKey) {
        issues.push({ code: 'runtime.key-mismatch', message: '页面运行时键与登记运行时不一致。' })
      }

      if (runtime.sceneMappingVersion !== sceneMapping.configVersion || runtime.configVersion !== page.configVersion) {
        issues.push({ code: 'runtime.version-mismatch', message: '运行时、场景映射与页面配置版本不一致。' })
      }

      issues.push(...validateRuntimeRegistration(runtime))
    }
  }

  return issues
}

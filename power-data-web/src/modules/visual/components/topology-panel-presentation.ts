import type { ProcessNodeId } from '@/config/process/identifiers'
import type { TopologyDeviceStatus, TopologyEvidenceStatus, TopologyDefinition } from '@/config/process/types'

/** 连线证据状态的显示配置集中在面板视图模型，模板不再通过燃气专用条件分支决定图例。 */
interface TopologyLegendDefinition {
  evidenceStatus: TopologyEvidenceStatus
  label: string
  modifier: 'verified' | 'pending' | 'conceptual' | 'unclassified'
}

/** 设备四态摘要的固定展示顺序，避免对象遍历顺序导致不同拓扑的状态说明来回跳动。 */
interface TopologyDeviceStatusDefinition {
  deviceStatus: TopologyDeviceStatus
  label: string
}

export interface TopologyPanelPresentation {
  title: string
  legends: readonly TopologyLegendDefinition[]
  statusSummary: string
  isEmpty: boolean
}

const legendDefinitions: readonly TopologyLegendDefinition[] = [
  { evidenceStatus: 'verified', label: '已确认', modifier: 'verified' },
  { evidenceStatus: 'pending-confirmation', label: '待确认', modifier: 'pending' },
  { evidenceStatus: 'conceptual', label: '概念连接', modifier: 'conceptual' },
  { evidenceStatus: 'unclassified', label: '未分类关系', modifier: 'unclassified' },
]

const deviceStatusDefinitions: readonly TopologyDeviceStatusDefinition[] = [
  { deviceStatus: 'normal', label: '正常' },
  { deviceStatus: 'alarm', label: '告警' },
  { deviceStatus: 'fault', label: '故障' },
  { deviceStatus: 'offline', label: '离线' },
]

/**
 * 根据当前拓扑配置创建只读面板展示模型。
 * 这里只统计已经进入配置的数据，不从标题、场景文件名或设备资源反推任何状态；复杂度为节点数与连线数之和。
 */
export function createTopologyPanelPresentation(
  topology: TopologyDefinition,
  nodeStatuses: ReadonlyMap<ProcessNodeId, TopologyDeviceStatus> | undefined = undefined,
): TopologyPanelPresentation {
  const evidenceStatuses = new Set(topology.edges.map((edge) => edge.evidenceStatus))
  const legends = legendDefinitions.filter((definition) => evidenceStatuses.has(definition.evidenceStatus))

  if (topology.nodes.length === 0) {
    return {
      title: toDisplayTitle(topology.title),
      legends,
      statusSummary: '当前拓扑尚未发布节点配置，不会根据页面名称、资源名称或坐标推断拓扑结构。',
      isEmpty: true,
    }
  }

  const countByStatus = new Map<TopologyDeviceStatus, number>()
  for (const node of topology.nodes) {
    // 当前快照只覆盖已声明的节点；缺失值严格回退到配置基线，不从名称或外部字段推测状态。
    const deviceStatus = nodeStatuses?.get(node.nodeId) ?? node.deviceStatus
    countByStatus.set(deviceStatus, (countByStatus.get(deviceStatus) ?? 0) + 1)
  }

  const statusItems = deviceStatusDefinitions
    .map((definition) => `${definition.label} ${countByStatus.get(definition.deviceStatus) ?? 0}`)
    .join('，')

  return {
    title: toDisplayTitle(topology.title),
    legends,
    statusSummary: `当前拓扑已配置 ${topology.nodes.length} 个节点：${statusItems}。状态以当前拓扑配置为准。`,
    isEmpty: false,
  }
}

/** 配置错误时显示通用降级标题，避免组件回退到任何业务领域名称。 */
function toDisplayTitle(title: string): string {
  const normalizedTitle = title.trim()
  return normalizedTitle || '未命名拓扑'
}

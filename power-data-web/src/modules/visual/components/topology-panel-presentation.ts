import type { TopologyEvidenceStatus, TopologyDefinition } from '@/config/process/types'

/** 连线证据状态的显示配置集中在面板视图模型，模板不再通过燃气专用条件分支决定图例。 */
interface TopologyLegendDefinition {
  evidenceStatus: TopologyEvidenceStatus
  label: string
  modifier: 'verified' | 'pending' | 'conceptual' | 'unclassified'
}

export interface TopologyPanelPresentation {
  title: string
  legends: readonly TopologyLegendDefinition[]
  /** 空拓扑才展示说明，常规态不再占用画布高度展示节点和状态统计。 */
  emptyMessage: string
  isEmpty: boolean
}

const legendDefinitions: readonly TopologyLegendDefinition[] = [
  { evidenceStatus: 'verified', label: '已确认', modifier: 'verified' },
  { evidenceStatus: 'pending-confirmation', label: '待确认', modifier: 'pending' },
  { evidenceStatus: 'conceptual', label: '概念连接', modifier: 'conceptual' },
  { evidenceStatus: 'unclassified', label: '未分类关系', modifier: 'unclassified' },
]

/**
 * 根据当前拓扑配置创建只读面板展示模型。
 * 常规态只提取标题和已声明连线图例，避免为了不展示的状态摘要遍历全部节点；
 * 空拓扑说明固定由组件提供，不从页面名称、资源名称或坐标推断拓扑结构。
 */
export function createTopologyPanelPresentation(topology: TopologyDefinition): TopologyPanelPresentation {
  const evidenceStatuses = new Set(topology.edges.map((edge) => edge.evidenceStatus))
  const legends = legendDefinitions.filter((definition) => evidenceStatuses.has(definition.evidenceStatus))

  if (topology.nodes.length === 0) {
    return {
      title: toDisplayTitle(topology.title),
      legends,
      emptyMessage: '当前拓扑尚未发布节点配置，不会根据页面名称、资源名称或坐标推断拓扑结构。',
      isEmpty: true,
    }
  }

  return {
    title: toDisplayTitle(topology.title),
    legends,
    emptyMessage: '',
    isEmpty: false,
  }
}

/** 配置错误时显示通用降级标题，避免组件回退到任何业务领域名称。 */
function toDisplayTitle(title: string): string {
  const normalizedTitle = title.trim()
  return normalizedTitle || '未命名拓扑'
}

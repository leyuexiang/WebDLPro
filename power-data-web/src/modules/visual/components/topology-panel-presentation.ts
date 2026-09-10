import type { TopologyDefinition } from '@/config/process/types'

export interface TopologyPanelPresentation {
  title: string
  /** 公共面板只保留无障碍标题和空态，不再构造会占用画布空间的标题栏展示数据。 */
  emptyMessage: string
  isEmpty: boolean
}

/**
 * 根据当前拓扑配置创建只读面板展示模型。
 * 常规态只读取标题和节点数量，不再遍历连线生成已移除的图例，拓扑切换成本保持常数级；
 * 空拓扑说明固定由组件提供，不从页面名称、资源名称或坐标猜测拓扑结构。
 */
export function createTopologyPanelPresentation(topology: TopologyDefinition): TopologyPanelPresentation {
  if (topology.nodes.length === 0) {
    return {
      title: toDisplayTitle(topology.title),
      emptyMessage: '当前拓扑尚未发布节点配置，不会根据页面名称、资源名称或坐标推断拓扑结构。',
      isEmpty: true,
    }
  }

  return {
    title: toDisplayTitle(topology.title),
    emptyMessage: '',
    isEmpty: false,
  }
}

/** 配置错误时显示通用降级标题，避免组件回退到任何业务领域名称。 */
function toDisplayTitle(title: string): string {
  const normalizedTitle = title.trim()
  return normalizedTitle || '未命名拓扑'
}

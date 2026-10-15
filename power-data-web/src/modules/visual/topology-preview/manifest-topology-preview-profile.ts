import type { Meta2dData, Pen } from '@meta2d/core'
import type { TopologyDataContext } from '@/modules/visual/topology/topology-runtime'
import type { SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/** 清单式第二层拓扑的完整文件描述；每个筛选组合只能命中一项。 */
export interface ManifestTopologyPreviewVariant {
  readonly id: string
  readonly combinationKey: string
  readonly layerIds: readonly string[]
  readonly topologyPath: string
  readonly sourceSha256: string
  readonly expectedPenCount: number
  readonly isDefault?: true
}

/** 公共筛选轨只消费展示字段，不读取场景专属拓扑数据。 */
export interface ManifestTopologyPreviewFilterGroup {
  readonly id: string
  readonly options: readonly {
    readonly id: string
    readonly label: string
    readonly color: string
  }[]
}

/** 图片设备悬浮提示使用源数据标题；无业务状态映射时明确显示预览默认态。 */
export interface ManifestTopologyPreviewTooltip {
  readonly penId: string
  readonly title: string
  readonly status: string
}

/**
 * 各业务场景向公共二维组态画布提供的最小能力集合。
 * 数据加载、资源清单和筛选状态机仍由场景模块负责，公共画布只协调生命周期。
 */
export interface ManifestTopologyPreviewProfile {
  readonly sceneLabel: string
  readonly defaultVariantId: string
  readonly filterGroups: readonly ManifestTopologyPreviewFilterGroup[]
  /** 正式发布用的 penId → nodeId → sceneNodeId 清单；预览层不得自行推导绑定。 */
  readonly runtimeBindings?: readonly SubstationTopologyRuntimeBinding[]
  createDefaultSelection(): ReadonlySet<string>
  toggleFilter(current: ReadonlySet<string>, filterId: string, checked: boolean): ReadonlySet<string>
  resolveVariant(selected: ReadonlySet<string>): ManifestTopologyPreviewVariant | undefined
  formatSelection(selected: ReadonlySet<string>): string
  loadData(variantId: string, signal?: AbortSignal): Promise<Meta2dData>
  /** 第三层上下文由公共画布按显式清单加载；未实现时保持第二层文件，不做路径猜测。 */
  loadDataContext?(context: TopologyDataContext, signal?: AbortSignal): Promise<Meta2dData>
  getTooltipContent(pen: Pen): ManifestTopologyPreviewTooltip | undefined
}

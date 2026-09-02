import type { NodeId, RouteId, SceneId, SceneNodeId, TopologyId, TransitionId } from '@/config/scene-topology/identifiers'
import type { DeviceVisualStatus, TopologyDefinition } from '@/config/scene-topology/types'
import type { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import { TopologyDeviceStateCache, type TopologyNodeStateApplyResult, type TopologyNodeStateBatch } from '@/modules/visual/topology/topology-device-state-cache'

/** 单个拓扑的有限视图状态；不保存 Canvas、图片、事件回调或原始设备消息。 */
export interface TopologyViewState {
  zoom: number
  offsetX: number
  offsetY: number
  selectedNodeIds: readonly NodeId[]
  selectedRouteIds: readonly RouteId[]
}

/**
 * 画布可读取的视口状态只包含缩放与平移，不携带选择。
 * 选择属于拓扑运行时的稳定业务状态，必须继续由运行时缓存，避免画布适配器把旧画布的临时选中结果
 * 作为新拓扑输入；切换前将这三个值与运行时缓存的选择合并，即可在复用唯一画布时完整恢复视图。
 */
export type TopologyViewportState = Pick<TopologyViewState, 'zoom' | 'offsetX' | 'offsetY'>

/** 运行时已准备但尚未激活的轻量配置快照，不含任何隐藏画布或异步资源句柄。 */
export interface PreparedTopology {
  sceneId: SceneId
  topologyId: TopologyId
  topologyVersion: string
  transitionId: TransitionId
  topology: TopologyDefinition
}

/** 画布适配器只实现当前活动画布所需最小能力；运行时不拥有第二个 Canvas 实例。 */
export interface TopologyCanvasPort {
  setTopology(topology: TopologyDefinition): void
  setSelection(nodeIds: readonly NodeId[], routeIds: readonly RouteId[]): void
  /** 状态覆盖与选择、缩放、平移分离；实现方只能更新当前画布节点状态，不能替换拓扑定义。 */
  setNodeStatuses(statuses: ReadonlyMap<NodeId, DeviceVisualStatus>): void
  /** 在替换拓扑定义前读取唯一画布的当前缩放和平移，供有限运行时缓存保存。 */
  getViewState(): TopologyViewportState | undefined
  restoreViewState(state: TopologyViewState): void
  dispose(): void
}

/**
 * 单画布多拓扑运行时。
 * prepare（准备）只查询、校验并缓存拓扑；activate（激活）只接受当前事务的准备结果，
 * 从而避免旧事务或准备失败清空正在显示的拓扑。
 */
export class TopologyRuntime {
  private readonly preparedByTopologyId = new Map<TopologyId, PreparedTopology>()
  private readonly viewStateByTopologyId = new Map<TopologyId, TopologyViewState>()
  /** 实时设备状态与准备缓存分离，状态更新不会改变拓扑定义、视图状态或活动事务。 */
  private readonly deviceStateCache: TopologyDeviceStateCache
  private activeTopology: PreparedTopology | undefined
  private disposed = false

  public constructor(
    private readonly registry: TopologyRegistry,
    private readonly canvas: TopologyCanvasPort,
    private readonly maximumPreparedTopologies = 8,
    private readonly maximumViewStates = 8,
    maximumDeviceStates: number = 500,
    maximumStatusSnapshots: number = 8,
  ) {
    this.deviceStateCache = new TopologyDeviceStateCache(registry, {
      maximumDeviceStates,
      maximumTopologySnapshots: maximumStatusSnapshots,
      maximumSceneSnapshots: maximumStatusSnapshots,
    })
  }

  /**
   * 预解析目标拓扑但不操作画布。场景边界、拓扑版本和事务标识均显式保存在结果中，
   * 调用方可在 Unity 场景与动作成功后才调用 activate，避免展示错误组合。
   */
  public prepare(sceneId: SceneId, topologyId: TopologyId, transitionId: TransitionId): PreparedTopology | undefined {
    if (this.disposed) return undefined
    const topology = this.registry.getTopologyForScene(sceneId, topologyId)
    if (!topology) return undefined

    const cached = this.preparedByTopologyId.get(topologyId)
    const prepared = cached && cached.topologyVersion === topology.configVersion && cached.sceneId === sceneId
      ? { ...cached, transitionId }
      : { sceneId, topologyId, topologyVersion: topology.configVersion, transitionId, topology }

    this.cachePreparedTopology(prepared)
    return prepared
  }

  /**
   * 仅激活属于当前事务的已准备拓扑。旧事务、已释放运行时和不存在的准备结果都不会影响活动画布。
   * 成功时复用同一画布适配器，按缓存恢复缩放、平移和选择，而不是创建隐藏 Canvas 池。
   */
  public activate(prepared: PreparedTopology, activeTransitionId: TransitionId): boolean {
    if (this.disposed || prepared.transitionId !== activeTransitionId) return false
    const cached = this.preparedByTopologyId.get(prepared.topologyId)
    if (!cached || cached.topologyVersion !== prepared.topologyVersion || cached.sceneId !== prepared.sceneId) return false

    const previousTopology = this.activeTopology
    if (previousTopology) this.cacheActiveViewState(previousTopology.topologyId)

    try {
      this.canvas.setTopology(prepared.topology)
      const restoredViewState = this.viewStateByTopologyId.get(prepared.topologyId)
      /*
       * 首次激活没有用户产生的视口快照，不能伪造 { 缩放: 1, 平移: 0 } 并下发给画布。
       * JSON 源图元坐标可能远离原点，伪默认值会覆盖画布首次的全图适配，造成数据已加载但
       * 所有图元落在可视区外。只有从真实活动画布缓存过的视口才允许恢复；首次进入则让
       * 画布组件依据全部图元自动居中。两种分支都显式清空选择，保持稳定业务状态一致。
       */
      if (restoredViewState) {
        this.canvas.restoreViewState(restoredViewState)
        this.canvas.setSelection(restoredViewState.selectedNodeIds, restoredViewState.selectedRouteIds)
      } else {
        this.canvas.setSelection([], [])
      }
      // 新画布定义先恢复，再写当前拓扑的状态覆盖；状态缓存不会改动选择、缩放、平移或路径定义。
      this.deviceStateCache.setActiveContext(prepared.sceneId, prepared.topologyId)
      this.canvas.setNodeStatuses(this.deviceStateCache.getActiveTopologyNodeStatuses())
      this.activeTopology = prepared
      return true
    } catch {
      /*
       * 画布端口可能在销毁、浏览器资源异常或适配器失败时抛错。
       * 立即尝试回放上一个已知拓扑；即使该补偿也失败，activeTopology 仍不改写为目标值，
       * 上层事务会据此执行三维回退或进入明确错误态，绝不提交混合上下文。
       */
      if (previousTopology) {
        this.restorePreviousCanvas(previousTopology)
      } else {
        /*
         * 首图激活没有可回放的旧拓扑。此前状态缓存已经短暂指向候选场景，若不显式清空，
         * 后续三维重投影可能把未成功激活的目标场景状态发送给 Unity；清空后只能由下一次成功 activate 重新建立上下文。
         */
        this.deviceStateCache.setActiveContext(undefined, undefined)
      }
      return false
    }
  }

  /**
   * 平台总览成功切入后停用业务拓扑，但不销毁或替换唯一 Canvas。
   * 当前视口先写入有限缓存，选择同步清空；重复停用保持幂等，状态更新随后只进入权威缓存而不会触碰隐藏旧图。
   */
  public deactivate(): boolean {
    if (this.disposed) return false
    const previousTopology = this.activeTopology
    if (!previousTopology) {
      this.deviceStateCache.setActiveContext(undefined, undefined)
      return true
    }

    try {
      this.cacheActiveViewState(previousTopology.topologyId)
      const cachedState = this.viewStateByTopologyId.get(previousTopology.topologyId) ?? this.getDefaultViewState()
      this.cacheViewState(previousTopology.topologyId, {
        ...cachedState,
        selectedNodeIds: [],
        selectedRouteIds: [],
      })
      this.canvas.setSelection([], [])
      this.activeTopology = undefined
      this.deviceStateCache.setActiveContext(undefined, undefined)
      return true
    } catch {
      // 停用失败时保留原活动拓扑，由事务层回切 Unity 或进入明确错误态，不能提交隐藏但仍可操作的旧拓扑。
      return false
    }
  }

  /**
   * 进入第三层前暂停唯一拓扑画布：先保存当前视口和选择，再撤销二维拓扑上下文，但不清空缓存中的选择。
   * 页面会同时隐藏并 inert（禁用交互）该容器，因此这里不触发 setTopology、布局或重绘；同时保留已校验的
   * `sceneId + stateNodeId`（场景编号 + 状态节点编号）作为唯一三维投影目标。这样播放、停止等实时状态不会
   * 因为拓扑暂停而丢失到 Unity 的投递链路，也不会把同场景其他设备状态扩散到独立关键环节模型。
   * 返回第二层时 activate（激活）会以业务拓扑上下文覆盖此临时筛选，并恢复原视口、选择和当前设备状态。
   */
  public suspendForProcessDetail(sceneId: SceneId, stateNodeId: SceneNodeId): boolean {
    if (this.disposed) return false
    const previousTopology = this.activeTopology
    // 调用方只能从同一业务场景进入第三层，防止目录错误将另一场景的设备状态投递给当前独立模型。
    if (!previousTopology || previousTopology.sceneId !== sceneId) return false

    try {
      this.cacheActiveViewState(previousTopology.topologyId)
      this.activeTopology = undefined
      this.deviceStateCache.setActiveContext(sceneId, undefined, stateNodeId)
      return true
    } catch {
      // 保存失败时继续保留旧活动拓扑，事务遮罩会阻断操作并由上层退出刚加载的第三层实例。
      return false
    }
  }

  /**
   * 已处第三层时只切换状态投影目标，不激活拓扑、不触碰画布，也不重新加载 Unity 资源。
   * 调用方必须先由目录验证同场景目标；活动二维拓扑存在时拒绝重定向，防止第二层状态被错误收窄。
   */
  public retargetProcessDetail(sceneId: SceneId, stateNodeId: SceneNodeId): boolean {
    if (this.disposed || this.activeTopology) return false
    this.deviceStateCache.setActiveContext(sceneId, undefined, stateNodeId)
    return true
  }

  /** 单次选择只更新当前画布，不重建拓扑、节点索引或路径缓存。 */
  public setSelection(nodeIds: readonly NodeId[], routeIds: readonly RouteId[]): void {
    if (this.disposed || !this.activeTopology) return
    const viewState = { ...(this.viewStateByTopologyId.get(this.activeTopology.topologyId) ?? this.getDefaultViewState()), selectedNodeIds: [...nodeIds], selectedRouteIds: [...routeIds] }
    this.cacheViewState(this.activeTopology.topologyId, viewState)
    this.canvas.setSelection(nodeIds, routeIds)
  }

  /**
   * 应用已由上层协议校验的设备状态批次。
   * 当前活动二维快照会在同一调用内写入唯一画布；当前三维节点快照仅作为受控返回值提供给任务-038，
   * 本任务不绕过能力协商直接向 Unity 发送 `setNodeVisualState`（设置节点视觉状态）命令。
   */
  public applyDeviceStates(batch: TopologyNodeStateBatch): TopologyNodeStateApplyResult {
    if (this.disposed) {
      return {
        committed: false,
        capacityExceeded: false,
        snapshotSequence: 0,
        acceptedNodeIds: [],
        restoredNodeIds: [],
        outdatedNodeIds: [],
        unmappedNodeIds: [],
        invalidTimestampNodeIds: [],
        activeTopologyNodeStatuses: new Map(),
        activeSceneNodeStatuses: new Map(),
        // 已释放运行时没有活动 Unity 场景；返回空投影可阻止任务-038在释放后安排新的内层状态命令。
        activeSceneNodeStateUpdates: new Map(),
        clearedActiveSceneNodeIds: [],
      }
    }

    /*
     * 第二层以活动拓扑建立完整场景投影；第三层没有活动拓扑时，suspendForProcessDetail 已经登记了
     * 唯一状态节点筛选。这里不得用 undefined 覆盖该上下文，否则停止按钮提交的故障态会只写入缓存
     * 而不会生成 Unity 状态命令。
     */
    if (this.activeTopology) {
      this.deviceStateCache.setActiveContext(this.activeTopology.sceneId, this.activeTopology.topologyId)
    }
    return this.deviceStateCache.apply(batch, (candidate) => {
      /*
       * 二维画布必须先成功接纳候选完整快照，缓存才会交换权威状态引用。
       * 若画布抛错，异常交给现有协调器转换为受控失败；缓存仍保留上一份快照，避免半提交。
       */
      if (this.activeTopology) this.canvas.setNodeStatuses(candidate.activeTopologyNodeStatuses)
    })
  }

  /** 返回当前活动场景已显式映射的三维节点状态；调用方只能拿到防御性快照，不能访问缓存本体。 */
  public getActiveSceneNodeStatuses(): ReadonlyMap<SceneNodeId, DeviceVisualStatus> {
    return this.deviceStateCache.getActiveSceneNodeStatuses()
  }

  /** 场景重新激活时只公开当前权威快照投影，任务-038不得访问缓存历史或自行猜测三维状态。 */
  public getActiveSceneNodeStateSnapshot() {
    return this.deviceStateCache.getActiveSceneNodeStateSnapshot()
  }

  /** 当前画布报告视图后写入有限缓存；配置版本变更由 prepare 自动淘汰对应旧视图。 */
  public saveActiveViewState(state: TopologyViewState): void {
    if (this.disposed || !this.activeTopology) return
    this.cacheViewState(this.activeTopology.topologyId, state)
  }

  /** 返回活动拓扑的不可变数据引用；无活动拓扑时明确返回 undefined。 */
  public getActiveTopology(): PreparedTopology | undefined {
    return this.activeTopology
  }

  /** 清理当前画布、准备缓存和视图状态；重复释放不会再次调用画布释放。 */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.activeTopology = undefined
    this.preparedByTopologyId.clear()
    this.viewStateByTopologyId.clear()
    this.deviceStateCache.dispose()
    this.canvas.dispose()
  }

  /** 最近使用缓存采用删除后重插入的 LRU（最近最少使用）顺序，容量固定且不保存资源对象。 */
  private cachePreparedTopology(prepared: PreparedTopology): void {
    this.preparedByTopologyId.delete(prepared.topologyId)
    this.preparedByTopologyId.set(prepared.topologyId, prepared)
    while (this.preparedByTopologyId.size > this.maximumPreparedTopologies) {
      const oldestTopologyId = this.preparedByTopologyId.keys().next().value
      if (!oldestTopologyId) break
      this.preparedByTopologyId.delete(oldestTopologyId)
      this.viewStateByTopologyId.delete(oldestTopologyId)
    }
  }

  /** 视图状态同样受独立容量约束，避免用户切换大量图后保留无界选择和缩放历史。 */
  private cacheViewState(topologyId: TopologyId, state: TopologyViewState): void {
    this.viewStateByTopologyId.delete(topologyId)
    this.viewStateByTopologyId.set(topologyId, {
      zoom: state.zoom,
      offsetX: state.offsetX,
      offsetY: state.offsetY,
      selectedNodeIds: [...state.selectedNodeIds],
      selectedRouteIds: [...state.selectedRouteIds],
    })
    while (this.viewStateByTopologyId.size > this.maximumViewStates) {
      const oldestTopologyId = this.viewStateByTopologyId.keys().next().value
      if (!oldestTopologyId) break
      this.viewStateByTopologyId.delete(oldestTopologyId)
    }
  }

  /**
   * 在 setTopology（设置拓扑）替换画布定义前保存当前视口。
   * 画布仅是缩放和平移的事实来源，运行时缓存才是选择的事实来源；二者合并后写回有限 LRU（最近最少使用）
   * 缓存，确保用户在多套拓扑之间往返时不会丢失视图，同时不创建第二个画布或额外状态容器。
   */
  private cacheActiveViewState(topologyId: TopologyId): void {
    const cachedState = this.viewStateByTopologyId.get(topologyId) ?? this.getDefaultViewState()
    const viewportState = this.canvas.getViewState()
    this.cacheViewState(topologyId, {
      ...cachedState,
      ...(viewportState ?? {}),
    })
  }

  /** 尽力恢复画布显示；该私有补偿不改变活动拓扑登记，成功与否都由 activate 的 false 交给事务层裁决。 */
  private restorePreviousCanvas(previousTopology: PreparedTopology | undefined): void {
    if (!previousTopology) return

    try {
      const viewState = this.viewStateByTopologyId.get(previousTopology.topologyId)
      this.canvas.setTopology(previousTopology.topology)
      // 与正常首次激活保持同一规则：没有真实快照时不覆盖组件的初始全图适配。
      if (viewState) {
        this.canvas.restoreViewState(viewState)
        this.canvas.setSelection(viewState.selectedNodeIds, viewState.selectedRouteIds)
      } else {
        this.canvas.setSelection([], [])
      }
      this.deviceStateCache.setActiveContext(previousTopology.sceneId, previousTopology.topologyId)
      this.canvas.setNodeStatuses(this.deviceStateCache.getActiveTopologyNodeStatuses())
    } catch {
      // 补偿失败不记录底层异常或重试；运行时的明确错误态会释放用户交互并避免无界恢复循环。
    }
  }

  /** 新拓扑默认使用完整视图和空选择，且该对象不会被外部调用方修改。 */
  private getDefaultViewState(): TopologyViewState {
    return { zoom: 1, offsetX: 0, offsetY: 0, selectedNodeIds: [], selectedRouteIds: [] }
  }
}

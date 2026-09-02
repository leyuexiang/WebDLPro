import type { NodeId, SceneId, SceneNodeId, TopologyId } from '@/config/scene-topology/identifiers'
import type { DeviceVisualStatus } from '@/config/scene-topology/types'
import type { RegisteredNodeStateProjection, TopologyRegistry } from '@/config/scene-topology/topology-registry'

/**
 * 协议入口已经完成节点编号、四态和带时区时间校验，缓存只接收强类型数据。
 * 缓存不得把未知枚举推断为离线，也不得再次用业务时间决定快照新旧。
 */
export interface TopologyNodeStateUpdate {
  nodeId: NodeId
  deviceStatus: DeviceVisualStatus
  statusUpdatedAt: string
}

/**
 * 当前权威快照投影到单个三维节点的最小状态。
 * 来源修订号和状态时间仅供诊断与内层协议透传，不参与壳侧接纳、覆盖或排序判断。
 */
export interface TopologySceneNodeVisualStateUpdate {
  visualState: DeviceVisualStatus
  statusUpdatedAt: string
  sourceRevision: number
}

/** 每次调用都是当前资源下全部已上报逻辑节点的完整快照，后到合法快照直接替换前一份。 */
export interface TopologyNodeStateBatch {
  sourceRevision: number
  items: readonly TopologyNodeStateUpdate[]
}

/**
 * 单次完整快照的二维、三维投影结果。
 * 旧字段保留为空数组，避免任务-038改造前破坏诊断调用；它们不再表达任何拒绝语义。
 */
export interface TopologyNodeStateApplyResult {
  committed: boolean
  capacityExceeded: boolean
  /** 壳会话内成功提交的本地单调序号；仅描述快照提交顺序，不替代外部来源修订号。 */
  snapshotSequence: number
  acceptedNodeIds: readonly NodeId[]
  restoredNodeIds: readonly NodeId[]
  outdatedNodeIds: readonly NodeId[]
  unmappedNodeIds: readonly NodeId[]
  invalidTimestampNodeIds: readonly NodeId[]
  activeTopologyNodeStatuses: ReadonlyMap<NodeId, DeviceVisualStatus>
  activeSceneNodeStatuses: ReadonlyMap<SceneNodeId, DeviceVisualStatus>
  /** 当前活动场景的完整三维投影；任务-038可据此合帧，但不得让其结果反向影响本次二维提交。 */
  activeSceneNodeStateUpdates: ReadonlyMap<SceneNodeId, TopologySceneNodeVisualStateUpdate>
  /** 上一份活动场景投影存在、本次已缺失的目标；后续三维协调任务据此恢复发布基线。 */
  clearedActiveSceneNodeIds: readonly SceneNodeId[]
}

/** 权威表只保存已识别设备的最新合法状态，不保存外层消息对象或派生渲染资源。 */
interface CachedNodeState {
  deviceStatus: DeviceVisualStatus
  statusUpdatedAt: string
  sourceRevision: number
}

/** 构建完成但尚未提交的候选快照；画布成功应用后才允许引用交换。 */
interface PreparedNodeStateSnapshot {
  nextStateByNodeId: Map<NodeId, CachedNodeState>
  result: TopologyNodeStateApplyResult
}

/** 权威设备表有固定硬上限；最近最少使用只用于可重建的拓扑和场景派生快照。 */
export interface TopologyDeviceStateCacheOptions {
  maximumDeviceStates?: number
  maximumTopologySnapshots?: number
  maximumSceneSnapshots?: number
}

/**
 * 完整节点状态快照到二维、三维稳定标识的有限投影缓存。
 * 清单加载时已经预建 `nodeId → 二维目标 + 可选三维目标` 索引，因此热路径只遍历本批节点及其直接目标；
 * 权威节点表从不做最近最少使用淘汰，只有可由权威表重建的派生快照受八份容量限制。
 */
export class TopologyDeviceStateCache {
  private latestStateByNodeId = new Map<NodeId, CachedNodeState>()
  private readonly nodeStatusesByTopologyId = new Map<TopologyId, Map<NodeId, DeviceVisualStatus>>()
  private readonly sceneNodeStatusesBySceneId = new Map<SceneId, Map<SceneNodeId, DeviceVisualStatus>>()
  private activeTopologyId: TopologyId | undefined
  private activeSceneId: SceneId | undefined
  /**
   * 第三层只允许当前独立资源接收自身登记的状态节点。
   * 该筛选与二维活动拓扑彻底分离：进入关键环节后拓扑可以暂停，实时状态仍可持续投影到唯一模型；
   * 未设置时表示第二层业务场景，需要按场景投影全部显式登记的三维节点。
   */
  private activeSceneNodeIdFilter: SceneNodeId | undefined
  private snapshotSequence = 0
  private disposed = false

  private readonly maximumDeviceStates: number
  private readonly maximumTopologySnapshots: number
  private readonly maximumSceneSnapshots: number

  public constructor(
    private readonly registry: TopologyRegistry,
    options: TopologyDeviceStateCacheOptions = {},
  ) {
    this.maximumDeviceStates = normalizeCapacity(options.maximumDeviceStates, 500)
    this.maximumTopologySnapshots = normalizeCapacity(options.maximumTopologySnapshots, 8)
    this.maximumSceneSnapshots = normalizeCapacity(options.maximumSceneSnapshots, 8)
  }

  /**
   * 激活上下文只决定本次返回和派生缓存保护范围，不会创建场景、画布或 Unity（统一引擎）对象。
   * `sceneNodeIdFilter` 仅供第三层独立模型使用，必须来自已经校验的清单状态节点，不能由模型名或页面参数推断。
   */
  public setActiveContext(
    sceneId: SceneId | undefined,
    topologyId: TopologyId | undefined,
    sceneNodeIdFilter?: SceneNodeId,
  ): void {
    if (this.disposed) return
    this.activeSceneId = sceneId
    this.activeTopologyId = topologyId
    this.activeSceneNodeIdFilter = sceneId ? sceneNodeIdFilter : undefined
  }

  /**
   * 构建候选完整快照，并在可选的同步二维提交成功后原子替换权威表。
   * `beforeCommit` 只供唯一画布写入候选二维投影；若其抛错，本方法不交换权威表、不清派生缓存，
   * 从而保证画布和缓存不会出现一边是新快照、一边仍是旧快照的半提交状态。
   */
  public apply(
    batch: TopologyNodeStateBatch,
    beforeCommit?: (candidate: TopologyNodeStateApplyResult) => void,
  ): TopologyNodeStateApplyResult {
    if (this.disposed) return this.createUncommittedResult(false)
    if (batch.items.length > this.maximumDeviceStates) return this.createUncommittedResult(true)

    const prepared = this.prepareSnapshot(batch)
    beforeCommit?.(prepared.result)

    /*
     * 候选构建和画布写入均为同步过程；只有全部成功后才交换权威表。
     * 随后清空可重建派生缓存并播种当前上下文，避免其他拓扑继续持有上一份完整快照的颜色覆盖。
     */
    this.latestStateByNodeId = prepared.nextStateByNodeId
    this.snapshotSequence += 1
    this.nodeStatusesByTopologyId.clear()
    this.sceneNodeStatusesBySceneId.clear()
    this.seedActiveSnapshots(prepared.result.activeTopologyNodeStatuses, prepared.result.activeSceneNodeStatuses)

    return {
      ...prepared.result,
      committed: true,
      snapshotSequence: this.snapshotSequence,
    }
  }

  /** 返回指定拓扑相对发布基线的动态覆盖；派生缓存淘汰后从权威表按需重建。 */
  public getTopologyNodeStatuses(topologyId: TopologyId): ReadonlyMap<NodeId, DeviceVisualStatus> {
    if (this.disposed) return new Map()
    const cached = this.nodeStatusesByTopologyId.get(topologyId)
    if (cached) {
      this.touchTopologySnapshot(topologyId, cached)
      return new Map(cached)
    }

    const hydrated = this.buildTopologyProjection(this.latestStateByNodeId, topologyId)
    this.touchTopologySnapshot(topologyId, hydrated)
    return new Map(hydrated)
  }

  /** 返回指定场景当前全部已识别设备的三维状态；没有三维目标的设备不会虚构目标。 */
  public getSceneNodeStatuses(sceneId: SceneId): ReadonlyMap<SceneNodeId, DeviceVisualStatus> {
    if (this.disposed) return new Map()
    const cached = this.sceneNodeStatusesBySceneId.get(sceneId)
    if (cached) {
      this.touchSceneSnapshot(sceneId, cached)
      return new Map(cached)
    }

    // 按指定场景查询始终返回完整派生结果；第三层筛选只影响“当前活动投影”，不能污染缓存的通用查询接口。
    const hydrated = this.buildSceneProjection(this.latestStateByNodeId, sceneId).statuses
    this.touchSceneSnapshot(sceneId, hydrated)
    return new Map(hydrated)
  }

  /** 无活动拓扑时明确返回空快照，禁止按默认拓扑或标题猜测当前画布。 */
  public getActiveTopologyNodeStatuses(): ReadonlyMap<NodeId, DeviceVisualStatus> {
    return this.activeTopologyId ? this.getTopologyNodeStatuses(this.activeTopologyId) : new Map()
  }

  /** 无活动场景时明确返回空快照，禁止把其他场景三维状态误投到当前 Unity。 */
  public getActiveSceneNodeStatuses(): ReadonlyMap<SceneNodeId, DeviceVisualStatus> {
    return this.activeSceneId ? this.getSceneNodeStatuses(this.activeSceneId) : new Map()
  }

  /**
   * 为 Unity 恢复或场景重新激活现场重建最新权威三维投影。
   * 返回值只来自当前完整设备表，不读取历史异步队列；状态时间和来源修订继续仅作诊断透传。
   */
  public getActiveSceneNodeStateSnapshot(): {
    snapshotSequence: number
    updates: ReadonlyMap<SceneNodeId, TopologySceneNodeVisualStateUpdate>
    /** 第三层返回自身受控节点，协调器据此不会把其他设备的历史清除命令投给独立模型。 */
    sceneNodeIdFilter?: SceneNodeId
  } {
    if (this.disposed || !this.activeSceneId || this.snapshotSequence <= 0) {
      return { snapshotSequence: this.snapshotSequence, updates: new Map(), ...(this.activeSceneNodeIdFilter ? { sceneNodeIdFilter: this.activeSceneNodeIdFilter } : {}) }
    }
    return {
      snapshotSequence: this.snapshotSequence,
      updates: this.buildSceneProjection(this.latestStateByNodeId, this.activeSceneId, this.activeSceneNodeIdFilter).updates,
      ...(this.activeSceneNodeIdFilter ? { sceneNodeIdFilter: this.activeSceneNodeIdFilter } : {}),
    }
  }

  /** 释放是终态：清空权威表、派生表和活动上下文，后续状态调用只返回未提交空结果。 */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.latestStateByNodeId.clear()
    this.nodeStatusesByTopologyId.clear()
    this.sceneNodeStatusesBySceneId.clear()
    this.activeSceneId = undefined
    this.activeTopologyId = undefined
    this.activeSceneNodeIdFilter = undefined
  }

  /** 单次遍历归一完整快照；同一节点重复出现时 Map（映射）无条件以数组最后一项覆盖。 */
  private prepareSnapshot(batch: TopologyNodeStateBatch): PreparedNodeStateSnapshot {
    const nextStateByNodeId = new Map<NodeId, CachedNodeState>()
    const acceptedNodeIds: NodeId[] = []
    const unmappedNodeIds: NodeId[] = []
    const acceptedSet = new Set<NodeId>()
    const unmappedSet = new Set<NodeId>()

    for (const item of batch.items) {
      const projection = this.registry.getNodeStateProjection(item.nodeId)
      if (!projection) {
        if (!unmappedSet.has(item.nodeId)) {
          unmappedSet.add(item.nodeId)
          unmappedNodeIds.push(item.nodeId)
        }
        continue
      }

      if (!acceptedSet.has(item.nodeId)) {
        acceptedSet.add(item.nodeId)
        acceptedNodeIds.push(item.nodeId)
      }
      nextStateByNodeId.set(item.nodeId, {
        deviceStatus: item.deviceStatus,
        statusUpdatedAt: item.statusUpdatedAt,
        sourceRevision: batch.sourceRevision,
      })
    }

    const restoredNodeIds: NodeId[] = []
    for (const nodeId of this.latestStateByNodeId.keys()) {
      if (!nextStateByNodeId.has(nodeId)) restoredNodeIds.push(nodeId)
    }

    const previousActiveSceneStatuses = this.activeSceneId
      ? this.buildSceneProjection(this.latestStateByNodeId, this.activeSceneId, this.activeSceneNodeIdFilter).statuses
      : new Map<SceneNodeId, DeviceVisualStatus>()
    const activeTopologyNodeStatuses = this.activeTopologyId
      ? this.buildTopologyProjection(nextStateByNodeId, this.activeTopologyId)
      : new Map<NodeId, DeviceVisualStatus>()
    const activeSceneProjection = this.activeSceneId
      ? this.buildSceneProjection(nextStateByNodeId, this.activeSceneId, this.activeSceneNodeIdFilter)
      : { statuses: new Map<SceneNodeId, DeviceVisualStatus>(), updates: new Map<SceneNodeId, TopologySceneNodeVisualStateUpdate>() }
    const clearedActiveSceneNodeIds: SceneNodeId[] = []
    for (const sceneNodeId of previousActiveSceneStatuses.keys()) {
      if (!activeSceneProjection.statuses.has(sceneNodeId)) clearedActiveSceneNodeIds.push(sceneNodeId)
    }

    return {
      nextStateByNodeId,
      result: {
        committed: false,
        capacityExceeded: false,
        snapshotSequence: this.snapshotSequence,
        acceptedNodeIds,
        restoredNodeIds,
        // 合作方确认来源修订号和状态时间只作诊断；后到合法完整快照永远不进入“过期”分支。
        outdatedNodeIds: [],
        unmappedNodeIds,
        // 非法时间已由外层协议整体拒绝，缓存不再跳过单项或推断状态。
        invalidTimestampNodeIds: [],
        activeTopologyNodeStatuses,
        activeSceneNodeStatuses: activeSceneProjection.statuses,
        activeSceneNodeStateUpdates: activeSceneProjection.updates,
        clearedActiveSceneNodeIds,
      },
    }
  }

  /**
   * 只遍历权威表中已识别节点及其直接二维目标，生成指定拓扑相对发布基线的覆盖表。
   * 状态等于节点配置基线时不保存覆盖，使节点从后续快照缺失后自然恢复原始图元状态。
   */
  private buildTopologyProjection(
    states: ReadonlyMap<NodeId, CachedNodeState>,
    topologyId: TopologyId,
  ): Map<NodeId, DeviceVisualStatus> {
    const statuses = new Map<NodeId, DeviceVisualStatus>()
    for (const [nodeId, state] of states) {
      const projection = this.registry.getNodeStateProjection(nodeId)
      if (!projection) continue
      for (const target of projection.topologyTargets) {
        if (target.topologyId !== topologyId || target.configuredStatus === state.deviceStatus) continue
        statuses.set(target.nodeId, state.deviceStatus)
      }
    }
    return statuses
  }

  /** 一个逻辑节点最多派生一个三维目标；注册表已校验目标不会被其他节点重复驱动。 */
  private buildSceneProjection(
    states: ReadonlyMap<NodeId, CachedNodeState>,
    sceneId: SceneId,
    sceneNodeIdFilter?: SceneNodeId,
  ): {
    statuses: Map<SceneNodeId, DeviceVisualStatus>
    updates: Map<SceneNodeId, TopologySceneNodeVisualStateUpdate>
  } {
    const statuses = new Map<SceneNodeId, DeviceVisualStatus>()
    const updates = new Map<SceneNodeId, TopologySceneNodeVisualStateUpdate>()

    for (const [nodeId, state] of states) {
      const projection = this.registry.getNodeStateProjection(nodeId)
      if (!projection || projection.sceneId !== sceneId) continue
      this.appendSceneTargets(projection, state, statuses, updates, sceneNodeIdFilter)
    }

    return { statuses, updates }
  }

  /** 将预计算且已去重的三维目标写入完整场景投影，避免为每个目标重复查注册表。 */
  private appendSceneTargets(
    projection: RegisteredNodeStateProjection,
    state: CachedNodeState,
    statuses: Map<SceneNodeId, DeviceVisualStatus>,
    updates: Map<SceneNodeId, TopologySceneNodeVisualStateUpdate>,
    sceneNodeIdFilter: SceneNodeId | undefined,
  ): void {
    for (const sceneNodeId of projection.sceneNodeIds) {
      // 第三层只接收目录中明确登记的状态节点，禁止把同一业务场景的其他设备状态扩散到独立模型。
      if (sceneNodeIdFilter && sceneNodeId !== sceneNodeIdFilter) continue
      statuses.set(sceneNodeId, state.deviceStatus)
      updates.set(sceneNodeId, {
        visualState: state.deviceStatus,
        statusUpdatedAt: state.statusUpdatedAt,
        sourceRevision: state.sourceRevision,
      })
    }
  }

  /** 提交后只播种当前上下文；其他派生快照首次访问时再从权威表重建，避免九场景重复存储。 */
  private seedActiveSnapshots(
    activeTopologyNodeStatuses: ReadonlyMap<NodeId, DeviceVisualStatus>,
    activeSceneNodeStatuses: ReadonlyMap<SceneNodeId, DeviceVisualStatus>,
  ): void {
    if (this.activeTopologyId) this.touchTopologySnapshot(this.activeTopologyId, new Map(activeTopologyNodeStatuses))
    if (this.activeSceneId) this.touchSceneSnapshot(this.activeSceneId, new Map(activeSceneNodeStatuses))
  }

  /** 未提交结果始终返回当前已提交权威投影，容量错误或释放都不会泄露候选半状态。 */
  private createUncommittedResult(capacityExceeded: boolean): TopologyNodeStateApplyResult {
    return {
      committed: false,
      capacityExceeded,
      snapshotSequence: this.snapshotSequence,
      acceptedNodeIds: [],
      restoredNodeIds: [],
      outdatedNodeIds: [],
      unmappedNodeIds: [],
      invalidTimestampNodeIds: [],
      activeTopologyNodeStatuses: this.disposed ? new Map() : this.getActiveTopologyNodeStatuses(),
      activeSceneNodeStatuses: this.disposed ? new Map() : this.getActiveSceneNodeStatuses(),
      activeSceneNodeStateUpdates: new Map(),
      clearedActiveSceneNodeIds: [],
    }
  }

  /** 以最近使用顺序保留有限拓扑派生快照，并保护当前活动拓扑。 */
  private touchTopologySnapshot(topologyId: TopologyId, snapshot: Map<NodeId, DeviceVisualStatus>): void {
    this.nodeStatusesByTopologyId.delete(topologyId)
    this.nodeStatusesByTopologyId.set(topologyId, snapshot)
    this.evictSnapshot(this.nodeStatusesByTopologyId, this.maximumTopologySnapshots, this.activeTopologyId)
  }

  /** 场景派生快照采用相同有限策略；淘汰后可由权威设备表无损重建。 */
  private touchSceneSnapshot(sceneId: SceneId, snapshot: Map<SceneNodeId, DeviceVisualStatus>): void {
    this.sceneNodeStatusesBySceneId.delete(sceneId)
    this.sceneNodeStatusesBySceneId.set(sceneId, snapshot)
    this.evictSnapshot(this.sceneNodeStatusesBySceneId, this.maximumSceneSnapshots, this.activeSceneId)
  }

  /**
   * 淘汰最早的非活动派生快照；直接遍历最多八个键，不创建临时键数组。
   * 若容量为一且唯一条目正是活动项，则保留活动项，避免可见状态为满足缓存数字而被清空。
   */
  private evictSnapshot<TKey, TValue>(cache: Map<TKey, TValue>, maximumSize: number, protectedKey: TKey | undefined): void {
    while (cache.size > maximumSize) {
      let deleted = false
      for (const key of cache.keys()) {
        if (key === protectedKey) continue
        cache.delete(key)
        deleted = true
        break
      }
      if (!deleted) return
    }
  }
}

/** 缓存容量必须是正安全整数；错误配置回退到任务定义的固定安全值。 */
function normalizeCapacity(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

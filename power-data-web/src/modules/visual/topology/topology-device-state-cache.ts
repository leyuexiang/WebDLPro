import type { DeviceId, NodeId, SceneId, SceneNodeId, TopologyId } from '@/config/scene-topology/identifiers'
import type { DeviceVisualStatus } from '@/config/scene-topology/types'
import type { TopologyRegistry } from '@/config/scene-topology/topology-registry'

/**
 * 状态输入在到达缓存前只保留设备标识、四态候选值和来源时间。
 * 协议层会先校验正式外层命令；此处仍接受未知状态，确保内部数据源缺失或枚举漂移时安全归一为离线。
 */
export interface TopologyDeviceStateUpdate {
  deviceId: DeviceId
  deviceStatus?: unknown
  statusUpdatedAt: string
}

/**
 * 本次真正变化且属于当前 Unity 场景的三维状态投影。
 * `statusUpdatedAt` 已在缓存层完成解析并规范化为 UTC ISO 时间；可选来源修订号与时间共同组成因果顺序，
 * 用于任务-038在相同业务时间下仍能识别更高修订。该投影不是原始父页面对象，也不会包含设备名称、
 * Unity 层级或任意附加字段。
 */
export interface TopologySceneNodeVisualStateUpdate {
  visualState: DeviceVisualStatus
  statusUpdatedAt: string
  sourceRevision?: number
}

/** 单次批量更新可附带来源修订号，用于在同一时间戳下稳定拒绝重复或旧来源重放。 */
export interface TopologyDeviceStateBatch {
  sourceRevision?: number
  items: readonly TopologyDeviceStateUpdate[]
}

/** 对外返回的结果只包含稳定标识和四态快照，不泄露原始消息、时间字符串或缓存内部对象。 */
export interface TopologyDeviceStateApplyResult {
  acceptedDeviceIds: readonly DeviceId[]
  outdatedDeviceIds: readonly DeviceId[]
  unmappedDeviceIds: readonly DeviceId[]
  invalidTimestampDeviceIds: readonly DeviceId[]
  activeTopologyNodeStatuses: ReadonlyMap<NodeId, DeviceVisualStatus>
  activeSceneNodeStatuses: ReadonlyMap<SceneNodeId, DeviceVisualStatus>
  /** 仅包含当前批次新接受的、映射到当前 Unity 场景的节点增量，供动画帧合并下发使用。 */
  activeSceneNodeStateUpdates: ReadonlyMap<SceneNodeId, TopologySceneNodeVisualStateUpdate>
}

/** 最近设备状态仅用于时间比较与被淘汰快照的按需恢复，不保存外层消息或任意设备对象。 */
interface CachedDeviceState {
  deviceStatus: DeviceVisualStatus
  updatedAtMilliseconds: number
  /** 规范化后的 UTC 时间只为三维端防止迟到回包覆盖服务，不保存父页面原始时间文本。 */
  statusUpdatedAt: string
  sourceRevision?: number
}

/** 每个拓扑和场景快照都受容量限制；当前活动上下文在淘汰时受到保护。 */
export interface TopologyDeviceStateCacheOptions {
  maximumDeviceStates?: number
  maximumTopologySnapshots?: number
  maximumSceneSnapshots?: number
}

/**
 * 设备状态到二维/三维稳定标识的有限缓存。
 * 该类只读取注册表中已发布的 `deviceId → 二维节点/三维节点` 映射；它不发送 Unity 命令，
 * 因此任务-038可以在能力、批量调度和可观测性就绪后复用同一受控快照，而不会绕过协议门禁。
 */
export class TopologyDeviceStateCache {
  private readonly latestStateByDeviceId = new Map<DeviceId, CachedDeviceState>()
  private readonly nodeStatusesByTopologyId = new Map<TopologyId, Map<NodeId, DeviceVisualStatus>>()
  private readonly sceneNodeStatusesBySceneId = new Map<SceneId, Map<SceneNodeId, DeviceVisualStatus>>()
  private activeTopologyId: TopologyId | undefined
  private activeSceneId: SceneId | undefined

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
   * 激活上下文仅用于保护当前二维、三维快照不被 LRU（最近最少使用）淘汰。
   * 切换时调用方应在画布换图后立即设置它，缓存不会自行创建场景、拓扑或渲染对象。
   */
  public setActiveContext(sceneId: SceneId | undefined, topologyId: TopologyId | undefined): void {
    this.activeSceneId = sceneId
    this.activeTopologyId = topologyId
  }

  /**
   * 合并批量设备状态并返回当前活动二维、三维的投影快照。
   * 同批同设备先按最新时间选取，时间相同则保留最后一项；跨批旧时间或相同时间的重复来源不会覆盖现有状态。
   */
  public apply(batch: TopologyDeviceStateBatch): TopologyDeviceStateApplyResult {
    const latestItemByDeviceId = new Map<DeviceId, { item: TopologyDeviceStateUpdate; updatedAtMilliseconds: number }>()
    const invalidTimestampDeviceIds: DeviceId[] = []

    for (const item of batch.items) {
      const updatedAtMilliseconds = Date.parse(item.statusUpdatedAt)
      if (!Number.isFinite(updatedAtMilliseconds)) {
        invalidTimestampDeviceIds.push(item.deviceId)
        continue
      }

      const current = latestItemByDeviceId.get(item.deviceId)
      // Map 覆盖保留输入批次中的最后一项，确保同批同设备只进入一次映射更新；
      // 同一动画帧内的多次画布绘制由 CanvasTopologyAdapter 继续合并，避免在状态缓存层重复持有帧调度器。
      if (!current || updatedAtMilliseconds >= current.updatedAtMilliseconds) {
        latestItemByDeviceId.set(item.deviceId, { item, updatedAtMilliseconds })
      }
    }

    const acceptedDeviceIds: DeviceId[] = []
    const outdatedDeviceIds: DeviceId[] = []
    const unmappedDeviceIds: DeviceId[] = []
    const activeSceneNodeStateUpdates = new Map<SceneNodeId, TopologySceneNodeVisualStateUpdate>()

    for (const [deviceId, candidate] of latestItemByDeviceId) {
      const previous = this.latestStateByDeviceId.get(deviceId)
      if (previous && isOutdated(candidate.updatedAtMilliseconds, batch.sourceRevision, previous)) {
        outdatedDeviceIds.push(deviceId)
        continue
      }

      const mapping = this.registry.getDeviceMapping(deviceId)
      if (!mapping) {
        // 未映射设备既不进入时间缓存，也不触发任何二维/三维更新，防止后续相同名称节点被误关联。
        unmappedDeviceIds.push(deviceId)
        continue
      }

      const state: CachedDeviceState = {
        deviceStatus: normalizeDeviceVisualStatus(candidate.item.deviceStatus),
        updatedAtMilliseconds: candidate.updatedAtMilliseconds,
        // 统一输出 UTC ISO 时间，避免同一时刻的多种时区写法在后续内层协议中形成不必要的字符串差异。
        statusUpdatedAt: new Date(candidate.updatedAtMilliseconds).toISOString(),
        ...(batch.sourceRevision !== undefined ? { sourceRevision: batch.sourceRevision } : {}),
      }
      this.cacheDeviceState(deviceId, state)
      this.applyMappedDeviceState(deviceId, state.deviceStatus)
      this.collectActiveSceneNodeStateUpdate(deviceId, state, activeSceneNodeStateUpdates)
      acceptedDeviceIds.push(deviceId)
    }

    return {
      acceptedDeviceIds,
      outdatedDeviceIds,
      unmappedDeviceIds,
      invalidTimestampDeviceIds,
      activeTopologyNodeStatuses: this.getActiveTopologyNodeStatuses(),
      activeSceneNodeStatuses: this.getActiveSceneNodeStatuses(),
      activeSceneNodeStateUpdates,
    }
  }

  /** 返回当前拓扑的防御性状态快照；被 LRU 淘汰的非活动图会从有限设备时间缓存按需恢复。 */
  public getTopologyNodeStatuses(topologyId: TopologyId): ReadonlyMap<NodeId, DeviceVisualStatus> {
    this.hydrateTopologySnapshot(topologyId)
    const snapshot = this.nodeStatusesByTopologyId.get(topologyId)
    return new Map(snapshot)
  }

  /** 返回指定场景的已映射三维节点状态；不含 sceneNodeId 的设备永远不会虚构三维目标。 */
  public getSceneNodeStatuses(sceneId: SceneId): ReadonlyMap<SceneNodeId, DeviceVisualStatus> {
    this.hydrateSceneSnapshot(sceneId)
    const snapshot = this.sceneNodeStatusesBySceneId.get(sceneId)
    return new Map(snapshot)
  }

  /** 当前活动二维状态供单画布增量重绘使用；无活动拓扑时明确返回空快照。 */
  public getActiveTopologyNodeStatuses(): ReadonlyMap<NodeId, DeviceVisualStatus> {
    return this.activeTopologyId ? this.getTopologyNodeStatuses(this.activeTopologyId) : new Map()
  }

  /** 当前活动三维状态供后续任务-038的受控 Unity 批量协调器读取；此处不直接发送命令。 */
  public getActiveSceneNodeStatuses(): ReadonlyMap<SceneNodeId, DeviceVisualStatus> {
    return this.activeSceneId ? this.getSceneNodeStatuses(this.activeSceneId) : new Map()
  }

  /** 释放全部有限快照与活动标识，组件卸载后不再保留状态时间或节点引用。 */
  public dispose(): void {
    this.latestStateByDeviceId.clear()
    this.nodeStatusesByTopologyId.clear()
    this.sceneNodeStatusesBySceneId.clear()
    this.activeTopologyId = undefined
    this.activeSceneId = undefined
  }

  /** 将已映射设备状态写入所有明确登记的二维引用及可选三维节点，不遍历无关拓扑或场景。 */
  private applyMappedDeviceState(deviceId: DeviceId, deviceStatus: DeviceVisualStatus): void {
    const mapping = this.registry.getDeviceMapping(deviceId)
    if (!mapping) return

    for (const reference of mapping.topologyNodeRefs) {
      const node = this.registry.getTopologyNode(reference.topologyId, reference.nodeId)
      if (!node) continue
      this.setTopologyNodeStatus(reference.topologyId, reference.nodeId, node.deviceStatus, deviceStatus)
    }

    if (mapping.sceneNodeId) {
      const sceneSnapshot = this.getMutableSceneSnapshot(mapping.sceneId)
      sceneSnapshot.set(mapping.sceneNodeId, deviceStatus)
      this.touchSceneSnapshot(mapping.sceneId, sceneSnapshot)
    }
  }

  /**
   * 只投影本批已接受设备在当前活动场景中的显式三维节点。
   * 同一节点若被两个正式设备映射命中（发布校验通常会阻止此配置），仍按较新的时间保留最终状态，
   * 使后续动画帧合并始终是确定性的常数时间覆盖而不是依赖遍历顺序的猜测。
   */
  private collectActiveSceneNodeStateUpdate(
    deviceId: DeviceId,
    state: CachedDeviceState,
    target: Map<SceneNodeId, TopologySceneNodeVisualStateUpdate>,
  ): void {
    const mapping = this.registry.getDeviceMapping(deviceId)
    if (!mapping || mapping.sceneId !== this.activeSceneId || !mapping.sceneNodeId) return

    const previous = target.get(mapping.sceneNodeId)
    if (previous && Date.parse(previous.statusUpdatedAt) > state.updatedAtMilliseconds) return

    target.set(mapping.sceneNodeId, {
      visualState: state.deviceStatus,
      statusUpdatedAt: state.statusUpdatedAt,
      // 来源修订号只在父页面显式提供且已通过缓存时序校验后透传；缺失时保持可选兼容语义。
      ...(state.sourceRevision !== undefined ? { sourceRevision: state.sourceRevision } : {}),
    })
  }

  /**
   * 配置基线状态不存覆盖值；空 Map（映射表）本身仍保留为“已水合”标记。
   * 这避免基线状态下的活动拓扑每次读取都重新扫描最多 500 条设备状态，
   * 同时空表也参与既有 LRU（最近最少使用）容量限制，不会形成无界副本。
   */
  private setTopologyNodeStatus(
    topologyId: TopologyId,
    nodeId: NodeId,
    configuredStatus: DeviceVisualStatus,
    deviceStatus: DeviceVisualStatus,
  ): void {
    const snapshot = this.getMutableTopologySnapshot(topologyId)
    if (deviceStatus === configuredStatus) snapshot.delete(nodeId)
    else snapshot.set(nodeId, deviceStatus)

    this.touchTopologySnapshot(topologyId, snapshot)
  }

  /** 被淘汰的非活动拓扑进入当前视图时只扫描有限的设备状态缓存一次，随后继续走常数时间快照读取。 */
  private hydrateTopologySnapshot(topologyId: TopologyId): void {
    if (this.nodeStatusesByTopologyId.has(topologyId)) {
      this.touchTopologySnapshot(topologyId, this.nodeStatusesByTopologyId.get(topologyId)!)
      return
    }

    for (const [deviceId, state] of this.latestStateByDeviceId) {
      const mapping = this.registry.getDeviceMapping(deviceId)
      if (!mapping) continue
      for (const reference of mapping.topologyNodeRefs) {
        if (reference.topologyId !== topologyId) continue
        const node = this.registry.getTopologyNode(reference.topologyId, reference.nodeId)
        if (node) this.setTopologyNodeStatus(reference.topologyId, reference.nodeId, node.deviceStatus, state.deviceStatus)
      }
    }

    // 没有设备映射或全部命中配置基线时也要记录空快照，避免每次读取重复扫描有限设备缓存。
    if (!this.nodeStatusesByTopologyId.has(topologyId)) this.touchTopologySnapshot(topologyId, new Map<NodeId, DeviceVisualStatus>())
  }

  /** 场景快照按同样的有限设备缓存按需恢复，避免为九场景长期保存无限状态副本。 */
  private hydrateSceneSnapshot(sceneId: SceneId): void {
    if (this.sceneNodeStatusesBySceneId.has(sceneId)) {
      this.touchSceneSnapshot(sceneId, this.sceneNodeStatusesBySceneId.get(sceneId)!)
      return
    }

    for (const [deviceId, state] of this.latestStateByDeviceId) {
      const mapping = this.registry.getDeviceMapping(deviceId)
      if (!mapping || mapping.sceneId !== sceneId || !mapping.sceneNodeId) continue
      const snapshot = this.getMutableSceneSnapshot(sceneId)
      snapshot.set(mapping.sceneNodeId, state.deviceStatus)
      this.touchSceneSnapshot(sceneId, snapshot)
    }

    // 无三维映射的场景同样保留受容量约束的空快照，保证读取路径不会退化为重复全表扫描。
    if (!this.sceneNodeStatusesBySceneId.has(sceneId)) this.touchSceneSnapshot(sceneId, new Map<SceneNodeId, DeviceVisualStatus>())
  }

  /** 最近设备状态容量到顶时移除最旧映射产生的二维、三维覆盖，确保淘汰不会残留无法比较的状态。 */
  private cacheDeviceState(deviceId: DeviceId, state: CachedDeviceState): void {
    this.latestStateByDeviceId.delete(deviceId)
    this.latestStateByDeviceId.set(deviceId, state)

    while (this.latestStateByDeviceId.size > this.maximumDeviceStates) {
      const oldestDeviceId = this.latestStateByDeviceId.keys().next().value as DeviceId | undefined
      if (!oldestDeviceId) return
      this.latestStateByDeviceId.delete(oldestDeviceId)
      this.removeMappedDeviceState(oldestDeviceId)
    }
  }

  /** 清理被设备 LRU 淘汰的所有显式目标；发布校验保证同一二维节点只属于其登记设备。 */
  private removeMappedDeviceState(deviceId: DeviceId): void {
    const mapping = this.registry.getDeviceMapping(deviceId)
    if (!mapping) return

    for (const reference of mapping.topologyNodeRefs) {
      const snapshot = this.nodeStatusesByTopologyId.get(reference.topologyId)
      if (!snapshot) continue
      snapshot.delete(reference.nodeId)
      // 被淘汰设备恢复到基线后保留空快照标记，避免下一次活动读取重新扫描全部设备状态。
      this.touchTopologySnapshot(reference.topologyId, snapshot)
    }

    if (mapping.sceneNodeId) {
      const snapshot = this.sceneNodeStatusesBySceneId.get(mapping.sceneId)
      if (!snapshot) return
      snapshot.delete(mapping.sceneNodeId)
      // 三维快照遵循与二维相同的空表标记规则，并继续受场景快照 LRU 容量约束。
      this.touchSceneSnapshot(mapping.sceneId, snapshot)
    }
  }

  /** 为单个拓扑创建轻量状态覆盖表；该表只保存偏离配置基线的节点。 */
  private getMutableTopologySnapshot(topologyId: TopologyId): Map<NodeId, DeviceVisualStatus> {
    return this.nodeStatusesByTopologyId.get(topologyId) ?? new Map<NodeId, DeviceVisualStatus>()
  }

  /** 场景三维快照只保存已声明 sceneNodeId 的状态，不引入任何 Unity 层级或对象引用。 */
  private getMutableSceneSnapshot(sceneId: SceneId): Map<SceneNodeId, DeviceVisualStatus> {
    return this.sceneNodeStatusesBySceneId.get(sceneId) ?? new Map<SceneNodeId, DeviceVisualStatus>()
  }

  /** 以 LRU 顺序保留有限拓扑快照，并永远跳过当前活动拓扑，防止实时后台更新使可见图回退。 */
  private touchTopologySnapshot(topologyId: TopologyId, snapshot: Map<NodeId, DeviceVisualStatus>): void {
    this.nodeStatusesByTopologyId.delete(topologyId)
    this.nodeStatusesByTopologyId.set(topologyId, snapshot)
    this.evictSnapshot(this.nodeStatusesByTopologyId, this.maximumTopologySnapshots, this.activeTopologyId)
  }

  /** 场景三维快照同样采用有限 LRU，并保护当前活动场景以保障可见状态稳定。 */
  private touchSceneSnapshot(sceneId: SceneId, snapshot: Map<SceneNodeId, DeviceVisualStatus>): void {
    this.sceneNodeStatusesBySceneId.delete(sceneId)
    this.sceneNodeStatusesBySceneId.set(sceneId, snapshot)
    this.evictSnapshot(this.sceneNodeStatusesBySceneId, this.maximumSceneSnapshots, this.activeSceneId)
  }

  /**
   * 淘汰最早的非活动快照；若容量为一且唯一条目正是活动项，则保留该项而不破坏当前可见状态。
   * 直接遍历 Map（映射）迭代器，不为最多八项的淘汰路径创建临时键数组，避免高频状态流产生无意义短命对象。
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

/** 非法、缺失或未来数据源新增的状态统一显示为离线，不让未知枚举进入二维或三维渲染器。 */
function normalizeDeviceVisualStatus(value: unknown): DeviceVisualStatus {
  return value === 'normal' || value === 'alarm' || value === 'fault' || value === 'offline' ? value : 'offline'
}

/** 同一时间戳仅接受更高来源修订；来源修订缺失时把重复时间视为幂等重放并丢弃。 */
function isOutdated(updatedAtMilliseconds: number, sourceRevision: number | undefined, previous: CachedDeviceState): boolean {
  if (updatedAtMilliseconds < previous.updatedAtMilliseconds) return true
  if (updatedAtMilliseconds > previous.updatedAtMilliseconds) return false
  if (sourceRevision === undefined || previous.sourceRevision === undefined) return true
  return sourceRevision <= previous.sourceRevision
}

/** 缓存容量必须是正安全整数；错误配置回退到任务定义的固定安全值。 */
function normalizeCapacity(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { toTopologyKey, type ProcessNodeId, type RouteId as ProcessRouteId } from '@/config/process/identifiers'
import type { TopologyDefinition as CanvasTopologyDefinition, TopologyDeviceStatus } from '@/config/process/types'
import { toSelectionId, type SelectionId } from '@/config/scene-topology/identifiers'
import type { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import type { TopologyRuntime } from '@/modules/visual/topology/topology-runtime'
import { TopologyRuntime as TopologyRuntimeImplementation } from '@/modules/visual/topology/topology-runtime'
import { ManifestTopologyCanvasPort } from '@/modules/visual/topology/manifest-topology-canvas-port'
import TopologyPanel from '@/modules/visual/components/TopologyPanel.vue'
import { resolveTopologyDeviceDoubleClick, type TopologyDeviceDoubleClickIntent } from '@/modules/visual/topology/topology-node-interaction'
import { visualizationCoordinatorFacadeKey } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import { TopologySelectionFocusCoordinator } from '@/modules/visual/topology/topology-selection-focus-coordinator'
import { visualizationRuntimeHostKey } from '@/modules/visual/runtime/visualization-runtime-host'

const props = defineProps<{
  registry: TopologyRegistry
}>()

const emit = defineEmits<{
  ready: [runtime: TopologyRuntime]
  deviceDoubleClick: [intent: TopologyDeviceDoubleClickIntent]
}>()

const visualizationCoordinatorFacade = inject(visualizationCoordinatorFacadeKey)
const visualizationRuntimeHost = inject(visualizationRuntimeHostKey)

const topologyPanel = ref<InstanceType<typeof TopologyPanel> | null>(null)

/**
 * 未收到合法 `system.init`（系统初始化）前的唯一展示状态。
 * 它不是任一业务场景、拓扑或设备的替代品；空节点配置仅用于在同一个组件内预先创建唯一画布端口，
 * 使后续 prepare（准备）阶段无需通过可见目标拓扑来抢建第二个 Canvas（画布）。
 */
const awaitingTopology: CanvasTopologyDefinition = Object.freeze({
  topologyKey: toTopologyKey('topology.awaiting-external-selection'),
  title: '等待外层场景选择',
  configVersion: 'runtime-placeholder',
  nodes: [],
  edges: [],
})

/** 组件显示值只在拓扑运行时 activate（激活）时更新；prepare 阶段绝不提前暴露目标拓扑。 */
const displayedTopology = ref<CanvasTopologyDefinition>(awaitingTopology)
/** 选择快照由运行时端口同步；它是面板属性的唯一来源，重渲染不会覆盖运行时恢复的选择。 */
const selectedNodeIds = ref<readonly ProcessNodeId[]>([])
const selectedRouteIds = ref<readonly ProcessRouteId[]>([])
/**
 * 设备状态是运行时快照，不写入清单定义；浅引用避免 Vue 递归代理 Map（映射）并让每批更新只触发一次属性同步。
 * 空映射会让画布回退到拓扑发布的节点基线状态，不需要创建全节点离线覆盖。
 */
const nodeStatuses = shallowRef<ReadonlyMap<ProcessNodeId, TopologyDeviceStatus>>(new Map())
let topologyRuntime: TopologyRuntime | undefined
let topologySelectionSequence = 0

/**
 * 聚焦只经受控运行时门面发送：拓扑组件无法读取 iframe 或连接器。
 * 非隔离聚焦只定位显式三维节点而不擅自隐藏同场景其他对象；若后续正式动作需要隔离，必须通过清单动作映射声明。
 */
const topologySelectionFocusCoordinator = new TopologySelectionFocusCoordinator({
  supportsFocusNode: () => visualizationRuntimeHost?.capabilities.value.includes('focusNode') ?? false,
  focusNode: (sceneNodeId, selectionId) => visualizationRuntimeHost
    ? visualizationRuntimeHost.sendCommandAndWait('focusNode', { sceneNodeId, selectionId, isolate: false })
    : Promise.resolve({ success: false }),
})

/**
 * 等待面板和其唯一 Canvas 均已挂载后再创建运行时。
 * 若端口缺失则不猜测或补建画布，而是保持等待态；调用方无法取得不完整的运行时实例。
 */
async function createTopologyRuntime(): Promise<void> {
  await nextTick()
  const canvas = topologyPanel.value?.getCanvasController()
  if (!canvas || topologyRuntime) return

  topologyRuntime = new TopologyRuntimeImplementation(
    props.registry,
    new ManifestTopologyCanvasPort(canvas, (projectedTopology) => {
      // 该回调仅由 activate 调用，因此新拓扑不会在 Unity 或动作未完成时进入可见模板。
      displayedTopology.value = projectedTopology
    }, (nodeIds, routeIds) => {
      // 选择回写仅更新本组件的声明快照，不直接操作 Pinia（状态管理库）或调用 Unity。
      selectedNodeIds.value = nodeIds
      selectedRouteIds.value = routeIds
    }, (statuses) => {
      // 只替换不可变快照引用；TopologyCanvas（拓扑画布）会沿既有状态增量通道合并到下一帧，选择与视图不受影响。
      nodeStatuses.value = statuses
    }),
  )
  emit('ready', topologyRuntime)
}

/** 向组合根提供已就绪运行时；未准备完成时返回 undefined，桥接层必须等待而不能绕过单画布端口。 */
function getTopologyRuntime(): TopologyRuntime | undefined {
  return topologyRuntime
}

/**
 * 单击先经唯一协调器提交选择，再同步当前活动画布；切换中、非活动拓扑和重复选择都会被拒绝或忽略。
 * 路由只从当前拓扑的已声明连线收集，复杂度为当前边数；二维选择提交后才异步请求已协商的三维聚焦。
 */
function handleSelectNode(processNodeId: string): void {
  const runtime = topologyRuntime
  const activeTopology = runtime?.getActiveTopology()
  const facade = visualizationCoordinatorFacade
  if (!runtime || !activeTopology || !facade) return

  const node = activeTopology.topology.nodes.find((item) => String(item.nodeId) === processNodeId)
  if (!node) return

  const nodeId = node.nodeId
  const routeIds = activeTopology.topology.edges
    .filter((edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId)
    .map((edge) => edge.edgeId)
  const snapshot = facade.getSnapshot()
  // 过期 Canvas 回调不得污染新场景或新拓扑；等待态、切换态和已释放态同样在这里被阻断。
  if (snapshot.runtimeStatus !== 'ready' || snapshot.stableContext?.sceneId !== activeTopology.sceneId || snapshot.stableContext.topologyId !== activeTopology.topologyId) return
  if (snapshot.selectedNodeIds.length === 1 && snapshot.selectedNodeIds[0] === nodeId && snapshot.selectedRouteIds.length === routeIds.length && snapshot.selectedRouteIds.every((routeId) => routeIds.includes(routeId))) return

  const result = facade.submit({
    type: 'selection.replace',
    nodeIds: [nodeId],
    routeIds,
    source: 'topology',
    deviceId: node.deviceId ?? null,
    sceneNodeId: node.sceneNodeId ?? null,
  })
  if (result.status !== 'accepted') return

  runtime.setSelection([nodeId], routeIds)
  // 同一 DOM 单击只生成一个受限关联标识；三维失败不会影响已提交的二维描边、路径和选择状态。
  void topologySelectionFocusCoordinator.requestFocus({
    source: 'topology',
    selectionId: createTopologySelectionId(),
    ...(node.sceneNodeId ? { sceneNodeId: node.sceneNodeId } : {}),
  })
}

/**
 * 每次已接受的二维选择创建一个跨前端与 Unity 的选择标识（selectionId）。
 * 该值只用于聚焦幂等关联，不写入状态仓库或外层协议；长度固定受 128 字符协议边界约束。
 */
function createTopologySelectionId(): SelectionId {
  topologySelectionSequence += 1
  const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return toSelectionId(`selection.topology.${topologySelectionSequence}.${randomPart}`.slice(0, 128))
}

/**
 * 双击仅在当前激活拓扑中解析明示的设备映射；概念节点、等待态和过期节点均不产生外部事件。
 * 单击已经独立即时执行，本函数不重复提交选择，也不发送三维聚焦命令，避免双击导致重复副作用。
 */
function handleDoubleClickNode(processNodeId: string): void {
  const activeTopology = topologyRuntime?.getActiveTopology()
  if (!activeTopology) return

  /*
   * 命中结果必须回到当前已激活拓扑的已声明节点，再传给双击意图解析器。
   * 不能把画布传来的字符串转换为新的节点标识：那会绕过“节点确实属于当前拓扑”的边界，
   * 并可能让旧画布回调或伪造标识进入设备事件链路。
   */
  const node = activeTopology.topology.nodes.find((item) => String(item.nodeId) === processNodeId)
  if (!node) return

  const intent = resolveTopologyDeviceDoubleClick(activeTopology.topology, node.nodeId)
  if (intent) emit('deviceDoubleClick', intent)
}

onMounted(() => {
  void createTopologyRuntime()
})

/** 组件销毁时同步释放聚焦去重历史与拓扑运行时，不保留隐藏图元、动画帧或选择关联记录。 */
onBeforeUnmount(() => {
  topologySelectionFocusCoordinator.dispose()
  topologyRuntime?.dispose()
  topologyRuntime = undefined
})

/** 运行时实例只向组合根暴露，业务组件不能访问 Canvas（画布）、适配器或拓扑注册表的写能力。 */
defineExpose({ getTopologyRuntime })
</script>

<template>
  <TopologyPanel
    ref="topologyPanel"
    :topology="displayedTopology"
    :selected-node-ids="selectedNodeIds"
    :selected-route-ids="selectedRouteIds"
    :node-statuses="nodeStatuses"
    @select-node="handleSelectNode"
    @double-click-node="handleDoubleClickNode"
  />
</template>

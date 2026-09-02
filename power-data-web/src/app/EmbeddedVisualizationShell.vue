<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { readDeploymentConfiguration } from '@/config/deployment/deployment-config'
import { isOverviewSceneId, toTransitionId, toViewSceneId } from '@/config/scene-topology/identifiers'
import {
  createContainerTooSmallReason,
  createEmbeddedShellCorrelationId,
  createEmbeddedShellDiagnostic,
} from '@/app/embedded-shell-diagnostics'
import { EmbeddedShellStartupDeadline } from '@/app/embedded-shell-startup-deadline'
import { RemoteSceneTopologyManifestLoader, type SceneTopologyManifestRequestFailureCode } from '@/config/scene-topology/remote-manifest-loader'
import type { SceneTopologyManifest } from '@/config/scene-topology/types'
import { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import { localProcessConfigLoader } from '@/config/process/local-process-config'
import { createHostBridgeStartup, HostBridge } from '@/host-bridge/host-bridge'
import { HostEventSender } from '@/host-bridge/host-event-sender'
import { HostRuntimeComposition } from '@/host-bridge/host-runtime-composition'
import { HostRuntimeReadinessGate } from '@/host-bridge/host-runtime-readiness-gate'
import { HOST_PROTOCOL_VERSION } from '@/host-bridge/host-protocol'
import ProcessScenePanel from '@/modules/visual/components/ProcessScenePanel.vue'
import {
  getCameraPoseNavigationButtons,
  type CameraPoseNavigationButton,
} from '@/modules/visual/components/camera-pose-navigation'
import ManifestTopologyRuntimePanel from '@/modules/visual/topology/ManifestTopologyRuntimePanel.vue'
import VisualizationRuntimeHost from '@/modules/visual/runtime/VisualizationRuntimeHost.vue'
import { VisualizationCoordinator } from '@/modules/visual/orchestration/visualization-coordinator'
import { createVisualizationCoordinatorFacade, visualizationCoordinatorFacadeKey } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import {
  isBusinessVisualizationStableContext,
  isProcessDetailVisualizationStableContext,
  useVisualizationStore,
} from '@/modules/visual/orchestration/visualization.store'
import { getVisualizationTransitionOverlayState } from '@/modules/visual/orchestration/visualization-transition-overlay'
import { ViewOpenTransactionHandler } from '@/modules/visual/orchestration/view-open-transaction-handler'
import { WorkflowTriggerTransactionHandler } from '@/modules/visual/orchestration/workflow-trigger-transaction-handler'
import { WorkflowTriggerTransactionRouter } from '@/modules/visual/orchestration/workflow-trigger-transaction-router'
import { ProcessDetailTransactionHandler } from '@/modules/visual/orchestration/process-detail-transaction-handler'
import { shouldInstallWorkflowTrigger } from '@/modules/visual/orchestration/workflow-trigger-capability'
import { DeviceStatesUpdateCoordinator } from '@/modules/visual/orchestration/device-states-update-coordinator'
import { UnityObjectSelectionCoordinator } from '@/modules/visual/orchestration/unity-object-selection-coordinator'
import { VisualizationRuntimeViewOpenPort } from '@/modules/visual/runtime/visualization-runtime-view-open-port'
import { VisualizationRuntimeDeviceStatePort } from '@/modules/visual/runtime/visualization-runtime-device-state-port'
import type {
  VisualizationRuntimeHostController,
  VisualizationRuntimeLifecycle,
} from '@/modules/visual/runtime/visualization-runtime-host'
import type { TopologyRuntime } from '@/modules/visual/topology/topology-runtime'
import type { TopologyNodeDoubleClickIntent } from '@/modules/visual/topology/topology-node-interaction'
import AppStatePanel from '@/shared/components/AppStatePanel.vue'

const deploymentConfiguration = readDeploymentConfiguration()
const shellElement = ref<HTMLElement | null>(null)
const isContainerTooSmall = ref(false)
const shellCorrelationId = createEmbeddedShellCorrelationId()
let shellResizeObserver: ResizeObserver | undefined
let manifestAbortController: AbortController | undefined
const startupTimedOut = ref(false)
/** 运行时宿主组件引用只用于读取受控控制器，不向壳层泄露 iframe、连接器或 Unity 窗口。 */
const visualizationRuntimeHost = ref<InstanceType<typeof VisualizationRuntimeHost> | null>(null)
/** 正式拓扑运行时在单画布端口就绪后由子组件交付，外层桥必须等到此实例存在才可处理初始化。 */
const topologyRuntime = shallowRef<TopologyRuntime | undefined>()
/** 通信组合根只保留一个实例；失败的启动参数不会构造桥，也不会留下半注册监听器。 */
let hostRuntimeComposition: HostRuntimeComposition | undefined
/**
 * 外层 ready（就绪）不再被 Unity 门控；平台早到的唯一 init（初始化）通过该单槽屏障等待内层运行时。
 * 屏障不保存外层消息，120秒超时后允许平台重新发送新的合法初始化命令。
 */
const hostRuntimeReadinessGate = new HostRuntimeReadinessGate()
/**
 * 合法嵌入参数在页面脚本初始化时即固定为唯一桥接实例。
 * 这样页面级15秒外层就绪截止从真实加载阶段开始计时，也能在 ready 之前向同一受信父页面发送一次受控超时错误。
 */
const hostBridgeStartup = deploymentConfiguration.configuration
  ? createHostBridgeStartup(window.location.search, deploymentConfiguration.configuration)
  : undefined
/**
 * 根地址直接打开时，入口脚本会用当前服务来源补齐 directAccess（直接访问）参数。
 * 只有顶层窗口且参数完整时才启用本地初始化；平台 iframe 即使伪造该标记，
 * 也会因 window.parent 不是当前窗口而跳过，继续等待平台发送 system.init。
 */
const directAccessMode = new URLSearchParams(window.location.search).get('directAccess') === '1' && window.parent === window
/** 独立服务入口把初始场景作为受控查询参数传入；只接受当前已发布的燃气、燃煤场景。 */
const directAccessQuery = new URLSearchParams(window.location.search)
const requestedInitialSceneId = directAccessQuery.get('sceneId')
const directAccessSceneId = requestedInitialSceneId === 'coal-power' ? 'coal-power' : 'gas-power'
/** 直接访问固定进入所选场景总览，禁止查询参数绕过正式清单动作白名单直接选择任意拓扑。 */
const directAccessTopologyId = `topology.${directAccessSceneId}.overview`
/**
 * 本地工艺配置只负责为当前发布场景申请对应的 Unity 单实例运行时。
 * 二维节点、连线、场景总览和二维—三维映射始终来自完成双重校验的正式场景清单，
 * 不会把燃气标题或本地占位图元作为燃煤场景的回退内容。
 */
const sceneBaseline = computed(() => localProcessConfigLoader.load(
  directAccessSceneId === 'coal-power' ? 'coal-overview' : 'gas-overview',
))
let removeDirectAccessBootstrapListener: (() => void) | undefined
const hostBridge = hostBridgeStartup?.status === 'ready'
  ? new HostBridge(hostBridgeStartup.context, window.parent, undefined, {
    onCommand: (command) => {
      // 组合根尚未就绪时不会接收早到命令；成功启动后回调只转交到同一个组合根。
      void hostRuntimeComposition?.handleCommand(command)
    },
  })
  : undefined
const startupErrorSender = hostBridge ? new HostEventSender(hostBridge) : undefined
const startupDeadline = hostBridge
  ? new EmbeddedShellStartupDeadline(() => {
    startupTimedOut.value = true
    manifestAbortController?.abort()
    manifestAbortController = undefined
    /*
     * 未发送 system.ready 的会话没有父命令可关联，因此只发送一次无 replyTo 的系统错误。
     * 发送器会重新投影固定错误说明，不能将清单地址、Unity 异常或任意载荷带到父页面。
     */
    startupErrorSender?.sendSystemError({
      code: 'runtime.startup.timeout',
      message: '页面未能在启动期限内完成运行时准备。',
      stage: 'handshake',
      recoverable: true,
    })
    hostBridge?.dispose()
  })
  : undefined
// 合法内嵌页面一开始加载即启动15秒外层期限；Unity 启动不计入此处，由收到初始化后的独立120秒屏障管理。
startupDeadline?.start()
/** 三维反向选择订阅只在组合根存在期间保留；壳层释放时必须解除，不能让旧 Unity 回调存活。 */
let unsubscribeUnityObjectSelected: (() => void) | undefined
let unsubscribeUnitySelectionCleared: (() => void) | undefined
/** 跨场景加载反馈只在壳层存在期间订阅；卸载时撤销，避免旧 Unity 事件更新新壳。 */
let unsubscribeUnitySceneLoadProgress: (() => void) | undefined
/** 反向选择协调器保留至壳层卸载，以便释放其固定容量去重表。 */
let unityObjectSelectionCoordinator: UnityObjectSelectionCoordinator | undefined

/** 清单读取状态只保留已校验快照或固定失败码，绝不缓存原始响应、地址或异常对象。 */
type ManifestState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; manifest: SceneTopologyManifest; registry: TopologyRegistry }
  | { status: 'failed'; code: SceneTopologyManifestRequestFailureCode }

/**
 * 清单快照与注册表均在加载完成后整体替换，不需要 Vue（渐进式网页框架）递归代理内部索引。
 * 浅响应式引用既保留私有索引的类型封装，也避免九场景清单被逐层包装后产生无意义的内存与访问开销。
 */
const manifestState = shallowRef<ManifestState>({ status: 'idle' })

/**
 * 嵌入壳是当前可视化树的唯一组合根：在此创建状态仓库与协调器，并只向下提供冻结门面。
 * 组件、外层桥和 Unity 适配器不能取得仓库写端口，后续任务只能提交领域命令。
 */
const visualizationStore = useVisualizationStore()
const visualizationCoordinatorFacade = createVisualizationCoordinatorFacade(new VisualizationCoordinator(visualizationStore))
provide(visualizationCoordinatorFacadeKey, visualizationCoordinatorFacade)

/**
 * 事务遮罩从唯一状态仓库的原始字段派生，提交、失败或释放时字段同步清空，界面无需轮询或维护第二份切换状态。
 * 遮罩只在协调器确认的完整事务目标存在时出现，避免 Unity 自身的启动状态与场景—拓扑原子切换相互混淆。
 */
const transitionOverlay = computed(() => getVisualizationTransitionOverlayState({
  activeTransitionId: visualizationStore.activeTransitionId,
  targetSceneId: visualizationStore.targetSceneId,
  targetTopologyId: visualizationStore.targetTopologyId,
  targetProcessDetailId: visualizationStore.targetProcessDetailId,
  runtimeStatus: visualizationStore.runtimeStatus,
}))
/** 仅已提交的平台总览上下文控制布局；进行中目标不得提前隐藏业务拓扑。 */
const overviewActive = computed(() => (
  visualizationStore.runtimeStatus === 'ready'
  && Boolean(visualizationStore.stableContext && isOverviewSceneId(visualizationStore.stableContext.sceneId))
))
/** 第三层与沙盘同为无拓扑全屏布局，但二者保持不同稳定上下文和协议字段。 */
const processDetailActive = computed(() => (
  visualizationStore.runtimeStatus === 'ready'
  && Boolean(visualizationStore.stableContext && isProcessDetailVisualizationStableContext(visualizationStore.stableContext))
))
/**
 * 两阶段进入在 Unity 提交前先将拓扑状态置为空闲；该瞬态只用于提交全屏三维布局，
 * 不会把目标环节提前写成稳定上下文，遮罩仍持续阻断用户操作直至完整事务提交。
 */
const processDetailLayoutPrepared = computed(() => (
  visualizationStore.activeTransitionId !== null
  && visualizationStore.targetProcessDetailId !== null
  && visualizationStore.topologyStatus === 'idle'
))
const topologySuppressed = computed(() => overviewActive.value || processDetailActive.value || processDetailLayoutPrepared.value)

/**
 * 命名镜头按钮只属于燃气、燃煤第二层业务视图。平台总览没有对应镜头，第三层关键环节又会拒绝
 * 第二层镜头命令，因此必须先用稳定上下文的业务类型守卫排除这两种无拓扑全屏状态。
 */
const cameraPoseButtons = computed(() => {
  const context = visualizationStore.stableContext
  return context && isBusinessVisualizationStableContext(context)
    ? getCameraPoseNavigationButtons(context.sceneId)
    : getCameraPoseNavigationButtons(undefined)
})
/** 最后一次由当前页面确认成功的镜头点只用于按钮反馈，不冒充 Unity 相机的权威实时状态。 */
const activeCameraPoseId = ref<string | null>(null)
/** 最新在途镜头点用于轻量反馈；不同按钮仍可连续点击，以满足后一次命令接管未完成插值。 */
const pendingCameraPoseId = ref<string | null>(null)
/** 单调请求序号阻止先发命令的迟到回执覆盖后发命令的按钮状态，不保存无界请求历史。 */
let cameraPoseRequestSequence = 0

/** 等待 Vue 完成响应式布局提交并跨过一帧浏览器布局边界，Unity 随后才可显示候选和移动相机。 */
async function waitForProcessDetailLayoutCommit(): Promise<void> {
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

/**
 * 启动遮罩直接读取唯一宿主控制器的生命周期，并与协调器的稳定上下文合并判断。
 * Unity ready 只代表通信可用；首个稳定视图提交前仍保持整区遮挡，失败或释放时立即让出遮罩显示中文状态。
 */
const runtimeHostStatus = computed<VisualizationRuntimeLifecycle>(() => (
  visualizationRuntimeHost.value?.getRuntimeHostController().status.value ?? 'idle'
))
const visualizationMaskVisible = computed(() => {
  const status = runtimeHostStatus.value
  if (status === 'failed' || status === 'disposed') return false

  return status !== 'ready' || !visualizationStore.hasStableContext || transitionOverlay.value.visible
})

/**
 * 控件在稳定业务视图可见；能力缺失时仍保留六步结构但整体禁用，便于联调直接识别 Unity 构建不兼容。
 * 命令可用性只读取唯一运行时宿主公开的状态与能力，不探测内嵌窗口。
 */
const cameraPoseControlsVisible = computed(() => cameraPoseButtons.value.length > 0 && !visualizationMaskVisible.value)
const cameraPoseNavigationAvailable = computed(() => {
  const runtime = getRuntimeHostController()
  return runtime?.status.value === 'ready' && runtime.capabilities.value.includes('moveCameraToPose')
})

/**
 * 向当前唯一运行时发送固定命名镜头标识。这里不加全局在途锁：连续点击不同步骤时，后一次命令应从
 * 当前相机位置接管插值；请求序号与稳定上下文版本共同过滤乱序回执和切场景后的迟到结果。
 */
async function moveCameraToPose(button: CameraPoseNavigationButton): Promise<void> {
  const runtime = getRuntimeHostController()
  const context = visualizationStore.stableContext
  if (
    !cameraPoseControlsVisible.value
    || !cameraPoseNavigationAvailable.value
    || !runtime
    || !context
    || !isBusinessVisualizationStableContext(context)
  ) return

  const requestSequence = ++cameraPoseRequestSequence
  const contextRevision = context.contextRevision
  const sceneId = context.sceneId
  pendingCameraPoseId.value = button.cameraPoseId

  const result = await runtime.sendCommandAndWait('moveCameraToPose', { cameraPoseId: button.cameraPoseId })
  if (requestSequence !== cameraPoseRequestSequence) return

  const currentContext = visualizationStore.stableContext
  const contextStillMatches = currentContext
    && isBusinessVisualizationStableContext(currentContext)
    && currentContext.contextRevision === contextRevision
    && currentContext.sceneId === sceneId
  if (!contextStillMatches) return

  pendingCameraPoseId.value = null
  if (result.success) {
    activeCameraPoseId.value = button.cameraPoseId
    return
  }

  activeCameraPoseId.value = null
  // 页面只输出固定诊断，不展示 Unity 原始错误或场景内部信息。
  console.warn('[命名镜头定位]', '三维运行时未确认本次镜头定位。')
}

/** 切换稳定视图时立即使旧请求失效，并清空只属于上一业务视图的按钮反馈。 */
watch(() => visualizationStore.stableContext?.contextRevision, () => {
  cameraPoseRequestSequence += 1
  activeCameraPoseId.value = null
  pendingCameraPoseId.value = null
})
/**
 * 壳层只向用户显示有限、脱敏的中文状态；部署地址、错误码、关联标识、外部消息和 Unity 原始错误均不进入界面。
 * 完整诊断模型仍保留给控制台和父页面协议使用。配置错误优先级最高，其次是尺寸不足和原子清单校验，
 * 最后才处理当前场景的本地运行时登记校验失败。
 */
const shellDiagnostic = computed(() => {
  if (deploymentConfiguration.status === 'invalid') {
    return createEmbeddedShellDiagnostic('configuration-error', {
      reason: deploymentConfiguration.issues[0]?.message ?? '部署配置未通过安全校验。',
      correlationId: shellCorrelationId,
    })
  }

  if (isContainerTooSmall.value) {
    return createEmbeddedShellDiagnostic('container-too-small', {
      reason: getContainerTooSmallReason(),
      correlationId: shellCorrelationId,
    })
  }

  if (startupTimedOut.value) {
    return createEmbeddedShellDiagnostic('startup-timeout', {
      reason: '页面加载后 15 秒内未完成外层协议准备，已停止启动。',
      correlationId: shellCorrelationId,
    })
  }

  /*
   * 物理三维或单画布回退无法确认时，协调器会清空稳定上下文并进入 error（错误）状态。
   * 此处必须替换整个双容器而非继续展示上次画面，避免用户在可能“新三维 + 旧拓扑”的组合上操作。
   */
  if (visualizationStore.runtimeStatus === 'error') {
    return createEmbeddedShellDiagnostic('topology-error', {
      reason: '场景切换失败且无法确认恢复上一稳定视图，已停止交互，请重新初始化。',
      correlationId: visualizationStore.latestDiagnostic?.correlationId ?? shellCorrelationId,
    })
  }

  if (manifestState.value.status === 'idle' || manifestState.value.status === 'loading') {
    return createEmbeddedShellDiagnostic('initializing', {
      reason: '正在读取并校验场景拓扑发布清单。',
      correlationId: shellCorrelationId,
    })
  }

  if (manifestState.value.status === 'failed') {
    return createEmbeddedShellDiagnostic('topology-error', {
      reason: getManifestFailureReason(manifestState.value.code),
      code: manifestState.value.code,
      correlationId: shellCorrelationId,
    })
  }

  if (!sceneBaseline.value.bundle) {
    return createEmbeddedShellDiagnostic('topology-error', {
      reason: '当前场景运行时登记未通过完整性校验，已停止创建可视化运行时。',
      correlationId: shellCorrelationId,
    })
  }

  return undefined
})

/**
 * 状态面板不展示技术字段，但联调仍需要能够定位问题；这里将固定诊断投影到浏览器控制台。
 * 诊断对象只包含已脱敏的代码、关联标识和中文原因，不记录原始响应、地址或异常对象。
 */
let lastLoggedShellDiagnostic: string | undefined

watch(shellDiagnostic, (diagnostic) => {
  if (!diagnostic) return

  const serializedDiagnostic = JSON.stringify({
    kind: diagnostic.kind,
    code: diagnostic.code,
    correlationId: diagnostic.correlationId,
    reason: diagnostic.reason,
  })
  // 同一响应式状态可能因无关布局更新重新计算；只输出首次结果，避免联调控制台被重复诊断淹没。
  if (serializedDiagnostic === lastLoggedShellDiagnostic) return

  lastLoggedShellDiagnostic = serializedDiagnostic
  console.warn('[嵌入壳诊断]', serializedDiagnostic)
}, { immediate: true })

/**
 * 将部署配置中的真实下限转换成用户可执行的中文提示。
 *
 * 容器尺寸判断和提示共用同一份配置，避免出现“提示尺寸”和“实际校验尺寸”不一致；
 * 文案只面向用户说明调整窗口的动作，不把内部错误码、关联标识或部署细节暴露到界面。
 */
function getContainerTooSmallReason(): string {
  const configuration = deploymentConfiguration.configuration
  if (!configuration) return '当前窗口可用区域不足，请调整窗口尺寸后重试。'

  return createContainerTooSmallReason(configuration.minimumViewportWidth, configuration.minimumViewportHeight)
}

/** 容器尺寸由部署配置声明；只在尺寸或配置可用性改变时更新状态，不在每帧轮询布局。 */
function synchronizeContainerSize(): void {
  const configuration = deploymentConfiguration.configuration
  const element = shellElement.value
  if (!configuration || !element) {
    isContainerTooSmall.value = false
    return
  }

  isContainerTooSmall.value = element.clientWidth < configuration.minimumViewportWidth || element.clientHeight < configuration.minimumViewportHeight
}

/** 重试只刷新当前子应用，确保已变更的构建环境或父容器尺寸能够重新参与初始化。 */
function retryEmbeddedShell(): void {
  window.location.reload()
}

/** 将请求层固定失败码转换为用户可读的脱敏说明，不暴露地址、响应状态正文或底层异常。 */
function getManifestFailureReason(code: SceneTopologyManifestRequestFailureCode): string {
  const reasonByCode: Record<SceneTopologyManifestRequestFailureCode, string> = {
    'manifest.http-status': '场景拓扑清单服务未返回可用内容。',
    'manifest.package-not-found': '当前联动包不存在，请确认资源标识和平台配置。',
    'manifest.file-missing': '当前联动包缺少场景拓扑清单文件。',
    'manifest.payload': '场景拓扑清单内容无法按发布格式解析。',
    'manifest.timeout': '场景拓扑清单在限定时间内未完成读取。',
    'manifest.aborted': '场景拓扑清单读取已被当前页面生命周期取消。',
    'manifest.network': '场景拓扑清单暂时无法连接。',
    'manifest.cache-policy': '场景拓扑清单服务未返回约定的禁止缓存策略。',
    'manifest.invalid': '场景拓扑清单未通过完整性和版本一致性校验。',
  }

  return reasonByCode[code]
}

/**
 * 只在部署配置完整时读取清单。远端读取成功后还必须通过本地注册表的跨引用校验，
 * 任一阶段失败都不创建半份拓扑索引或画布运行时；组件卸载后迟到响应不会更新状态。
 */
async function loadManifest(): Promise<void> {
  if (startupTimedOut.value) return
  const configuration = deploymentConfiguration.configuration
  if (!configuration) return

  manifestAbortController?.abort()
  const controller = new AbortController()
  manifestAbortController = controller
  manifestState.value = { status: 'loading' }
  const result = await new RemoteSceneTopologyManifestLoader().load(configuration.manifestUrl, controller.signal)

  if (startupTimedOut.value || controller.signal.aborted || manifestAbortController !== controller) return
  if (result.status !== 'ready') {
    manifestState.value = { status: 'failed', code: result.code }
    return
  }

  const registryResult = TopologyRegistry.create(result.manifest)
  manifestState.value = registryResult.status === 'ready'
    ? { status: 'ready', manifest: result.manifest, registry: registryResult.registry }
    : { status: 'failed', code: 'manifest.invalid' }
}

/**
 * 拓扑子组件只在其唯一 Canvas（画布）端口准备就绪后交付运行时。
 * 壳层不自行创建第二个拓扑运行时，保证 `view.open`（原子打开视图）只操作同一个预备/激活画布。
 */
function handleTopologyRuntimeReady(runtime: TopologyRuntime): void {
  if (startupTimedOut.value) return
  topologyRuntime.value = runtime
  startHostRuntimeCompositionIfReady()
}

/**
 * 任务-027的双击意图只交给已启动的外层通信组合根。
 * 组合根会再次核对握手、稳定上下文、场景和拓扑；壳层不根据标题、坐标或旧燃气配置补全节点映射。
 */
function handleTopologyNodeDoubleClick(intent: TopologyNodeDoubleClickIntent): void {
  hostRuntimeComposition?.reportTopologyNodeDoubleClick(intent)
}

/**
 * 直接访问模式复用同一套 HostBridge（外层桥）和事务组合根，只补一条本窗口初始化消息。
 * 监听器在 composition.start（组合根启动）前注册，避免极快的 system.ready（系统就绪）丢失；
 * 发送一次后立即解除，平台嵌入模式不会创建这条本地回环路径。
 */
function installDirectAccessBootstrap(): void {
  if (!directAccessMode || !hostBridgeStartup || hostBridgeStartup.status !== 'ready') return

  const context = hostBridgeStartup.context
  let initialized = false
  const handleReady = (event: MessageEvent<unknown>): void => {
    if (initialized || event.source !== window || event.origin !== context.parentOrigin) return
    const message = event.data
    if (!message || typeof message !== 'object' || Array.isArray(message)) return
    const candidate = message as Record<string, unknown>
    if (
      candidate.channel !== 'power-scene-topology-shell' ||
      candidate.version !== HOST_PROTOCOL_VERSION ||
      candidate.instanceId !== context.instanceId ||
      candidate.sessionId !== context.sessionId ||
      candidate.type !== 'system.ready'
    ) return

    initialized = true
    window.postMessage({
      channel: 'power-scene-topology-shell',
      version: HOST_PROTOCOL_VERSION,
      instanceId: context.instanceId,
      sessionId: context.sessionId,
      messageId: `direct-access-init-${Date.now()}`,
      type: 'system.init',
      timestamp: Date.now(),
      payload: {
        sceneId: directAccessSceneId,
        topologyId: directAccessTopologyId,
      },
    }, context.parentOrigin)
    removeDirectAccessBootstrapListener?.()
    removeDirectAccessBootstrapListener = undefined
  }

  window.addEventListener('message', handleReady)
  removeDirectAccessBootstrapListener = () => window.removeEventListener('message', handleReady)
}

/**
 * 读取运行时宿主已经显式暴露的最小控制器。
 * 若宿主尚未挂载，调用方只能等待，不得访问组件私有 iframe/连接器或在壳层重建 Unity 实例。
 */
function getRuntimeHostController(): VisualizationRuntimeHostController | undefined {
  return visualizationRuntimeHost.value?.getRuntimeHostController()
}

/**
 * 当清单、唯一拓扑运行时和 Unity 宿主控制器均已装配后创建外层桥组合根。
 * Unity 此时可以仍处于 creating/handshaking（创建/握手）阶段；组合根会立即发送 system.ready，
 * 早到的 system.init 只在内部单槽等待 Unity，成功确认仍由稳定视图事务产生。
 * 直接打开子应用时通常缺少父来源、实例和协议版本参数，此时保持本地等待态而不创建宽松桥接；
 * 被合法父页面嵌入时，三个参数仍须与部署白名单同时匹配，任一不匹配均不会注册窗口监听器。
 */
function startHostRuntimeCompositionIfReady(): void {
  if (hostRuntimeComposition || startupTimedOut.value) return
  const configuration = deploymentConfiguration.configuration
  const manifest = manifestState.value.status === 'ready' ? manifestState.value.manifest : undefined
  const registry = manifestState.value.status === 'ready' ? manifestState.value.registry : undefined
  const runtime = topologyRuntime.value
  const runtimeHost = getRuntimeHostController()
  const unitySceneMappingVersion = sceneBaseline.value.bundle?.runtime?.sceneMappingVersion
  if (!configuration || !manifest || !registry || !runtime || !runtimeHost || !unitySceneMappingVersion) return

  const bridge = hostBridge
  if (!bridge || hostBridgeStartup?.status !== 'ready') return
  /**
   * 批量状态协调器复用已经就绪的唯一拓扑运行时与 Unity 宿主端口。
   * 它必须先于视图事务处理器构造，才能让失败回退和超时补偿直接重投影当前权威快照。
   */
  const deviceStatesUpdate = new DeviceStatesUpdateCoordinator(
    runtime,
    new VisualizationRuntimeDeviceStatePort(runtimeHost),
  )
  const unityViewPort = new VisualizationRuntimeViewOpenPort(runtimeHost)
  const viewOpen = new ViewOpenTransactionHandler(
    registry,
    runtime,
    unityViewPort,
    visualizationCoordinatorFacade,
    unitySceneMappingVersion,
    undefined,
    // 失败回退或超时补偿会产生新的 Unity 物理实例；无需等待平台重推，直接从有限权威快照重投影。
    (sceneActivationId) => deviceStatesUpdate.resynchronizeLatestSnapshot(sceneActivationId),
  )
  /** 关键环节使用独立事务和同一个 Unity 宿主端口，不创建第二个 iframe 或第二张拓扑画布。 */
  const processDetail = new ProcessDetailTransactionHandler(
    registry,
    runtime,
    unityViewPort,
    visualizationCoordinatorFacade,
    undefined,
    waitForProcessDetailLayoutCommit,
  )
  /*
   * 跨场景关键环节会先进入目标业务场景默认拓扑，再在启动第三层资源事务前等待最新状态完成重放。
   * 该同步器只复用现有有限工作池与同一 Unity 宿主，不创建第二条状态通道或额外运行时实例。
   */
  const synchronizeCrossSceneProcessDetailState = (sceneActivationId?: Parameters<DeviceStatesUpdateCoordinator['resynchronizeLatestSnapshotAndWait']>[0]) => (
    deviceStatesUpdate.resynchronizeLatestSnapshotAndWait(sceneActivationId)
  )
  /*
   * 只有清单实际登记动作时，才构造流程路由并向外层组合根注入能力。
   * 空动作清单（如当前燃气联调发布包）保留 view.open 和状态能力，但不会错误发布
   * `workflow.trigger`，从握手阶段阻止“已声明、却没有任何可执行动作”的伪能力。
   */
  const workflowTrigger = shouldInstallWorkflowTrigger(manifest)
    ? new WorkflowTriggerTransactionRouter(
      registry,
      visualizationCoordinatorFacade,
      // 同场景流程触发只复用同一个原子切换处理器；它不会取得运行时宿主的 release 或 iframe 访问权。
      new WorkflowTriggerTransactionHandler(registry, viewOpen, visualizationCoordinatorFacade, 'same-scene', processDetail),
      // 跨场景流程动作先建立目标业务场景，再等待状态重放并进入关键环节，避免目标控制器尚不存在时直接发送第三层命令。
      new WorkflowTriggerTransactionHandler(
        registry,
        viewOpen,
        visualizationCoordinatorFacade,
        'cross-scene',
        processDetail,
        synchronizeCrossSceneProcessDetailState,
      ),
    )
    : undefined
  const composition = new HostRuntimeComposition(
    bridge,
    visualizationCoordinatorFacade,
    viewOpen,
    manifest.manifestVersion,
    // 外层释放确认必须等待 Unity 宿主解除 iframe/连接器资源，不能只释放可序列化协调器状态。
    () => runtimeHost.releaseAndWait(),
    workflowTrigger,
    deviceStatesUpdate,
    // 播放按钮复用已存在的第三层事务处理器；它只允许控制当前稳定关键环节，不能直连 Unity iframe。
    processDetail,
    {
      // 回调只暴露布尔就绪结果；组合根不能取得 Vue 状态、iframe 或 Unity 控制器引用。
      waitForInnerRuntimeReady: () => hostRuntimeReadinessGate.wait(),
    },
  )
  /**
   * 订阅只经过 Unity 宿主公开的受控门面。协调器会用当前清单、拓扑和稳定上下文精确映射选择，
   * 无映射时仅写入受限诊断；来源为 Unity 的选择绝不再次调用 focusNode（聚焦节点）。
   */
  unityObjectSelectionCoordinator = new UnityObjectSelectionCoordinator(
    registry,
    runtime,
    visualizationCoordinatorFacade,
  )
  unsubscribeUnityObjectSelected = runtimeHost.subscribeObjectSelected((selection) => {
    // 总览没有拓扑图：建筑点击直接转换为目标业务视图事务，不能送入业务节点反向选择协调逻辑。
    if (isOverviewSceneId(selection.payload.sceneId)) {
      const target = unityObjectSelectionCoordinator?.resolveOverviewBuilding(selection)
      if (target) void composition?.openOverviewBuilding(target)
      return
    }

    const selected = unityObjectSelectionCoordinator?.resolve(selection)
    if (selected) composition?.reportSceneObjectSelected(selected)
  })
  unsubscribeUnitySelectionCleared = runtimeHost.subscribeSelectionCleared((selection) => {
    unityObjectSelectionCoordinator?.resolveCleared(selection)
  })
  /**
   * Unity 加载反馈已经由内层连接器按来源、原请求、场景、事务和数值范围校验。
   * 此处仍转换为稳定标识并只交给协调器；协调器会拒绝过期、错场景或非活动事务反馈，目标拓扑不会因此提前激活。
   */
  unsubscribeUnitySceneLoadProgress = runtimeHost.subscribeSceneLoadProgress(({ payload }) => {
    visualizationCoordinatorFacade.submit({
      type: 'unity.load-progress.reported',
      transitionId: toTransitionId(payload.transitionId),
      sceneId: toViewSceneId(payload.sceneId),
      stageCode: payload.stageCode,
      progress: payload.progress,
    })
  })
 hostRuntimeComposition = composition
  installDirectAccessBootstrap()
 composition.start()
  // 清单摘要、能力和外层消息通道已经发布后即完成页面级15秒 ready 期限；Unity 使用独立120秒屏障。
  startupDeadline?.succeed()
}

onMounted(() => {
  if (!shellElement.value) return

  shellResizeObserver = new ResizeObserver(synchronizeContainerSize)
  shellResizeObserver.observe(shellElement.value)
  synchronizeContainerSize()
  // 页面级启动期限已在脚本初始化阶段按合法嵌入参数启动，此处只开始异步清单读取。
  void loadManifest()
})

/**
 * Unity 宿主的 ready（就绪）状态是外层初始化可用的最后条件。
 * 监听只读取已公开的只读状态引用；其变化不会触发任何重复创建，启动函数以单例变量做最终幂等保护。
 */
watch(
  () => getRuntimeHostController()?.status.value,
  (status) => {
    if (status) hostRuntimeReadinessGate.report(status)
    startHostRuntimeCompositionIfReady()
  },
)

/** 卸载时释放尺寸观察器，避免父页面销毁 iframe 后仍保留子应用回调。 */
onBeforeUnmount(() => {
  shellResizeObserver?.disconnect()
  shellResizeObserver = undefined
  manifestAbortController?.abort()
  manifestAbortController = undefined
  startupDeadline?.dispose()
  hostRuntimeReadinessGate.dispose()
  removeDirectAccessBootstrapListener?.()
  removeDirectAccessBootstrapListener = undefined
  unsubscribeUnityObjectSelected?.()
  unsubscribeUnityObjectSelected = undefined
  unsubscribeUnitySelectionCleared?.()
  unsubscribeUnitySelectionCleared = undefined
  unsubscribeUnitySceneLoadProgress?.()
  unsubscribeUnitySceneLoadProgress = undefined
  unityObjectSelectionCoordinator?.dispose()
  unityObjectSelectionCoordinator = undefined
  // 先解除外层窗口监听和命令计时器，再释放协调器；避免迟到的父页面命令观察到已销毁的运行时门面。
  hostRuntimeComposition?.dispose()
  hostRuntimeComposition = undefined
  hostBridge?.dispose()
  // 壳销毁时由唯一协调器清空可序列化上下文，迟到的下游回调无法再提交旧状态。
  visualizationCoordinatorFacade.submit({ type: 'system.release' })
})

</script>

<template>
  <!--
    根壳只保留一个三维容器和一个拓扑容器：没有顶栏、侧栏、面包屑、工艺导航或设备详情。
    运行时宿主仍唯一拥有 iframe 与浏览器资源，避免壳组件或拓扑组件创建第二个 Unity 实例。
  -->
  <main ref="shellElement" class="embedded-visualization-shell" aria-label="电力场景与拓扑嵌入模块">
    <AppStatePanel
      v-if="shellDiagnostic"
      class="embedded-visualization-shell__state"
      :kind="shellDiagnostic.kind"
      :reason="shellDiagnostic.reason"
      @retry="retryEmbeddedShell"
    />

    <!-- Unity 启动登记与正式注册表均通过后才创建两类运行时；二者任一缺失都不会把旧燃气拓扑传给画布。 -->
    <div
      v-else-if="sceneBaseline.bundle && manifestState.status === 'ready'"
      :class="['embedded-visualization-shell__content', { 'embedded-visualization-shell__content--full-scene': topologySuppressed }]"
      :aria-busy="visualizationMaskVisible ? 'true' : 'false'"
    >
      <VisualizationRuntimeHost ref="visualizationRuntimeHost" v-slot="{ status }">
        <!-- 上半区固定取得可用高度的一半，并在其中复用已验证的 Unity 单实例视口和蓝色视觉基线。 -->
        <section
          class="embedded-visualization-shell__scene"
          aria-label="三维场景容器"
          :inert="visualizationMaskVisible"
        >
          <ProcessScenePanel :result="sceneBaseline" />
          <!--
            临时步骤导航只发送独立命名镜头命令，不触发流程步骤，不改变模型显隐、选择、描边或设备状态。
            六个按钮来自当前稳定业务场景的固定映射，禁止把页面输入直接作为 cameraPoseId（镜头点标识）。
          -->
          <nav
            v-if="cameraPoseControlsVisible"
            class="embedded-visualization-shell__camera-steps"
            aria-label="关键环节镜头定位"
          >
            <ol class="embedded-visualization-shell__camera-step-list">
              <li v-for="(button, index) in cameraPoseButtons" :key="button.cameraPoseId">
                <button
                  class="embedded-visualization-shell__camera-step-button"
                  type="button"
                  :disabled="!cameraPoseNavigationAvailable"
                  :aria-pressed="activeCameraPoseId === button.cameraPoseId"
                  :aria-busy="pendingCameraPoseId === button.cameraPoseId ? 'true' : 'false'"
                  :title="cameraPoseNavigationAvailable ? button.label : '当前三维运行时不支持命名镜头定位'"
                  @click="moveCameraToPose(button)"
                >
                  <span class="embedded-visualization-shell__camera-step-index" aria-hidden="true">
                    {{ String(index + 1).padStart(2, '0') }}
                  </span>
                  <span>{{ button.label }}</span>
                </button>
              </li>
            </ol>
          </nav>
          <!-- 运行时尚未就绪时遮罩三维区域，但底层面板仍会登记视口并完成唯一实例初始化。 -->
          <AppStatePanel
            v-if="status === 'idle' || status === 'creating' || status === 'handshaking' || status === 'switching' || status === 'releasing'"
            class="embedded-visualization-shell__runtime-state"
            kind="initializing"
            reason="正在等待 Unity 三维运行时完成初始化。"
            :primary-action-visible="false"
          />
          <!-- Unity 失败和释放均以固定诊断呈现，不显示子页面返回的原始错误载荷。 -->
          <AppStatePanel
            v-else-if="status === 'failed'"
            class="embedded-visualization-shell__runtime-state"
            kind="unity-error"
            reason="Unity 三维运行时未能完成安全连接。"
            @retry="retryEmbeddedShell"
          />
          <AppStatePanel
            v-else-if="status === 'disposed'"
            class="embedded-visualization-shell__runtime-state"
            kind="released"
            reason="Unity 三维运行时已经释放，当前页面不会继续向其发送命令。"
            @retry="retryEmbeddedShell"
          />
        </section>

        <!-- 下半区固定取得可用高度的一半，并始终复用一个画布；它只接受正式原子清单运行时的激活结果，不以燃气配置回退猜测当前拓扑。 -->
          <section
            class="embedded-visualization-shell__topology"
            aria-label="二维拓扑容器"
            v-show="!topologySuppressed"
            :inert="visualizationMaskVisible || topologySuppressed"
            :aria-hidden="topologySuppressed ? 'true' : 'false'"
          >
          <ManifestTopologyRuntimePanel
            :registry="manifestState.registry"
            :suspended="topologySuppressed"
            @ready="handleTopologyRuntimeReady"
            @node-double-click="handleTopologyNodeDoubleClick"
          />
        </section>
      </VisualizationRuntimeHost>

      <!--
        启动与事务遮罩覆盖两个容器并以 inert（非活动）阻断原有焦点，确保 Unity 内部加载画面、
        旧三维与新拓扑都不会在首个稳定视图前透出或被操作。它不是对话框，因此不使用 aria-modal。
      -->
      <div
        v-if="visualizationMaskVisible"
        class="embedded-visualization-shell__transition-mask"
        role="status"
        aria-label="正在加载可视化内容"
        aria-live="polite"
        aria-atomic="true"
      >
        <span class="embedded-visualization-shell__transition-indicator" aria-hidden="true" />
      </div>
    </div>
  </main>
</template>

<style scoped>
/*
 * 使用固定视口网格占满父 iframe 的可用区域；overflow hidden 阻止旧工作台内容高度向父页面传播，
 * 从而避免子应用和外部父页面同时出现滚动条。任务-006会在此基础上补齐正式的尺寸不足诊断。
 */
.embedded-visualization-shell {
  /*
   * 两个可视化区在高度方向均分可用空间。三维区域在自己的半区内保持 16:9，
   * 工作宽度由半区高度反推；拓扑复用该宽度，因此上下容器边界始终对齐。
   * 计算只读取动态视口尺寸，没有固定像素上限，2K、4K、8K 与带鱼屏都会重新求值。
   */
  --visualization-half-block-size: calc((100dvh - 1px) / 2);
  --scene-block-size: min(56.25cqw, var(--visualization-half-block-size));
  --visualization-work-inline-size: min(100%, calc(var(--scene-block-size) * 16 / 9));
  display: grid;
  inline-size: 100%;
  block-size: 100dvh;
  min-inline-size: 0;
  min-block-size: 0;
  /*
   * 根容器作为查询容器，供其内部网格用 cqw（容器查询宽度单位）读取实际嵌入壳宽度。
   * cqw 不能由元素读取自身尺寸；放在父级可确保内容网格获得正确的 iframe 可用宽度。
   */
  container-type: inline-size;
  overflow: hidden;
  background: #061323;
}

.embedded-visualization-shell__content {
  position: relative;
  display: grid;
  min-inline-size: 0;
  min-block-size: 0;
  /*
   * 上下两个容器使用相同的 1fr（剩余空间等分）轨道，因此各占可用高度的一半。
   * 上方三维视口仍严格维持 16:9；三维与拓扑内层共用同一工作宽度，避免超宽屏中两者边界错位。
   */
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1px;
  /* 两侧留白不是业务容器，统一使用三维区的纯黑基底，避免拓扑青色背景扩展到未占用区域。 */
  background: #020617;
}

.embedded-visualization-shell__content--full-scene {
  grid-template-rows: minmax(0, 1fr) 0;
  gap: 0;
}

/* 平台总览只改变已提交稳定上下文对应的布局，不重建 Unity iframe 或拓扑 Canvas。 */
.embedded-visualization-shell__content--full-scene .embedded-visualization-shell__scene :deep(.process-scene--reserved) {
  inline-size: 100%;
  block-size: 100%;
  aspect-ratio: auto;
}

/*
 * 启动和切换遮罩与网格同尺寸，不依赖固定像素：2K、4K、8K 与带鱼屏均由容器自身边界决定覆盖范围。
 * 使用不透明背景完全挡住 Unity iframe 的品牌图和内部加载层，直到协调器确认首个稳定视图后才移除；
 * pointer-events 阻断鼠标交互，inert 负责键盘焦点隔离。
 */
.embedded-visualization-shell__transition-mask {
  position: absolute;
  z-index: 4;
  inset: 0;
  display: grid;
  place-items: center;
  padding: clamp(16px, 2cqw, 32px);
  pointer-events: auto;
  background: #020617;
}

/* 轻量旋转指示器仅使用合成层动画，不触发拓扑画布或 Unity iframe 的重排。 */
.embedded-visualization-shell__transition-indicator {
  inline-size: 1.125rem;
  block-size: 1.125rem;
  flex: 0 0 auto;
  border: 2px solid rgb(186 230 253 / 35%);
  border-block-start-color: #67e8f9;
  border-radius: 50%;
  animation: embedded-visualization-shell-spin 800ms linear infinite;
}

@keyframes embedded-visualization-shell-spin {
  to {
    transform: rotate(1turn);
  }
}

.embedded-visualization-shell__scene,
.embedded-visualization-shell__topology {
  min-inline-size: 0;
  min-block-size: 0;
  overflow: hidden;
}

/* 状态覆盖层仅占用三维子容器，初始化与异常时阻断交互，避免用户操作未稳定的视图。 */
.embedded-visualization-shell__scene {
  position: relative;
  display: grid;
  place-items: center;
  background: #020617;
}

.embedded-visualization-shell__runtime-state {
  position: absolute;
  z-index: 3;
  inset: var(--space-4);
  align-content: center;
  justify-items: center;
  text-align: center;
}

/*
 * 六步镜头导航覆盖在第二层三维区底部，不参与网格计算，因此不会触发 Unity 视口重排。
 * 普通业务视图必须复用 --visualization-work-inline-size（Unity 实际视口宽度），而不能读取外层
 * 场景区域的 100% 宽度；这样宽屏两侧的留白不会被按钮条占用。六个按钮始终收缩在导航条边界内，
 * 文本在按钮内部换行，页面和三维容器保持无横向滚动条。
 */
.embedded-visualization-shell__camera-steps {
  position: absolute;
  z-index: 2;
  inset-block-end: clamp(12px, 2.4cqh, 28px);
  inset-inline-start: 50%;
  /*
   * 导航条的外框明确绑定到与 ProcessScenePanel（Unity 容器）相同的工作宽度，
   * 而不是由外层场景区域或六个按钮的内容宽度反向撑开。显式使用 border-box，
   * 让边框和内边距都包含在 Unity 容器宽度内，外框不会从画布两侧溢出。
   */
  inline-size: var(--visualization-work-inline-size);
  max-inline-size: 100%;
  box-sizing: border-box;
  padding: 8px;
  /* 六个按钮在外框内等比分配；窄屏时由按钮自身换行，不产生页面级横向滚动。 */
  overflow: hidden;
  border: 1px solid rgb(103 232 249 / 42%);
  border-radius: 10px;
  background: rgb(2 15 28 / 84%);
  box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
  transform: translateX(-50%);
  backdrop-filter: blur(6px);
  scrollbar-width: thin;
  scrollbar-color: rgb(103 232 249 / 55%) transparent;
}

/*
 * 总览或关键环节全屏态会把 Unity 容器从 16:9 工作宽度扩展到整个场景区域；
 * 导航条同步扩展，避免全屏时仍沿用普通态变量而在 Unity 画布两侧留下错位边界。
 */
.embedded-visualization-shell__content--full-scene .embedded-visualization-shell__camera-steps {
  inline-size: 100%;
  max-inline-size: 100%;
}

.embedded-visualization-shell__camera-step-list {
  display: grid;
  /* 六个固定按钮始终共享导航条可用宽度，避免 min-content 宽度把列表撑出容器。 */
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 7px;
  inline-size: 100%;
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 单个按钮保持两行以内，并用独立序号强化从左到右的工艺顺序。 */
.embedded-visualization-shell__camera-step-button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  min-block-size: 42px;
  /* 清除网格项目的自动最小宽度，确保长文案不会把对应轨道重新撑大。 */
  min-inline-size: 0;
  inline-size: 100%;
  padding: 7px 10px;
  border: 1px solid rgb(103 232 249 / 36%);
  border-radius: 7px;
  color: #e6fbff;
  font: inherit;
  font-size: clamp(11px, 0.72cqw, 13px);
  line-height: 1.25;
  text-align: start;
  cursor: pointer;
  background: rgb(8 47 73 / 88%);
  transition: border-color 120ms ease, background-color 120ms ease, opacity 120ms ease;
}

.embedded-visualization-shell__camera-step-index {
  display: grid;
  place-items: center;
  inline-size: 24px;
  block-size: 24px;
  border: 1px solid rgb(103 232 249 / 60%);
  border-radius: 50%;
  color: #a5f3fc;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.embedded-visualization-shell__camera-step-button:hover:not(:disabled),
.embedded-visualization-shell__camera-step-button[aria-pressed='true'],
.embedded-visualization-shell__camera-step-button[aria-busy='true'] {
  border-color: #67e8f9;
  background: #0e7490;
}

.embedded-visualization-shell__camera-step-button:focus-visible {
  outline: 2px solid #f8fafc;
  outline-offset: 2px;
}

.embedded-visualization-shell__camera-step-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

/*
 * 只让已声明网页图形能力的场景占据标准 16:9 视口；高度由上方网格轨道限定，
 * 宽度在当前内容区与动态高度上限反推宽度之间取较小值。两侧产生的留白由场景容器承接，
 * 不会改变 iframe 的实际渲染比例，也不会因高分辨率或超宽屏向下方拓扑挤占额外高度。
 */
.embedded-visualization-shell__scene :deep(.process-scene--reserved) {
  inline-size: var(--visualization-work-inline-size);
  block-size: auto;
  min-block-size: 0;
  aspect-ratio: 16 / 9;
}

/* Unity iframe 的投放容器填满上述固定比例视口，ResizeObserver 仅接收等比后的真实尺寸。 */
.embedded-visualization-shell__scene :deep(.process-scene__runtime) {
  block-size: 100%;
  min-block-size: 0;
}

/*
 * 拓扑外层固定占据下半区，内层面板与实际 Unity 视口共用宽度并居中。
 * 因此宽屏两侧仅是壳层留白，标题、图例、画布和全屏按钮的左右边界始终与三维容器对齐。
 * 全屏面板已脱离运行壳，不能继承该约束，否则会造成视口越界。
 */
.embedded-visualization-shell__topology {
  display: grid;
  justify-items: center;
  /* 仅居中的拓扑面板保留工业青色视觉，面板以外的剩余区域不承担第二套背景语义。 */
  background: #020617;
}

.embedded-visualization-shell__topology :deep(.topology-panel:not(.topology-panel--fullscreen)),
.embedded-visualization-shell__topology :deep(.topology-canvas) {
  block-size: 100%;
  min-block-size: 0;
}

/*
 * 常规态的拓扑面板与三维容器共用工作区宽度，保证上下视觉边界对齐。
 * 全屏态不能继承此宽度：它由自身 fixed（固定定位）+ inset（视口边距）
 * 决定四边，才能在普通屏、带鱼屏和高分辨率屏中铺满当前可视区域。
 */
.embedded-visualization-shell__topology :deep(.topology-panel:not(.topology-panel--fullscreen)) {
  inline-size: var(--visualization-work-inline-size);
  /* 覆盖面板默认网格，保证常规态画布在移除状态摘要后占满第二行。 */
  grid-template-rows: auto minmax(0, 1fr);
  border: 0;
  border-radius: 0;
}

.embedded-visualization-shell__topology :deep(.topology-canvas) {
  border-inline: 0;
  border-block-end: 0;
  border-radius: 0;
}

.embedded-visualization-shell__state {
  align-self: center;
  justify-self: center;
  inline-size: min(560px, calc(100% - 32px));
}

</style>

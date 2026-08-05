<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { readDeploymentConfiguration } from '@/config/deployment/deployment-config'
import { createEmbeddedShellCorrelationId, createEmbeddedShellDiagnostic } from '@/app/embedded-shell-diagnostics'
import { RemoteSceneTopologyManifestLoader, type SceneTopologyManifestRequestFailureCode } from '@/config/scene-topology/remote-manifest-loader'
import type { SceneTopologyManifest } from '@/config/scene-topology/types'
import { TopologyRegistry } from '@/config/scene-topology/topology-registry'
import { localProcessConfigLoader } from '@/config/process/local-process-config'
import { createHostBridgeStartup, HostBridge } from '@/host-bridge/host-bridge'
import { HostRuntimeComposition } from '@/host-bridge/host-runtime-composition'
import ProcessScenePanel from '@/modules/visual/components/ProcessScenePanel.vue'
import ManifestTopologyRuntimePanel from '@/modules/visual/topology/ManifestTopologyRuntimePanel.vue'
import VisualizationRuntimeHost from '@/modules/visual/runtime/VisualizationRuntimeHost.vue'
import { VisualizationCoordinator } from '@/modules/visual/orchestration/visualization-coordinator'
import { createVisualizationCoordinatorFacade, visualizationCoordinatorFacadeKey } from '@/modules/visual/orchestration/visualization-coordinator-facade'
import { useVisualizationStore } from '@/modules/visual/orchestration/visualization.store'
import { getVisualizationTransitionOverlayState } from '@/modules/visual/orchestration/visualization-transition-overlay'
import { ViewOpenTransactionHandler } from '@/modules/visual/orchestration/view-open-transaction-handler'
import { WorkflowTriggerTransactionHandler } from '@/modules/visual/orchestration/workflow-trigger-transaction-handler'
import { WorkflowTriggerTransactionRouter } from '@/modules/visual/orchestration/workflow-trigger-transaction-router'
import { DeviceStatesUpdateCoordinator } from '@/modules/visual/orchestration/device-states-update-coordinator'
import { UnityObjectSelectionCoordinator } from '@/modules/visual/orchestration/unity-object-selection-coordinator'
import { VisualizationRuntimeViewOpenPort } from '@/modules/visual/runtime/visualization-runtime-view-open-port'
import { VisualizationRuntimeDeviceStatePort } from '@/modules/visual/runtime/visualization-runtime-device-state-port'
import type { VisualizationRuntimeHostController } from '@/modules/visual/runtime/visualization-runtime-host'
import type { TopologyRuntime } from '@/modules/visual/topology/topology-runtime'
import type { TopologyDeviceDoubleClickIntent } from '@/modules/visual/topology/topology-node-interaction'
import AppStatePanel from '@/shared/components/AppStatePanel.vue'

/**
 * 现有燃气配置只保留为已验证的 Unity 单实例启动登记。
 * 二维拓扑一律由下面完成双重校验的正式场景清单提供，不能再把燃气标题、节点或连线作为其他场景的默认值。
 */
const gasBaseline = computed(() => localProcessConfigLoader.load('gas-overview'))
const deploymentConfiguration = readDeploymentConfiguration()
const shellElement = ref<HTMLElement | null>(null)
const isContainerTooSmall = ref(false)
const shellCorrelationId = createEmbeddedShellCorrelationId()
let shellResizeObserver: ResizeObserver | undefined
let manifestAbortController: AbortController | undefined
/** 运行时宿主组件引用只用于读取受控控制器，不向壳层泄露 iframe、连接器或 Unity 窗口。 */
const visualizationRuntimeHost = ref<InstanceType<typeof VisualizationRuntimeHost> | null>(null)
/** 正式拓扑运行时在单画布端口就绪后由子组件交付，外层桥必须等到此实例存在才可处理初始化。 */
const topologyRuntime = shallowRef<TopologyRuntime | undefined>()
/** 通信组合根只保留一个实例；失败的启动参数不会构造桥，也不会留下半注册监听器。 */
let hostRuntimeComposition: HostRuntimeComposition | undefined
/** 三维反向选择订阅只在组合根存在期间保留；壳层释放时必须解除，不能让旧 Unity 回调存活。 */
let unsubscribeUnityObjectSelected: (() => void) | undefined
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
  runtimeStatus: visualizationStore.runtimeStatus,
}))

/**
 * 壳层只向用户显示有限、脱敏的诊断模型；部署地址、外部消息和 Unity 原始错误均不进入界面。
 * 配置错误优先级最高，其次是尺寸不足和原子清单校验，最后才处理本地燃气基线的拓扑校验失败。
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
      reason: '父页面提供的可用区域未达到当前部署配置要求。',
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

  if (!gasBaseline.value.bundle) {
    return createEmbeddedShellDiagnostic('topology-error', {
      reason: '当前燃气拓扑基线未通过完整性校验，已停止创建可视化运行时。',
      correlationId: shellCorrelationId,
    })
  }

  return undefined
})

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
    'manifest.payload': '场景拓扑清单内容无法按发布格式解析。',
    'manifest.timeout': '场景拓扑清单在限定时间内未完成读取。',
    'manifest.aborted': '场景拓扑清单读取已被当前页面生命周期取消。',
    'manifest.network': '场景拓扑清单暂时无法连接。',
    'manifest.invalid': '场景拓扑清单未通过完整性和版本一致性校验。',
  }

  return reasonByCode[code]
}

/**
 * 只在部署配置完整时读取清单。远端读取成功后还必须通过本地注册表的跨引用校验，
 * 任一阶段失败都不创建半份拓扑索引或画布运行时；组件卸载后迟到响应不会更新状态。
 */
async function loadManifest(): Promise<void> {
  const configuration = deploymentConfiguration.configuration
  if (!configuration) return

  manifestAbortController?.abort()
  const controller = new AbortController()
  manifestAbortController = controller
  manifestState.value = { status: 'loading' }
  const result = await new RemoteSceneTopologyManifestLoader().load(configuration.manifestUrl, controller.signal)

  if (controller.signal.aborted || manifestAbortController !== controller) return
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
  topologyRuntime.value = runtime
  startHostRuntimeCompositionIfReady()
}

/**
 * 任务-027的双击意图只交给已启动的外层通信组合根。
 * 组合根会再次核对握手、稳定上下文、场景和拓扑；壳层不根据标题、坐标或旧燃气配置补全设备映射。
 */
function handleTopologyDeviceDoubleClick(intent: TopologyDeviceDoubleClickIntent): void {
  hostRuntimeComposition?.reportTopologyDeviceDoubleClick(intent)
}

/**
 * 读取运行时宿主已经显式暴露的最小控制器。
 * 若宿主尚未挂载，调用方只能等待，不得访问组件私有 iframe/连接器或在壳层重建 Unity 实例。
 */
function getRuntimeHostController(): VisualizationRuntimeHostController | undefined {
  return visualizationRuntimeHost.value?.getRuntimeHostController()
}

/**
 * 当清单、唯一拓扑运行时和 Unity 运行时均已就绪后，才创建外层桥组合根。
 * 直接打开子应用时通常缺少父来源、实例和协议版本参数，此时保持本地等待态而不创建宽松桥接；
 * 被合法父页面嵌入时，三个参数仍须与部署白名单同时匹配，任一不匹配均不会注册窗口监听器。
 */
function startHostRuntimeCompositionIfReady(): void {
  if (hostRuntimeComposition) return
  const configuration = deploymentConfiguration.configuration
  const manifest = manifestState.value.status === 'ready' ? manifestState.value.manifest : undefined
  const registry = manifestState.value.status === 'ready' ? manifestState.value.registry : undefined
  const runtime = topologyRuntime.value
  const runtimeHost = getRuntimeHostController()
  if (!configuration || !manifest || !registry || !runtime || !runtimeHost || runtimeHost.status.value !== 'ready') return

  const startup = createHostBridgeStartup(window.location.search, configuration)
  if (startup.status !== 'ready') return

  // 回调闭包先引用局部变量，赋值完成后才 start；因此桥接一开始接收消息时组合根已经完整构造。
  let composition: HostRuntimeComposition | undefined
  const bridge = new HostBridge(startup.context, window.parent, undefined, {
    onCommand: (command) => {
      // 生命周期、握手和事务内部均将错误收敛为协议事件；这里不记录或展示不可信命令载荷。
      void composition?.handleCommand(command)
    },
  })
  const viewOpen = new ViewOpenTransactionHandler(
    registry,
    runtime,
    new VisualizationRuntimeViewOpenPort(runtimeHost),
    visualizationCoordinatorFacade,
  )
  /** 同场景流程触发只复用上方同一个原子切换处理器；它不会取得运行时宿主的 release 或 iframe 访问权。 */
  const sameSceneWorkflowTrigger = new WorkflowTriggerTransactionHandler(
    registry,
    viewOpen,
    visualizationCoordinatorFacade,
  )
  /** 跨场景流程动作使用相同原子处理器，但范围校验独立，避免同场景失败策略错误应用于跨场景物理回退。 */
  const crossSceneWorkflowTrigger = new WorkflowTriggerTransactionHandler(
    registry,
    viewOpen,
    visualizationCoordinatorFacade,
    'cross-scene',
  )
  /** 路由只读取显式动作目标和当前稳定场景，真正的参数、事务和失败校验仍由范围处理器完成。 */
  const workflowTrigger = new WorkflowTriggerTransactionRouter(
    registry,
    visualizationCoordinatorFacade,
    sameSceneWorkflowTrigger,
    crossSceneWorkflowTrigger,
  )
  /**
   * 批量状态协调器复用已经就绪的唯一拓扑运行时与 Unity 宿主端口。
   * 它不会创建第二画布或第二 Unity 实例；未协商四态能力时由协调器返回受控失败并记录有限摘要。
   */
  const deviceStatesUpdate = new DeviceStatesUpdateCoordinator(
    runtime,
    new VisualizationRuntimeDeviceStatePort(runtimeHost),
  )
  composition = new HostRuntimeComposition(
    bridge,
    visualizationCoordinatorFacade,
    viewOpen,
    manifest.manifestVersion,
    // 外层释放确认必须等待 Unity 宿主解除 iframe/连接器资源，不能只释放可序列化协调器状态。
    () => runtimeHost.releaseAndWait(),
    workflowTrigger,
    deviceStatesUpdate,
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
    const selected = unityObjectSelectionCoordinator?.resolve(selection)
    if (selected) composition?.reportSceneObjectSelected(selected)
  })
  hostRuntimeComposition = composition
  composition.start()
}

onMounted(() => {
  if (!shellElement.value) return

  shellResizeObserver = new ResizeObserver(synchronizeContainerSize)
  shellResizeObserver.observe(shellElement.value)
  synchronizeContainerSize()
  void loadManifest()
})

/**
 * Unity 宿主的 ready（就绪）状态是外层初始化可用的最后条件。
 * 监听只读取已公开的只读状态引用；其变化不会触发任何重复创建，启动函数以单例变量做最终幂等保护。
 */
watch(
  () => getRuntimeHostController()?.status.value,
  () => startHostRuntimeCompositionIfReady(),
)

/** 卸载时释放尺寸观察器，避免父页面销毁 iframe 后仍保留子应用回调。 */
onBeforeUnmount(() => {
  shellResizeObserver?.disconnect()
  shellResizeObserver = undefined
  manifestAbortController?.abort()
  manifestAbortController = undefined
  unsubscribeUnityObjectSelected?.()
  unsubscribeUnityObjectSelected = undefined
  unityObjectSelectionCoordinator?.dispose()
  unityObjectSelectionCoordinator = undefined
  // 先解除外层窗口监听和命令计时器，再释放协调器；避免迟到的父页面命令观察到已销毁的运行时门面。
  hostRuntimeComposition?.dispose()
  hostRuntimeComposition = undefined
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
      :error-code="shellDiagnostic.code"
      :correlation-id="shellDiagnostic.correlationId"
      @retry="retryEmbeddedShell"
    />

    <!-- Unity 启动登记与正式注册表均通过后才创建两类运行时；二者任一缺失都不会把旧燃气拓扑传给画布。 -->
    <div
      v-else-if="gasBaseline.bundle && manifestState.status === 'ready'"
      class="embedded-visualization-shell__content"
      :aria-busy="transitionOverlay.visible ? 'true' : 'false'"
    >
      <VisualizationRuntimeHost ref="visualizationRuntimeHost" v-slot="{ status }">
        <!-- 上半区复用已验证的 Unity 单实例视口和蓝色视觉基线。 -->
        <section
          class="embedded-visualization-shell__scene"
          aria-label="三维场景容器"
          :inert="transitionOverlay.visible"
        >
          <ProcessScenePanel :result="gasBaseline" />
          <!-- 运行时尚未就绪时遮罩三维区域，但底层面板仍会登记视口并完成唯一实例初始化。 -->
          <AppStatePanel
            v-if="status === 'idle' || status === 'creating' || status === 'handshaking' || status === 'switching' || status === 'releasing'"
            class="embedded-visualization-shell__runtime-state"
            kind="initializing"
            reason="正在等待 Unity 三维运行时完成初始化。"
            error-code="runtime.initializing"
            :correlation-id="shellCorrelationId"
            :primary-action-visible="false"
          />
          <!-- Unity 失败和释放均以固定诊断呈现，不显示子页面返回的原始错误载荷。 -->
          <AppStatePanel
            v-else-if="status === 'failed'"
            class="embedded-visualization-shell__runtime-state"
            kind="unity-error"
            reason="Unity 三维运行时未能完成安全连接。"
            error-code="unity.runtime-failed"
            :correlation-id="shellCorrelationId"
            @retry="retryEmbeddedShell"
          />
          <AppStatePanel
            v-else-if="status === 'disposed'"
            class="embedded-visualization-shell__runtime-state"
            kind="released"
            reason="Unity 三维运行时已经释放，当前页面不会继续向其发送命令。"
            error-code="runtime.disposed"
            :correlation-id="shellCorrelationId"
            @retry="retryEmbeddedShell"
          />
        </section>

        <!-- 下半区始终复用一个画布；它只接受正式原子清单运行时的激活结果，不以燃气配置回退猜测当前拓扑。 -->
        <section
          class="embedded-visualization-shell__topology"
          aria-label="二维拓扑容器"
          :inert="transitionOverlay.visible"
        >
          <ManifestTopologyRuntimePanel
            :registry="manifestState.registry"
            @ready="handleTopologyRuntimeReady"
            @device-double-click="handleTopologyDeviceDoubleClick"
          />
        </section>
      </VisualizationRuntimeHost>

      <!--
        事务遮罩覆盖两个容器并以 inert（非活动）阻断原有焦点，确保屏幕阅读器与键盘用户
        都不会在“旧三维 + 新拓扑”尚未提交的短暂窗口继续操作。它不是对话框，因此不使用 aria-modal。
      -->
      <div
        v-if="transitionOverlay.visible"
        class="embedded-visualization-shell__transition-mask"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div class="embedded-visualization-shell__transition-card">
          <span class="embedded-visualization-shell__transition-indicator" aria-hidden="true" />
          <p>{{ transitionOverlay.message }}</p>
        </div>
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
   * 两个可视化区共用同一工作宽度：先为拓扑保留随视口变化的最小可读高度，
   * 再在剩余高度内计算满足 16:9 的三维高度和宽度。该值没有固定像素上限，
   * 2K、4K、8K 与带鱼屏都会按父 iframe 的真实尺寸重新求值。
   */
  --topology-reserved-block-size: clamp(320px, 42dvh, 460px);
  --scene-block-size: min(56.25cqw, calc(100dvh - var(--topology-reserved-block-size) - 1px));
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
   * 上方三维视口严格维持 16:9，并从根容器预先计算的剩余高度中取值；下方拓扑先获得
   * 最小可读高度，再占据其余空间。三维与拓扑内层共用同一工作宽度，避免超宽屏中两者边界错位。
   */
  grid-template-rows: minmax(0, var(--scene-block-size)) minmax(var(--topology-reserved-block-size), 1fr);
  gap: 1px;
  /* 两侧留白不是业务容器，统一使用三维区的纯黑基底，避免拓扑青色背景扩展到未占用区域。 */
  background: #020617;
}

/*
 * 切换遮罩与网格同尺寸，不依赖固定像素：2K、4K、8K 与带鱼屏均由容器自身边界决定覆盖范围。
 * 半透明背景保留当前稳定画面作为切换反馈，同时 pointer-events 阻断鼠标交互；inert 负责键盘焦点隔离。
 */
.embedded-visualization-shell__transition-mask {
  position: absolute;
  z-index: 4;
  inset: 0;
  display: grid;
  place-items: center;
  padding: clamp(16px, 2cqw, 32px);
  pointer-events: auto;
  background: rgb(2 6 23 / 68%);
  backdrop-filter: blur(3px);
}

/* 卡片宽度只相对当前嵌入壳收缩，避免超宽屏将状态文字拉成难以阅读的超长行。 */
.embedded-visualization-shell__transition-card {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  max-inline-size: min(100%, 42rem);
  padding: var(--space-4) var(--space-5);
  border: 1px solid rgb(103 232 249 / 58%);
  border-radius: var(--radius-lg);
  color: #e0f2fe;
  background: rgb(8 47 73 / 92%);
  box-shadow: 0 12px 30px rgb(0 0 0 / 30%);
}

.embedded-visualization-shell__transition-card p {
  margin: 0;
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
 * 拓扑外层保留全部剩余高度，内层面板却必须与实际 Unity 视口共用宽度并居中。
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
  grid-template-rows: auto auto minmax(0, 1fr);
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

@media (width < 720px) {
  /* 小宽度优先保留拓扑的文字可读高度，三维仍保持 16:9，不降回旧工作台的多栏布局。 */
  .embedded-visualization-shell {
    --topology-reserved-block-size: clamp(300px, 48dvh, 420px);
  }

  /* 窄屏下三维与拓扑继续读取同一个工作宽度变量，确保视觉边界始终对齐。 */
  .embedded-visualization-shell__scene :deep(.process-scene--reserved) {
    inline-size: var(--visualization-work-inline-size);
  }
}
</style>

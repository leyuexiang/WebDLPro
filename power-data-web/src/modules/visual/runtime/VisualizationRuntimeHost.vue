<script setup lang="ts">
import { nextTick, onBeforeUnmount, provide, readonly, ref } from 'vue'
import type { WebglRuntimeRegistration } from '@/config/process/types'
import {
  WebglRuntimeConnector,
  type WebglConnectorStatus,
} from '@/services/webgl/runtime-connector'
import type { WebglCommandType } from '@/services/webgl/protocol'
import {
  visualizationRuntimeHostKey,
  type VisualizationObjectSelection,
  type VisualizationSceneLoadProgressEvent,
  type VisualizationRuntimeHostController,
  type VisualizationRuntimeLifecycle,
} from '@/modules/visual/runtime/visualization-runtime-host'

const iframeElement = ref<HTMLIFrameElement | null>(null)
const iframeSource = ref<string | null>(null)
const viewportElement = ref<HTMLElement | null>(null)
const runtimeStatus = ref<VisualizationRuntimeLifecycle>('idle')
const runtimeReason = ref<string | null>(null)
const runtimeCapabilities = ref<readonly WebglCommandType[]>([])
const selectedObjectListeners = new Set<(selection: VisualizationObjectSelection) => void>()
/** 加载反馈监听器属于嵌入壳生命周期，不随单次 Unity 场景切换重建；壳层卸载时统一清空。 */
const sceneLoadProgressListeners = new Set<(progress: VisualizationSceneLoadProgressEvent) => void>()
/** 等待表与连接器待确认表使用同一 requestId，且其容量受连接器 64 条上限间接约束。 */
const pendingCommandResultByRequestId = new Map<string, (result: { success: boolean; sceneActivationId?: string }) => void>()
/**
 * 释放等待者只由外层 system.dispose（系统释放）使用，单实例宿主通常至多存在一个。
 * 使用 Set 仍可安全处理重复释放：每个调用各自结算，清理完成后立即清空，不保留页面卸载后的闭包。
 */
const pendingReleaseResolvers = new Set<(result: { success: boolean }) => void>()

let activeRuntime: WebglRuntimeRegistration | undefined
let pendingRuntime: WebglRuntimeRegistration | undefined
let connector: WebglRuntimeConnector | undefined
let resizeObserver: ResizeObserver | undefined
let resizeAnimationFrame: number | undefined
let instanceSequence = 0

/**
 * 页面将场景容器登记给唯一宿主，宿主才会将自己拥有的 iframe 投放到该容器。
 * 返回的注销函数具有幂等性，路由切换时旧容器消失不会影响已登记的新容器。
 */
function registerViewport(viewport: HTMLElement): () => void {
  viewportElement.value = viewport
  observeViewport(viewport)

  return () => {
    if (viewportElement.value !== viewport) return

    viewportElement.value = null
    disconnectResizeObserver()
  }
}

/**
 * 获取登记运行时：同一构建复用已有单实例；不同构建先请求旧实例释放，
 * 后续创建始终使用新 instanceId，旧消息会被连接器严格丢弃。
 */
function acquire(runtime: WebglRuntimeRegistration): void {
  if (activeRuntime?.runtimeKey === runtime.runtimeKey && connector && runtimeStatus.value !== 'failed') return

  pendingRuntime = runtime
  if (connector) {
    runtimeStatus.value = 'switching'
    runtimeReason.value = null
    requestActiveRuntimeRelease()
    return
  }

  startPendingRuntime()
}

/**
 * 仅允许当前运行时主动释放；传入其他 runtimeKey 的旧页面卸载不会误释放新页面实例。
 * 未完成握手的运行时没有可信 dispose 能力，直接执行本地资源回收即可。
 */
function release(runtimeKey?: string): void {
  if (!connector || (runtimeKey && activeRuntime?.runtimeKey !== runtimeKey)) return

  pendingRuntime = undefined
  requestActiveRuntimeRelease()
}

/**
 * 请求释放并等待 iframe、连接器、尺寸观察器和待确认表都完成清理。
 * 它不把 Unity `disposed`（已释放）事件直接交给业务层：即使远端确认超时，宿主也会在连接器失败路径
 * 执行本地兜底回收后结算成功，表达“资源已不再由当前页面持有”，而不是伪造远端业务成功。
 */
function releaseAndWait(runtimeKey?: string): Promise<{ success: boolean }> {
  if (!connector || (runtimeKey && activeRuntime?.runtimeKey !== runtimeKey)) return Promise.resolve({ success: true })

  return new Promise((resolve) => {
    pendingReleaseResolvers.add(resolve)
    release(runtimeKey)
  })
}

/** 业务页面通过宿主转发白名单命令；连接器会再次验证运行时状态与协商能力。 */
function sendCommand(command: Exclude<WebglCommandType, 'init'>, payload: unknown): string | undefined {
  return connector?.sendCommand(command, payload)
}

/**
 * 向内层发送命令并等待连接器已验证的最终结果。
 * 发送未成功、连接器失败或当前运行时释放时均返回失败；调用方不必接触跨窗口事件或自行管理超时器。
 */
function sendCommandAndWait(command: Exclude<WebglCommandType, 'init'>, payload: unknown): Promise<{ success: boolean; sceneActivationId?: string }> {
  const requestId = connector?.sendCommand(command, payload)
  if (!requestId) return Promise.resolve({ success: false })

  return new Promise((resolve) => {
    pendingCommandResultByRequestId.set(requestId, resolve)
  })
}

/**
 * 订阅对象选中事件并返回撤销函数。监听器集合只保存在布局生命周期内，
 * 页面组件卸载后会撤销订阅，避免跨工艺页保留闭包。
 */
function subscribeObjectSelected(listener: (selection: VisualizationObjectSelection) => void): () => void {
  selectedObjectListeners.add(listener)
  return () => selectedObjectListeners.delete(listener)
}

/**
 * 将连接器已经验证的有限加载反馈转交给唯一协调器。
 * 宿主仍不暴露 connector（连接器）、iframe 或窗口对象；订阅者只能读取稳定标识、阶段和归一化进度。
 */
function subscribeSceneLoadProgress(listener: (progress: VisualizationSceneLoadProgressEvent) => void): () => void {
  sceneLoadProgressListeners.add(listener)
  return () => sceneLoadProgressListeners.delete(listener)
}

/**
 * 对内层组件与组合根公开的唯一运行时控制器。
 * 对象在整个宿主生命周期内保持同一引用，且只暴露受控方法和只读响应式状态；iframe、连接器、等待表、
 * 窗口对象和尺寸观察器仍严格封装在本组件中，外层桥无法越过该边界直接访问 Unity。
 */
const runtimeHostController: VisualizationRuntimeHostController = Object.freeze({
  status: readonly(runtimeStatus),
  reason: readonly(runtimeReason),
  capabilities: readonly(runtimeCapabilities),
  registerViewport,
  acquire,
  release,
  releaseAndWait,
  sendCommand,
  sendCommandAndWait,
  subscribeObjectSelected,
  subscribeSceneLoadProgress,
})
provide(visualizationRuntimeHostKey, runtimeHostController)

/**
 * 组合根通过组件引用获取同一个受控控制器，用于 task-033 的 `view.open` 端口接线。
 * 这避免嵌入壳依赖插槽作用域或私有注入时序，也不会把 iframe/连接器实例暴露到父组件。
 */
function getRuntimeHostController(): VisualizationRuntimeHostController {
  return runtimeHostController
}

defineExpose({ getRuntimeHostController })

/**
 * 创建待启动运行时。入口地址、父页面来源与构建元数据都完全来自只读登记表，
 * 这里不接受业务页面传入 URL，也不会降级为通配 targetOrigin。
 */
function startPendingRuntime(): void {
  const nextRuntime = pendingRuntime
  if (!nextRuntime || connector) return

  if (window.location.origin !== nextRuntime.allowedParentOrigin) {
    failBeforeConnector('当前父页面来源与网页图形登记表不一致。')
    return
  }

  if (!viewportElement.value) {
    failBeforeConnector('场景容器尚未就绪，无法创建网页图形运行时。')
    return
  }

  activeRuntime = nextRuntime
  pendingRuntime = undefined
  runtimeStatus.value = 'creating'
  runtimeReason.value = null
  runtimeCapabilities.value = []

  const instanceId = createInstanceId(nextRuntime.runtimeKey)
  connector = new WebglRuntimeConnector(nextRuntime, instanceId, {
    onStatusChange: handleConnectorStatus,
    onReady: () => {
      // ready 只表示元数据已核对；能力必须等 init 确认后才允许业务命令使用。
      runtimeCapabilities.value = []
    },
    onObjectSelected: (payload, messageId) => {
      selectedObjectListeners.forEach((listener) => listener({ payload, messageId }))
    },
    // 进度先由连接器绑定原 switchScene 请求校验，再由壳层协调器复核当前事务；宿主不直接改领域状态。
    onSceneLoadProgress: (payload, messageId) => {
      sceneLoadProgressListeners.forEach((listener) => listener({ payload, messageId }))
    },
    onCommandFailure: (command, reason) => {
      // 非致命命令失败不销毁已就绪场景；页面只显示固定中文降级，详细原因写入控制台供联调排查。
      console.warn('[网页图形运行时命令失败]', { command, reason })
      runtimeReason.value = `${command} 命令失败：${reason}`
    },
    // 连接器只在原 requestId 的最终成功、失败或超时后通知；宿主据此一次性结算 Promise。
    onCommandCompleted: (completion) => {
      const resolve = pendingCommandResultByRequestId.get(completion.requestId)
      if (!resolve) return
      pendingCommandResultByRequestId.delete(completion.requestId)
      // 等待表只保留场景实例的稳定标识，不缓存 Unity 原始场景状态或消息载荷；
      // 该标识来自已校验的 sceneChanged，或来自“目标失败但旧场景自动恢复成功”的 commandResult。
      resolve({
        success: completion.success,
        ...(completion.sceneActivationId ? { sceneActivationId: completion.sceneActivationId } : {}),
      })
    },
  })

  // 先注册消息监听，再将 iframe 插入并设置 src，防止极快加载的运行时丢失 ready。
  connector.startListening()
  iframeSource.value = buildRuntimeSource(nextRuntime, instanceId)

  void attachIframeWindow()
}

/**
 * Teleport 渲染完成后立即绑定 contentWindow；WindowProxy 会在导航后保持同一代理身份，
 * 因此可在子页面 ready 前完成 source 绑定和握手计时。
 */
async function attachIframeWindow(): Promise<void> {
  await nextTick()

  if (!connector || !iframeElement.value?.contentWindow) {
    failBeforeConnector('网页图形 iframe 未能创建窗口。')
    return
  }

  connector.attachChildWindow(iframeElement.value.contentWindow)
}

/**
 * iframe 首次插入时的 contentWindow（内容窗口）可能仍对应 about:blank（初始空白页）。
 * Unity 页面完成实际导航后重新读取一次窗口代理，使连接器的严格 event.source（事件来源窗口）校验
 * 对准真实运行时；连接器不会因此延长握手时限，也不会放宽来源或实例标识校验。
 */
function handleIframeLoad(): void {
  if (!connector || !iframeElement.value?.contentWindow) return
  connector.attachChildWindow(iframeElement.value.contentWindow)
}

/** 将连接器内部阶段映射到布局状态机，并在终态统一回收 iframe 与观察器。 */
function handleConnectorStatus(status: WebglConnectorStatus, reason?: string): void {
  if (status === 'handshaking') {
    runtimeStatus.value = 'handshaking'
    return
  }

  if (status === 'ready') {
    runtimeStatus.value = 'ready'
    runtimeReason.value = null
    runtimeCapabilities.value = connector?.getCommandCapabilities() ?? []
    scheduleResize()
    return
  }

  if (status === 'releasing') {
    runtimeStatus.value = 'releasing'
    return
  }

  if (status === 'failed') {
    // 运行时失败页面只显示固定中文说明，连接器提供的受控原因保留在控制台。
    console.error('[网页图形运行时连接失败]', { status, reason })
    runtimeReason.value = reason ?? '网页图形运行时连接失败。'
    runtimeStatus.value = 'failed'
    cleanupActiveRuntime(false)
    return
  }

  if (status === 'disposed') {
    runtimeStatus.value = 'disposed'
    cleanupActiveRuntime(true)
  }
}

/**
 * 已就绪时必须通过 dispose 等待远端确认；握手前或异常时连接器会同步强制释放，
 * 宿主仍统一在 disposed 回调中移除 iframe，避免双重销毁。
 */
function requestActiveRuntimeRelease(): void {
  if (!connector) return

  runtimeStatus.value = 'releasing'
  connector.requestDispose()
}

/**
 * 清理当前实例的 DOM、事件监听、计时器和尺寸观察器。若有待切换运行时，
 * 仅在旧实例确认释放或已强制回收后再启动，保证同一时刻最多一个 Unity 实例。
 */
function cleanupActiveRuntime(startNext: boolean): void {
  const currentConnector = connector
  connector = undefined
  iframeSource.value = null
  activeRuntime = undefined
  runtimeCapabilities.value = []
  resolvePendingCommandResults(false)
  disconnectResizeObserver()

  // failed 状态的连接器已经自行移除监听；其余状态调用幂等 forceDispose 兜底清理。
  currentConnector?.forceDispose()
  // 连接器正常确认与超时/失败兜底都会到达本清理点，因此等待者只在资源实际解除后结算。
  resolvePendingReleaseWaiters()

  if (startNext && pendingRuntime) {
    startPendingRuntime()
    return
  }

  if (!pendingRuntime) runtimeStatus.value = startNext ? 'disposed' : 'failed'
}

/** 在连接器尚未建立时直接标记失败，避免错误地访问不存在的远端窗口。 */
function failBeforeConnector(reason: string): void {
  console.error('[网页图形运行时初始化失败]', { reason })
  runtimeReason.value = reason
  runtimeStatus.value = 'failed'
  iframeSource.value = null
  activeRuntime = undefined
  pendingRuntime = undefined
  resolvePendingCommandResults(false)
  connector?.forceDispose()
  connector = undefined
  disconnectResizeObserver()
  resolvePendingReleaseWaiters()
}

/**
 * ResizeObserver 只观察当前投放容器，并将同一动画帧内多次尺寸变化合并为一次 resize 命令。
 * 这避免栅格重排时的命令风暴，也不在 iframe 外叠加固定高度或第二层滚动条。
 */
function observeViewport(viewport: HTMLElement): void {
  disconnectResizeObserver()
  resizeObserver = new ResizeObserver(() => scheduleResize())
  resizeObserver.observe(viewport)
}

/** 就绪前不发送 resize；就绪后使用容器真实内容尺寸，过滤零尺寸和重复无效工作。 */
function scheduleResize(): void {
  if (resizeAnimationFrame !== undefined) return

  resizeAnimationFrame = window.requestAnimationFrame(() => {
    resizeAnimationFrame = undefined
    const viewport = viewportElement.value
    if (!viewport || !connector?.supportsCommand('resize')) return

    const width = Math.round(viewport.clientWidth)
    const height = Math.round(viewport.clientHeight)
    if (width <= 0 || height <= 0) return

    connector.sendCommand('resize', { width, height, devicePixelRatio: window.devicePixelRatio })
  })
}

/** 取消尺寸相关资源，确保页面切换和组件卸载后不会继续向旧 iframe 发送命令。 */
function disconnectResizeObserver(): void {
  resizeObserver?.disconnect()
  resizeObserver = undefined

  if (resizeAnimationFrame !== undefined) {
    window.cancelAnimationFrame(resizeAnimationFrame)
    resizeAnimationFrame = undefined
  }
}

/** 运行时切换、失败或卸载时结算全部等待项，避免事务处理器永久等待已销毁的 iframe。 */
function resolvePendingCommandResults(success: boolean): void {
  // 连接器失效或释放时没有可信的物理场景实例，故只能结算失败，不能沿用先前的激活标识。
  pendingCommandResultByRequestId.forEach((resolve) => resolve({ success }))
  pendingCommandResultByRequestId.clear()
}

/**
 * 将所有释放等待者一次性结算并清空集合。
 * 此处不暴露连接器失败原因：外层协议只需知道当前页面已停止持有 Unity 资源，详细原因保留在受限运行时诊断中。
 */
function resolvePendingReleaseWaiters(): void {
  pendingReleaseResolvers.forEach((resolve) => resolve({ success: true }))
  pendingReleaseResolvers.clear()
}

/**
 * 从受审计登记项生成入口地址，只附加桥接必需的精确父来源、实例和构建一致性字段。
 * 子页面应逐项回传这些元数据，连接器会在 ready 阶段作精确比对。
 */
function buildRuntimeSource(runtime: WebglRuntimeRegistration, instanceId: string): string {
  const entryUrl = new URL(runtime.entryUrl)
  entryUrl.searchParams.set('parentOrigin', runtime.allowedParentOrigin)
  entryUrl.searchParams.set('instanceId', instanceId)
  entryUrl.searchParams.set('runtimeKey', runtime.runtimeKey)
  entryUrl.searchParams.set('buildId', runtime.buildId)
  entryUrl.searchParams.set('sceneMappingVersion', runtime.sceneMappingVersion)
  entryUrl.searchParams.set('resourceDigest', runtime.resourceDigest)
  return entryUrl.toString()
}

/** 生成本次 iframe 唯一实例标识；随机值失败时仍携带递增序号以避免路由切换冲突。 */
function createInstanceId(runtimeKey: string): string {
  instanceSequence += 1
  const randomId = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${runtimeKey}-${instanceSequence}-${randomId}`
}

/** 布局卸载时不依赖远端响应，直接回收当前单实例所有资源。 */
onBeforeUnmount(() => {
  pendingRuntime = undefined
  connector?.forceDispose()
  connector = undefined
  iframeSource.value = null
  disconnectResizeObserver()
  resolvePendingCommandResults(false)
  resolvePendingReleaseWaiters()
  selectedObjectListeners.clear()
  sceneLoadProgressListeners.clear()
})
</script>

<template>
  <!-- 将只读状态作为插槽参数提供给嵌入壳；子组件仍必须通过注入的受控门面操作运行时。 -->
  <slot :status="runtimeStatus" :reason="runtimeReason" />
  <!-- iframe 只由本布局宿主创建；Teleport 仅改变展示位置，不转移其所有权。 -->
  <Teleport v-if="iframeSource && viewportElement" :to="viewportElement">
    <iframe
      ref="iframeElement"
      class="visualization-runtime-frame"
      :src="iframeSource"
      title="网页图形运行时"
      allow="fullscreen"
      @load="handleIframeLoad"
    />
  </Teleport>
</template>

<style scoped>
.visualization-runtime-frame {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  min-block-size: 0;
  border: 0;
  background: #061323;
}
</style>

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
  type VisualizationRuntimeLifecycle,
} from '@/modules/visual/runtime/visualization-runtime-host'

const iframeElement = ref<HTMLIFrameElement | null>(null)
const iframeSource = ref<string | null>(null)
const viewportElement = ref<HTMLElement | null>(null)
const runtimeStatus = ref<VisualizationRuntimeLifecycle>('idle')
const runtimeReason = ref<string | null>(null)
const runtimeCapabilities = ref<readonly WebglCommandType[]>([])
const selectedObjectListeners = new Set<(selection: VisualizationObjectSelection) => void>()

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

/** 业务页面通过宿主转发白名单命令；连接器会再次验证运行时状态与协商能力。 */
function sendCommand(command: Exclude<WebglCommandType, 'init'>, payload: unknown): string | undefined {
  return connector?.sendCommand(command, payload)
}

/**
 * 订阅对象选中事件并返回撤销函数。监听器集合只保存在布局生命周期内，
 * 页面组件卸载后会撤销订阅，避免跨工艺页保留闭包。
 */
function subscribeObjectSelected(listener: (selection: VisualizationObjectSelection) => void): () => void {
  selectedObjectListeners.add(listener)
  return () => selectedObjectListeners.delete(listener)
}

provide(visualizationRuntimeHostKey, {
  status: readonly(runtimeStatus),
  reason: readonly(runtimeReason),
  capabilities: readonly(runtimeCapabilities),
  registerViewport,
  acquire,
  release,
  sendCommand,
  subscribeObjectSelected,
})

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
    onCommandFailure: (command, reason) => {
      // 非致命命令失败不销毁已就绪场景，只保留可见诊断，避免一次聚焦失败导致画面闪退。
      runtimeReason.value = `${command} 命令失败：${reason}`
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
  disconnectResizeObserver()

  // failed 状态的连接器已经自行移除监听；其余状态调用幂等 forceDispose 兜底清理。
  currentConnector?.forceDispose()

  if (startNext && pendingRuntime) {
    startPendingRuntime()
    return
  }

  if (!pendingRuntime) runtimeStatus.value = startNext ? 'disposed' : 'failed'
}

/** 在连接器尚未建立时直接标记失败，避免错误地访问不存在的远端窗口。 */
function failBeforeConnector(reason: string): void {
  runtimeReason.value = reason
  runtimeStatus.value = 'failed'
  iframeSource.value = null
  activeRuntime = undefined
  pendingRuntime = undefined
  connector?.forceDispose()
  connector = undefined
  disconnectResizeObserver()
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
  selectedObjectListeners.clear()
})
</script>

<template>
  <slot />
  <!-- iframe 只由本布局宿主创建；Teleport 仅改变展示位置，不转移其所有权。 -->
  <Teleport v-if="iframeSource && viewportElement" :to="viewportElement">
    <iframe
      ref="iframeElement"
      class="visualization-runtime-frame"
      :src="iframeSource"
      title="网页图形运行时"
      allow="fullscreen"
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

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ProcessConfigLoadResult } from '@/config/process/types'
import {
  visualizationRuntimeHostKey,
} from '@/modules/visual/runtime/visualization-runtime-host'
import AppStatePanel from '@/shared/components/AppStatePanel.vue'
import pipelineLegendUrl from '@/assets/pipeline-legend-horizontal.png'

const props = defineProps<{
  result: ProcessConfigLoadResult
  /**
   * 仅由外层已提交的第二层稳定上下文开启；图例本身不读取场景名或运行时对象，
   * 因而不会把第一层沙盘或第三层关键环节误判为业务厂区。
   */
  showPipelineLegend?: boolean
}>()

const emit = defineEmits<{
  /** 旧工艺面板转发的对象选择也必须保持三维节点字段语义，不能将其降格为二维节点。 */
  objectSelected: [sceneNodeId: string, messageId: string]
  /** 仅在 Unity 确认相机复位后通知壳层清理命名镜头按钮反馈。 */
  cameraReset: []
}>()

const runtimeHost = inject(visualizationRuntimeHostKey, null)
const sceneViewport = ref<HTMLElement | null>(null)
const isSceneFullscreen = ref(false)
const isCameraResetPending = ref(false)
let unregisterViewport: (() => void) | undefined
let unsubscribeObjectSelection: (() => void) | undefined
let leasedRuntimeKey: string | undefined

/** 当前页仅在加载器确认拥有完整登记运行时时才申请网页图形；否则始终保留安全降级视图。 */
const requestedRuntime = computed(() => {
  if (props.result.effectiveRuntimeMode !== 'webgl') return undefined
  return props.result.bundle?.runtime
})

/** 宿主失败时展示与静态预览一致的明确降级，而非保留可能失效的 iframe。 */
const isRuntimeFailed = computed(() => runtimeHost?.status.value === 'failed')

/**
 * 将配置校验或运行时失败压缩为中文降级说明，页面不显示运行时原始原因或错误码；
 * 详细信息由运行时宿主写入控制台，供联调排查。
 */
const fallbackReason = computed(() => {
  if (isRuntimeFailed.value) return '三维运行时暂时不可用，当前显示静态预览。'
  return props.result.issues[0]?.message ?? '网页图形运行时尚未就绪。'
})

/**
 * 页面只登记一个空场景容器并申请已审计的 runtimeKey；iframe 创建、消息监听与尺寸管理
 * 全部由 VisualLayout 中的唯一宿主完成，当前组件不会接触跨窗口对象。
 */
async function synchronizeRuntime(): Promise<void> {
  const runtime = requestedRuntime.value
  if (!runtime || !runtimeHost) {
    releaseRuntimeLease()
    return
  }

  await nextTick()
  if (!sceneViewport.value) return

  if (!unregisterViewport) unregisterViewport = runtimeHost.registerViewport(sceneViewport.value)
  if (!unsubscribeObjectSelection) {
    unsubscribeObjectSelection = runtimeHost.subscribeObjectSelected(({ payload, messageId }) => {
      // Unity 上行载荷只能提供 sceneNodeId（三维节点标识）；二维节点由统一协调器按清单解析。
      emit('objectSelected', payload.sceneNodeId, messageId)
    })
  }

  leasedRuntimeKey = runtime.runtimeKey
  runtimeHost.acquire(runtime)
}

/**
 * 只有持有当前 runtimeKey 的页面可以触发释放，避免旧路由卸载时销毁已经切换给新页面的实例。
 * 先注销容器与选中订阅，确保远端迟到事件不会再更新已卸载页面。
 */
function releaseRuntimeLease(): void {
  unsubscribeObjectSelection?.()
  unsubscribeObjectSelection = undefined
  unregisterViewport?.()
  unregisterViewport = undefined

  if (leasedRuntimeKey) runtimeHost?.release(leasedRuntimeKey)
  leasedRuntimeKey = undefined
}

/**
 * 全屏状态始终以浏览器实际的全屏元素为准，而不是以点击结果推测。
 * 这样用户按 Esc、浏览器拒绝请求或页面卸载时，右上角按钮都能立即恢复准确的可访问名称。
 */
function synchronizeFullscreenState(): void {
  isSceneFullscreen.value = document.fullscreenElement === sceneViewport.value
}

/** 相机复位按钮只读取协商后的运行时能力；旧 Unity 构建不会收到不支持的命令。 */
const cameraResetAvailable = computed(() => (
  runtimeHost?.status.value === 'ready' && runtimeHost.capabilities.value.includes('resetCamera')
))

/**
 * 向当前唯一 Unity 实例发送严格空载荷的复位命令。
 * Unity 会恢复初始镜头和总览视觉、保留设备状态，并在成功后通知拓扑取消选择。
 * 在途期间禁用按钮，避免用户连续点击产生没有额外效果的重复补间与待确认项。
 */
async function resetCamera(): Promise<void> {
  if (!runtimeHost || !cameraResetAvailable.value || isCameraResetPending.value) return

  isCameraResetPending.value = true
  const result = await runtimeHost.sendCommandAndWait('resetCamera', {})
  isCameraResetPending.value = false
  if (result.success) {
    emit('cameraReset')
    return
  }

  // 页面只输出固定诊断，不展示 Unity 返回的场景内部信息。
  console.warn('[相机复位]', '三维运行时未确认本次相机复位。')
}

/**
 * 仅放大三维视口及其插槽中的步骤导航、说明气泡，不包含外部导航与下方拓扑区域。
 * 内嵌框架与覆盖控件共享全屏元素，随实际视口尺寸拉伸；再次点击按钮或按 Esc 均可退出。
 */
async function toggleSceneFullscreen(): Promise<void> {
  const viewport = sceneViewport.value
  if (!viewport) return

  try {
    if (document.fullscreenElement === viewport) {
      await document.exitFullscreen()
      return
    }

    await viewport.requestFullscreen()
  } catch {
    // 浏览器可能因权限策略或当前窗口状态拒绝请求；保留原视口，不中断三维运行时。
    synchronizeFullscreenState()
  }
}

watch(requestedRuntime, () => {
  void synchronizeRuntime()
}, { immediate: true })

/** 监听 Esc 等浏览器原生退出动作，避免按钮图标与实际视口状态不同步。 */
onMounted(() => {
  document.addEventListener('fullscreenchange', synchronizeFullscreenState)
})

/** 组件销毁只交还自己的租约；真正 iframe 释放仍由布局宿主统一确认和回收。 */
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', synchronizeFullscreenState)
  releaseRuntimeLease()
})
</script>

<template>
  <!-- 仅为已声明网页图形能力的页面保留固定视口；空场景页继续按内容高度展示。 -->
  <section :class="['process-scene', { 'process-scene--reserved': result.bundle?.page.runtimeMode === 'webgl' }]" aria-label="场景区域">
    <template v-if="result.status === 'missing'">
      <AppStatePanel kind="config-missing" :reason="fallbackReason" :primary-action-visible="false" />
    </template>
    <template v-else-if="result.effectiveRuntimeMode === 'empty'">
      <AppStatePanel kind="scene-unavailable" reason="该页面尚未发布场景或静态预览资源，二维拓扑与导览仍可使用。" :primary-action-visible="false" />
    </template>
    <template v-else-if="result.effectiveRuntimeMode === 'static-preview' || isRuntimeFailed">
      <div class="process-scene__preview">
        <p class="eyebrow">静态预览</p>
        <h2>{{ result.bundle?.page.title }}</h2>
        <p>{{ result.bundle?.page.description }}</p>
        <p class="process-scene__notice">{{ fallbackReason }}</p>
      </div>
    </template>
    <template v-else>
      <div ref="sceneViewport" class="process-scene__runtime" aria-live="polite">
        <!--
          公共管线图例是无交互静态说明，直接放在原生全屏根元素内部；进入或退出全屏时保持同一节点，
          不监听全屏事件、不接管鼠标命中，也不触发 Unity（三维引擎）画布重排或资源重建。
        -->
        <img
          v-if="props.showPipelineLegend"
          class="process-scene__pipeline-legend"
          :src="pipelineLegendUrl"
          width="500"
          height="60"
          alt="管线图例：橙色代表天然气，蓝色代表水，红色代表蒸汽，青色代表电缆，绿色代表控制线"
          draggable="false"
        >
        <!-- 复位使用独立命令：恢复初始镜头和总览视觉、保留设备状态，并清除跨端选择。 -->
        <button
          type="button"
          class="process-scene__camera-reset"
          :disabled="!cameraResetAvailable || isCameraResetPending"
          :aria-busy="isCameraResetPending ? 'true' : 'false'"
          aria-label="恢复初始镜头"
          :title="cameraResetAvailable ? '恢复初始镜头' : '当前三维运行时不支持相机复位'"
          @click="void resetCamera()"
        >
          <span aria-hidden="true">↺</span>
        </button>
        <!-- 按钮位于 iframe 之上，只请求当前三维视口全屏，避免恢复 Unity 模板页脚。 -->
        <button
          type="button"
          class="process-scene__fullscreen"
          :aria-label="isSceneFullscreen ? '退出三维全屏' : '进入三维全屏'"
          :aria-pressed="isSceneFullscreen"
          :title="isSceneFullscreen ? '退出全屏' : '全屏查看三维场景'"
          @click="void toggleSceneFullscreen()"
        >
          <!-- 与二维拓扑共用图标语义：常规态放大，全屏态显示关闭入口。 -->
          <span aria-hidden="true">{{ isSceneFullscreen ? '×' : '⛶' }}</span>
        </button>
        <!--
          原生全屏只显示目标元素的后代；业务控件必须通过插槽留在真实视口内，不能放在面板外。
          覆盖层不参与网格尺寸计算，也不接管内嵌框架的挂载和生命周期；空白处保留三维鼠标操作。
        -->
        <div v-if="$slots.overlays" class="process-scene__overlays">
          <slot name="overlays" />
        </div>
        <!--
          iframe 创建后由 Unity 模板独占加载反馈，避免前端状态卡覆盖画布并重复提示“正在加载”。
          运行时失败会在上方 isRuntimeFailed 分支切换为明确的降级说明，因此此处无需额外空白占位。
        -->
      </div>
    </template>
  </section>
</template>

<style scoped>
.process-scene {
  min-block-size: 220px;
}

/*
 * 三维区域固定为标准 16:9 画幅：宽度始终由工作台主栏决定，高度由浏览器按比例计算。
 * 这让 iframe、加载态和静态降级态共享同一稳定尺寸，避免 Unity 画布就绪后发生布局抖动，
 * 同时移除旧的固定 320 像素高度，防止宽屏下场景被压扁。
 */
.process-scene--reserved {
  aspect-ratio: 16 / 9;
  block-size: auto;
  min-block-size: 0;
}

/* 容器由工作台网格约束尺寸；iframe 通过宿主 Teleport 填满此容器，不产生固定画布或双滚动条。 */
.process-scene__runtime {
  position: relative;
  isolation: isolate;
  display: grid;
  block-size: 100%;
  min-block-size: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-strong);
}

/*
 * 覆盖层精确填满实际画布，并作为双轴尺寸查询容器；子控件的 cqw/cqh 会随全屏自动重算。
 * 绝对定位不会挤压运行时网格。仅具体控件恢复鼠标响应，层内其余区域直接透传给三维画面。
 * 层级低于独立的全屏按钮，确保任何业务控件都不会遮挡退出全屏入口。
 */
.process-scene__overlays {
  position: absolute;
  z-index: 1;
  inset: 0;
  container-type: size;
  pointer-events: none;
}

/*
 * 图例以附件的 500×60 原始比例等比缩小到约 420 像素宽，并固定在实际三维视口顶部正中；
 * 窄容器继续按比例缩小，同时为右上角两个公共按钮保留安全空间。关闭全部指针与拖拽行为后，
 * 图例覆盖区域仍由下方 Unity iframe（内嵌框架）接收鼠标操作。
 */
.process-scene__pipeline-legend {
  position: absolute;
  z-index: 2;
  inset-block-start: var(--space-3);
  inset-inline-start: 50%;
  inline-size: min(420px, calc(100% - 112px));
  block-size: auto;
  max-block-size: 51px;
  object-fit: contain;
  object-position: center center;
  transform: translateX(-50%);
  pointer-events: none;
  user-select: none;
}

/*
 * 控件沿用二维拓扑图的青色描边、30 像素方形和悬停反馈，形成工作台一致的全屏入口。
 * 它建立在独立层叠上下文的最高层，确保 Teleport 挂载的 Unity iframe 加载完成后也不会遮挡它。
 */
.process-scene__camera-reset,
.process-scene__fullscreen {
  position: absolute;
  inset-block-start: var(--space-3);
  z-index: 2;
  display: inline-grid;
  inline-size: 30px;
  block-size: 30px;
  padding: 0;
  place-items: center;
  border: 1px solid rgba(103, 232, 249, 0.44);
  border-radius: 5px;
  background: rgba(8, 47, 73, 0.56);
  color: #bff7ff;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, opacity 150ms ease;
}

.process-scene__camera-reset {
  inset-inline-end: calc(var(--space-3) + 38px);
}

.process-scene__fullscreen {
  inset-inline-end: var(--space-3);
}

.process-scene__camera-reset:hover:not(:disabled),
.process-scene__camera-reset:focus-visible:not(:disabled),
.process-scene__fullscreen:hover,
.process-scene__fullscreen:focus-visible {
  border-color: #67e8f9;
  background: rgba(8, 145, 178, 0.42);
  color: #ffffff;
}

.process-scene__camera-reset:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

/* 浏览器进入原生全屏后去除卡片边框，确保三维画布完整覆盖整个屏幕。 */
.process-scene__runtime:fullscreen {
  border: 0;
  border-radius: 0;
  background: #000;
}

.process-scene__preview {
  display: grid;
  block-size: 100%;
  min-block-size: 0;
  align-content: center;
  gap: var(--space-3);
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background:
    radial-gradient(circle at 12% 15%, color-mix(in srgb, var(--color-primary), transparent 68%), transparent 38%),
    linear-gradient(135deg, var(--color-surface-strong), var(--color-primary));
  color: var(--color-text-inverse);
}

.process-scene__preview .eyebrow {
  color: #b9d4ff;
}

.process-scene__preview h2,
.process-scene__preview p {
  margin: 0;
}

.process-scene__preview > p:not(.eyebrow) {
  max-inline-size: 700px;
  line-height: 1.65;
}

.process-scene__notice {
  color: #d9e8ff;
  font-size: 0.875rem;
}

</style>

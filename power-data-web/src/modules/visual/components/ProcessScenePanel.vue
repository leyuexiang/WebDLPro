<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ProcessConfigLoadResult } from '@/config/process/types'
import {
  visualizationRuntimeHostKey,
  type VisualizationRuntimeLifecycle,
} from '@/modules/visual/runtime/visualization-runtime-host'
import { useProcessContextStore } from '@/stores/process-context.store'
import AppStatePanel from '@/shared/components/AppStatePanel.vue'

const props = defineProps<{
  result: ProcessConfigLoadResult
}>()

const emit = defineEmits<{
  objectSelected: [nodeId: string, messageId: string]
}>()

const processContext = useProcessContextStore()
const runtimeHost = inject(visualizationRuntimeHostKey, null)
const sceneViewport = ref<HTMLElement | null>(null)
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

/** 将配置校验或运行时失败压缩为可读首因，完整问题仍由加载器与受控日志保留。 */
const fallbackReason = computed(() => {
  if (isRuntimeFailed.value && runtimeHost?.reason.value) return runtimeHost.reason.value
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
      emit('objectSelected', payload.nodeId, messageId)
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

/** 将受控宿主状态写入可序列化工艺上下文，业务协调器只能在 ready 状态发出三维命令。 */
function synchronizeSceneState(status: VisualizationRuntimeLifecycle, capabilities: readonly import('@/services/webgl/protocol').WebglCommandType[]): void {
  const statusMapping: Record<VisualizationRuntimeLifecycle, import('@/stores/process-context.store').ProcessSceneStatus> = {
    idle: 'idle',
    creating: 'creating',
    handshaking: 'handshaking',
    ready: 'ready',
    switching: 'switching',
    releasing: 'releasing',
    disposed: 'released',
    failed: 'failed',
  }

  processContext.setSceneState(statusMapping[status], capabilities)
}

watch(requestedRuntime, () => {
  void synchronizeRuntime()
}, { immediate: true })

watch(
  () => [runtimeHost?.status.value, runtimeHost?.capabilities.value] as const,
  ([status, capabilities]) => {
    if (!requestedRuntime.value || !runtimeHost || !status || !capabilities) return
    synchronizeSceneState(status, capabilities)
  },
  { immediate: true },
)

/** 组件销毁只交还自己的租约；真正 iframe 释放仍由布局宿主统一确认和回收。 */
onBeforeUnmount(releaseRuntimeLease)
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
        <AppStatePanel
          v-if="runtimeHost?.status.value !== 'ready'"
          kind="scene-connecting"
          :reason="runtimeHost?.reason.value ?? '正在校验网页图形运行时与场景资源。'"
          :primary-action-visible="false"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.process-scene {
  min-block-size: 220px;
}

/*
 * 三维场景与静态降级共用同一高度预算，避免运行时握手成功后将二维拓扑整体下推。
 * 桌面固定为 320 像素、窄屏固定为 300 像素，容器本身不依赖 iframe 的最终加载尺寸。
 */
.process-scene--reserved {
  block-size: 320px;
  min-block-size: 320px;
}

/* 容器由工作台网格约束尺寸；iframe 通过宿主 Teleport 填满此容器，不产生固定画布或双滚动条。 */
.process-scene__runtime {
  position: relative;
  display: grid;
  block-size: 100%;
  min-block-size: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-strong);
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

@media (width < 820px) {
  /* 单栏布局保持可预测的场景高度，避免移动端过度占用首屏。 */
  .process-scene--reserved {
    block-size: 300px;
    min-block-size: 300px;
  }
}
</style>

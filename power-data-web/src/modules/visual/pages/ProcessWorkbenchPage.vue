<script setup lang="ts">
import { computed, inject, onBeforeUnmount, toRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ProcessNodeId, ProcessStepId } from '@/config/process/identifiers'
import { localProcessConfigDataset, localProcessConfigLoader } from '@/config/process/local-process-config'
import type { ProcessConfigLoadResult } from '@/config/process/types'
import ProcessDetailPanel from '@/modules/visual/components/ProcessDetailPanel.vue'
import ProcessGuidePanel from '@/modules/visual/components/ProcessGuidePanel.vue'
import ProcessNavigationPanel from '@/modules/visual/components/ProcessNavigationPanel.vue'
import ProcessScenePanel from '@/modules/visual/components/ProcessScenePanel.vue'
import ProcessWorkbenchLayout from '@/modules/visual/components/ProcessWorkbenchLayout.vue'
import { visualizationRuntimeHostKey } from '@/modules/visual/runtime/visualization-runtime-host'
import TopologyPanel from '@/modules/visual/components/TopologyPanel.vue'
import { ProcessActionCoordinator } from '@/modules/visual/services/process-action-coordinator'
import { useProcessContextStore } from '@/stores/process-context.store'
import { createCorrelationId } from '@/shared/utils/correlation-id'

const route = useRoute()
const router = useRouter()
const processContext = useProcessContextStore()
const runtimeHost = inject(visualizationRuntimeHostKey, null)
const processPageId = computed(() => String(route.params.processPageId ?? ''))

/** 路由守卫会预先拦截未知页；页面层仍保留加载器结果以处理配置热更新或直接渲染。 */
const loadResult = computed<ProcessConfigLoadResult>(() => localProcessConfigLoader.load(processPageId.value))

/**
 * 协调器只读取 Pinia 字段的 Ref 视图并调用显式写入方法。
 * 真实场景连接器尚未登记，返回的三维命令不会直接操作 iframe 或 window。
 */
const coordinator = new ProcessActionCoordinator({
  sceneStatus: toRef(processContext, 'sceneStatus'),
  sceneCapabilities: toRef(processContext, 'sceneCapabilities'),
  selectStep: processContext.selectStep,
  selectNode: processContext.selectNode,
  recordCommand: processContext.recordCommand,
})

/** 进入或切换工艺页时初始化可序列化上下文；配置缺失时主动释放旧页状态。 */
watch(
  loadResult,
  (result) => {
    coordinator.dispose()

    if (result.bundle) {
      processContext.activatePage(result.bundle, result.effectiveRuntimeMode)
      return
    }

    processContext.release()
  },
  { immediate: true },
)

/** 导览点击交由统一协调器处理，避免右侧面板直接控制二维或三维视图。 */
function handleStepSelection(stepId: ProcessStepId): void {
  const bundle = loadResult.value.bundle

  if (!bundle || !stepId) return
  const result = coordinator.coordinate(bundle, { type: 'select-step', stepId, source: 'guide', correlationId: createCorrelationId('guide') })
  dispatchSceneCommand(result.sceneCommand?.type, result.sceneCommand?.payload, 'guide')
}

/** 拓扑点击只产生稳定节点 ID；协调器决定是否需要联动步骤和受控场景命令。 */
function handleTopologySelection(nodeId: ProcessNodeId): void {
  const bundle = loadResult.value.bundle

  if (!bundle) return
  const result = coordinator.coordinate(bundle, { type: 'select-node', nodeId, source: 'topology', correlationId: createCorrelationId('topology') })
  dispatchSceneCommand(result.sceneCommand?.type, result.sceneCommand?.payload, 'topology')
}

/**
 * 二维操作只将协调器已经核准的命令交给受控宿主。协调器与宿主会分别校验场景就绪状态和协商能力，
 * 页面本身不持有 iframe、Window 或 postMessage，因此无法绕过网页图形安全边界。
 */
function dispatchSceneCommand(
  type: 'enterProcessStep' | 'focusNode' | undefined,
  payload: Record<string, string> | undefined,
  source: 'guide' | 'topology',
): void {
  if (!type || !payload) return

  const messageId = runtimeHost?.sendCommand(type, payload)
  if (!messageId) return

  processContext.recordCommand({ type, source, correlationId: messageId, issuedAt: new Date().toISOString() })
}

/**
 * 网页图形回传只驱动二维状态，不会再次下发场景命令。
 * messageId 作为关联标识进入幂等缓存，可阻断子页面重复上报造成的回写循环。
 */
function handleSceneObjectSelection(nodeId: string, messageId: string): void {
  const bundle = loadResult.value.bundle
  if (!bundle) return

  coordinator.coordinate(bundle, {
    type: 'select-node',
    nodeId: nodeId as ProcessNodeId,
    source: 'webgl',
    correlationId: messageId,
  })
}

/** 返回总览始终走命名路由，避免将相对地址与工艺页面参数耦合。 */
function returnToDashboard(): void {
  void router.push({ name: 'visual-dashboard' })
}

/** 工作台销毁时释放有界协调缓存与页面上下文，防止下个路由读取旧页面快照。 */
onBeforeUnmount(() => {
  coordinator.dispose()
  processContext.release()
})
</script>

<template>
  <section class="process-workbench page-content">
    <header class="process-workbench__header">
      <div>
        <p class="eyebrow">工艺工作台</p>
        <h1 class="page-title">{{ loadResult.bundle?.page.title ?? '工艺页面待配置' }}</h1>
        <p class="page-description">{{ loadResult.bundle?.page.description ?? `页面标识：${processPageId || '缺失'}` }}</p>
      </div>
      <button type="button" class="button button--secondary" @click="returnToDashboard">返回总览</button>
    </header>

    <ProcessWorkbenchLayout v-if="loadResult.bundle" class="process-workbench__layout">
      <template #navigation>
        <ProcessNavigationPanel
          :domains="localProcessConfigDataset.domains"
          :pages="localProcessConfigDataset.pages"
          :current-page-id="processPageId"
        />
      </template>
      <template #main>
        <ProcessScenePanel :result="loadResult" @object-selected="handleSceneObjectSelection" />
        <TopologyPanel
          :topology="loadResult.bundle.topology"
          :selected-node-ids="processContext.selectedTopologyNodeIds"
          :selected-route-ids="processContext.selectedTopologyRouteIds"
          @select-node="handleTopologySelection"
        />
      </template>
      <template #detail>
        <ProcessGuidePanel :guide="loadResult.bundle.guide" :current-step-id="processContext.currentStepId" @select-step="handleStepSelection" />
        <ProcessDetailPanel
          :topology="loadResult.bundle.topology"
          :details="loadResult.bundle.details"
          :selected-node-id="processContext.selectedNodeId"
          :metric-snapshots="processContext.metricSnapshots"
        />
      </template>
    </ProcessWorkbenchLayout>
    <ProcessScenePanel v-else :result="loadResult" @object-selected="handleSceneObjectSelection" />
  </section>
</template>

<style scoped>
.process-workbench {
  display: grid;
  min-block-size: calc(100dvh - 56px);
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--space-4);
}

.process-workbench__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-4);
}

.process-workbench__layout {
  min-block-size: 0;
}

@media (width < 820px) {
  .process-workbench__header {
    align-items: start;
    flex-direction: column;
  }
}
</style>

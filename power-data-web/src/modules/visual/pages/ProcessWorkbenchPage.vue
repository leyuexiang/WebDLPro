<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppStatePanel from '@/shared/components/AppStatePanel.vue'

/**
 * 34 个工艺页面共用的唯一页面组件。
 * 任务 013、014 的配置中心尚未就绪前，它只展示可诊断的配置缺失状态，
 * 不会依据地址参数加载网页图形、图片或任意外部资源。
 */
const route = useRoute()
const router = useRouter()
const processPageId = computed(() => String(route.params.processPageId ?? ''))
const correlationId = computed(() => `process-page:${processPageId.value || 'missing'}`)

/** 返回可视化总览，用户可继续浏览不依赖页面配置的入口。 */
function returnToDashboard(): void {
  void router.push({ name: 'visual-dashboard' })
}
</script>

<template>
  <section class="process-workbench page-content">
    <header class="process-workbench__header">
      <div>
        <p class="eyebrow">工艺工作台</p>
        <h1 class="page-title">工艺页面待配置</h1>
        <p class="page-description">页面标识：{{ processPageId || '缺失' }}</p>
      </div>
      <RouterLink class="button button--secondary" :to="{ name: 'visual-dashboard' }">返回总览</RouterLink>
    </header>

    <div class="process-workbench__grid">
      <aside class="process-workbench__panel">
        <h2>工艺导航</h2>
        <p>等待页面定义提供工艺域、排序、权限和父子关系。</p>
      </aside>
      <div class="process-workbench__center">
        <AppStatePanel
          kind="config-missing"
          reason="当前路由尚未匹配已发布的工艺页面定义，已阻止任何网页图形与资源加载。"
          :correlation-id="correlationId"
          @back="returnToDashboard"
        />
        <section class="process-workbench__placeholder">
          <h2>二维拓扑区域</h2>
          <p>将在同版本页面定义、拓扑定义和导览定义发布后由拓扑适配器渲染。</p>
        </section>
      </div>
      <aside class="process-workbench__panel">
        <h2>工艺导览与详情</h2>
        <p>等待流程步骤、设备详情和数据绑定配置，当前不展示虚构内容。</p>
      </aside>
    </div>
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

.process-workbench__grid {
  display: grid;
  min-block-size: 0;
  grid-template-columns: 236px minmax(0, 1fr) 360px;
  gap: var(--space-4);
}

.process-workbench__panel,
.process-workbench__placeholder {
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.process-workbench__panel h2,
.process-workbench__placeholder h2,
.process-workbench__panel p,
.process-workbench__placeholder p {
  margin: 0;
}

.process-workbench__panel p,
.process-workbench__placeholder p {
  margin-block-start: var(--space-2);
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.process-workbench__center {
  display: grid;
  min-inline-size: 0;
  grid-template-rows: minmax(220px, 16fr) minmax(320px, 9fr);
  gap: var(--space-4);
}

.process-workbench__placeholder {
  display: grid;
  place-content: center;
  min-block-size: 320px;
  border-style: dashed;
  text-align: center;
}

@media (width < 1440px) {
  .process-workbench__grid {
    grid-template-columns: 208px minmax(0, 1fr) 320px;
  }
}

@media (width < 1280px) {
  .process-workbench__grid {
    grid-template-columns: 208px minmax(0, 1fr);
  }

  .process-workbench__grid > :last-child {
    display: none;
  }
}

@media (width < 1024px) {
  .process-workbench__grid {
    grid-template-columns: 1fr;
  }

  .process-workbench__grid > :first-child {
    display: none;
  }

  .process-workbench__header {
    align-items: start;
    flex-direction: column;
  }
}
</style>

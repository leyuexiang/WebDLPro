<script setup lang="ts">
import { computed } from 'vue'
import { localProcessConfigDataset, localProcessConfigLoader } from '@/config/process/local-process-config'
import { localTopicDefinitions } from '@/config/process/topic-config'

/**
 * 可视化总览是配置中心的稳定入口。
 * 卡片数量和首个工艺页均读取已发布配置，不读取或伪造实时监控数据。
 */
const firstProcessPage = localProcessConfigLoader.getPage('gas-overview')
const processPageCount = computed(() => localProcessConfigDataset.pages.length)
const topicCount = computed(() => localTopicDefinitions.length)

/** 卡片路由使用命名路由与稳定配置标识，避免嵌入字符串地址拼接。 */
const scopeCards = computed(() => [
  {
    title: '工艺工作台',
    detail: `${processPageCount.value} 个工艺页面共用配置驱动工作台。`,
    to: firstProcessPage ? { name: 'visual-process', params: { processPageId: firstProcessPage.processPageId } } : { name: 'visual-dashboard' },
  },
  { title: '专题场景', detail: `${topicCount.value} 个专题入口由独立配置定义与发布。`, to: { name: 'visual-topic' } },
  {
    title: '网页图形运行时',
    detail: '同一时刻只允许一个已登记的网页图形实例，缺少登记时安全降级。',
    to: firstProcessPage ? { name: 'visual-process', params: { processPageId: firstProcessPage.processPageId } } : { name: 'visual-dashboard' },
  },
])
</script>

<template>
  <section class="visual-dashboard page-content">
    <p class="eyebrow">可视化入口</p>
    <h1 class="page-title">总览大屏</h1>
    <p class="page-description">实时指标与告警等级待外部契约确认；当前提供可验证的配置路由、工作台和安全降级状态。</p>
    <div class="visual-dashboard__grid">
      <RouterLink v-for="card in scopeCards" :key="card.title" class="visual-dashboard__card" :to="card.to">
        <h2>{{ card.title }}</h2>
        <p>{{ card.detail }}</p>
        <span>查看框架状态 →</span>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.visual-dashboard__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
  margin-block-start: var(--space-6);
}

.visual-dashboard__card {
  display: grid;
  min-block-size: 180px;
  gap: var(--space-3);
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: linear-gradient(145deg, var(--color-surface), var(--color-primary-soft));
}

.visual-dashboard__card:hover {
  border-color: var(--color-primary);
}

.visual-dashboard__card h2,
.visual-dashboard__card p {
  margin: 0;
}

.visual-dashboard__card p {
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.visual-dashboard__card span {
  align-self: end;
  color: var(--color-primary);
  font-weight: 700;
}

@media (width < 1024px) {
  .visual-dashboard__grid {
    grid-template-columns: 1fr;
  }
}
</style>

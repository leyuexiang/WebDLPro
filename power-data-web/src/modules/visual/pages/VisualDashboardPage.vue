<script setup lang="ts">
/**
 * 可视化总览是后续配置中心的稳定入口。
 * 当前只呈现架构范围与路由入口，不读取或伪造实时监控数据。
 */
const scopeCards = [
  { title: '工艺工作台', detail: '34 个工艺页面共用配置驱动页面组件。', to: '/visual/process/gas-overview' },
  { title: '专题场景', detail: '5 个专题入口由独立配置定义与发布。', to: '/visual/topic' },
  { title: '网页图形运行时', detail: '同一时刻只允许一个已激活网页图形实例。', to: '/visual/process/gas-overview' },
]
</script>

<template>
  <section class="visual-dashboard page-content">
    <p class="eyebrow">可视化入口</p>
    <h1 class="page-title">总览大屏</h1>
    <p class="page-description">实时指标与告警等级待外部契约确认；当前提供可验证的路由与布局骨架。</p>
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

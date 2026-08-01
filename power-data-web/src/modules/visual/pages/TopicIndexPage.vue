<script setup lang="ts">
/** 专题入口保留稳定路由形态，详情内容将在专题配置完成后异步装配。 */
const topics = ['监控与数据采集', '分布式控制系统', '可编程逻辑控制器', '故障诊断', '安全预警']
</script>

<template>
  <section class="topic-index page-content">
    <p class="eyebrow">专题场景</p>
    <h1 class="page-title">专题入口</h1>
    <p class="page-description">专题页面范围与配置尚待确认，当前路由已预留。</p>
    <ul class="topic-index__list">
      <li v-for="topic in topics" :key="topic">{{ topic }}：待配置发布</li>
    </ul>
  </section>
</template>

<style scoped>
.topic-index__list {
  display: grid;
  max-inline-size: 680px;
  gap: var(--space-3);
  margin: var(--space-6) 0 0;
  padding: 0;
  list-style: none;
}

.topic-index__list li {
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
</style>

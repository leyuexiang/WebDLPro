<script setup lang="ts">
import { computed } from 'vue'
import { localTopicDefinitions } from '@/config/process/topic-config'
import { usePermissionStore } from '@/stores/permission.store'

const permissionStore = usePermissionStore()

/** 专题导航仅展示当前账号可访问的配置项，不通过前端隐藏逻辑替代路由权限校验。 */
const visibleTopics = computed(() => localTopicDefinitions.filter((topic) => permissionStore.hasPermission('page', topic.permissionCode)))
</script>

<template>
  <section class="topic-index page-content">
    <p class="eyebrow">专题场景</p>
    <h1 class="page-title">专题入口</h1>
    <p class="page-description">专题标题、权限码和版本由配置中心统一维护；专题运行时资源将在各自契约发布后接入。</p>
    <ul class="topic-index__list">
      <li v-for="topic in visibleTopics" :key="topic.topicId">
        <RouterLink :to="{ name: 'visual-topic-detail', params: { topicId: topic.topicId } }">
          <strong>{{ topic.title }}</strong>
          <span>{{ topic.description }}</span>
        </RouterLink>
      </li>
    </ul>
    <p v-if="visibleTopics.length === 0" class="topic-index__empty">当前账号没有可访问的专题配置。</p>
  </section>
</template>

<style scoped>
.topic-index__list {
  display: grid;
  max-inline-size: 760px;
  gap: var(--space-3);
  margin: var(--space-6) 0 0;
  padding: 0;
  list-style: none;
}

.topic-index__list a {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.topic-index__list a:hover {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.topic-index__list span,
.topic-index__empty {
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}

.topic-index__empty {
  margin: var(--space-6) 0 0;
}
</style>

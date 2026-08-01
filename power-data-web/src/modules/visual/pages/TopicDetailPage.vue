<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getLocalTopicDefinition } from '@/config/process/topic-config'
import AppStatePanel from '@/shared/components/AppStatePanel.vue'

const route = useRoute()
const router = useRouter()
const topicId = computed(() => String(route.params.topicId ?? ''))

/** 路由守卫已做存在性与权限校验；组件仍保留空态以应对配置热更新。 */
const topic = computed(() => getLocalTopicDefinition(topicId.value))

/** 回到专题入口，避免配置热更新后停留在不可操作详情页。 */
function returnToTopics(): void {
  void router.push({ name: 'visual-topic' })
}
</script>

<template>
  <section v-if="topic" class="topic-detail page-content">
    <p class="eyebrow">专题场景</p>
    <h1 class="page-title">{{ topic.title }}</h1>
    <p class="page-description">{{ topic.description }}</p>
    <AppStatePanel
      kind="scene-unavailable"
      reason="该专题入口已完成配置与权限接入，具体页面、数据和场景资源仍待对应外部契约发布。"
      :correlation-id="`topic:${topic.topicId}`"
      :primary-action-visible="false"
    />
  </section>
  <section v-else class="page-content">
    <AppStatePanel
      kind="config-missing"
      :reason="`专题标识“${topicId || '缺失'}”尚未匹配发布配置。`"
      :correlation-id="`topic:${topicId || 'missing'}`"
      @back="returnToTopics"
    />
  </section>
</template>

<style scoped>
.topic-detail :deep(.app-state-panel) {
  max-inline-size: 760px;
  margin-block-start: var(--space-6);
}
</style>

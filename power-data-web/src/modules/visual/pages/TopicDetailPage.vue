<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppStatePanel from '@/shared/components/AppStatePanel.vue'

/** 统一承接所有专题详情标识，未发布配置时禁止猜测或加载资源。 */
const route = useRoute()
const router = useRouter()
const topicId = computed(() => String(route.params.topicId ?? ''))

/** 回到专题入口，避免未配置详情页留在不可操作状态。 */
function returnToTopics(): void {
  void router.push({ name: 'visual-topic' })
}
</script>

<template>
  <section class="page-content">
    <AppStatePanel
      kind="config-missing"
      :reason="`专题标识“${topicId || '缺失'}”尚未匹配发布配置。`"
      :correlation-id="`topic:${topicId || 'missing'}`"
      @back="returnToTopics"
    />
  </section>
</template>

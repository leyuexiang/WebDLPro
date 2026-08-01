<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppStatePanel from '@/shared/components/AppStatePanel.vue'

/** 未知路由统一进入结构化错误页，避免显示空白内容或错误重定向。 */
const router = useRouter()

/** 返回门户，提供可预测的恢复入口。 */
function returnToPortal(): void {
  void router.push({ name: 'portal-home' })
}
</script>

<template>
  <main class="state-page">
    <AppStatePanel
      kind="config-missing"
      reason="访问的入口不存在或尚未发布。"
      correlation-id="route:not-found"
      @back="returnToPortal"
    />
  </main>
</template>

<style scoped>
.state-page {
  display: grid;
  min-block-size: 100dvh;
  place-items: center;
  padding: var(--space-6);
}

.state-page :deep(.app-state-panel) {
  inline-size: min(100%, 560px);
}
</style>

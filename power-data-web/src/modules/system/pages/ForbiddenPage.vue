<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppStatePanel from '@/shared/components/AppStatePanel.vue'

/** 无权限页只显示守卫传入的权限码，避免泄露受保护页面的业务内容。 */
const route = useRoute()
const router = useRouter()
const requiredPermission = computed(() => String(route.query.permission ?? 'unknown'))

/** 返回门户是无权限状态下的安全默认恢复路径。 */
function returnToPortal(): void {
  void router.push({ name: 'portal-home' })
}
</script>

<template>
  <main class="state-page">
    <AppStatePanel
      kind="forbidden"
      :reason="`缺少页面访问权限：${requiredPermission}`"
      :correlation-id="`permission:${requiredPermission}`"
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

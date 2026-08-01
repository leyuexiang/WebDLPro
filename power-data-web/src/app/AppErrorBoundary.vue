<script setup lang="ts">
import { onErrorCaptured, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

/**
 * 捕获子树同步渲染错误并渲染结构化兜底界面。
 * 路由发生变化时自动重置错误状态，使用户可以通过导航离开故障页面。
 */
const route = useRoute()
const errorMessage = ref('')

onErrorCaptured((error) => {
  errorMessage.value = error instanceof Error ? error.message : '发生了无法识别的页面异常。'
  return false
})

watch(
  () => route.fullPath,
  () => {
    errorMessage.value = ''
  },
)

/** 清空当前错误状态，让同一路由可由用户手动重新尝试渲染。 */
function retry(): void {
  errorMessage.value = ''
}
</script>

<template>
  <main v-if="errorMessage" class="app-error-boundary" aria-live="assertive">
    <section class="app-error-boundary__card">
      <p class="eyebrow">页面异常</p>
      <h1>页面暂时无法显示</h1>
      <p>{{ errorMessage }}</p>
      <div class="app-error-boundary__actions">
        <button type="button" class="button button--primary" @click="retry">重新尝试</button>
        <RouterLink class="button button--secondary" to="/portal">返回门户</RouterLink>
      </div>
    </section>
  </main>
  <slot v-else />
</template>

<style scoped>
.app-error-boundary {
  display: grid;
  min-block-size: 100dvh;
  place-items: center;
  padding: var(--space-6);
  background: var(--color-canvas);
}

.app-error-boundary__card {
  inline-size: min(100%, 560px);
  padding: var(--space-8);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}

.app-error-boundary__card h1 {
  margin: var(--space-2) 0;
}

.app-error-boundary__card p:not(.eyebrow) {
  color: var(--color-text-secondary);
}

.app-error-boundary__actions {
  display: flex;
  gap: var(--space-3);
  margin-block-start: var(--space-6);
}
</style>

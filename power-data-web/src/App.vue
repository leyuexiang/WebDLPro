<script setup lang="ts">
import AppErrorBoundary from '@/app/AppErrorBoundary.vue'
</script>

<template>
  <!-- 全局错误边界把未知渲染异常收敛为可恢复页面，避免向用户呈现白屏。 -->
  <AppErrorBoundary>
    <RouterView />
  </AppErrorBoundary>
</template>

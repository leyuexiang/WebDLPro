<script setup lang="ts">
import ShellHeader from '@/layouts/ShellHeader.vue'
</script>

<template>
  <!-- 门户布局保持内容区宽度约束，供入口卡片和全局公告等信息密度较低的页面使用。 -->
  <div class="portal-layout">
    <ShellHeader />
    <main class="portal-layout__content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.portal-layout {
  min-block-size: 100dvh;
}

.portal-layout__content {
  inline-size: min(100%, 1440px);
  margin-inline: auto;
}
</style>

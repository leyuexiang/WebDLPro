<script setup lang="ts">
import { computed } from 'vue'
import { primaryNavigation } from '@/config/navigation'
import { usePermissionStore } from '@/stores/permission.store'

/** 门户只从导航配置生成模块入口，权限变化时自动隐藏无权模块。 */
const permissionStore = usePermissionStore()
const visibleModules = computed(() =>
  primaryNavigation.filter((item) => permissionStore.hasPermission('page', item.permissionCode)),
)
</script>

<template>
  <section class="portal-home page-content">
    <p class="eyebrow">统一应用入口</p>
    <h1 class="page-title">电力全流程数据采集与分析系统</h1>
    <p class="page-description">门户、采集、数据、可视化与系统管理由同一应用壳统一装配。</p>

    <div class="portal-home__grid">
      <RouterLink v-for="item in visibleModules" :key="item.key" class="portal-home__card" :to="item.to">
        <span class="portal-home__index">{{ item.key }}</span>
        <h2>{{ item.label }}</h2>
        <p>{{ item.description }}</p>
        <span>进入模块 →</span>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.portal-home {
  padding-block: var(--space-10);
}

.portal-home__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: var(--space-4);
  margin-block-start: var(--space-8);
}

.portal-home__card {
  display: grid;
  min-block-size: 220px;
  align-content: start;
  gap: var(--space-3);
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  transition: border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
}

.portal-home__card:hover {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}

.portal-home__card h2,
.portal-home__card p {
  margin: 0;
}

.portal-home__card p {
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.portal-home__card > span:last-child {
  margin-block-start: auto;
  color: var(--color-primary);
  font-weight: 700;
}

.portal-home__index {
  color: var(--color-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
  text-transform: uppercase;
}
</style>

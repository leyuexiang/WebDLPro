<script setup lang="ts">
import { computed } from 'vue'
import { primaryNavigation } from '@/config/navigation'
import { usePermissionStore } from '@/stores/permission.store'

/**
 * 根据页面访问权限过滤一级导航。
 * 导航只判断“是否显示入口”，数据与场景操作仍由对应领域组件在动作点单独判断。
 */
const permissionStore = usePermissionStore()
const visibleNavigation = computed(() =>
  primaryNavigation.filter((item) => permissionStore.hasPermission('page', item.permissionCode)),
)
</script>

<template>
  <nav class="primary-navigation" aria-label="一级导航">
    <RouterLink
      v-for="item in visibleNavigation"
      :key="item.key"
      class="primary-navigation__item"
      :to="item.to"
    >
      <span class="primary-navigation__label">{{ item.label }}</span>
      <span class="primary-navigation__description">{{ item.description }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.primary-navigation {
  display: grid;
  gap: var(--space-2);
}

.primary-navigation__item {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  transition: background-color 150ms ease, color 150ms ease;
}

.primary-navigation__item:hover,
.primary-navigation__item.router-link-active {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.primary-navigation__label {
  font-weight: 700;
}

.primary-navigation__description {
  font-size: 0.75rem;
  line-height: 1.45;
}
</style>

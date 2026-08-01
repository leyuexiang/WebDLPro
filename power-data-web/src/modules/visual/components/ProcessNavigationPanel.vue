<script setup lang="ts">
import { computed } from 'vue'
import type { ProcessDomainDefinition, ProcessPageDefinition } from '@/config/process/types'
import { usePermissionStore } from '@/stores/permission.store'

const props = defineProps<{
  domains: readonly ProcessDomainDefinition[]
  pages: readonly ProcessPageDefinition[]
  currentPageId: string
}>()

const permissionStore = usePermissionStore()

/** 预建页面索引，导航渲染时按 ID 常数时间取页，避免域内重复扫描完整页面数组。 */
const pagesById = computed(() => new Map(props.pages.map((page) => [page.processPageId, page])))

/** 仅返回用户具备页面权限的工艺域；无可见页的域不会暴露为空菜单。 */
const visibleDomains = computed(() =>
  props.domains
    .map((domain) => ({
      ...domain,
      pages: domain.pageIds
        .map((pageId) => pagesById.value.get(pageId))
        .filter((page): page is ProcessPageDefinition => page !== undefined && permissionStore.hasPermission('page', page.permissionCode)),
    }))
    .filter((domain) => domain.pages.length > 0),
)
</script>

<template>
  <nav class="process-navigation" aria-label="工艺页面导航">
    <p class="eyebrow">工艺导航</p>
    <div class="process-navigation__groups">
      <section v-for="domain in visibleDomains" :key="domain.domainId" class="process-navigation__group">
        <h2>{{ domain.title }}</h2>
        <RouterLink
          v-for="page in domain.pages"
          :key="page.processPageId"
          class="process-navigation__link"
          :class="{ 'process-navigation__link--active': page.processPageId === currentPageId }"
          :to="{ name: 'visual-process', params: { processPageId: page.processPageId } }"
        >
          {{ page.title }}
        </RouterLink>
      </section>
    </div>
  </nav>
</template>

<style scoped>
.process-navigation {
  display: grid;
  min-block-size: 0;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.process-navigation__groups {
  display: grid;
  min-block-size: 0;
  gap: var(--space-4);
  overflow: auto;
}

.process-navigation__group {
  display: grid;
  gap: var(--space-1);
}

.process-navigation__group h2 {
  margin: 0 0 var(--space-1);
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}

.process-navigation__link {
  padding: 6px var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}

.process-navigation__link:hover,
.process-navigation__link--active {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 700;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'

/** 六类可诊断状态与任务 010 一一对应，调用方不能用空容器代替状态反馈。 */
export type AppStateKind =
  | 'loading'
  | 'scene-connecting'
  | 'scene-unavailable'
  | 'data-delayed'
  | 'forbidden'
  | 'config-missing'

const props = withDefaults(
  defineProps<{
    kind: AppStateKind
    reason?: string
    correlationId?: string
    primaryActionVisible?: boolean
  }>(),
  {
    reason: '',
    correlationId: '',
    primaryActionVisible: true,
  },
)

const emit = defineEmits<{
  retry: []
  refresh: []
  back: []
}>()

/** 每种状态都预置用户可理解的标题和恢复动作，调用方仅补充实际诊断原因。 */
const stateDefinition = computed(() => {
  const definitions: Record<AppStateKind, { title: string; description: string; action: string; event: 'retry' | 'refresh' | 'back' }> = {
    loading: {
      title: '正在加载',
      description: '正在准备页面所需资源，请稍候。',
      action: '重新加载',
      event: 'retry',
    },
    'scene-connecting': {
      title: '正在连接三维场景',
      description: '正在等待网页图形运行时完成安全握手。',
      action: '重新连接',
      event: 'retry',
    },
    'scene-unavailable': {
      title: '三维场景不可用',
      description: '当前页面将继续提供二维拓扑、工艺导览和设备详情。',
      action: '重试场景',
      event: 'retry',
    },
    'data-delayed': {
      title: '数据更新延迟',
      description: '页面保留最近可用快照，请检查实时连接或稍后刷新。',
      action: '刷新数据',
      event: 'refresh',
    },
    forbidden: {
      title: '无访问权限',
      description: '当前账号不具备访问该资源所需的页面或数据权限。',
      action: '返回门户',
      event: 'back',
    },
    'config-missing': {
      title: '页面配置尚未发布',
      description: '页面定义、拓扑、导览与场景映射必须以同一版本发布后才可加载。',
      action: '返回可视化总览',
      event: 'back',
    },
  }

  return definitions[props.kind]
})

/** 根据声明的动作类型向父组件发出事件，状态组件不自行修改路由或发起请求。 */
function triggerPrimaryAction(): void {
  const event = stateDefinition.value.event

  // 使用显式分支保留事件与载荷的类型约束，避免联合类型绕过组件事件声明。
  if (event === 'retry') {
    emit('retry')
    return
  }

  if (event === 'refresh') {
    emit('refresh')
    return
  }

  emit('back')
}
</script>

<template>
  <section class="app-state-panel" :class="`app-state-panel--${kind}`" aria-live="polite">
    <p class="eyebrow">状态提示</p>
    <h2>{{ stateDefinition.title }}</h2>
    <p>{{ reason || stateDefinition.description }}</p>
    <p v-if="correlationId" class="app-state-panel__correlation">关联标识：{{ correlationId }}</p>
    <button v-if="primaryActionVisible" type="button" class="button button--secondary" @click="triggerPrimaryAction">
      {{ stateDefinition.action }}
    </button>
  </section>
</template>

<style scoped>
.app-state-panel {
  display: grid;
  justify-items: start;
  gap: var(--space-2);
  padding: var(--space-6);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.app-state-panel h2,
.app-state-panel p {
  margin: 0;
}

.app-state-panel > p:not(.eyebrow):not(.app-state-panel__correlation) {
  color: var(--color-text-secondary);
}

.app-state-panel__correlation {
  color: var(--color-text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
}

.app-state-panel--forbidden {
  border-color: color-mix(in srgb, var(--color-danger), var(--color-border) 50%);
}
</style>

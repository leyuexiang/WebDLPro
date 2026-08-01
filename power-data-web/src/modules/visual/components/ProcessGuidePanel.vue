<script setup lang="ts">
import type { ProcessStepId } from '@/config/process/identifiers'
import type { ProcessGuideDefinition } from '@/config/process/types'

const props = defineProps<{
  guide: ProcessGuideDefinition
  currentStepId: ProcessStepId | null
}>()

const emit = defineEmits<{
  selectStep: [stepId: ProcessStepId]
}>()
</script>

<template>
  <section class="process-guide" aria-label="工艺导览">
    <p class="eyebrow">工艺导览</p>
    <h2>流程步骤</h2>
    <ol v-if="props.guide.steps.length > 0" class="process-guide__steps">
      <li v-for="step in props.guide.steps" :key="step.stepId">
        <button
          type="button"
          class="process-guide__step"
          :class="{ 'process-guide__step--active': step.stepId === props.currentStepId }"
          @click="emit('selectStep', step.stepId)"
        >
          <span class="process-guide__order">{{ step.order }}</span>
          <span>
            <strong>{{ step.title }}</strong>
            <small>{{ step.description }}</small>
          </span>
        </button>
      </li>
    </ol>
    <p v-else class="process-guide__empty">该页面的流程步骤尚未发布。</p>
  </section>
</template>

<style scoped>
.process-guide {
  display: grid;
  gap: var(--space-2);
}

.process-guide h2,
.process-guide p {
  margin: 0;
}

.process-guide h2 {
  font-size: 1rem;
}

.process-guide__steps {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.process-guide__step {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: start;
  gap: var(--space-2);
  inline-size: 100%;
  padding: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  text-align: start;
}

.process-guide__step:hover,
.process-guide__step--active {
  border-color: var(--color-border);
  background: var(--color-primary-soft);
}

.process-guide__order {
  display: grid;
  place-items: center;
  inline-size: 24px;
  block-size: 24px;
  border-radius: 50%;
  background: var(--color-surface-muted);
  color: var(--color-primary);
  font-size: 0.75rem;
  font-weight: 700;
}

.process-guide__step--active .process-guide__order {
  background: var(--color-primary);
  color: var(--color-text-inverse);
}

.process-guide__step strong,
.process-guide__step small {
  display: block;
}

.process-guide__step small,
.process-guide__empty {
  margin-block-start: 2px;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  line-height: 1.5;
}
</style>

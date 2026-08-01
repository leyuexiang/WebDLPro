<script setup lang="ts">
/**
 * 通用表单字段壳只管理标签、说明与错误文本的语义关系。
 * 具体输入控件由插槽提供，避免在字段字典未知时生成虚假的业务控件。
 */
defineProps<{
  fieldId: string
  label: string
  hint?: string
  error?: string
  required?: boolean
}>()
</script>

<template>
  <label class="base-form-field" :for="fieldId">
    <span class="base-form-field__label">
      {{ label }}<span v-if="required" class="base-form-field__required" aria-hidden="true"> *</span>
    </span>
    <slot />
    <span v-if="error" class="base-form-field__error">{{ error }}</span>
    <span v-else-if="hint" class="base-form-field__hint">{{ hint }}</span>
  </label>
</template>

<style scoped>
.base-form-field {
  display: grid;
  gap: var(--space-2);
  color: var(--color-text);
  font-size: 0.875rem;
}

.base-form-field__label {
  font-weight: 700;
}

.base-form-field__required,
.base-form-field__error {
  color: var(--color-danger);
}

.base-form-field__hint {
  color: var(--color-text-secondary);
}
</style>

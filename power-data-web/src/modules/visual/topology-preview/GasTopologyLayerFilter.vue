<script setup lang="ts">
import {
  GAS_TOPOLOGY_FILTER_GROUPS,
  type GasTopologyFilterId,
  type GasTopologyFilterOption,
} from './gas-topology-layer-filter'

const props = defineProps<{
  selectedFilterIds: ReadonlySet<GasTopologyFilterId>
}>()

const emit = defineEmits<{
  change: [filterId: GasTopologyFilterId, checked: boolean]
}>()

/** 复选框变化只把稳定编号和布尔值交给画布，筛选状态的主开关规则集中在父组件。 */
function handleChange(option: GasTopologyFilterOption, event: Event): void {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  emit('change', option.id, input.checked)
}

function isChecked(option: GasTopologyFilterOption): boolean {
  return props.selectedFilterIds.has(option.id)
}
</script>

<template>
  <div class="gas-topology-layer-filter" aria-label="图层筛选">
    <span class="gas-topology-layer-filter__title">图层筛选：</span>
    <fieldset
      v-for="group in GAS_TOPOLOGY_FILTER_GROUPS"
      :key="group.id"
      class="gas-topology-layer-filter__group"
    >
      <label v-for="option in group.options" :key="option.id" class="gas-topology-layer-filter__option">
        <input
          type="checkbox"
          :checked="isChecked(option)"
          :aria-label="group.label"
          @change="handleChange(option, $event)"
        >
        <span class="gas-topology-layer-filter__check" aria-hidden="true" />
        <span class="gas-topology-layer-filter__swatch" :style="{ backgroundColor: option.color }" aria-hidden="true" />
        <span>{{ option.label }}</span>
      </label>
    </fieldset>
  </div>
</template>

<style scoped>
.gas-topology-layer-filter {
  position: relative;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px 10px;
  min-block-size: 42px;
  padding: 6px 8px;
  overflow: auto hidden;
  border-block-end: 1px solid rgba(148, 163, 184, 0.4);
  background: #10131b;
  color: #d6deeb;
  font: 12px/20px "Microsoft YaHei", sans-serif;
  scrollbar-width: thin;
}

.gas-topology-layer-filter__title {
  flex: 0 0 auto;
  color: #aebbd0;
  font-weight: 600;
}

.gas-topology-layer-filter__group {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  min-block-size: 30px;
  margin: 0;
  padding: 0 8px;
  border: 1px solid #5c6574;
}

.gas-topology-layer-filter__option {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  min-block-size: 28px;
  color: #dce5f2;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.gas-topology-layer-filter__option input {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  opacity: 0;
}

.gas-topology-layer-filter__check {
  position: relative;
  inline-size: 15px;
  block-size: 15px;
  border: 1px solid #93a4bb;
  border-radius: 3px;
  background: #202938;
}

.gas-topology-layer-filter__option input:checked + .gas-topology-layer-filter__check {
  border-color: #60a5fa;
  background: #60a5fa;
}

.gas-topology-layer-filter__option input:checked + .gas-topology-layer-filter__check::after {
  position: absolute;
  inset: 1px 3px 3px 4px;
  border: solid #08111f;
  border-width: 0 2px 2px 0;
  content: "";
  transform: rotate(45deg);
}

.gas-topology-layer-filter__option input:focus-visible + .gas-topology-layer-filter__check {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
}

.gas-topology-layer-filter__swatch {
  inline-size: 10px;
  block-size: 10px;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18);
}

@media (max-width: 900px) {
  .gas-topology-layer-filter {
    align-items: flex-start;
    flex-wrap: nowrap;
    min-block-size: 42px;
  }
}
</style>

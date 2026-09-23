<script setup lang="ts" generic="FilterId extends string">
/** 公共筛选项只描述展示信息；具体筛选编号及联动规则仍由各拓扑的数据模块负责。 */
interface TopologyLayerFilterRailOption<Id extends string> {
  readonly id: Id
  readonly label: string
  readonly color: string
}

/** 分组结构兼容现有四层模型，也允许后续拓扑传入自己的稳定筛选编号。 */
interface TopologyLayerFilterRailGroup<Id extends string> {
  readonly id: string
  readonly options: readonly TopologyLayerFilterRailOption<Id>[]
}

const props = defineProps<{
  groups: readonly TopologyLayerFilterRailGroup<FilterId>[]
  selectedFilterIds: ReadonlySet<FilterId>
}>()

const emit = defineEmits<{
  change: [filterId: FilterId, checked: boolean]
}>()

/**
 * 公共组件只转发稳定筛选编号和勾选值，不扫描拓扑数据，也不处理架构层联动；
 * 这样每次操作保持常数复杂度，后续拓扑可复用同一外观而不耦合燃气或燃煤规则。
 */
function handleChange(option: TopologyLayerFilterRailOption<FilterId>, event: Event): void {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  emit('change', option.id, input.checked)
}

function isChecked(option: TopologyLayerFilterRailOption<FilterId>): boolean {
  return props.selectedFilterIds.has(option.id)
}
</script>

<template>
  <div class="topology-layer-filter-rail" role="group" aria-label="图层筛选" title="图层筛选">
    <!-- “筛选框”三个字依次占据前三行，筛选轨整体只保留一个汉字的内容宽度。 -->
    <span class="topology-layer-filter-rail__title" aria-hidden="true">筛选框</span>
    <fieldset
      v-for="group in props.groups"
      :key="group.id"
      class="topology-layer-filter-rail__group"
    >
      <label
        v-for="option in group.options"
        :key="option.id"
        class="topology-layer-filter-rail__option"
        :title="option.label"
      >
        <input
          type="checkbox"
          :checked="isChecked(option)"
          :aria-label="option.label"
          @change="handleChange(option, $event)"
        >
        <span class="topology-layer-filter-rail__check" aria-hidden="true" />
        <!-- 完整名称逐字向下换行，文字颜色同时承担层级颜色标识，不额外增加色块行。 -->
        <span class="topology-layer-filter-rail__vertical-label" :style="{ color: option.color }" aria-hidden="true">
          {{ option.label }}
        </span>
      </label>
    </fieldset>
  </div>
</template>

<style scoped>
/*
 * 筛选轨绝对定位在最近的相对定位画布右上角，不参与网格轨道计算；
 * 顶部预留公共全屏按钮的高度后整体下移，因而所有当前及后续拓扑都能复用同一位置规范。
 */
.topology-layer-filter-rail {
  position: absolute;
  z-index: 20;
  inset-block-start: 48px;
  inset-inline-end: 8px;
  display: grid;
  justify-items: center;
  gap: 1px;
  inline-size: 15px;
  /* 顶部按钮占用 32px，加上下方 8px 间距和底部 8px 安全边距，避免下移后轨道顶到底部溢出。 */
  max-block-size: calc(100% - 56px);
  min-block-size: 0;
  box-sizing: content-box;
  padding: 4px 3px;
  overflow: hidden auto;
  border: 1px solid rgba(148, 163, 184, 0.55);
  border-radius: 5px;
  background: rgba(16, 19, 27, 0.92);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  color: #d6deeb;
  font: 11px/14px "Microsoft YaHei", sans-serif;
  scrollbar-width: thin;
}

.topology-layer-filter-rail__title,
.topology-layer-filter-rail__vertical-label {
  inline-size: 1em;
  line-height: 14px;
  overflow-wrap: anywhere;
  text-align: center;
}

.topology-layer-filter-rail__title {
  color: #aebbd0;
  font-weight: 600;
}

.topology-layer-filter-rail__group {
  display: grid;
  justify-items: center;
  gap: 1px;
  inline-size: 15px;
  margin: 0;
  padding: 2px 0 0;
  border: 0;
  border-block-start: 1px solid rgba(92, 101, 116, 0.72);
}

.topology-layer-filter-rail__option {
  display: grid;
  grid-template-columns: 15px;
  justify-items: center;
  gap: 1px;
  inline-size: 15px;
  color: #dce5f2;
  cursor: pointer;
  user-select: none;
}

.topology-layer-filter-rail__option input {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  opacity: 0;
}

.topology-layer-filter-rail__check {
  position: relative;
  inline-size: 13px;
  block-size: 13px;
  border: 1px solid #93a4bb;
  border-radius: 3px;
  background: #202938;
}

.topology-layer-filter-rail__option input:checked + .topology-layer-filter-rail__check {
  border-color: #60a5fa;
  background: #60a5fa;
}

.topology-layer-filter-rail__option input:checked + .topology-layer-filter-rail__check::after {
  position: absolute;
  inset: 1px 3px 3px 4px;
  border: solid #08111f;
  border-width: 0 2px 2px 0;
  content: "";
  transform: rotate(45deg);
}

.topology-layer-filter-rail__option input:focus-visible + .topology-layer-filter-rail__check {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
}
</style>

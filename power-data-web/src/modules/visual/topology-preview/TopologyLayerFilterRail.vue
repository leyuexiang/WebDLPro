<script setup lang="ts" generic="FilterId extends string">
import { ref, useId } from 'vue'

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

/** 每次打开拓扑时默认收起筛选面板，只保留固定在侧边的展开按钮。 */
const isExpanded = ref(false)
/** 生成稳定且不重复的面板编号，供侧边按钮声明对应的筛选区域。 */
const filterPanelId = `topology-layer-filter-panel-${useId()}`

/** 只切换筛选面板可见状态，不重置当前已选图层。 */
function toggleExpanded(): void {
  isExpanded.value = !isExpanded.value
}

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
  <div
    class="topology-layer-filter-drawer"
    :class="{ 'topology-layer-filter-drawer--expanded': isExpanded }"
  >
    <div
      :id="filterPanelId"
      class="topology-layer-filter-rail"
      role="group"
      aria-label="图层筛选"
      :aria-hidden="!isExpanded"
      :inert="!isExpanded"
    >
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

    <button
      type="button"
      class="topology-layer-filter-drawer__toggle"
      :aria-controls="filterPanelId"
      :aria-expanded="isExpanded"
      :aria-label="isExpanded ? '收起图层筛选' : '展开图层筛选'"
      :title="isExpanded ? '收起图层筛选' : '展开图层筛选'"
      @click="toggleExpanded"
    >
      <svg class="topology-layer-filter-drawer__chevron" viewBox="0 0 16 16" aria-hidden="true">
        <path d="m9.5 3.5-4.5 4.5 4.5 4.5" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/*
 * 公共筛选入口以侧边按钮常驻，面板默认收起，展开后覆盖画布可用区而不挤压拓扑布局。
 * 面板被收起时同步从辅助技术树和键盘焦点顺序移除，避免隐藏内容仍可交互。
 */
.topology-layer-filter-drawer {
  /* 面板含边框与内边距共 23 像素；面板和按钮共用右边界，不相互预留横向空带。 */
  --topology-filter-panel-width: 23px;
  position: absolute;
  z-index: 20;
  /* 公共筛选属于画布控件，固定贴住承载画布右边界，不随图元缩放或居中留白移动。 */
  top: 48px;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  width: 32px;
  /* 面板可在低矮画布内收缩滚动，按钮始终保留完整高度与底部 8 像素的安全距离。 */
  max-block-size: calc(100% - 56px);
  pointer-events: none;
}

.topology-layer-filter-rail {
  position: relative;
  display: grid;
  flex: 0 1 auto;
  justify-items: center;
  gap: 1px;
  inline-size: var(--topology-filter-panel-width);
  min-block-size: 0;
  box-sizing: border-box;
  padding: 4px 3px;
  overflow: hidden auto;
  border: 1px solid rgba(148, 163, 184, 0.55);
  border-radius: 5px;
  background: rgba(16, 19, 27, 0.92);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  color: #d6deeb;
  font: 11px/14px "Microsoft YaHei", sans-serif;
  /* 隐藏时保留排版尺寸，按钮不会跳位；透明区域不接收输入，辅助技术由 aria-hidden 与 inert 隔离。 */
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  transform: translateX(100%);
  transition: opacity 160ms ease, transform 160ms ease, visibility 0s linear 160ms;
  /* 单字宽轨道不为滚动条挤掉文字；低矮画布仍可用滚轮或键盘滚动查看全部筛选项。 */
  scrollbar-width: none;
}

.topology-layer-filter-drawer--expanded .topology-layer-filter-rail {
  visibility: visible;
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
  transition-delay: 0s;
}

.topology-layer-filter-drawer__toggle {
  position: relative;
  z-index: 1;
  /* 面板与按钮按竖列排版，展开和收起均保持物理右侧零偏移，不遮挡筛选文字。 */
  right: 0;
  display: grid;
  flex: 0 0 42px;
  width: 32px;
  height: 42px;
  padding: 0;
  place-items: center;
  border: 1px solid rgba(148, 163, 184, 0.62);
  border-radius: 5px 0 0 5px;
  background: rgba(16, 19, 27, 0.94);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  color: #d6deeb;
  cursor: pointer;
  pointer-events: auto;
  transition: border-color 150ms ease, background-color 150ms ease, color 150ms ease;
}

.topology-layer-filter-drawer__toggle:hover,
.topology-layer-filter-drawer__toggle:focus-visible {
  border-color: #67e8f9;
  background: rgba(8, 47, 73, 0.96);
  color: #bff7ff;
}

.topology-layer-filter-drawer__toggle:focus-visible {
  outline: 2px solid rgba(103, 232, 249, 0.72);
  outline-offset: 2px;
}

.topology-layer-filter-drawer__chevron {
  inline-size: 16px;
  block-size: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
  transition: transform 150ms ease;
}

.topology-layer-filter-drawer--expanded .topology-layer-filter-drawer__chevron {
  transform: rotate(180deg);
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

@media (prefers-reduced-motion: reduce) {
  .topology-layer-filter-rail,
  .topology-layer-filter-drawer__toggle,
  .topology-layer-filter-drawer__chevron {
    transition-duration: 0.01ms;
    transition-delay: 0s;
  }
}
</style>

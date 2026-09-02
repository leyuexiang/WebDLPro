<script setup lang="ts">
import cameraPoseInformationBubbleUrl from '@/assets/camera-pose-information-bubble.svg'

defineProps<{
  /** 当前步骤标题只来自固定镜头映射，不接收平台或 Unity 返回的任意文本。 */
  title: string
  /** 当前步骤的临时说明；后续可在固定映射中替换，不改变气泡布局和交互。 */
  description: string
}>()

const emit = defineEmits<{
  /** 关闭按钮是稳定业务视图内唯一允许主动关闭气泡的入口。 */
  close: []
}>()
</script>

<template>
  <aside
    class="camera-pose-information-bubble"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    <!-- 原始矢量图只承担装饰边框；可访问名称由标题和说明文本提供，避免屏幕阅读器重复朗读。 -->
    <img
      class="camera-pose-information-bubble__frame"
      :src="cameraPoseInformationBubbleUrl"
      alt=""
      aria-hidden="true"
    >

    <!--
      文本区严格按原图坐标 (68.5, 61.54) 至 (571.5, 400.54) 换算为百分比；
      外框随 Unity 视口高度缩放时，文本可用区域会以相同比例同步变化。
    -->
    <div class="camera-pose-information-bubble__content">
      <p class="camera-pose-information-bubble__eyebrow">关键环节</p>
      <h2>{{ title }}</h2>
      <p class="camera-pose-information-bubble__description">{{ description }}</p>
    </div>

    <button
      class="camera-pose-information-bubble__close"
      type="button"
      aria-label="关闭关键环节说明"
      title="关闭"
      @click="emit('close')"
    >
      <span aria-hidden="true">×</span>
    </button>
  </aside>
</template>

<style scoped>
/*
 * 气泡高度固定为 Unity 实际视口高度的三分之一；宽度使用原图宽高比反推。
 * 0.4730689588472514 = (613.868 / 432.543) / 3，避免依赖尚未普遍支持的 calc 除法语法。
 * 两个起始偏移与居中的 Unity 视口共用工作宽度和场景高度变量，宽屏留白不会造成错位。
 */
.camera-pose-information-bubble {
  position: absolute;
  z-index: 2;
  inset-block-start: calc((100% - var(--scene-block-size)) / 2);
  inset-inline-start: calc((100% - var(--visualization-work-inline-size)) / 2);
  inline-size: calc(var(--scene-block-size) * 0.4730689588472514);
  max-inline-size: var(--visualization-work-inline-size);
  block-size: calc(var(--scene-block-size) / 3);
  margin: 0;
  overflow: visible;
  color: #e6fbff;
  pointer-events: auto;
}

.camera-pose-information-bubble__frame {
  position: absolute;
  inset: 0;
  display: block;
  inline-size: 100%;
  block-size: 100%;
  user-select: none;
  pointer-events: none;
}

/*
 * 百分比来自用户给定的原始安全区坐标：
 * 左 68.5 / 613.868，上 61.54 / 432.543，宽 503 / 613.868，高 339 / 432.543。
 */
.camera-pose-information-bubble__content {
  position: absolute;
  inset-block-start: 14.2274872093642%;
  inset-inline-start: 11.1587507412017%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  inline-size: 81.939439749262%;
  block-size: 78.3737108218142%;
  box-sizing: border-box;
  min-inline-size: 0;
  min-block-size: 0;
  padding: 5% 13% 5% 2%;
  overflow: hidden;
}

.camera-pose-information-bubble__eyebrow,
.camera-pose-information-bubble__description,
.camera-pose-information-bubble h2 {
  margin: 0;
}

.camera-pose-information-bubble__eyebrow {
  color: #67e8f9;
  font-size: clamp(8px, 0.58cqw, 11px);
  font-weight: 600;
  letter-spacing: 0.08em;
}

.camera-pose-information-bubble h2 {
  margin-block-start: 2%;
  color: #ffffff;
  font-size: clamp(11px, 0.86cqw, 17px);
  line-height: 1.25;
}

.camera-pose-information-bubble__description {
  margin-block-start: 4%;
  overflow: hidden;
  color: rgb(230 251 255 / 88%);
  font-size: clamp(9px, 0.65cqw, 13px);
  line-height: 1.45;
  text-wrap: pretty;
}

/* 关闭按钮位于矢量框右上角内侧，不占用文档流，也不会改变气泡或 Unity 视口尺寸。 */
.camera-pose-information-bubble__close {
  position: absolute;
  z-index: 1;
  inset-block-start: 7.5%;
  inset-inline-end: 7.5%;
  display: grid;
  place-items: center;
  inline-size: clamp(20px, calc(var(--scene-block-size) * 0.055), 30px);
  block-size: clamp(20px, calc(var(--scene-block-size) * 0.055), 30px);
  padding: 0;
  border: 1px solid rgb(103 232 249 / 68%);
  border-radius: 50%;
  color: #e6fbff;
  font: inherit;
  font-size: clamp(16px, calc(var(--scene-block-size) * 0.038), 22px);
  line-height: 1;
  cursor: pointer;
  background: rgb(2 38 57 / 86%);
  transition: border-color 120ms ease, background-color 120ms ease, color 120ms ease;
}

.camera-pose-information-bubble__close:hover {
  border-color: #67e8f9;
  color: #ffffff;
  background: rgb(14 116 144 / 92%);
}

.camera-pose-information-bubble__close:focus-visible {
  outline: 2px solid #f8fafc;
  outline-offset: 2px;
}
</style>

<script setup lang="ts">
import ModuleEntryPlaceholder from '@/shared/components/ModuleEntryPlaceholder.vue'

/** 采集模块在字段与接口明确前只展示契约缺口，避免提前实现错误的增删改查。 */
const pendingItems = ['采集点字段与采集频率', '链路、策略与质量状态流转', '接口分页、错误码与写入权限']
</script>

<template>
  <ModuleEntryPlaceholder
    title="数据采集"
    description="采集点、链路、策略和质量监控页面将在业务契约确认后按通用基座装配。"
    :pending-items="pendingItems"
  />
</template>

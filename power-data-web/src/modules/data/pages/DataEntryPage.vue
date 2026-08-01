<script setup lang="ts">
import ModuleEntryPlaceholder from '@/shared/components/ModuleEntryPlaceholder.vue'

/** 数据管理模块不虚构实时指标、统计口径或告警等级。 */
const pendingItems = ['实时数据主题与指标编码', '业务统计的时间范围和聚合口径', '数据查看权限与导出规则']
</script>

<template>
  <ModuleEntryPlaceholder
    title="数据管理"
    description="实时数据与业务统计将等待指标口径、订阅协议和权限规则确认后接入。"
    :pending-items="pendingItems"
  />
</template>

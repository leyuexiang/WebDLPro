<script setup lang="ts">
import ModuleEntryPlaceholder from '@/shared/components/ModuleEntryPlaceholder.vue'

/** 系统管理模块先提供组件入口，真实设备、用户与角色模型由任务 012 明确。 */
const pendingItems = ['设备、用户、角色与权限字段字典', '低代码配置的发布与回滚流程', '各管理对象的审计与操作权限']
</script>

<template>
  <ModuleEntryPlaceholder
    title="系统管理"
    description="系统管理的业务页面尚未开始开发；当前可先验证无业务含义的通用组件基座。"
    :pending-items="pendingItems"
  />
</template>

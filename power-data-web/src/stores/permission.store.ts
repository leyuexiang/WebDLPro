import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type PermissionLayer = 'page' | 'data' | 'scene'

/**
 * 三层权限策略的可序列化载荷。
 * 页面、数据和场景操作分开声明，避免“可查看页面”等同于“可执行高风险操作”。
 */
export interface PermissionPolicy {
  page: readonly string[]
  data: readonly string[]
  scene: readonly string[]
}

/**
 * 当前为开发阶段模拟策略，正式鉴权接入后只替换 refreshPolicy 的数据来源。
 * 不在此处虚构业务角色名称或后端字段，所有判断仅面向权限码。
 */
const developmentPolicy: PermissionPolicy = {
  page: ['portal.view', 'collect.view', 'data.view', 'visual.view', 'system.view', 'components.view'],
  data: [],
  scene: [],
}

/**
 * 权限仓库只保存数组形式的策略快照。
 * 计算属性按需生成集合，减少导航渲染期间重复线性查找，同时不把不可序列化集合写入状态。
 */
export const usePermissionStore = defineStore('permission', () => {
  const policy = ref<PermissionPolicy>(developmentPolicy)
  const pageCodes = computed(() => new Set(policy.value.page))
  const dataCodes = computed(() => new Set(policy.value.data))
  const sceneCodes = computed(() => new Set(policy.value.scene))

  /** 根据权限层选择对应集合，调用端必须明确声明所判断的访问边界。 */
  function hasPermission(layer: PermissionLayer, code: string): boolean {
    const codes = layer === 'page' ? pageCodes.value : layer === 'data' ? dataCodes.value : sceneCodes.value
    return codes.has(code)
  }

  /**
   * 使用不可变快照替换策略，避免调用方保留数组引用后绕开权限刷新流程。
   * 正式环境由鉴权适配器在令牌刷新或角色切换完成后调用。
   */
  function refreshPolicy(nextPolicy: PermissionPolicy): void {
    policy.value = {
      page: [...nextPolicy.page],
      data: [...nextPolicy.data],
      scene: [...nextPolicy.scene],
    }
  }

  return {
    policy,
    hasPermission,
    refreshPolicy,
  }
})

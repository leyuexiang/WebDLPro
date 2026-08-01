import type { Pinia } from 'pinia'
import type { Router } from 'vue-router'
import { usePermissionStore } from '@/stores/permission.store'

/**
 * 安装通用页面权限守卫。
 * 工艺页的“配置存在性 + 页面权限”守卫依赖任务 013、014 的配置仓库，届时在此基础上追加，
 * 不能在当前阶段用路由参数生成资源地址或假定页面配置存在。
 */
export function installRouteGuards(router: Router, pinia: Pinia): void {
  router.beforeEach((to) => {
    const permissionStore = usePermissionStore(pinia)
    const requiredPermission = to.matched
      .map((record) => record.meta.permissionCode)
      .find((code): code is string => typeof code === 'string')

    if (!requiredPermission || permissionStore.hasPermission('page', requiredPermission)) {
      return true
    }

    return {
      name: 'forbidden',
      query: { from: to.fullPath, permission: requiredPermission },
    }
  })
}

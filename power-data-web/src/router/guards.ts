import type { Pinia } from 'pinia'
import type { Router } from 'vue-router'
import { localProcessConfigLoader } from '@/config/process/local-process-config'
import { getLocalTopicDefinition } from '@/config/process/topic-config'
import { usePermissionStore } from '@/stores/permission.store'

/**
 * 安装通用页面权限守卫。
 * 工艺页和专题页先验证配置存在性，再检查其配置声明的页面权限；未知路由参数不会被用来
 * 拼接资源地址或绕过页面权限，直接进入统一的 404 或无权限状态。
 */
export function installRouteGuards(router: Router, pinia: Pinia): void {
  router.beforeEach((to) => {
    const permissionStore = usePermissionStore(pinia)
    const requiredPermission = to.matched
      .map((record) => record.meta.permissionCode)
      .find((code): code is string => typeof code === 'string')

    if (requiredPermission && !permissionStore.hasPermission('page', requiredPermission)) {
      return {
        name: 'forbidden',
        query: { from: to.fullPath, permission: requiredPermission },
      }
    }

    if (to.name === 'visual-process') {
      const page = localProcessConfigLoader.getPage(String(to.params.processPageId ?? ''))

      if (!page) {
        return { name: 'not-found' }
      }

      if (!permissionStore.hasPermission('page', page.permissionCode)) {
        return { name: 'forbidden', query: { from: to.fullPath, permission: page.permissionCode } }
      }
    }

    if (to.name === 'visual-topic-detail') {
      const topic = getLocalTopicDefinition(String(to.params.topicId ?? ''))

      if (!topic) {
        return { name: 'not-found' }
      }

      if (!permissionStore.hasPermission('page', topic.permissionCode)) {
        return { name: 'forbidden', query: { from: to.fullPath, permission: topic.permissionCode } }
      }
    }

    return true
  })
}

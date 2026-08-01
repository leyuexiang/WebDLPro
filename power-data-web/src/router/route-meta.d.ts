import 'vue-router'

declare module 'vue-router' {
  /**
   * 所有路由统一声明页面访问权限码。
   * 数据与场景操作权限由组件在动作发生前单独校验，不能被此处的页面权限替代。
   */
  interface RouteMeta {
    permissionCode?: string
    title?: string
  }
}

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

/**
 * 路由收缩为唯一嵌入运行壳。
 *
 * 外层只负责承载工艺三维视图和拓扑视图；门户、后台、专题及旧三栏工作台不再注册，
 * 因而不会被路由动态导入，也不会作为生产入口重新出现。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    // 根路径和未知路径都收敛至嵌入壳，避免暴露已下线的旧功能入口。
    redirect: '/embed',
  },
  {
    path: '/embed',
    name: 'embedded-visualization-shell',
    // 懒加载保留壳与业务边界，且不引入任何旧门户代码。
    component: () => import('@/app/EmbeddedVisualizationShell.vue'),
    meta: { title: '电力场景与拓扑嵌入模块' },
  },
  {
    path: '/:pathMatch(.*)*',
    // 对历史地址采取收敛跳转，而不是渲染旧页面或权限提示页。
    redirect: '/embed',
  },
]

/** 使用网页历史模式创建路由；部署服务器必须将未知路径回退到应用入口文件。 */
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0, left: 0 }),
})

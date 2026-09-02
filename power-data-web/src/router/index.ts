import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { resolveRouterHistoryBase } from './history-base'

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
    path: '/gas-topology-json-preview',
    name: 'gas-topology-json-preview',
    // 新拓扑只作为原始 JSON 的独立效果预览，不登记到正式场景清单，也不替换现有燃气拓扑。
    component: () => import('@/modules/visual/topology-preview/GasTopologyJsonPreview.vue'),
    meta: { title: '燃气拓扑图 JSON 预览' },
  },
  {
    path: '/coal-topology-json-preview',
    name: 'coal-topology-json-preview',
    // 燃煤拓扑使用独立数据与资源目录，保留原燃煤/燃气正式入口及其回退能力。
    component: () => import('@/modules/visual/topology-preview/CoalTopologyJsonPreview.vue'),
    meta: { title: '燃煤拓扑图 JSON 预览' },
  },
  {
    path: '/:pathMatch(.*)*',
    // 对历史地址采取收敛跳转，而不是渲染旧页面或权限提示页。
    redirect: '/embed',
  },
]

/**
 * 在首屏地址仍含 `shell` 目录时固定历史基础路径，避免相对构建在重定向到 `/embed` 后
 * 请求根目录静态资源。部署服务器仍需将壳内未知路由回退到入口文件。
 */
const routerHistoryBase = resolveRouterHistoryBase(
  import.meta.env.BASE_URL,
  typeof window === 'undefined' ? '/' : window.location.pathname,
)

/** 使用网页历史模式创建路由；部署服务器必须将未知路径回退到应用入口文件。 */
export const router = createRouter({
  history: createWebHistory(routerHistoryBase),
  routes,
  scrollBehavior: () => ({ top: 0, left: 0 }),
})

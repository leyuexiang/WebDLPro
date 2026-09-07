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
    path: '/gas-v3-topology-json-preview',
    name: 'gas-v3-topology-json-preview',
    // 第三版使用独立数据和编号清单；第一版已存档并移除，正式总览与独立预览保持同一数据源。
    component: () => import('@/modules/visual/topology-preview/GasV3TopologyJsonPreview.vue'),
    meta: { title: '燃气 V3 拓扑图 JSON 预览' },
  },
  {
    path: '/coal-topology-json-preview',
    name: 'coal-topology-json-preview',
    // 燃煤拓扑使用独立数据与资源目录，不依赖已移除的第一版燃气预览。
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

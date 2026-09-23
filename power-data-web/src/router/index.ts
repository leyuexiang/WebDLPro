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
    path: '/wind-topology-json-preview',
    name: 'wind-topology-json-preview',
    component: () => import('@/modules/visual/topology-preview/WindTopologyJsonPreview.vue'),
    meta: { title: '风电拓扑图 JSON 预览' },
  },
  {
    path: '/solar-topology-json-preview',
    name: 'solar-topology-json-preview',
    component: () => import('@/modules/visual/topology-preview/SolarTopologyJsonPreview.vue'),
    meta: { title: '光伏拓扑图 JSON 预览' },
  },
  {
    path: '/coal-topology-json-preview',
    name: 'coal-topology-json-preview',
    // 燃煤拓扑使用独立数据与资源目录，不依赖已移除的第一版燃气预览。
    component: () => import('@/modules/visual/topology-preview/CoalTopologyJsonPreview.vue'),
    meta: { title: '燃煤拓扑图 JSON 预览' },
  },
  {
    path: '/step-up-substation-topology-json-preview',
    name: 'step-up-substation-topology-json-preview',
    // 独立预览与正式升压站总览共用八份变体清单，保证验收结果和业务入口一致。
    component: () => import('@/modules/visual/topology-preview/StepUpSubstationTopologyJsonPreview.vue'),
    meta: { title: '升压站拓扑图 JSON 预览' },
  },
  {
    path: '/step-down-substation-topology-json-preview',
    name: 'step-down-substation-topology-json-preview',
    // 独立预览与正式降压站总览共用同一清单、资源和公共画布，不维护第二套验收数据。
    component: () => import('@/modules/visual/topology-preview/StepDownSubstationTopologyJsonPreview.vue'),
    meta: { title: '降压站拓扑图 JSON 预览' },
  },
  {
    path: '/converter-station-topology-json-preview',
    name: 'converter-station-topology-json-preview',
    // 独立预览与正式换流站总览共用八份只读清单，验收不会维护另一份运行时合并数据。
    component: () => import('@/modules/visual/topology-preview/ConverterStationTopologyJsonPreview.vue'),
    meta: { title: '换流站拓扑图 JSON 预览' },
  },
  {
    path: '/protection-process-detail-topology-preview',
    name: 'protection-process-detail-topology-preview',
    // 仅用于核对三份二维保护图，不登记或模拟尚未交付的 Unity 第三层资源。
    component: () => import('@/modules/visual/topology-preview/ProtectionProcessDetailTopologyPreview.vue'),
    meta: { title: '保护关键环节拓扑预览' },
  },
  {
    path: '/switching-station-topology-json-preview',
    name: 'switching-station-topology-json-preview',
    // 独立预览和正式开关站总览共享八份不可变拓扑清单及公共画布。
    component: () => import('@/modules/visual/topology-preview/SwitchingStationTopologyJsonPreview.vue'),
    meta: { title: '开关站拓扑图 JSON 预览' },
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

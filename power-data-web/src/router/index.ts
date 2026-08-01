import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

/**
 * 页面组件全部通过动态导入注册，保证首包只包含应用壳。
 * 工艺页保留一个共享路由组件；配置中心完成前不在路由层解析或拼接任何三维资源地址。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/portal',
  },
  {
    path: '/portal',
    component: () => import('@/layouts/PortalLayout.vue'),
    meta: { permissionCode: 'portal.view', title: '系统门户' },
    children: [
      {
        path: '',
        name: 'portal-home',
        component: () => import('@/modules/portal/pages/PortalHomePage.vue'),
      },
    ],
  },
  {
    path: '/collect',
    component: () => import('@/layouts/AdminLayout.vue'),
    meta: { permissionCode: 'collect.view', title: '数据采集' },
    children: [
      {
        path: '',
        name: 'collect-home',
        component: () => import('@/modules/collect/pages/CollectEntryPage.vue'),
      },
    ],
  },
  {
    path: '/data',
    component: () => import('@/layouts/AdminLayout.vue'),
    meta: { permissionCode: 'data.view', title: '数据管理' },
    children: [
      {
        path: '',
        name: 'data-home',
        component: () => import('@/modules/data/pages/DataEntryPage.vue'),
      },
    ],
  },
  {
    path: '/visual',
    component: () => import('@/layouts/VisualLayout.vue'),
    meta: { permissionCode: 'visual.view', title: '可视化' },
    children: [
      {
        path: 'dashboard',
        name: 'visual-dashboard',
        component: () => import('@/modules/visual/pages/VisualDashboardPage.vue'),
      },
      {
        path: 'process/:processPageId',
        name: 'visual-process',
        component: () => import('@/modules/visual/pages/ProcessWorkbenchPage.vue'),
      },
      {
        path: 'topic',
        name: 'visual-topic',
        component: () => import('@/modules/visual/pages/TopicIndexPage.vue'),
      },
      {
        path: 'topic/:topicId',
        name: 'visual-topic-detail',
        component: () => import('@/modules/visual/pages/TopicDetailPage.vue'),
      },
    ],
  },
  {
    path: '/system',
    component: () => import('@/layouts/AdminLayout.vue'),
    meta: { permissionCode: 'system.view', title: '系统管理' },
    children: [
      {
        path: '',
        name: 'system-home',
        component: () => import('@/modules/system/pages/SystemEntryPage.vue'),
      },
      {
        path: 'components',
        name: 'component-showcase',
        component: () => import('@/modules/system/pages/ComponentShowcasePage.vue'),
        meta: { permissionCode: 'components.view', title: '基础组件示例' },
      },
    ],
  },
  {
    path: '/forbidden',
    name: 'forbidden',
    component: () => import('@/modules/system/pages/ForbiddenPage.vue'),
    meta: { title: '无访问权限' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/modules/system/pages/NotFoundPage.vue'),
    meta: { title: '页面不存在' },
  },
]

/** 使用网页历史模式创建路由；部署服务器必须将未知路径回退到应用入口文件。 */
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0, left: 0 }),
})

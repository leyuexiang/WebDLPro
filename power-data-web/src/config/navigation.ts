import type { NavigationItem } from '@/shared/types/navigation'

/**
 * 一级导航属于本地只读壳配置。
 * 展示顺序由数组顺序确定，后续接入配置中心时可替换数据源而不改变布局组件。
 */
export const primaryNavigation: readonly NavigationItem[] = [
  {
    key: 'portal',
    label: '系统门户',
    description: '统一进入各业务模块。',
    to: '/portal',
    permissionCode: 'portal.view',
  },
  {
    key: 'collect',
    label: '数据采集',
    description: '采集点、链路、策略与质量监控入口。',
    to: '/collect',
    permissionCode: 'collect.view',
  },
  {
    key: 'data',
    label: '数据管理',
    description: '实时数据与业务统计入口。',
    to: '/data',
    permissionCode: 'data.view',
  },
  {
    key: 'visual',
    label: '可视化',
    description: '总览大屏、工艺工作台与专题场景入口。',
    to: '/visual/dashboard',
    permissionCode: 'visual.view',
  },
  {
    key: 'system',
    label: '系统管理',
    description: '设备、用户、角色、权限与配置入口。',
    to: '/system',
    permissionCode: 'system.view',
  },
]

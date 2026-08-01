/** 平台一级模块使用稳定键值，组件与权限判断均不能依赖展示文案。 */
export type AppModuleKey = 'portal' | 'collect' | 'data' | 'visual' | 'system'

/** 导航项只描述页面入口与权限，不保存任何页面实例或运行时资源。 */
export interface NavigationItem {
  key: AppModuleKey
  label: string
  description: string
  to: string
  permissionCode: string
}

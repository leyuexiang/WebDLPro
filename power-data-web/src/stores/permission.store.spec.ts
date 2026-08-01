import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePermissionStore } from '@/stores/permission.store'

/** 权限仓库测试覆盖三层隔离与不可变刷新，防止页面权限被误用于场景操作。 */
describe('权限仓库', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('分别判断页面、数据和场景权限', () => {
    const store = usePermissionStore()
    store.refreshPolicy({
      page: ['visual.view'],
      data: ['metric.read'],
      scene: ['scene.focus'],
    })

    expect(store.hasPermission('page', 'visual.view')).toBe(true)
    expect(store.hasPermission('data', 'metric.read')).toBe(true)
    expect(store.hasPermission('scene', 'scene.focus')).toBe(true)
    expect(store.hasPermission('scene', 'visual.view')).toBe(false)
  })

  it('刷新后不保留调用方数组引用', () => {
    const store = usePermissionStore()
    const policy = { page: ['portal.view'], data: [], scene: [] }
    store.refreshPolicy(policy)
    policy.page.push('system.view')

    expect(store.hasPermission('page', 'system.view')).toBe(false)
  })
})

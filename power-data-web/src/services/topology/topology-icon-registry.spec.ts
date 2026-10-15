import { describe, expect, it } from 'vitest'
import type { TopologyDeviceStatus } from '@/config/process/types'
import {
  getTopologyIconUrl,
  hasTopologyIconKey,
  MAXIMUM_TOPOLOGY_ICON_ASSETS,
  REGISTERED_TOPOLOGY_ICON_KEYS,
} from '@/services/topology/topology-icon-registry'

/** 四态资源必须完整解析；不允许依赖文件名猜测、默认正常态或外部路径拼接。 */
const topologyDeviceStatuses: readonly TopologyDeviceStatus[] = ['normal', 'alarm', 'fault', 'offline']

/** 交换机、服务器和工作站已改用公共 WebP 四态资源；其余图元仍显式登记矢量资源。 */
const firstBatchIconKeys = ['core-switch', 'server', 'workstation'] as const

describe('正式拓扑图元登记表', () => {
  it('只按受控图元键和四态返回受控公共资源或显式矢量资源地址', () => {
    const urls = REGISTERED_TOPOLOGY_ICON_KEYS.flatMap((iconKey) => topologyDeviceStatuses.map((status) => getTopologyIconUrl(iconKey, status)))

    expect(Object.isFrozen(REGISTERED_TOPOLOGY_ICON_KEYS)).toBe(true)
    expect(urls).toHaveLength(MAXIMUM_TOPOLOGY_ICON_ASSETS)
    expect(urls.every((url): url is string => typeof url === 'string'
      && (url.includes('/topology/shared/icons/') || url.includes('assets/topology-icons/')))).toBe(true)
    expect(urls.every((url): url is string => typeof url === 'string' && !/\.png(?:\?|$)/i.test(url))).toBe(true)
    expect(new Set(urls).size).toBe(MAXIMUM_TOPOLOGY_ICON_ASSETS)
    // 先显式收窄可选资源地址，再检查路径，保证类型检查与运行时保护使用同一语义。
    expect(urls.some((url) => typeof url === 'string' && url.includes('Docs/'))).toBe(false)
  })

  it('交换机、服务器和工作站的四态都使用公共 WebP，核心交换机使用补充目录的双交换机素材', () => {
    firstBatchIconKeys.forEach((iconKey) => {
      for (const status of topologyDeviceStatuses) {
        expect(getTopologyIconUrl(iconKey, status)).toMatch(/\.webp(?:\?|$)/)
        expect(getTopologyIconUrl(iconKey, status)).toContain('/topology/shared/icons/')
      }
    })
  })

  it('中性占位和未知键不注册图像，避免生产运行时根据外部输入请求资源', () => {
    expect(hasTopologyIconKey('generic')).toBe(false)
    expect(hasTopologyIconKey('unregistered-icon')).toBe(false)
    expect(getTopologyIconUrl('generic', 'offline')).toBeUndefined()
  })
})

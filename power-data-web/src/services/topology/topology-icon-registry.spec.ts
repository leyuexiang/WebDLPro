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

/** 首批新图标仅覆盖已确认的正常、故障和停止/离线三态，告警态继续使用旧资源。 */
const firstBatchIconKeys = ['core-switch', 'server', 'workstation'] as const

describe('正式拓扑图元登记表', () => {
  it('只按受控图元键和四态返回前端资产目录中的唯一图像地址', () => {
    const urls = REGISTERED_TOPOLOGY_ICON_KEYS.flatMap((iconKey) => topologyDeviceStatuses.map((status) => getTopologyIconUrl(iconKey, status)))

    expect(Object.isFrozen(REGISTERED_TOPOLOGY_ICON_KEYS)).toBe(true)
    expect(urls).toHaveLength(MAXIMUM_TOPOLOGY_ICON_ASSETS)
    expect(urls.every((url): url is string => typeof url === 'string' && url.includes('assets/topology-icons/'))).toBe(true)
    expect(new Set(urls).size).toBe(MAXIMUM_TOPOLOGY_ICON_ASSETS)
    // 先显式收窄可选资源地址，再检查路径，保证类型检查与运行时保护使用同一语义。
    expect(urls.some((url) => typeof url === 'string' && url.includes('Docs/'))).toBe(false)
  })

  it('按确认的状态语义接入首批新图标，并为暂缺素材的告警态保留旧图标', () => {
    firstBatchIconKeys.forEach((iconKey) => {
      expect(getTopologyIconUrl(iconKey, 'normal')).toMatch(/_normal\.png(?:\?|$)/)
      expect(getTopologyIconUrl(iconKey, 'alarm')).toMatch(/_alarm\.svg(?:\?|$)/)
      expect(getTopologyIconUrl(iconKey, 'fault')).toMatch(/_fault\.png(?:\?|$)/)
      expect(getTopologyIconUrl(iconKey, 'offline')).toMatch(/_offline\.png(?:\?|$)/)
    })
  })

  it('中性占位和未知键不注册图像，避免生产运行时根据外部输入请求资源', () => {
    expect(hasTopologyIconKey('generic')).toBe(false)
    expect(hasTopologyIconKey('unregistered-icon')).toBe(false)
    expect(getTopologyIconUrl('generic', 'offline')).toBeUndefined()
  })
})

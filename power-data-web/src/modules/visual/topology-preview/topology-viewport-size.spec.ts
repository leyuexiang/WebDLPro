import { describe, expect, it } from 'vitest'
import { readUsableTopologyViewportSize } from './topology-viewport-size'

/** 用最小只读宿主夹具锁定第三层返回期间的零尺寸边界，不依赖真实浏览器布局时序。 */
function createHost(clientWidth: number, clientHeight: number): Pick<HTMLElement, 'clientWidth' | 'clientHeight'> {
  return { clientWidth, clientHeight }
}

describe('拓扑画布可用视口尺寸', () => {
  it('拒绝隐藏恢复阶段的零尺寸，避免创建零尺寸离屏画布', () => {
    expect(readUsableTopologyViewportSize(createHost(0, 720))).toBeUndefined()
    expect(readUsableTopologyViewportSize(createHost(1280, 0))).toBeUndefined()
    expect(readUsableTopologyViewportSize(createHost(0, 0))).toBeUndefined()
  })

  it('只向二维组态引擎提供收敛后的正整数尺寸', () => {
    expect(readUsableTopologyViewportSize(createHost(1279.6, 719.5))).toEqual({ width: 1280, height: 720 })
  })
})

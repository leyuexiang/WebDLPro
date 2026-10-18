import { describe, expect, it } from 'vitest'
import { resolveRouterHistoryBase } from './history-base'

describe('嵌入壳网页历史基础路径', () => {
  it('相对构建从 shell/embed 打开时应保留 shell 前缀', () => {
    expect(resolveRouterHistoryBase('./', '/shell/embed')).toBe('/shell/')
  })

  it('独立拓扑预览同样应保留 shell 前缀', () => {
    expect(resolveRouterHistoryBase('.', '/shell/gas-v3-topology-json-preview')).toBe('/shell/')
    expect(resolveRouterHistoryBase('.', '/shell/step-up-substation-topology-json-preview')).toBe('/shell/')
    expect(resolveRouterHistoryBase('.', '/shell/step-down-substation-topology-json-preview')).toBe('/shell/')
    expect(resolveRouterHistoryBase('.', '/shell/converter-station-topology-json-preview')).toBe('/shell/')
    expect(resolveRouterHistoryBase('.', '/shell/switching-station-topology-json-preview')).toBe('/shell/')
    expect(resolveRouterHistoryBase('.', '/shell/dispatch-topology-json-preview')).toBe('/shell/')
  })

  it('绝对构建前缀不应被发布包规则改写', () => {
    expect(resolveRouterHistoryBase('/power/', '/shell/embed')).toBe('/power/')
  })

  it.each([
    ['/wind-process-detail-topology-preview', '/'],
    ['/shell/wind-process-detail-topology-preview', '/shell/'],
    ['/platform/shell/wind-process-detail-topology-preview', '/platform/shell/'],
  ])('风电第三层预览 %s 应解析到部署目录 %s，避免误跳嵌入壳', (pathname, expectedBase) => {
    // 同时覆盖根部署和合作方嵌入目录，防止只在开发服务中能打开、相对构建后却错误重定向。
    expect(resolveRouterHistoryBase('./', pathname)).toBe(expectedBase)
  })
})

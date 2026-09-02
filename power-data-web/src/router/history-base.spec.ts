import { describe, expect, it } from 'vitest'
import { resolveRouterHistoryBase } from './history-base'

describe('嵌入壳网页历史基础路径', () => {
  it('相对构建从 shell/embed 打开时应保留 shell 前缀', () => {
    expect(resolveRouterHistoryBase('./', '/shell/embed')).toBe('/shell/')
  })

  it('独立拓扑预览同样应保留 shell 前缀', () => {
    expect(resolveRouterHistoryBase('.', '/shell/gas-topology-json-preview')).toBe('/shell/')
  })

  it('绝对构建前缀不应被发布包规则改写', () => {
    expect(resolveRouterHistoryBase('/power/', '/shell/embed')).toBe('/power/')
  })
})

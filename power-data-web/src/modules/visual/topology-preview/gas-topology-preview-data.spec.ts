import { describe, expect, it } from 'vitest'
import { getGasTopologyPreviewPublicAssetUrl } from './gas-topology-preview-data'

describe('燃气拓扑公开资源地址', () => {
  it('相对基础路径应始终以嵌入壳入口脚本为锚点', () => {
    const result = getGasTopologyPreviewPublicAssetUrl(
      'topology.json',
      './',
      'http://127.0.0.1:5578/shell/assets/index-entry.js',
    )

    // `/embed` 是前端路由而不是静态资源目录；该断言防止发布包再次请求根目录的 `/topology`。
    expect(result).toBe('http://127.0.0.1:5578/shell/topology/gas-json-preview/topology.json')
  })

  it('绝对基础路径应保留部署前缀', () => {
    expect(getGasTopologyPreviewPublicAssetUrl('icons/normal/gas_turbine.webp', '/power/', undefined))
      .toBe('/power/topology/gas-json-preview/icons/normal/gas_turbine.webp')
  })
})

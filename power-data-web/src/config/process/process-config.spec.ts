import { describe, expect, it } from 'vitest'
import { validateStableIdentifier } from '@/config/process/identifiers'
import { localProcessConfigDataset, localProcessConfigLoader } from '@/config/process/local-process-config'

describe('工艺配置中心', () => {
  it('发布九个工艺域和三十四个页面', () => {
    // 页面数量直接对应任务清单，防止后续增删配置时遗失导航入口。
    expect(localProcessConfigDataset.domains).toHaveLength(9)
    expect(localProcessConfigDataset.pages).toHaveLength(34)
  })

  it('在网页图形运行时未正式登记时将燃气页安全降级为静态预览', () => {
    // 本地运行时登记表为空，加载器必须保留二维配置并禁止启动未经审核的 WebGL。
    const result = localProcessConfigLoader.load('gas-overview')

    expect(result.status).toBe('degraded')
    expect(result.effectiveRuntimeMode).toBe('static-preview')
    expect(result.bundle?.guide.steps).toHaveLength(8)
    expect(result.issues.some((issue) => issue.code === 'runtime.registration-missing')).toBe(true)
  })

  it('按企业、生产隔离区、厂级、单元和现场五层发布燃气控制网络', () => {
    // 图一确认的是控制网络边界而非 Unity 场景层级；状态契约尚未接入时不得批量伪造正常状态。
    const result = localProcessConfigLoader.load('gas-overview')
    const topology = result.bundle?.topology

    expect(topology?.layers?.map((layer) => layer.layerId)).toEqual([
      'enterprise-it',
      'production-dmz',
      'plant-control',
      'unit-control',
      'field-device',
    ])
    expect(topology?.nodes).toHaveLength(24)
    expect(topology?.nodes.every((node) => node.deviceStatus === 'offline')).toBe(true)
    expect(topology?.edges.some((edge) => edge.fromNodeId === 'enterprise-firewall' && edge.toNodeId === 'dmz-industrial-firewall')).toBe(true)
    expect(topology?.edges.some((edge) => edge.fromNodeId === 'gas-network' && edge.toNodeId === 'inlet-duct')).toBe(true)
  })

  it('将已配置为空模式的页面作为可诊断空场景正常加载', () => {
    // 空模式页面拥有完整的原子配置，不会被误判为缺失配置或尝试加载外部资源。
    const result = localProcessConfigLoader.load('coal-overview')

    expect(result.status).toBe('ready')
    expect(result.effectiveRuntimeMode).toBe('empty')
    expect(result.bundle?.topology.nodes).toHaveLength(0)
  })

  it('拒绝中文标题、层级路径和资源文件名作为稳定接口标识', () => {
    expect(validateStableIdentifier('燃气轮机1')).not.toHaveLength(0)
    expect(validateStableIdentifier('场景/燃气轮机1')).not.toHaveLength(0)
    expect(validateStableIdentifier('gas-turbine.fbx')).not.toHaveLength(0)
  })
})

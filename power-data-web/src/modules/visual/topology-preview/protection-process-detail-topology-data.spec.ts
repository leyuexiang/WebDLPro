import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProcessDetailTopologyDataContext, PROCESS_DETAIL_TOPOLOGY_DATA_CONTEXTS } from '../topology/process-detail-topology-contexts'
import { toProcessNodeId } from '@/config/process/identifiers'

vi.mock('@meta2d/core', () => ({ LockState: { DisableEdit: 1, Disable: 2 } }))

describe('保护关键环节公共拓扑数据', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('十一个合作方绑定使用唯一上下文，并且只复用三份源文件', () => {
    const file = resolve(process.cwd(), 'public/topology/process-detail/protection/topology-bindings.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
      topologies: readonly { sceneId: string; processDetailId: string; topologyDataContextId: string; topologyPath: string }[]
    }
    expect(manifest.topologies).toHaveLength(11)
    expect(new Set(manifest.topologies.map((item) => item.processDetailId)).size).toBe(11)
    expect(new Set(manifest.topologies.map((item) => item.topologyDataContextId)).size).toBe(11)
    expect(new Set(manifest.topologies.map((item) => item.topologyPath)).size).toBe(3)
    expect(new Set(manifest.topologies.map((item) => item.sceneId)).size).toBe(4)
  })

  it('第三层设备图片使用当前部署前缀下的公共资源地址', async () => {
    const { clearProtectionProcessDetailTopologyCacheForTests, loadProtectionProcessDetailTopologyData } = await import('./protection-process-detail-topology-data')
    const context = getProcessDetailTopologyDataContext('process-detail.step-up-substation.transformer-protection')!
    const source = JSON.parse(readFileSync(resolve(process.cwd(), 'public/topology', context.topologyPath), 'utf8'))
    clearProtectionProcessDetailTopologyCacheForTests()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => source }))
    const data = await loadProtectionProcessDetailTopologyData(context)
    const images = data.pens.filter((pen) => pen.image).map((pen) => pen.image)
    expect(images.length).toBeGreaterThan(0)
    // 公共图片别名必须像第二层一样生效，避免源文件路径绕开部署地址生成器。
    expect(images).toContain('/topology/shared/background/flow-light-3.webp')
    expect(images.every((url) => url?.includes('/topology/shared/'))).toBe(true)
  })

  it('十一份保护上下文均把断路器交给合作方且不声明 Unity 映射', () => {
    const contexts = PROCESS_DETAIL_TOPOLOGY_DATA_CONTEXTS.filter((context) => context.contextId.includes('substation') || context.contextId.includes('converter-station') || context.contextId.includes('switching-station'))
    expect(contexts).toHaveLength(11)
    for (const context of contexts) {
      const breakerBindings = context.bindings.filter((binding) => binding.nodeId.includes('-protection-breaker'))
      expect(breakerBindings).toHaveLength(1)
      expect(breakerBindings[0]?.sceneNodeId).toBeUndefined()
    }
  })

  it('断路器四态只引用公共 WebP 资源', async () => {
    const { getProtectionProcessDetailStatusImageUrl } = await import('./protection-process-detail-topology-data')
    for (const status of ['normal', 'alarm', 'fault', 'offline'] as const) {
      const image = getProtectionProcessDetailStatusImageUrl(toProcessNodeId('asset.step-up-line-protection-breaker'), status)
      expect(image).toContain(`/topology/shared/icons/${status}/`)
      expect(image).toMatch(/\.webp$/)
    }
  })

  it('第二层四类保护控制节点四态均可切换公共 WebP 且不依赖 Unity 映射', async () => {
    const { getProtectionProcessDetailStatusImageUrl } = await import('./protection-process-detail-topology-data')
    const controlNodeIds = [
      'system.step-up-transformer-protection',
      'system.step-up-busbar-protection',
      'system.step-up-line-protection',
      'system.step-up-capacitor-protection',
      'system.step-down-transformer-protection',
      'system.step-down-busbar-protection',
      'system.step-down-line-protection',
      'system.step-down-capacitor-protection',
      'system.converter-transformer-protection',
      'system.converter-busbar-protection',
      'system.converter-line-protection',
      'system.converter-capacitor-protection',
      'system.switching-busbar-protection',
      'system.switching-line-protection',
      'system.switching-capacitor-protection',
    ]
    for (const nodeId of controlNodeIds) {
      const image = getProtectionProcessDetailStatusImageUrl(toProcessNodeId(nodeId), 'fault')
      expect(image).toContain('/topology/shared/icons/fault/')
      expect(image).toMatch(/\.webp$/)
    }
  })
})

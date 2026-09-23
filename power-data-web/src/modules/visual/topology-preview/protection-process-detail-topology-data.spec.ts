import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProcessDetailTopologyDataContext } from '../topology/process-detail-topology-contexts'

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
    expect(images).toContain('/topology/shared/background/flow-light-3.png')
    expect(images.every((url) => url?.includes('/topology/shared/'))).toBe(true)
  })
})

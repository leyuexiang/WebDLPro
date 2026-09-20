import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('保护关键环节公共拓扑数据', () => {
  it('九个合作方绑定使用唯一上下文，并且只复用三份源文件', () => {
    const file = resolve(process.cwd(), 'public/topology/process-detail/protection/topology-bindings.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
      topologies: readonly { sceneId: string; processDetailId: string; topologyDataContextId: string; topologyPath: string }[]
    }
    expect(manifest.topologies).toHaveLength(9)
    expect(new Set(manifest.topologies.map((item) => item.processDetailId)).size).toBe(9)
    expect(new Set(manifest.topologies.map((item) => item.topologyDataContextId)).size).toBe(9)
    expect(new Set(manifest.topologies.map((item) => item.topologyPath)).size).toBe(3)
    expect(new Set(manifest.topologies.map((item) => item.sceneId)).size).toBe(3)
  })
})

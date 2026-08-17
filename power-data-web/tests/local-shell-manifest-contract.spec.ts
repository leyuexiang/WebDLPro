import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { RemoteSceneTopologyManifestLoader } from '@/config/scene-topology/remote-manifest-loader'

/** 使用独立端口启动本地清单服务，避免合同测试占用人工浏览器夹具的5510端口。 */
const testPort = 5512
const testOrigin = `http://127.0.0.1:${testPort}`
let serverProcess: ChildProcessWithoutNullStreams | undefined

async function waitForServer(process: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 5_000
  let output = ''
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now())
    const result = await Promise.race([
      once(process.stdout, 'data').then(([chunk]) => ({ type: 'data' as const, chunk: String(chunk) })),
      once(process, 'exit').then(([code]) => ({ type: 'exit' as const, code })),
      new Promise<{ type: 'timeout' }>((resolve) => setTimeout(() => resolve({ type: 'timeout' }), remaining)),
    ])
    if (result.type === 'data') {
      output += result.chunk
      if (output.includes('测试宿主已启动')) return
    } else if (result.type === 'exit') {
      throw new Error(`本地清单服务提前退出：${String(result.code)}`)
    } else {
      break
    }
  }
  throw new Error('本地清单服务未在限定时间内启动。')
}

describe('本地运行时清单接口合同夹具', () => {
  beforeAll(async () => {
    serverProcess = spawn(process.execPath, ['tests/local-shell-regression/server.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, LOCAL_SHELL_PORT: String(testPort) },
      stdio: 'pipe',
      windowsHide: true,
    })
    await waitForServer(serverProcess)
  })

  afterAll(() => {
    serverProcess?.kill('SIGTERM')
    serverProcess = undefined
  })

  it('返回合法空绑定完整清单，并保持禁止缓存响应策略', async () => {
    const response = await fetch(`${testOrigin}/manifest-empty.json`, { cache: 'no-store' })
    const manifest = await response.json() as Record<string, unknown>
    const topologies = manifest.topologies as Array<Record<string, unknown>>
    const nodes = topologies.flatMap((topology) => topology.nodes as Array<Record<string, unknown>>)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-cache')
    expect(Object.prototype.hasOwnProperty.call(manifest, 'platformBindingCount')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(manifest, 'deviceMappings')).toBe(false)
    expect(nodes.every((node) => 'nodeId' in node)).toBe(true)
    expect(nodes.some((node) => 'deviceId' in node)).toBe(false)
  })

  it('返回两类约定404且不把未知路径当作成功清单', async () => {
    const packageMissing = await fetch(`${testOrigin}/missing-package/manifest.json`)
    const fileMissing = await fetch(`${testOrigin}/missing-file/manifest.json`)

    expect(packageMissing.status).toBe(404)
    expect(await packageMissing.json()).toEqual({ error: 'package not found' })
    expect(fileMissing.status).toBe(404)
    expect(await fileMissing.json()).toEqual({ error: 'manifest file missing' })
  })

  it('由正式清单读取器贯通空绑定成功和两类404错误码', async () => {
    // 使用生产读取器而非手写响应解析，确保缓存策略、运行时清单校验和稳定错误码同一条链路生效。
    const loader = new RemoteSceneTopologyManifestLoader()
    const emptyBinding = await loader.load(`${testOrigin}/manifest-empty.json`)
    const missingPackage = await loader.load(`${testOrigin}/missing-package/manifest.json`)
    const missingFile = await loader.load(`${testOrigin}/missing-file/manifest.json`)

    expect(emptyBinding.status).toBe('ready')
    expect(emptyBinding.status).toBe('ready')
    expect(missingPackage).toMatchObject({ status: 'failed', code: 'manifest.package-not-found' })
    expect(missingFile).toMatchObject({ status: 'failed', code: 'manifest.file-missing' })
  })
})

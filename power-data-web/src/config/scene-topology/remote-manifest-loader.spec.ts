import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCENE_IDS, toTopologyId, toUnityRuntimeKey, toUnitySceneKey } from '@/config/scene-topology/identifiers'
import { RemoteSceneTopologyManifestLoader, SCENE_TOPOLOGY_MANIFEST_TIMEOUT_MS, type SceneTopologyManifestFetch } from '@/config/scene-topology/remote-manifest-loader'
import type { SceneTopologyManifest } from '@/config/scene-topology/types'

/** 构造最小有效清单；仅验证请求边界，不作为正式九场景映射资料。 */
function createValidManifest(): SceneTopologyManifest {
  const version = 'test-manifest.1'
  const scenes = SCENE_IDS.map((sceneId) => {
    const topologyId = toTopologyId(`topology.${sceneId}.overview`)
    return {
      sceneId,
      title: `测试场景-${sceneId}`,
      unitySceneKey: toUnitySceneKey(`scene.${sceneId}`),
      defaultTopologyId: topologyId,
      topologyIds: [topologyId],
      supportedActionIds: [],
      sceneMappingVersion: version,
      resourceVersion: version,
      switchStrategy: 'unload-first' as const,
    }
  })

  return {
    manifestVersion: version,
    unityBuildId: 'test-build.1',
    unityRuntimeKey: toUnityRuntimeKey('test-runtime'),
    scenes,
    topologies: scenes.map((scene) => ({ topologyId: scene.defaultTopologyId, sceneId: scene.sceneId, title: `测试拓扑-${scene.sceneId}`, configVersion: version, nodes: [], edges: [] })),
    actions: [],
    deviceMappings: [],
    unitySceneMappings: scenes.map((scene) => ({ sceneId: scene.sceneId, mappingVersion: version, processSteps: [], sceneNodeIds: [], routeIds: [] })),
  }
}

describe('远程场景拓扑清单读取器', () => {
  afterEach(() => vi.useRealTimers())

  it('只接受经过原子校验的清单，并以省略凭据方式读取', async () => {
    const fetchManifest = vi.fn<SceneTopologyManifestFetch>().mockResolvedValue({ ok: true, json: async () => createValidManifest() })
    const result = await new RemoteSceneTopologyManifestLoader(fetchManifest).load('https://config.example.test/power/manifest.json')

    expect(result.status).toBe('ready')
    expect(fetchManifest).toHaveBeenCalledWith('https://config.example.test/power/manifest.json', expect.objectContaining({ credentials: 'omit', headers: { accept: 'application/json' } }))
  })

  it('将网络状态、非法载荷和校验失败收敛为固定失败码', async () => {
    const network = new RemoteSceneTopologyManifestLoader(async () => { throw new Error('原始网络错误不得进入界面') })
    const payload = new RemoteSceneTopologyManifestLoader(async () => ({ ok: true, json: async () => { throw new Error('原始正文错误不得进入界面') } }))
    const invalid = new RemoteSceneTopologyManifestLoader(async () => ({ ok: true, json: async () => ({ manifestVersion: 'incomplete' }) }))

    await expect(network.load('https://config.example.test/power/manifest.json')).resolves.toMatchObject({ status: 'failed', code: 'manifest.network' })
    await expect(payload.load('https://config.example.test/power/manifest.json')).resolves.toMatchObject({ status: 'failed', code: 'manifest.payload' })
    await expect(invalid.load('https://config.example.test/power/manifest.json')).resolves.toMatchObject({ status: 'failed', code: 'manifest.invalid' })
  })

  it('超时会中止请求且不会无限等待', async () => {
    vi.useFakeTimers()
    const fetchManifest: SceneTopologyManifestFetch = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('请求中止', 'AbortError')), { once: true })
    })
    const resultPromise = new RemoteSceneTopologyManifestLoader(fetchManifest).load('https://config.example.test/power/manifest.json')

    await vi.advanceTimersByTimeAsync(SCENE_TOPOLOGY_MANIFEST_TIMEOUT_MS)
    await expect(resultPromise).resolves.toMatchObject({ status: 'failed', code: 'manifest.timeout' })
  })

  it('页面卸载触发外部取消时不保留请求', async () => {
    const fetchManifest: SceneTopologyManifestFetch = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('请求中止', 'AbortError')), { once: true })
    })
    const pageLifecycle = new AbortController()
    const resultPromise = new RemoteSceneTopologyManifestLoader(fetchManifest).load('https://config.example.test/power/manifest.json', pageLifecycle.signal)

    pageLifecycle.abort()

    await expect(resultPromise).resolves.toMatchObject({ status: 'failed', code: 'manifest.aborted' })
  })
})

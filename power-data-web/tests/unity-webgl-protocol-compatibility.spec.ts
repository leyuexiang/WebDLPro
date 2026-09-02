import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureUnityBuildSupportsSceneActivation } from '../scripts/build-gas-power-smoke-release.mjs'

/**
 * 每个测试创建独立的系统临时 Unity 目录，只写入构建阶段生成的版本化协议元数据。
 * 夹具不读取工作区正式构建，也不伪造业务场景内容，可在未安装 Unity 的持续集成环境稳定回归。
 */
async function createTemporaryUnityBuild(metadata?: unknown): Promise<string> {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), 'webdlpro-unity-protocol-'))
  if (metadata !== undefined) {
    await writeFile(
      path.join(rootDirectory, 'webgl-protocol-capabilities.json'),
      JSON.stringify(metadata),
      'utf8',
    )
  }

  return rootDirectory
}

/**
 * 测试临时目录名称带唯一前缀，清理时只删除本测试刚创建的精确目录，绝不枚举或触碰用户的发布目录。
 */
const temporaryDirectories: string[] = []

/**
 * 返回当前构建器应生成的最小完整协议声明；每个测试只覆盖自己要破坏的字段，避免夹具随契约升级后静默漏项。
 */
function createValidMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 9,
    unityReleaseId: 'unity-release-test',
    channel: 'power3d-unity',
    protocolVersion: 2,
    commandCapabilities: ['init', 'resize', 'switchScene', 'enterProcessStep', 'moveCameraToPose', 'enterProcessDetail', 'prepareProcessDetail', 'commitProcessDetail', 'abortProcessDetail', 'exitProcessDetail', 'setProcessDetailPlayback', 'resetScene', 'focusNode', 'clearSelection', 'setNodeVisualState', 'clearNodeVisualState', 'setRouteFlow', 'setNodeVisibility', 'dispose'],
    eventCapabilities: ['ready', 'ack', 'commandResult', 'sceneLoadProgress', 'sceneChanged', 'objectSelected', 'selectionCleared', 'disposed'],
    sceneChangedSchemaVersion: 2,
    sceneChangedRequiredFields: ['requestId', 'sceneId', 'transitionId', 'sceneActivationId', 'success'],
    switchSceneRequiredFields: ['sceneId', 'transitionId', 'sceneMappingVersion', 'forceReload'],
    switchSceneRecoverySchemaVersion: 1,
    switchSceneRecoveryRequiredFields: ['requestId', 'success', 'sceneActivationId'],
    setNodeVisualStateSchemaVersion: 3,
    setNodeVisualStateRequiredFields: ['sceneNodeId', 'visualState', 'snapshotSequence', 'statusUpdatedAt', 'sourceRevision'],
    clearNodeVisualStateSchemaVersion: 1,
    clearNodeVisualStateRequiredFields: ['sceneNodeId', 'snapshotSequence'],
    // Unity 对准备、提交、取消准备、兼容进入和退出第三层共用一个结构版本；
    // 夹具与实际 WebGL 元数据同形，确保门禁真实覆盖两阶段事务。
    processDetailCommandSchemaVersion: 2,
    enterProcessDetailRequiredFields: ['sceneId', 'processId', 'stepId', 'processDetailId', 'transitionId'],
    prepareProcessDetailRequiredFields: ['sceneId', 'processId', 'stepId', 'processDetailId', 'transitionId'],
    commitProcessDetailRequiredFields: ['sceneId', 'processDetailId', 'transitionId'],
    abortProcessDetailRequiredFields: ['sceneId', 'processDetailId', 'transitionId'],
    exitProcessDetailRequiredFields: ['sceneId', 'processDetailId', 'transitionId'],
    setProcessDetailPlaybackRequiredFields: ['sceneId', 'processDetailId', 'playing'],
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Unity 网页图形协议兼容性门禁', () => {
  it('版本化元数据完整声明场景完成、失败恢复、强制重载和状态因果契约时允许发布', async () => {
    const directory = await createTemporaryUnityBuild(createValidMetadata())
    temporaryDirectories.push(directory)

    await expect(ensureUnityBuildSupportsSceneActivation(directory, 'unity-release-test')).resolves.toBeUndefined()
  })

  it('仅在压缩资源出现字段字符串但缺少版本化元数据时仍明确阻断发布', async () => {
    const directory = await createTemporaryUnityBuild()
    temporaryDirectories.push(directory)
    await writeFile(path.join(directory, 'unity.data.br'), 'sceneActivationId')

    await expect(ensureUnityBuildSupportsSceneActivation(directory, 'unity-release-test')).rejects.toThrow('协议元数据')
  })

  it('元数据缺少强制同场景重载字段时明确阻断发布', async () => {
    const directory = await createTemporaryUnityBuild(createValidMetadata({
      switchSceneRequiredFields: ['sceneId', 'transitionId', 'sceneMappingVersion'],
    }))
    temporaryDirectories.push(directory)

    await expect(ensureUnityBuildSupportsSceneActivation(directory, 'unity-release-test')).rejects.toThrow('forceReload')
  })

  it('元数据缺少自动恢复后的物理激活标识声明时明确阻断发布', async () => {
    const directory = await createTemporaryUnityBuild(createValidMetadata({
      switchSceneRecoveryRequiredFields: ['requestId', 'success'],
    }))
    temporaryDirectories.push(directory)

    await expect(ensureUnityBuildSupportsSceneActivation(directory, 'unity-release-test')).rejects.toThrow('sceneActivationId')
  })

  it('元数据缺少壳内快照序号字段时明确阻断发布', async () => {
    const directory = await createTemporaryUnityBuild(createValidMetadata({
      setNodeVisualStateRequiredFields: ['sceneNodeId', 'visualState', 'statusUpdatedAt'],
    }))
    temporaryDirectories.push(directory)

    await expect(ensureUnityBuildSupportsSceneActivation(directory, 'unity-release-test')).rejects.toThrow('snapshotSequence')
  })

  it('元数据缺少三维动态状态清除能力或快照序号时明确阻断发布', async () => {
    const missingCapabilityDirectory = await createTemporaryUnityBuild(createValidMetadata({
      commandCapabilities: ['init', 'resize', 'switchScene', 'enterProcessStep', 'moveCameraToPose', 'enterProcessDetail', 'prepareProcessDetail', 'commitProcessDetail', 'abortProcessDetail', 'exitProcessDetail', 'setProcessDetailPlayback', 'resetScene', 'focusNode', 'clearSelection', 'setNodeVisualState', 'setRouteFlow', 'setNodeVisibility', 'dispose'],
    }))
    const missingFieldDirectory = await createTemporaryUnityBuild(createValidMetadata({
      clearNodeVisualStateRequiredFields: ['sceneNodeId'],
    }))
    temporaryDirectories.push(missingCapabilityDirectory, missingFieldDirectory)

    await expect(ensureUnityBuildSupportsSceneActivation(missingCapabilityDirectory, 'unity-release-test')).rejects.toThrow('clearNodeVisualState')
    await expect(ensureUnityBuildSupportsSceneActivation(missingFieldDirectory, 'unity-release-test')).rejects.toThrow('snapshotSequence')
  })

  it('元数据缺少命名镜头定位能力时明确阻断发布', async () => {
    const directory = await createTemporaryUnityBuild(createValidMetadata({
      commandCapabilities: ['init', 'resize', 'switchScene', 'enterProcessStep', 'enterProcessDetail', 'prepareProcessDetail', 'commitProcessDetail', 'abortProcessDetail', 'exitProcessDetail', 'setProcessDetailPlayback', 'resetScene', 'focusNode', 'clearSelection', 'setNodeVisualState', 'clearNodeVisualState', 'setRouteFlow', 'setNodeVisibility', 'dispose'],
    }))
    temporaryDirectories.push(directory)

    await expect(ensureUnityBuildSupportsSceneActivation(directory, 'unity-release-test')).rejects.toThrow('moveCameraToPose')
  })

  it('元数据缺少清除三维交互描边能力时明确阻断发布', async () => {
    const directory = await createTemporaryUnityBuild(createValidMetadata({
      commandCapabilities: ['init', 'resize', 'switchScene', 'enterProcessStep', 'moveCameraToPose', 'enterProcessDetail', 'prepareProcessDetail', 'commitProcessDetail', 'abortProcessDetail', 'exitProcessDetail', 'setProcessDetailPlayback', 'resetScene', 'focusNode', 'setNodeVisualState', 'clearNodeVisualState', 'setRouteFlow', 'setNodeVisibility', 'dispose'],
    }))
    temporaryDirectories.push(directory)

    await expect(ensureUnityBuildSupportsSceneActivation(directory, 'unity-release-test')).rejects.toThrow('clearSelection')
  })

  it('元数据缺少第三层两阶段命令时明确阻断发布', async () => {
    const missingCommandDirectory = await createTemporaryUnityBuild(createValidMetadata({
      commandCapabilities: ['init', 'resize', 'switchScene', 'enterProcessStep', 'moveCameraToPose', 'enterProcessDetail', 'commitProcessDetail', 'abortProcessDetail', 'exitProcessDetail', 'setProcessDetailPlayback', 'resetScene', 'focusNode', 'clearSelection', 'setNodeVisualState', 'clearNodeVisualState', 'setRouteFlow', 'setNodeVisibility', 'dispose'],
    }))
    const missingCommitCommandDirectory = await createTemporaryUnityBuild(createValidMetadata({
      commandCapabilities: ['init', 'resize', 'switchScene', 'enterProcessStep', 'moveCameraToPose', 'enterProcessDetail', 'prepareProcessDetail', 'abortProcessDetail', 'exitProcessDetail', 'setProcessDetailPlayback', 'resetScene', 'focusNode', 'clearSelection', 'setNodeVisualState', 'clearNodeVisualState', 'setRouteFlow', 'setNodeVisibility', 'dispose'],
    }))
    const missingAbortCommandDirectory = await createTemporaryUnityBuild(createValidMetadata({
      commandCapabilities: ['init', 'resize', 'switchScene', 'enterProcessStep', 'moveCameraToPose', 'enterProcessDetail', 'prepareProcessDetail', 'commitProcessDetail', 'exitProcessDetail', 'setProcessDetailPlayback', 'resetScene', 'focusNode', 'clearSelection', 'setNodeVisualState', 'clearNodeVisualState', 'setRouteFlow', 'setNodeVisibility', 'dispose'],
    }))
    temporaryDirectories.push(missingCommandDirectory, missingCommitCommandDirectory, missingAbortCommandDirectory)

    await expect(ensureUnityBuildSupportsSceneActivation(missingCommandDirectory, 'unity-release-test')).rejects.toThrow('prepareProcessDetail')
    await expect(ensureUnityBuildSupportsSceneActivation(missingCommitCommandDirectory, 'unity-release-test')).rejects.toThrow('commitProcessDetail')
    await expect(ensureUnityBuildSupportsSceneActivation(missingAbortCommandDirectory, 'unity-release-test')).rejects.toThrow('abortProcessDetail')
  })

  it('元数据缺少两阶段事务稳定编号或代际字段时明确阻断发布', async () => {
    const missingPrepareTransitionDirectory = await createTemporaryUnityBuild(createValidMetadata({
      prepareProcessDetailRequiredFields: ['sceneId', 'processId', 'stepId', 'processDetailId'],
    }))
    const missingCommitTransitionDirectory = await createTemporaryUnityBuild(createValidMetadata({
      commitProcessDetailRequiredFields: ['sceneId', 'processDetailId'],
    }))
    const missingAbortDetailDirectory = await createTemporaryUnityBuild(createValidMetadata({
      abortProcessDetailRequiredFields: ['sceneId', 'transitionId'],
    }))
    temporaryDirectories.push(missingPrepareTransitionDirectory, missingCommitTransitionDirectory, missingAbortDetailDirectory)

    await expect(ensureUnityBuildSupportsSceneActivation(missingPrepareTransitionDirectory, 'unity-release-test')).rejects.toThrow('transitionId')
    await expect(ensureUnityBuildSupportsSceneActivation(missingCommitTransitionDirectory, 'unity-release-test')).rejects.toThrow('transitionId')
    await expect(ensureUnityBuildSupportsSceneActivation(missingAbortDetailDirectory, 'unity-release-test')).rejects.toThrow('processDetailId')
  })

  it('元数据缺少第三层原子事务结构版本时明确阻断发布', async () => {
    const directory = await createTemporaryUnityBuild(createValidMetadata({
      processDetailCommandSchemaVersion: 0,
    }))
    temporaryDirectories.push(directory)

    await expect(ensureUnityBuildSupportsSceneActivation(directory, 'unity-release-test')).rejects.toThrow('结构版本')
  })

  it('第一版 Unity 元数据不能连接第二版关键环节包', async () => {
    const directory = await createTemporaryUnityBuild(createValidMetadata({ protocolVersion: 1 }))
    temporaryDirectories.push(directory)

    await expect(ensureUnityBuildSupportsSceneActivation(directory, 'unity-release-test')).rejects.toThrow('协议版本')
  })

  it('元数据缺少三维对象选中或选择清除事件时明确阻断发布', async () => {
    const missingObjectSelectedDirectory = await createTemporaryUnityBuild(createValidMetadata({
      eventCapabilities: ['ready', 'ack', 'commandResult', 'sceneLoadProgress', 'sceneChanged', 'selectionCleared', 'disposed'],
    }))
    const missingSelectionClearedDirectory = await createTemporaryUnityBuild(createValidMetadata({
      eventCapabilities: ['ready', 'ack', 'commandResult', 'sceneLoadProgress', 'sceneChanged', 'objectSelected', 'disposed'],
    }))
    temporaryDirectories.push(missingObjectSelectedDirectory, missingSelectionClearedDirectory)

    await expect(ensureUnityBuildSupportsSceneActivation(missingObjectSelectedDirectory, 'unity-release-test')).rejects.toThrow('objectSelected')
    await expect(ensureUnityBuildSupportsSceneActivation(missingSelectionClearedDirectory, 'unity-release-test')).rejects.toThrow('selectionCleared')
  })

  it('元数据仍使用旧结构版本时明确阻断发布', async () => {
    const directory = await createTemporaryUnityBuild(createValidMetadata({ schemaVersion: 2 }))
    temporaryDirectories.push(directory)

    await expect(ensureUnityBuildSupportsSceneActivation(directory, 'unity-release-test')).rejects.toThrow('结构版本')
  })

  it('元数据超过安全上限时在读取内容前明确阻断发布', async () => {
    const directory = await createTemporaryUnityBuild()
    temporaryDirectories.push(directory)
    await writeFile(path.join(directory, 'webgl-protocol-capabilities.json'), 'x'.repeat(16 * 1024 + 1), 'utf8')

    await expect(ensureUnityBuildSupportsSceneActivation(directory, 'unity-release-test')).rejects.toThrow('安全上限')
  })

  it('元数据发布标识与待复制 Unity 版本不一致时明确阻断发布', async () => {
    const directory = await createTemporaryUnityBuild(createValidMetadata({ unityReleaseId: 'different-release' }))
    temporaryDirectories.push(directory)

    await expect(ensureUnityBuildSupportsSceneActivation(directory, 'unity-release-test')).rejects.toThrow('发布标识')
  })
})

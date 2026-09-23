import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

/**
 * 从技能目录向上寻找仓库根目录，避免脚本依赖调用者当前所在目录。
 * 只检查联合清单生成器是否存在，不扫描仓库文件，确保检查开销稳定。
 */
function findRepositoryRoot(startDirectory) {
  let currentDirectory = path.resolve(startDirectory)
  const fileSystemRoot = path.parse(currentDirectory).root

  while (true) {
    const manifestBuilderPath = path.join(
      currentDirectory,
      'power-data-web',
      'scripts',
      'build-gas-power-smoke-release.mjs',
    )
    if (existsSync(manifestBuilderPath)) return currentDirectory
    if (currentDirectory === fileSystemRoot) break
    currentDirectory = path.dirname(currentDirectory)
  }

  throw new Error('未找到 power-data-web/scripts/build-gas-power-smoke-release.mjs，请确认技能位于 WebDLPro 仓库内。')
}

/**
 * 去重时保留清单原始顺序，使输出既稳定又与实际发布顺序一致。
 */
function unique(values) {
  return [...new Set(values)]
}

/**
 * 生成只读契约摘要。所有字段都来自当前源清单，不维护第二份易漂移的固定数量或标识列表。
 */
async function inspectReleaseContract() {
  const repositoryRoot = findRepositoryRoot(scriptDirectory)
  const webApplicationRoot = path.join(repositoryRoot, 'power-data-web')
  const manifestBuilderPath = path.join(
    webApplicationRoot,
    'scripts',
    'build-gas-power-smoke-release.mjs',
  )

  /*
   * 现有清单生成器在模块加载阶段按进程工作目录定位 tests/fixtures 下的标准夹具。
   * 因此必须先切到前端工程目录再动态导入，并在成功或失败后都恢复原目录。
   */
  const originalWorkingDirectory = process.cwd()
  let manifest
  try {
    process.chdir(webApplicationRoot)
    const { createConfiguredPowerScenesManifest } = await import(pathToFileURL(manifestBuilderPath).href)
    if (typeof createConfiguredPowerScenesManifest !== 'function') {
      throw new TypeError('联合清单生成器未导出 createConfiguredPowerScenesManifest 函数。')
    }
    manifest = await createConfiguredPowerScenesManifest('scene-release-gate-inspection', 'gas-power')
  } finally {
    process.chdir(originalWorkingDirectory)
  }
  const actionById = new Map(manifest.actions.map((action) => [action.actionId, action]))
  const processDetailSceneIds = new Set(manifest.processDetails.map((detail) => detail.sceneId))

  const actions = manifest.actions.map((action) => ({
    actionId: action.actionId,
    targetSceneId: action.targetSceneId,
    targetViewMode: action.targetViewMode,
    processDetailId: action.processDetailId ?? null,
    unityActionType: action.unityAction?.type ?? null,
  }))
  const scenes = manifest.scenes.map((scene) => ({
    sceneId: scene.sceneId,
    defaultTopologyId: scene.defaultTopologyId ?? null,
    supportedActionIds: [...scene.supportedActionIds],
  }))
  const processDetails = manifest.processDetails.map((detail) => ({
    sceneId: detail.sceneId,
    processDetailId: detail.processDetailId,
    resourceId: detail.resourceId,
    cameraPoseId: detail.cameraPoseId,
    stateNodeId: detail.stateNodeId,
    topologyDataContextId: detail.topologyDataContextId,
  }))
  const unitySceneMappings = manifest.unitySceneMappings.map((mapping) => ({
    sceneId: mapping.sceneId,
    /*
     * 导航占位场景允许省略空集合字段。摘要工具只做只读统计，必须把省略字段规范化为空数组，
     * 不能因合法的精简清单中没有节点、步骤或路线而在文档审计前提前崩溃。
     */
    sceneNodeIds: [...(mapping.sceneNodeIds ?? [])],
    processSteps: (mapping.processSteps ?? []).map((step) => ({ ...step })),
    routeIds: [...(mapping.routeIds ?? [])],
  }))
  const publishedScenes = scenes.filter((scene) => scene.supportedActionIds.length > 0)
  const navigationOnlySceneIds = publishedScenes
    .filter((scene) => {
      if (processDetailSceneIds.has(scene.sceneId)) return false
      return scene.supportedActionIds.every((actionId) => actionById.get(actionId)?.unityAction?.type === 'none')
    })
    .map((scene) => scene.sceneId)

  return {
    manifestVersion: manifest.manifestVersion,
    actionCount: actions.length,
    actions,
    sceneCount: scenes.length,
    publishedSceneCount: publishedScenes.length,
    scenes,
    processDetailCount: processDetails.length,
    processDetails,
    processDetailSceneIds: unique(processDetails.map((detail) => detail.sceneId)),
    navigationOnlySceneIds,
    unitySceneMappings,
  }
}

try {
  const summary = await inspectReleaseContract()
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`场景发布契约检查失败：${message}\n`)
  process.exitCode = 1
}

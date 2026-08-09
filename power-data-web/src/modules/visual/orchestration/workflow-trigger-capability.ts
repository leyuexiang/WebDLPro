import type { SceneTopologyManifest } from '@/config/scene-topology/types'

/**
 * 判断当前原子清单是否真正安装了流程触发能力。
 * 能力声明必须以清单内至少一个动作定义为前提；空数组时不创建流程路由，也不向父页面发布
 * `workflow.trigger`（流程触发）能力，避免父页面得到“已支持但必然失败”的错误协商结果。
 */
export function shouldInstallWorkflowTrigger(
  manifest: Pick<SceneTopologyManifest, 'actions'>,
): boolean {
  return manifest.actions.length > 0
}

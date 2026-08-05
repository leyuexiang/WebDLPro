import type { UnityActionDefinition } from '@/config/scene-topology/types'
import type { ViewOpenUnityPort, ViewOpenUnityPortResult } from '@/modules/visual/orchestration/view-open-transaction-handler'
import type { VisualizationRuntimeHostController } from '@/modules/visual/runtime/visualization-runtime-host'

/**
 * 将 `view.open` 编排动作转换为内层已声明的 Unity 白名单命令。
 * 该适配器只依赖运行时宿主门面：不读取 iframe、消息事件或 Unity 对象，也不接受 Unity 方法名。
 */
export class VisualizationRuntimeViewOpenPort implements ViewOpenUnityPort {
  public constructor(private readonly runtime: VisualizationRuntimeHostController) {}

  /** 场景切换始终携带清单映射版本，连接器会继续校验最终 sceneChanged 的场景、事务和原请求。 */
  public async switchScene(sceneId: Parameters<ViewOpenUnityPort['switchScene']>[0], sceneMappingVersion: string, transitionId: Parameters<ViewOpenUnityPort['switchScene']>[2]): Promise<ViewOpenUnityPortResult> {
    const result = await this.runtime.sendCommandAndWait('switchScene', { sceneId, sceneMappingVersion, transitionId })
    return result.success ? { success: true } : { success: false, errorCode: 'scene.switch.failed' }
  }

  /** 将已通过原子清单校验的动作转换为固定内层消息载荷；未知动作类型在编译期不能进入此分支。 */
  public async executeAction(
    action: UnityActionDefinition,
    _actionId: NonNullable<Parameters<ViewOpenUnityPort['executeAction']>[1]>,
    _transitionId: Parameters<ViewOpenUnityPort['executeAction']>[2],
  ): Promise<ViewOpenUnityPortResult> {
    switch (action.type) {
      case 'none':
        return { success: true }
      case 'enterProcessStep':
        return this.execute('enterProcessStep', {
          processId: action.processId,
          stepId: action.stepId,
          ...(action.defaultUnitId ? { unitId: action.defaultUnitId } : {}),
          isolate: action.isolate,
        })
      case 'focusNode':
        return this.execute('focusNode', { sceneNodeId: action.sceneNodeId, isolate: action.isolate })
      case 'resetScene':
        return this.execute('resetScene', {})
      case 'setRouteFlow':
        return this.execute('setRouteFlow', { routeId: action.routeId, enabled: action.enabled })
    }
  }

  /** 等待宿主结算已验证的原请求回执；失败统一映射为动作执行失败，避免泄露内层原因。 */
  private async execute(command: 'enterProcessStep' | 'focusNode' | 'resetScene' | 'setRouteFlow', payload: unknown): Promise<ViewOpenUnityPortResult> {
    const result = await this.runtime.sendCommandAndWait(command, payload)
    return result.success ? { success: true } : { success: false, errorCode: 'action.execute.failed' }
  }
}

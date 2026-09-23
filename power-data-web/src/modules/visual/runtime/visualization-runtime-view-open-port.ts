import type { UnityActionDefinition } from '@/config/scene-topology/types'
import { toSceneActivationId, toSelectionId } from '@/config/scene-topology/identifiers'
import type { ViewOpenUnityPort, ViewOpenUnityPortResult } from '@/modules/visual/orchestration/view-open-transaction-handler'
import type { VisualizationRuntimeHostController } from '@/modules/visual/runtime/visualization-runtime-host'

/**
 * 将 `view.open` 编排动作转换为内层已声明的 Unity 白名单命令。
 * 该适配器只依赖运行时宿主门面：不读取 iframe、消息事件或 Unity 对象，也不接受 Unity 方法名。
 */
export class VisualizationRuntimeViewOpenPort implements ViewOpenUnityPort {
  public constructor(private readonly runtime: VisualizationRuntimeHostController) {}

  /**
   * 场景切换始终携带清单映射版本，连接器会继续校验最终 sceneChanged 的场景、事务和原请求。
   * 成功结果还必须有 Unity 新生成的物理激活标识；缺失时不把“已切换但实例不可证明”的状态交给编排层。
   */
  public async switchScene(
    sceneId: Parameters<ViewOpenUnityPort['switchScene']>[0],
    sceneMappingVersion: string,
    transitionId: Parameters<ViewOpenUnityPort['switchScene']>[2],
    forceReload = false,
  ): Promise<ViewOpenUnityPortResult> {
    // 布尔值始终显式下发，禁止新旧 Unity 构建对“字段缺失”采用不同缺省语义。
    const result = await this.runtime.sendCommandAndWait('switchScene', {
      sceneId,
      sceneMappingVersion,
      transitionId,
      forceReload,
    })
    if (!result.success) {
      // 失败结果中的实例标识不属于目标场景，而是 Unity 自动恢复出的旧稳定场景新实例；
      // 保留它让事务层更新因果上下文，避免后续真实对象事件因仍持有旧标识而被拒绝。
      return {
        success: false,
        errorCode: 'scene.switch.failed',
        ...(result.sceneActivationId ? { sceneActivationId: toSceneActivationId(result.sceneActivationId) } : {}),
      }
    }
    if (!result.sceneActivationId) return { success: false, errorCode: 'scene.switch.failed' }
    return { success: true, sceneActivationId: toSceneActivationId(result.sceneActivationId) }
  }

  /** 将已通过原子清单校验的动作转换为固定内层消息载荷；未知动作类型在编译期不能进入此分支。 */
  public async executeAction(
    action: UnityActionDefinition,
    _actionId: NonNullable<Parameters<ViewOpenUnityPort['executeAction']>[1]>,
    transitionId: Parameters<ViewOpenUnityPort['executeAction']>[2],
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
        // view.open（视图打开）事务本身已是唯一稳定值；显式转换为不同品牌的选择标识，
        // 让同一事务重试在 Unity 端保持幂等，同时禁止调用方把两类标识在类型层直接混用。
        return this.execute('focusNode', {
          sceneNodeId: action.sceneNodeId,
          selectionId: toSelectionId(String(transitionId)),
          isolate: action.isolate,
        })
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

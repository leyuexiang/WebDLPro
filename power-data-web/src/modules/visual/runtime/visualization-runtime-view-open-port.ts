import type { UnityActionDefinition } from '@/config/scene-topology/types'
import { toSceneActivationId, toSelectionId } from '@/config/scene-topology/identifiers'
import type { ViewOpenUnityPort, ViewOpenUnityPortResult } from '@/modules/visual/orchestration/view-open-transaction-handler'
import type { VisualizationRuntimeHostController } from '@/modules/visual/runtime/visualization-runtime-host'
import type { ProcessDetailUnityPort } from '@/modules/visual/orchestration/process-detail-transaction-handler'
import type { ProcessDetailDefinition } from '@/config/scene-topology/types'
import type { ProcessDetailId, SceneId, TransitionId } from '@/config/scene-topology/identifiers'

/**
 * 将 `view.open` 编排动作转换为内层已声明的 Unity 白名单命令。
 * 该适配器只依赖运行时宿主门面：不读取 iframe、消息事件或 Unity 对象，也不接受 Unity 方法名。
 */
export class VisualizationRuntimeViewOpenPort implements ViewOpenUnityPort, ProcessDetailUnityPort {
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
      case 'enterProcessDetail':
        // 第三层需要完整目录项并由独立事务控制拓扑暂停；旧 view.open 动作执行器不能降级拼装该命令。
        return { success: false, errorCode: 'action.execute.failed' }
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

  /**
   * 第一阶段只投影业务目录字段和事务标识；资源编号、相机参数和模型绑定继续由 Unity 本地目录核对。
   * Unity 成功回执仅证明隐藏候选已就绪，不能据此提前切换网页布局或提交稳定上下文。
   */
  public async prepareProcessDetail(detail: ProcessDetailDefinition, transitionId: TransitionId): Promise<{ success: boolean }> {
    return this.executeProcessDetailCommand('prepareProcessDetail', {
      sceneId: detail.sceneId,
      processId: detail.processId,
      stepId: detail.stepId,
      processDetailId: detail.processDetailId,
      transitionId,
    })
  }

  /** 第二阶段只引用同一事务候选；网页完成拓扑暂停及全屏布局后才允许调用。 */
  public async commitProcessDetail(
    sceneId: SceneId,
    processDetailId: ProcessDetailId,
    transitionId: TransitionId,
  ): Promise<{ success: boolean }> {
    return this.executeProcessDetailCommand('commitProcessDetail', { sceneId, processDetailId, transitionId })
  }

  /** 准备失败、超时或被新事务取代时定向释放候选，当前活动关键环节保持不变。 */
  public async abortProcessDetail(
    sceneId: SceneId,
    processDetailId: ProcessDetailId,
    transitionId: TransitionId,
  ): Promise<{ success: boolean }> {
    return this.executeProcessDetailCommand('abortProcessDetail', { sceneId, processDetailId, transitionId })
  }

  /**
   * 退出同时绑定活动场景、环节和原子事务，迟到命令不会按模型名误释放其他资源。
   * Unity 端应将该标识作为资源实例门禁，而不是把它当作资源名称或层级路径。
   */
  public async exitProcessDetail(
    sceneId: SceneId,
    processDetailId: ProcessDetailId,
    transitionId: TransitionId,
  ): Promise<{ success: boolean }> {
    return this.executeProcessDetailCommand('exitProcessDetail', { sceneId, processDetailId, transitionId })
  }

  /**
   * 直接设置当前关键环节播放状态。未来按钮或模型点击事件只需调用该方法，
   * 无需伪造设备故障或正常状态，也不会触发第三层进入、退出或拓扑事务。
   */
  public async setProcessDetailPlayback(
    sceneId: SceneId,
    processDetailId: ProcessDetailId,
    playing: boolean,
  ): Promise<{ success: boolean }> {
    return this.executeProcessDetailCommand('setProcessDetailPlayback', { sceneId, processDetailId, playing })
  }

  /** 等待宿主结算已验证的原请求回执；失败统一映射为动作执行失败，避免泄露内层原因。 */
  private async execute(command: 'enterProcessStep' | 'focusNode' | 'resetScene' | 'setRouteFlow', payload: unknown): Promise<ViewOpenUnityPortResult> {
    const result = await this.runtime.sendCommandAndWait(command, payload)
    return result.success ? { success: true } : { success: false, errorCode: 'action.execute.failed' }
  }

  /** 独立第三层命令不复用旧动作枚举，成功结果也不伪造新的物理场景实例。 */
  private async executeProcessDetailCommand(
    command: 'prepareProcessDetail' | 'commitProcessDetail' | 'abortProcessDetail' | 'exitProcessDetail' | 'setProcessDetailPlayback',
    payload: unknown,
  ): Promise<{ success: boolean }> {
    const result = await this.runtime.sendCommandAndWait(command, payload)
    return { success: result.success }
  }
}

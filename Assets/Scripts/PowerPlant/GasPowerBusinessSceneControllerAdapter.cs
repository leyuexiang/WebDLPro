using System;
using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 将现有燃气 PowerPlantProcessController 组合适配到九场景统一接口。
/// 适配器不修改用户正在重构的节点、材质和静态流动实现，也不会把已删除的 setRouteFlow 能力恢复到协议中。
/// </summary>
public sealed class GasPowerBusinessSceneControllerAdapter : IBusinessSceneController, IBusinessSceneProcessDetailController, IBusinessSceneNamedCameraPoseController
{
    private const string GasPowerSceneId = "gas-power";

    private readonly PowerPlantProcessController _controller;
    private readonly ProcessDetailCoordinator _processDetailCoordinator;
    private readonly BusinessSceneNamedCameraPoseRegistry _cameraPoseRegistry;
    private readonly BusinessSceneResourceScope _resourceScope = new BusinessSceneResourceScope();
    private bool _released;

    public string SceneId => GasPowerSceneId;

    public BusinessSceneCapability Capabilities
    {
        get
        {
            BusinessSceneCapability capabilities =
                BusinessSceneCapability.Initialize |
                BusinessSceneCapability.EnterProcessStep |
                BusinessSceneCapability.FocusNode |
                BusinessSceneCapability.ClearSelection |
                BusinessSceneCapability.SetNodeVisibility |
                BusinessSceneCapability.ResetScene |
                BusinessSceneCapability.Release;

            // 四态能力不由协议元数据或接口方法的存在决定，而由当前真实燃气模型是否完成全部显式登记决定。
            // 注册失败时保持能力缺失，让桥接返回结构化“不支持”，不能让部分模型成功变色后再静默忽略其余目标。
            if (_controller != null && _controller.SupportsNodeVisualState)
            {
                capabilities |= BusinessSceneCapability.UpdateNodeVisualState |
                                BusinessSceneCapability.ClearNodeVisualState;
            }

            if (_cameraPoseRegistry != null)
            {
                capabilities |= BusinessSceneCapability.MoveCameraToPose;
            }

            return capabilities;
        }
    }

    public GasPowerBusinessSceneControllerAdapter(PowerPlantProcessController controller)
        : this(controller, null, null)
    {
    }

    public GasPowerBusinessSceneControllerAdapter(
        PowerPlantProcessController controller,
        ProcessDetailCoordinator processDetailCoordinator)
        : this(controller, processDetailCoordinator, null)
    {
    }

    public GasPowerBusinessSceneControllerAdapter(
        PowerPlantProcessController controller,
        ProcessDetailCoordinator processDetailCoordinator,
        BusinessSceneNamedCameraPoseRegistry cameraPoseRegistry)
    {
        _controller = controller;
        _processDetailCoordinator = processDetailCoordinator;
        _cameraPoseRegistry = cameraPoseRegistry;
        if (_controller != null)
        {
            // 控制器拥有运行时半透明材质和高亮组件；在 Unity 场景卸载前主动清理，
            // 避免只依赖延后的 OnDestroy，导致连续切换时旧场景资源短时叠加。
            _resourceScope.TrackReleaseAction(_controller.ReleaseOwnedRuntimeResources);
        }
        if (_processDetailCoordinator != null)
        {
            // 后登记使释放时先退出第三层并销毁独立实例，再清理二层控制器资源。
            _resourceScope.TrackReleaseAction(() => _processDetailCoordinator.Release());
        }
    }

    /// <summary>在场景载入前登记适配工厂；注册表只保存工厂，不跨场景缓存燃气控制器对象。</summary>
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    internal static void RegisterFactory()
    {
        BusinessSceneControllerRegistry.RegisterFactory(GasPowerSceneId, CreateForScene);
    }

    public IEnumerator InitializeAsync(BusinessSceneInitializationContext context, Action<BusinessSceneCommandResult> completed)
    {
        if (_controller == null)
        {
            completed?.Invoke(BusinessSceneCommandResult.Failed("controller-unavailable", "燃气场景缺少 PowerPlantProcessController。"));
            yield break;
        }
        if (!string.Equals(context.SceneId, GasPowerSceneId, StringComparison.Ordinal))
        {
            completed?.Invoke(BusinessSceneCommandResult.Failed("scene-controller-mismatch", "燃气适配器收到其他场景的初始化请求。"));
            yield break;
        }

        if (_released)
        {
            completed?.Invoke(BusinessSceneCommandResult.Failed("scene-controller-released", "燃气业务场景控制器已经释放，不能重新初始化。"));
            yield break;
        }

        completed?.Invoke(BusinessSceneCommandResult.Completed("燃气业务场景控制器初始化完成。"));
    }

    public BusinessSceneCommandResult EnterProcessStep(string processId, string stepId, string unitId, bool isolate)
    {
        if (!TryUseSecondLayerInteraction(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }

        bool success = _controller.TryEnterProcessStep(processId, stepId, unitId, isolate, out string message);
        return success
            ? BusinessSceneCommandResult.Completed(message)
            : BusinessSceneCommandResult.Failed("invalid-process-step", message);
    }

    /// <summary>
    /// 播放独立命名镜头点动画。该入口不调用流程控制器，因此不会改变步骤、显隐、描边或四态。
    /// 第三层关键环节展示期间仍沿用二层交互门，防止两个相机事务互相覆盖。
    /// </summary>
    public BusinessSceneCommandResult MoveCameraToPose(string cameraPoseId)
    {
        if (!TryUseSecondLayerInteraction(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }

        return _cameraPoseRegistry != null
            ? _cameraPoseRegistry.MoveCameraToPose(cameraPoseId)
            : BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.MoveCameraToPose);
    }

    /// <summary>
    /// 将拓扑节点选择转交燃气控制器更新三维描边与可选镜头聚焦。
    /// 是否移动镜头由控制器统一选中开关决定；isolate 仅控制模型显隐上下文。
    /// </summary>
    public BusinessSceneCommandResult FocusNode(string sceneNodeId, bool isolate)
    {
        if (!TryUseSecondLayerInteraction(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }

        bool success = _controller.TryFocusNode(sceneNodeId, isolate, out string message);
        return success
            ? BusinessSceneCommandResult.Completed(message)
            : BusinessSceneCommandResult.Failed("invalid-node", message);
    }

    /// <summary>
    /// 只清除当前由拓扑节点聚焦产生的三维交互描边。
    /// 不改变流程步骤、模型显隐、当前镜头位置或告警描边，保证空白点击不会把场景重置到总览。
    /// </summary>
    public BusinessSceneCommandResult ClearSelection()
    {
        if (!TryUseSecondLayerInteraction(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }

        bool success = _controller.TryClearSelection(out string message);
        return success
            ? BusinessSceneCommandResult.Completed(message)
            : BusinessSceneCommandResult.Failed("clear-selection-failed", message);
    }

    /// <summary>
    /// 将固定四态委托给燃气控制器的显式真实模型登记器。
    /// 适配器不接收颜色、材质或对象引用；能力未声明时仍维持统一的结构化拒绝边界。
    /// </summary>
    public BusinessSceneCommandResult UpdateNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }
        if (!Capabilities.HasFlag(BusinessSceneCapability.UpdateNodeVisualState))
        {
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.UpdateNodeVisualState);
        }

        BusinessSceneCommandResult result = _controller.UpdateNodeVisualState(sceneNodeId, visualState);
        if (!result.Success || _processDetailCoordinator == null)
        {
            return result;
        }

        BusinessSceneCommandResult detailResult = _processDetailCoordinator.UpdateNodeVisualState(sceneNodeId, visualState);
        return detailResult.Success ? result : detailResult;
    }

    /// <summary>
    /// 撤销动态状态覆盖并恢复模型基础颜色。
    /// 清除能力与设置能力始终同时声明，保证完整快照中设备消失时不会遗留旧颜色。
    /// </summary>
    public BusinessSceneCommandResult ClearNodeVisualState(string sceneNodeId)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }
        if (!Capabilities.HasFlag(BusinessSceneCapability.ClearNodeVisualState))
        {
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ClearNodeVisualState);
        }

        BusinessSceneCommandResult result = _controller.ClearNodeVisualState(sceneNodeId);
        if (!result.Success || _processDetailCoordinator == null)
        {
            return result;
        }

        BusinessSceneCommandResult detailResult = _processDetailCoordinator.ClearNodeVisualState(sceneNodeId);
        return detailResult.Success ? result : detailResult;
    }

    /// <summary>第一阶段只准备隐藏候选，不改变当前活动模型、相机或第二层资源。</summary>
    public IEnumerator PrepareProcessDetailAsync(
        string sceneId,
        string processId,
        string stepId,
        string processDetailId,
        string transitionId,
        Action<BusinessSceneCommandResult> completed)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            completed?.Invoke(unavailable);
            yield break;
        }
        if (_processDetailCoordinator == null)
        {
            completed?.Invoke(BusinessSceneCommandResult.Failed(
                "process-detail-unsupported",
                "燃气场景未装配第三层关键环节协调器。"));
            yield break;
        }

        IEnumerator preparing = _processDetailCoordinator.PrepareAsync(
            sceneId, processId, stepId, processDetailId, transitionId, completed);
        try
        {
            while (preparing.MoveNext())
            {
                yield return preparing.Current;
            }
        }
        finally
        {
            (preparing as IDisposable)?.Dispose();
        }
    }

    public BusinessSceneCommandResult CommitPreparedProcessDetail(
        string sceneId,
        string processDetailId,
        string transitionId)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }
        return _processDetailCoordinator != null
            ? _processDetailCoordinator.CommitPrepared(sceneId, processDetailId, transitionId)
            : BusinessSceneCommandResult.Failed("process-detail-unsupported", "燃气场景未装配第三层关键环节协调器。");
    }

    public BusinessSceneCommandResult AbortPreparedProcessDetail(
        string sceneId,
        string processDetailId,
        string transitionId)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }
        return _processDetailCoordinator != null
            ? _processDetailCoordinator.AbortPrepared(sceneId, processDetailId, transitionId)
            : BusinessSceneCommandResult.Failed("process-detail-unsupported", "燃气场景未装配第三层关键环节协调器。");
    }

    /// <summary>
    /// 兼容旧第三层进入命令；内部依次执行准备和提交，不调用旧流程步骤、显隐或包围盒取景。
    /// </summary>
    public IEnumerator EnterProcessDetailAsync(
        string sceneId,
        string processId,
        string stepId,
        string processDetailId,
        string transitionId,
        Action<BusinessSceneCommandResult> completed)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            completed?.Invoke(unavailable);
            yield break;
        }
        if (_processDetailCoordinator == null)
        {
            completed?.Invoke(BusinessSceneCommandResult.Failed(
                "process-detail-unsupported",
                "燃气场景未装配第三层关键环节协调器。"));
            yield break;
        }

        IEnumerator entering = _processDetailCoordinator.EnterAsync(
            sceneId,
            processId,
            stepId,
            processDetailId,
            transitionId,
            completed);
        try
        {
            while (entering.MoveNext())
            {
                yield return entering.Current;
            }
        }
        finally
        {
            // Unity 停止外层协程、桥接器销毁或场景被卸载时，不能只依赖正常遍历结束。
            // 内层协调器和加载器均在枚举器 Dispose 中清理取消下载、迟到句柄和临时资源，
            // 因此此处必须向下传递释放，避免中断进入后遗留独立模型或资源租约。
            (entering as IDisposable)?.Dispose();
        }
    }

    public BusinessSceneCommandResult ExitProcessDetail(string sceneId, string processDetailId, string transitionId)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }
        return _processDetailCoordinator != null
            ? _processDetailCoordinator.Exit(sceneId, processDetailId, transitionId)
            : BusinessSceneCommandResult.Failed(
                "process-detail-unsupported",
                "燃气场景未装配第三层关键环节协调器。");
    }

    /// <summary>直接转发关键环节播放控制；该路径不经过设备状态或二层流程步骤。</summary>
    public BusinessSceneCommandResult SetProcessDetailPlayback(string sceneId, string processDetailId, bool playing)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }
        return _processDetailCoordinator != null
            ? _processDetailCoordinator.SetPlayback(sceneId, processDetailId, playing)
            : BusinessSceneCommandResult.Failed(
                "process-detail-unsupported",
                "燃气场景未装配第三层关键环节协调器。");
    }

    /// <summary>用户已删除燃气动态路径流能力；统一接口保留契约，但燃气适配器显式声明不支持。</summary>
    public BusinessSceneCommandResult SetRouteFlow(string routeId, bool enabled, float speedMultiplier)
    {
        return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetRouteFlow);
    }

    public BusinessSceneCommandResult SetNodeVisibility(string sceneNodeId, bool visible)
    {
        if (!TryUseSecondLayerInteraction(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }

        bool success = _controller.TrySetNodeVisibility(sceneNodeId, visible, out string message);
        return success
            ? BusinessSceneCommandResult.Completed(message)
            : BusinessSceneCommandResult.Failed("invalid-node", message);
    }

    public BusinessSceneCommandResult ResetScene()
    {
        if (!TryUseSecondLayerInteraction(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }

        bool success = _controller.TryResetScene(out string message);
        return success
            ? BusinessSceneCommandResult.Completed(message)
            : BusinessSceneCommandResult.Failed("reset-failed", message);
    }

    /// <summary>
    /// 在场景卸载前主动清理控制器拥有的运行时材质和高亮资源，并保持幂等。
    /// 这里只释放明确登记的运行时资源，不重置场景、不扫描层级，也不调用全局未使用资源卸载。
    /// </summary>
    public BusinessSceneCommandResult ReleaseScene()
    {
        if (_released)
        {
            return BusinessSceneCommandResult.Completed("燃气业务场景控制器已释放。");
        }

        _released = true;
        BusinessSceneResourceReleaseReport report = _resourceScope.ReleaseAll();
        if (report.FailureCount > 0)
        {
            return BusinessSceneCommandResult.Failed(
                "resource-release-failed",
                $"燃气业务场景资源释放存在 {report.FailureCount} 项失败。已继续完成其余清理。");
        }

        return BusinessSceneCommandResult.Completed(
            $"燃气业务场景控制器已释放 {report.ReleasedResourceCount} 项资源并进入卸载流程。");
    }

    public string GetStateDescription()
    {
        if (_released)
        {
            return "released";
        }
        return _controller != null ? _controller.GetStateDescription() : "controller-unavailable";
    }

    private static IBusinessSceneController CreateForScene(Scene scene, BusinessSceneCatalogEntry entry)
    {
        if (!scene.IsValid() || !scene.isLoaded || (entry != null && !string.Equals(entry.SceneId, GasPowerSceneId, StringComparison.Ordinal)))
        {
            return null;
        }

        GameObject[] roots = scene.GetRootGameObjects();
        PowerPlantProcessController controller = null;
        ProcessDetailCoordinator processDetailCoordinator = null;
        BusinessSceneNamedCameraPoseRegistry cameraPoseRegistry = null;
        for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
        {
            if (controller == null)
            {
                controller = roots[rootIndex].GetComponentInChildren<PowerPlantProcessController>(true);
            }
            if (processDetailCoordinator == null)
            {
                processDetailCoordinator = roots[rootIndex].GetComponentInChildren<ProcessDetailCoordinator>(true);
            }
            if (cameraPoseRegistry == null)
            {
                cameraPoseRegistry = roots[rootIndex].GetComponentInChildren<BusinessSceneNamedCameraPoseRegistry>(true);
            }
        }

        return controller != null
            ? new GasPowerBusinessSceneControllerAdapter(controller, processDetailCoordinator, cameraPoseRegistry)
            : null;
    }

    private bool TryUseController(out BusinessSceneCommandResult failure)
    {
        if (_released)
        {
            failure = BusinessSceneCommandResult.Failed("scene-controller-released", "燃气业务场景控制器已经释放。");
            return false;
        }
        if (_controller == null)
        {
            failure = BusinessSceneCommandResult.Failed("controller-unavailable", "燃气场景控制器不可用。");
            return false;
        }

        failure = default;
        return true;
    }

    /// <summary>
    /// 旧二层流程、聚焦、选择清除、显隐和复位共用的第三层隔离门。
    /// 设备四态更新不经过这里，保证关键环节展示期间仍能持续接收状态并重放到独立模型；
    /// 返回二层后该门立即解除，不影响原有燃气业务交互。
    /// </summary>
    private bool TryUseSecondLayerInteraction(out BusinessSceneCommandResult failure)
    {
        if (!TryUseController(out failure))
        {
            return false;
        }
        if (_processDetailCoordinator != null && _processDetailCoordinator.BlocksBusinessSceneInteractions)
        {
            failure = BusinessSceneCommandResult.Failed(
                "process-detail-interaction-blocked",
                "燃气轮机关键环节展示期间已阻断旧二层流程、聚焦、显隐和复位交互。" );
            return false;
        }

        return true;
    }
}

using System;
using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 将燃煤场景中的 PowerPlantProcessController 接入九场景统一接口。
/// 适配器只转发已声明的稳定流程和节点标识，不从模型名称、层级路径或二维标题推断映射。
/// </summary>
public sealed class CoalPowerBusinessSceneControllerAdapter : IBusinessSceneController, IBusinessSceneProcessDetailController, IBusinessSceneNamedCameraPoseController, IBusinessSceneCameraResetController
{
    private const string CoalPowerSceneId = "coal-power";

    private readonly PowerPlantProcessController _controller;
    private readonly ProcessDetailCoordinator _processDetailCoordinator;
    private readonly BusinessSceneNamedCameraPoseRegistry _cameraPoseRegistry;
    private readonly BusinessSceneResourceScope _resourceScope = new BusinessSceneResourceScope();
    private bool _released;

    public string SceneId => CoalPowerSceneId;

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

            // 四态能力只有在锅炉、汽轮机和发电机三组显式目标都成功登记后才开放。
            // 任一模型缺失时整体拒绝，避免同一份完整快照出现部分着色。
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

    public CoalPowerBusinessSceneControllerAdapter(PowerPlantProcessController controller)
        : this(controller, null, null)
    {
    }

    public CoalPowerBusinessSceneControllerAdapter(
        PowerPlantProcessController controller,
        ProcessDetailCoordinator processDetailCoordinator)
        : this(controller, processDetailCoordinator, null)
    {
    }

    public CoalPowerBusinessSceneControllerAdapter(
        PowerPlantProcessController controller,
        ProcessDetailCoordinator processDetailCoordinator,
        BusinessSceneNamedCameraPoseRegistry cameraPoseRegistry)
    {
        _controller = controller;
        _processDetailCoordinator = processDetailCoordinator;
        _cameraPoseRegistry = cameraPoseRegistry;
        if (_controller != null)
        {
            // 运行时材质和高亮组件由控制器创建；场景卸载前主动释放，避免连续切换时短时叠加。
            _resourceScope.TrackReleaseAction(_controller.ReleaseOwnedRuntimeResources);
        }
        if (_processDetailCoordinator != null)
        {
            // 后登记使释放时先退出锅炉第三层并销毁独立实例，再清理二层控制器资源。
            _resourceScope.TrackReleaseAction(() => _processDetailCoordinator.Release());
        }
    }

    /// <summary>在场景载入前登记燃煤工厂，注册表只保存工厂，不缓存跨场景控制器对象。</summary>
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    internal static void RegisterFactory()
    {
        BusinessSceneControllerRegistry.RegisterFactory(CoalPowerSceneId, CreateForScene);
    }

    public IEnumerator InitializeAsync(BusinessSceneInitializationContext context, Action<BusinessSceneCommandResult> completed)
    {
        if (_controller == null)
        {
            completed?.Invoke(BusinessSceneCommandResult.Failed("controller-unavailable", "燃煤场景缺少 PowerPlantProcessController。"));
            yield break;
        }
        if (!string.Equals(context.SceneId, CoalPowerSceneId, StringComparison.Ordinal) ||
            !string.Equals(_controller.ConfiguredProcessId, "coal-power-generation", StringComparison.Ordinal))
        {
            completed?.Invoke(BusinessSceneCommandResult.Failed("scene-controller-mismatch", "燃煤适配器收到不匹配的场景或流程配置。"));
            yield break;
        }
        if (_released)
        {
            completed?.Invoke(BusinessSceneCommandResult.Failed("scene-controller-released", "燃煤业务场景控制器已经释放，不能重新初始化。"));
            yield break;
        }

        completed?.Invoke(BusinessSceneCommandResult.Completed("燃煤业务场景控制器初始化完成。"));
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
    /// 播放独立命名镜头点动画。燃煤场景当前只预留组件与协议接口，未登记点位时返回明确错误。
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
    /// 平滑恢复燃煤场景初始镜头，并将流程、命名镜头和交互产生的临时视觉恢复到总览。
    /// 当前设备四态由流程控制器原样保留并重新应用；该入口不改写流程字段或状态表。
    /// </summary>
    public BusinessSceneCommandResult ResetCamera()
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }
        if (_cameraPoseRegistry == null)
        {
            return BusinessSceneCommandResult.Failed("camera-reset-unavailable", "燃煤场景缺少相机复位控制器。");
        }

        // 先验证并启动镜头复位。镜头配置无效时不得先改变场景视觉，避免失败命令留下半完成状态。
        BusinessSceneCommandResult cameraResult = _cameraPoseRegistry.ResetCamera();
        if (!cameraResult.Success)
        {
            return cameraResult;
        }

        bool visualResetSucceeded = _controller.TryResetOverviewVisualsPreservingDeviceStates(out string visualMessage);
        return visualResetSucceeded
            ? BusinessSceneCommandResult.Completed($"{cameraResult.Message}{visualMessage}")
            : BusinessSceneCommandResult.Failed("camera-visual-reset-failed", visualMessage);
    }

    /// <summary>节点选择更新显隐和描边；是否自动聚焦由场景控制器的统一选中开关决定。</summary>
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

    /// <summary>只清除拓扑选择描边，保留流程状态、告警描边、显隐和镜头上下文。</summary>
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

        // 第三层锅炉使用同一状态节点编号；展示期间同步重放四态，返回二层后不遗留独立实例状态。
        BusinessSceneCommandResult detailResult = _processDetailCoordinator.UpdateNodeVisualState(sceneNodeId, visualState);
        return detailResult.Success ? result : detailResult;
    }

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

    /// <summary>第一阶段只准备隐藏的燃煤锅炉候选，不改变当前二层模型、相机或交互状态。</summary>
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
                "燃煤场景未装配第三层关键环节协调器。"));
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
            : BusinessSceneCommandResult.Failed("process-detail-unsupported", "燃煤场景未装配第三层关键环节协调器。");
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
            : BusinessSceneCommandResult.Failed("process-detail-unsupported", "燃煤场景未装配第三层关键环节协调器。");
    }

    /// <summary>兼容旧第三层进入命令；内部仍按准备、提交两阶段执行，不复用燃煤二层流程步骤。</summary>
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
                "燃煤场景未装配第三层关键环节协调器。"));
            yield break;
        }

        IEnumerator entering = _processDetailCoordinator.EnterAsync(
            sceneId, processId, stepId, processDetailId, transitionId, completed);
        try
        {
            while (entering.MoveNext())
            {
                yield return entering.Current;
            }
        }
        finally
        {
            // 外层协程被场景卸载或桥接器销毁时继续向下释放，避免遗留下载句柄、资源租约或独立锅炉实例。
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
            : BusinessSceneCommandResult.Failed("process-detail-unsupported", "燃煤场景未装配第三层关键环节协调器。");
    }

    /// <summary>转发关键环节播放控制；实际许可由统一绑定器按当前设备状态计算。</summary>
    public BusinessSceneCommandResult SetProcessDetailPlayback(string sceneId, string processDetailId, bool playing)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }
        return _processDetailCoordinator != null
            ? _processDetailCoordinator.SetPlayback(sceneId, processDetailId, playing)
            : BusinessSceneCommandResult.Failed("process-detail-unsupported", "燃煤场景未装配第三层关键环节协调器。");
    }

    /// <summary>资料没有确认燃煤三维路径，不能把二维网络连线误当作动态流动路径。</summary>
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

    public BusinessSceneCommandResult ReleaseScene()
    {
        if (_released)
        {
            return BusinessSceneCommandResult.Completed("燃煤业务场景控制器已释放。");
        }

        _released = true;
        BusinessSceneResourceReleaseReport report = _resourceScope.ReleaseAll();
        if (report.FailureCount > 0)
        {
            return BusinessSceneCommandResult.Failed(
                "resource-release-failed",
                $"燃煤业务场景资源释放存在 {report.FailureCount} 项失败。已继续完成其余清理。");
        }

        return BusinessSceneCommandResult.Completed(
            $"燃煤业务场景控制器已释放 {report.ReleasedResourceCount} 项资源并进入卸载流程。");
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
        if (!scene.IsValid() || !scene.isLoaded ||
            (entry != null && !string.Equals(entry.SceneId, CoalPowerSceneId, StringComparison.Ordinal)))
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
                PowerPlantProcessController candidate = roots[rootIndex].GetComponentInChildren<PowerPlantProcessController>(true);
                if (candidate != null && string.Equals(candidate.ConfiguredProcessId, "coal-power-generation", StringComparison.Ordinal))
                {
                    controller = candidate;
                }
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
            ? new CoalPowerBusinessSceneControllerAdapter(controller, processDetailCoordinator, cameraPoseRegistry)
            : null;
    }

    private bool TryUseController(out BusinessSceneCommandResult failure)
    {
        if (_released)
        {
            failure = BusinessSceneCommandResult.Failed("scene-controller-released", "燃煤业务场景控制器已经释放。");
            return false;
        }
        if (_controller == null)
        {
            failure = BusinessSceneCommandResult.Failed("controller-unavailable", "燃煤场景控制器不可用。");
            return false;
        }

        failure = default;
        return true;
    }

    /// <summary>
    /// 二层流程、聚焦、选择清除、显隐、镜头和复位共用第三层隔离门。
    /// 设备四态不经过该门，保证锅炉关键环节展示期间仍能接收并重放实时状态。
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
                "燃煤锅炉关键环节展示期间已阻断旧二层流程、聚焦、显隐、镜头和复位交互。");
            return false;
        }

        return true;
    }
}

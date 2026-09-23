using System;
using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 将光伏场景中的 PowerPlantProcessController 接入统一业务场景协议。
/// 光伏开放已核验节点、设备四态和第二层命名镜头；所有目标均通过场景序列化引用显式绑定。
/// </summary>
public sealed class SolarPowerBusinessSceneControllerAdapter : IBusinessSceneController, IBusinessSceneProcessDetailController, IBusinessSceneNamedCameraPoseController, IBusinessSceneCameraResetController
{
    private const string SolarPowerSceneId = "solar-power";
    private readonly PowerPlantProcessController _controller;
    private readonly ProcessDetailCoordinator _processDetailCoordinator;
    private readonly BusinessSceneNamedCameraPoseRegistry _cameraPoseRegistry;
    private bool _released;

    public string SceneId => SolarPowerSceneId;

    /// <summary>能力集合必须与 BusinessSceneCatalog.asset 和发布清单逐项一致。</summary>
    public BusinessSceneCapability Capabilities
    {
        get
        {
            BusinessSceneCapability capabilities =
                BusinessSceneCapability.Initialize |
                BusinessSceneCapability.FocusNode |
                BusinessSceneCapability.ClearSelection |
                BusinessSceneCapability.ResetScene |
                BusinessSceneCapability.Release;

            // 四态能力只有在场景资产中的真实 visualStateBindings 完整可用时才开放。
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

    public SolarPowerBusinessSceneControllerAdapter(PowerPlantProcessController controller)
        : this(controller, null, null)
    {
    }

    public SolarPowerBusinessSceneControllerAdapter(
        PowerPlantProcessController controller,
        ProcessDetailCoordinator processDetailCoordinator)
        : this(controller, processDetailCoordinator, null)
    {
    }

    public SolarPowerBusinessSceneControllerAdapter(
        PowerPlantProcessController controller,
        ProcessDetailCoordinator processDetailCoordinator,
        BusinessSceneNamedCameraPoseRegistry cameraPoseRegistry)
    {
        _controller = controller;
        _processDetailCoordinator = processDetailCoordinator;
        _cameraPoseRegistry = cameraPoseRegistry;
    }

    /// <summary>在场景载入前登记光伏适配器，注册表只保存工厂，不跨场景缓存控制器对象。</summary>
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    internal static void RegisterFactory()
    {
        BusinessSceneControllerRegistry.RegisterFactory(SolarPowerSceneId, CreateForScene);
    }

    public IEnumerator InitializeAsync(BusinessSceneInitializationContext context, Action<BusinessSceneCommandResult> completed)
    {
        if (_controller == null)
        {
            completed?.Invoke(BusinessSceneCommandResult.Failed("controller-unavailable", "光伏场景缺少 PowerPlantProcessController。"));
            yield break;
        }
        if (!string.Equals(context.SceneId, SolarPowerSceneId, StringComparison.Ordinal) ||
            !string.Equals(_controller.ConfiguredProcessId, "solar-power-generation", StringComparison.Ordinal))
        {
            completed?.Invoke(BusinessSceneCommandResult.Failed("scene-controller-mismatch", "光伏适配器收到不匹配的场景或流程配置。"));
            yield break;
        }
        completed?.Invoke(BusinessSceneCommandResult.Completed("光伏业务场景控制器初始化完成。"));
    }

    /// <summary>
    /// 播放第二层独立命名镜头。第三层活动期间拒绝该命令，避免二层镜头覆盖第三层相机事务。
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
    /// 第三层活动时恢复第三层默认视角；否则恢复光伏二层初始镜头和总览视觉。
    /// </summary>
    public BusinessSceneCommandResult ResetCamera()
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }

        if (_processDetailCoordinator != null && _processDetailCoordinator.IsActive)
        {
            return _processDetailCoordinator.ResetActiveCameraPose();
        }
        if (_cameraPoseRegistry == null)
        {
            return BusinessSceneCommandResult.Failed("camera-reset-unavailable", "光伏场景缺少相机复位控制器。");
        }

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

    public BusinessSceneCommandResult FocusNode(string sceneNodeId, bool isolate)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable)) return unavailable;
        return _controller.TryFocusNode(sceneNodeId, isolate, out string message)
            ? BusinessSceneCommandResult.Completed(message)
            : BusinessSceneCommandResult.Failed("invalid-node", message);
    }

    public BusinessSceneCommandResult ClearSelection()
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable)) return unavailable;
        return _controller.TryClearSelection(out string message)
            ? BusinessSceneCommandResult.Completed(message)
            : BusinessSceneCommandResult.Failed("clear-selection-failed", message);
    }

    public BusinessSceneCommandResult UpdateNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable)) return unavailable;
        if (!Capabilities.HasFlag(BusinessSceneCapability.UpdateNodeVisualState))
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.UpdateNodeVisualState);
        BusinessSceneCommandResult result = _controller.UpdateNodeVisualState(sceneNodeId, visualState);
        if (!result.Success || _processDetailCoordinator == null)
        {
            return result;
        }
        BusinessSceneCommandResult detailResult = _processDetailCoordinator.UpdateNodeVisualState(sceneNodeId, visualState);
        return detailResult.Success ? result : detailResult;
    }

    public BusinessSceneCommandResult ClearNodeVisualState(string sceneNodeId)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable)) return unavailable;
        if (!Capabilities.HasFlag(BusinessSceneCapability.ClearNodeVisualState))
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ClearNodeVisualState);
        BusinessSceneCommandResult result = _controller.ClearNodeVisualState(sceneNodeId);
        if (!result.Success || _processDetailCoordinator == null)
        {
            return result;
        }
        BusinessSceneCommandResult detailResult = _processDetailCoordinator.ClearNodeVisualState(sceneNodeId);
        return detailResult.Success ? result : detailResult;
    }

    public BusinessSceneCommandResult ResetScene()
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable)) return unavailable;
        return _controller.TryResetScene(out string message)
            ? BusinessSceneCommandResult.Completed(message)
            : BusinessSceneCommandResult.Failed("reset-failed", message);
    }

    public BusinessSceneCommandResult ReleaseScene()
    {
        if (_released) return BusinessSceneCommandResult.Completed("光伏业务场景控制器已释放。");
        _released = true;
        _processDetailCoordinator?.Release();
        _controller?.ReleaseOwnedRuntimeResources();
        return BusinessSceneCommandResult.Completed("光伏业务场景控制器已释放。");
    }

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
                "光伏场景未装配第三层关键环节协调器。"));
            yield break;
        }

        IEnumerator preparing = _processDetailCoordinator.PrepareAsync(
            sceneId, processId, stepId, processDetailId, transitionId, completed);
        try
        {
            while (preparing.MoveNext()) yield return preparing.Current;
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
        if (!TryUseController(out BusinessSceneCommandResult unavailable)) return unavailable;
        return _processDetailCoordinator != null
            ? _processDetailCoordinator.CommitPrepared(sceneId, processDetailId, transitionId)
            : BusinessSceneCommandResult.Failed("process-detail-unsupported", "光伏场景未装配第三层关键环节协调器。");
    }

    public BusinessSceneCommandResult AbortPreparedProcessDetail(
        string sceneId,
        string processDetailId,
        string transitionId)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable)) return unavailable;
        return _processDetailCoordinator != null
            ? _processDetailCoordinator.AbortPrepared(sceneId, processDetailId, transitionId)
            : BusinessSceneCommandResult.Failed("process-detail-unsupported", "光伏场景未装配第三层关键环节协调器。");
    }

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
                "光伏场景未装配第三层关键环节协调器。"));
            yield break;
        }

        IEnumerator entering = _processDetailCoordinator.EnterAsync(
            sceneId, processId, stepId, processDetailId, transitionId, completed);
        try
        {
            while (entering.MoveNext()) yield return entering.Current;
        }
        finally
        {
            (entering as IDisposable)?.Dispose();
        }
    }

    public BusinessSceneCommandResult ExitProcessDetail(string sceneId, string processDetailId, string transitionId)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable)) return unavailable;
        return _processDetailCoordinator != null
            ? _processDetailCoordinator.Exit(sceneId, processDetailId, transitionId)
            : BusinessSceneCommandResult.Failed("process-detail-unsupported", "光伏场景未装配第三层关键环节协调器。");
    }

    public BusinessSceneCommandResult SetProcessDetailPlayback(string sceneId, string processDetailId, bool playing)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable)) return unavailable;
        return _processDetailCoordinator != null
            ? _processDetailCoordinator.SetPlayback(sceneId, processDetailId, playing)
            : BusinessSceneCommandResult.Failed("process-detail-unsupported", "光伏场景未装配第三层关键环节协调器。");
    }

    public BusinessSceneCommandResult SetRouteFlow(string routeId, bool enabled, float speedMultiplier) =>
        BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetRouteFlow);

    public BusinessSceneCommandResult SetNodeVisibility(string sceneNodeId, bool visible) =>
        BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetNodeVisibility);

    public string GetStateDescription() => _released ? "released" : (_controller != null ? _controller.GetStateDescription() : "controller-unavailable");

    private bool TryUseController(out BusinessSceneCommandResult failure)
    {
        if (_released)
        {
            failure = BusinessSceneCommandResult.Failed("scene-controller-released", "光伏业务场景控制器已经释放。");
            return false;
        }
        if (_controller == null)
        {
            failure = BusinessSceneCommandResult.Failed("controller-unavailable", "光伏场景控制器不可用。");
            return false;
        }
        failure = default;
        return true;
    }

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
                "光伏关键环节展示期间已阻断第二层流程、聚焦、显隐和命名镜头交互。");
            return false;
        }

        return true;
    }

    private static IBusinessSceneController CreateForScene(Scene scene, BusinessSceneCatalogEntry entry)
    {
        if (!scene.IsValid() || !scene.isLoaded ||
            (entry != null && !string.Equals(entry.SceneId, SolarPowerSceneId, StringComparison.Ordinal)))
            return null;

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
        return controller != null && string.Equals(controller.ConfiguredProcessId, "solar-power-generation", StringComparison.Ordinal)
            ? new SolarPowerBusinessSceneControllerAdapter(controller, processDetailCoordinator, cameraPoseRegistry)
            : null;
    }
}

using System;
using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 将燃煤场景中的 PowerPlantProcessController 接入九场景统一接口。
/// 适配器只转发已声明的稳定流程和节点标识，不从模型名称、层级路径或二维标题推断映射。
/// </summary>
public sealed class CoalPowerBusinessSceneControllerAdapter : IBusinessSceneController
{
    private const string CoalPowerSceneId = "coal-power";

    private readonly PowerPlantProcessController _controller;
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

            return capabilities;
        }
    }

    public CoalPowerBusinessSceneControllerAdapter(PowerPlantProcessController controller)
    {
        _controller = controller;
        if (_controller != null)
        {
            // 运行时材质和高亮组件由控制器创建；场景卸载前主动释放，避免连续切换时短时叠加。
            _resourceScope.TrackReleaseAction(_controller.ReleaseOwnedRuntimeResources);
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
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }

        bool success = _controller.TryEnterProcessStep(processId, stepId, unitId, isolate, out string message);
        return success
            ? BusinessSceneCommandResult.Completed(message)
            : BusinessSceneCommandResult.Failed("invalid-process-step", message);
    }

    /// <summary>节点选择更新显隐和描边；是否自动聚焦由场景控制器的统一选中开关决定。</summary>
    public BusinessSceneCommandResult FocusNode(string sceneNodeId, bool isolate)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
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
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
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

        return _controller.UpdateNodeVisualState(sceneNodeId, visualState);
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

        return _controller.ClearNodeVisualState(sceneNodeId);
    }

    /// <summary>资料没有确认燃煤三维路径，不能把二维网络连线误当作动态流动路径。</summary>
    public BusinessSceneCommandResult SetRouteFlow(string routeId, bool enabled, float speedMultiplier)
    {
        return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetRouteFlow);
    }

    public BusinessSceneCommandResult SetNodeVisibility(string sceneNodeId, bool visible)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
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
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
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
        for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
        {
            PowerPlantProcessController controller = roots[rootIndex].GetComponentInChildren<PowerPlantProcessController>(true);
            if (controller != null && string.Equals(controller.ConfiguredProcessId, "coal-power-generation", StringComparison.Ordinal))
            {
                return new CoalPowerBusinessSceneControllerAdapter(controller);
            }
        }

        return null;
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
}

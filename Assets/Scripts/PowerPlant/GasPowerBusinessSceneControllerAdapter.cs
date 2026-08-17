using System;
using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 将现有燃气 PowerPlantProcessController 组合适配到九场景统一接口。
/// 适配器不修改用户正在重构的节点、材质和静态流动实现，也不会把已删除的 setRouteFlow 能力恢复到协议中。
/// </summary>
public sealed class GasPowerBusinessSceneControllerAdapter : IBusinessSceneController
{
    private const string GasPowerSceneId = "gas-power";

    private readonly PowerPlantProcessController _controller;
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

            return capabilities;
        }
    }

    public GasPowerBusinessSceneControllerAdapter(PowerPlantProcessController controller)
    {
        _controller = controller;
        if (_controller != null)
        {
            // 控制器拥有运行时半透明材质和高亮组件；在 Unity 场景卸载前主动清理，
            // 避免只依赖延后的 OnDestroy，导致连续切换时旧场景资源短时叠加。
            _resourceScope.TrackReleaseAction(_controller.ReleaseOwnedRuntimeResources);
        }
    }

    /// <summary>在场景载入前登记适配工厂；注册表只保存工厂，不跨场景缓存燃气控制器对象。</summary>
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    private static void RegisterFactory()
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
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }

        bool success = _controller.TryEnterProcessStep(processId, stepId, unitId, isolate, out string message);
        return success
            ? BusinessSceneCommandResult.Completed(message)
            : BusinessSceneCommandResult.Failed("invalid-process-step", message);
    }

    /// <summary>
    /// 将拓扑节点选择转交燃气控制器更新三维描边。
    /// 接口命名沿用既有协议，但实现不移动镜头；isolate 仅控制模型显隐上下文。
    /// </summary>
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

    /// <summary>
    /// 只清除当前由拓扑节点聚焦产生的三维交互描边。
    /// 不改变流程步骤、模型显隐、当前镜头位置或告警描边，保证空白点击不会把场景重置到总览。
    /// </summary>
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

        return _controller.UpdateNodeVisualState(sceneNodeId, visualState);
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

        return _controller.ClearNodeVisualState(sceneNodeId);
    }

    /// <summary>用户已删除燃气动态路径流能力；统一接口保留契约，但燃气适配器显式声明不支持。</summary>
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
        for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
        {
            PowerPlantProcessController controller = roots[rootIndex].GetComponentInChildren<PowerPlantProcessController>(true);
            if (controller != null)
            {
                return new GasPowerBusinessSceneControllerAdapter(controller);
            }
        }

        return null;
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
}

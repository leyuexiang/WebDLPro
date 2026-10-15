using System;
using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 楼宇场景的运行时业务控制器适配器。
/// 结构与燃气、燃煤适配器一致：由业务场景控制器注册表按 sceneId 创建普通 C# 对象，
/// 不作为 MonoBehaviour（Unity 组件）挂到场景物体；场景里的 PowerPlantProcessController 和动画路由器仍由 Unity 序列化绑定。
/// 节点状态先委托给现有控制器更新颜色、描边和闪烁，成功后再转发到可选的节点动画路由器。
/// </summary>
public sealed class BuildingBusinessSceneControllerAdapter : IBusinessSceneController
{
    private const string BuildingSceneId = "consumption";

    private readonly PowerPlantProcessController _processController;
    private readonly BuildingNodeStatusAnimationRouter _animationRouter;
    private bool _released;

    /// <summary>提供给场景注册表的固定楼宇场景标识。</summary>
    public string SceneId => BuildingSceneId;

    /// <summary>
    /// 仅开放控制器实际具备的生命周期和四态能力。
    /// 四态更新与状态清除必须同时存在，并由场景目录登记完全相同的能力集合。
    /// </summary>
    public BusinessSceneCapability Capabilities
    {
        get
        {
            BusinessSceneCapability capabilities =
                BusinessSceneCapability.Initialize |
                BusinessSceneCapability.ResetScene |
                BusinessSceneCapability.Release;

            if (_processController != null && _processController.SupportsNodeVisualState)
            {
                capabilities |= BusinessSceneCapability.UpdateNodeVisualState |
                                BusinessSceneCapability.ClearNodeVisualState;
            }

            return capabilities;
        }
    }

    /// <summary>
    /// 创建适配器时保存当前场景内显式查找到的控制器引用。
    /// 动画路由器允许缺省：未配置动画时，现有节点颜色和闪烁控制仍可正常工作。
    /// </summary>
    private BuildingBusinessSceneControllerAdapter(
        PowerPlantProcessController processController,
        BuildingNodeStatusAnimationRouter animationRouter)
    {
        _processController = processController;
        _animationRouter = animationRouter;
    }

    /// <summary>
    /// 在场景载入前登记楼宇适配工厂。
    /// 注册表保存工厂而不跨场景缓存控制器实例，避免场景卸载后保留 Unity 对象引用。
    /// </summary>
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    internal static void RegisterFactory()
    {
        BusinessSceneControllerRegistry.RegisterFactory(BuildingSceneId, CreateForScene);
    }

    /// <summary>
    /// 校验目标场景后，从场景根对象的子层级中查找所需组件。
    /// 扫描只发生在场景控制器解析时，不在设备状态高频调用路径中重复遍历层级。
    /// </summary>
    private static IBusinessSceneController CreateForScene(Scene scene, BusinessSceneCatalogEntry entry)
    {
        if (!scene.IsValid() || !scene.isLoaded ||
            (entry != null && !string.Equals(entry.SceneId, BuildingSceneId, StringComparison.Ordinal)))
        {
            return null;
        }

        PowerPlantProcessController processController = null;
        BuildingNodeStatusAnimationRouter animationRouter = null;
        GameObject[] roots = scene.GetRootGameObjects();
        for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
        {
            if (processController == null)
            {
                processController = roots[rootIndex].GetComponentInChildren<PowerPlantProcessController>(true);
            }

            if (animationRouter == null)
            {
                animationRouter = roots[rootIndex].GetComponentInChildren<BuildingNodeStatusAnimationRouter>(true);
            }

            if (processController != null && animationRouter != null)
            {
                break;
            }
        }

        return processController != null
            ? new BuildingBusinessSceneControllerAdapter(processController, animationRouter)
            : null;
    }

    /// <summary>校验目录传入的楼宇场景标识，并为动画路由器建立节点索引。</summary>
    public IEnumerator InitializeAsync(
        BusinessSceneInitializationContext context,
        Action<BusinessSceneCommandResult> completed)
    {
        if (_released)
        {
            completed?.Invoke(BusinessSceneCommandResult.Failed(
                "scene-controller-released",
                "楼宇场景控制器已经释放。"));
            yield break;
        }

        if (!string.Equals(context.SceneId, SceneId, StringComparison.Ordinal))
        {
            completed?.Invoke(BusinessSceneCommandResult.Failed(
                "scene-controller-mismatch",
                "楼宇场景控制器标识与初始化目标不一致。"));
            yield break;
        }

        if (_processController == null)
        {
            completed?.Invoke(BusinessSceneCommandResult.Failed(
                "controller-unavailable",
                "楼宇场景缺少 PowerPlantProcessController。"));
            yield break;
        }

        _animationRouter?.RebuildIndex();
        completed?.Invoke(BusinessSceneCommandResult.Completed("楼宇业务场景控制器初始化完成。"));
    }

    /// <summary>楼宇场景未声明节点聚焦能力时明确返回不支持，不静默改变模型或相机。</summary>
    public BusinessSceneCommandResult FocusNode(string sceneNodeId, bool isolate)
    {
        return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.FocusNode);
    }

    /// <summary>楼宇场景未声明清除选择能力时明确返回不支持。</summary>
    public BusinessSceneCommandResult ClearSelection()
    {
        return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ClearSelection);
    }

    /// <summary>
    /// 先应用节点四态视觉，只有底层控制器成功后才触发对应动画。
    /// 未登记动画的节点保持原有视觉状态处理结果，不会使设备状态命令失败。
    /// </summary>
    public BusinessSceneCommandResult UpdateNodeVisualState(
        string sceneNodeId,
        BusinessSceneNodeVisualState visualState)
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }
        if (!Capabilities.HasFlag(BusinessSceneCapability.UpdateNodeVisualState))
        {
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.UpdateNodeVisualState);
        }

        BusinessSceneCommandResult visualResult =
            _processController.UpdateNodeVisualState(sceneNodeId, visualState);
        if (visualResult.Success)
        {
            _animationRouter?.ApplyNodeVisualState(sceneNodeId, visualState);
        }

        return visualResult;
    }

    /// <summary>先恢复节点基础视觉，成功后再清除该节点动画状态。</summary>
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

        BusinessSceneCommandResult visualResult = _processController.ClearNodeVisualState(sceneNodeId);
        if (visualResult.Success)
        {
            _animationRouter?.ClearNodeVisualState(sceneNodeId);
        }

        return visualResult;
    }

    /// <summary>楼宇适配器不接管流程路径动画，避免把燃气或燃煤路径规则误用于楼宇节点。</summary>
    public BusinessSceneCommandResult SetRouteFlow(string routeId, bool enabled, float speedMultiplier)
    {
        return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetRouteFlow);
    }

    /// <summary>楼宇场景未声明节点显隐能力时明确返回不支持。</summary>
    public BusinessSceneCommandResult SetNodeVisibility(string sceneNodeId, bool visible)
    {
        return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetNodeVisibility);
    }

    /// <summary>复用场景控制器的复位入口；成功后清除所有动画触发器。</summary>
    public BusinessSceneCommandResult ResetScene()
    {
        if (!TryUseController(out BusinessSceneCommandResult unavailable))
        {
            return unavailable;
        }

        bool resetSucceeded = _processController.TryResetScene(out string message);
        if (!resetSucceeded)
        {
            return BusinessSceneCommandResult.Failed("reset-failed", message);
        }

        _animationRouter?.ClearAllNodeVisualStates();
        return BusinessSceneCommandResult.Completed(message);
    }

    /// <summary>
    /// 释放时只清理本适配器关联的动画路由，不释放由场景持有的 PowerPlantProcessController 资源。
    /// 重复释放返回成功，保证场景切换回滚时可安全重入。
    /// </summary>
    public BusinessSceneCommandResult ReleaseScene()
    {
        if (_released)
        {
            return BusinessSceneCommandResult.Completed("楼宇业务场景控制器已释放。");
        }

        _released = true;
        _animationRouter?.ClearAllNodeVisualStates();
        return BusinessSceneCommandResult.Completed("楼宇业务场景控制器已释放。");
    }

    /// <summary>给场景协调日志返回简明状态，便于区分可用、缺少视觉登记和已释放状态。</summary>
    public string GetStateDescription()
    {
        if (_released)
        {
            return "released";
        }

        return _processController != null && _processController.SupportsNodeVisualState
            ? "ready-with-node-visual-state"
            : "ready-without-node-visual-state";
    }

    /// <summary>拒绝释放后或缺少底层控制器时执行状态相关命令。</summary>
    private bool TryUseController(out BusinessSceneCommandResult failure)
    {
        if (_released)
        {
            failure = BusinessSceneCommandResult.Failed(
                "scene-controller-released",
                "楼宇场景控制器已经释放。");
            return false;
        }

        if (_processController == null)
        {
            failure = BusinessSceneCommandResult.Failed(
                "controller-unavailable",
                "楼宇场景缺少 PowerPlantProcessController。");
            return false;
        }

        failure = default;
        return true;
    }

}

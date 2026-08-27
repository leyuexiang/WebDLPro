using System;
using System.Collections;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 九个业务场景可声明的统一能力。能力清单用于在调用前明确拒绝不支持的动作，
    /// 不能把“未实现”当作成功，也不能从场景显示名称反推能力。
    /// </summary>
    [Flags]
    public enum BusinessSceneCapability
    {
        None = 0,
        Initialize = 1 << 0,
        EnterProcessStep = 1 << 1,
        FocusNode = 1 << 2,
        UpdateNodeVisualState = 1 << 3,
        SetRouteFlow = 1 << 4,
        ResetScene = 1 << 5,
        Release = 1 << 6,
        SetNodeVisibility = 1 << 7,
        ClearSelection = 1 << 8,
        // 清除设备动态状态与 Normal 四态语义不同：前者恢复模型登记时的基础材质颜色，后者是平台明确下发的正常态。
        ClearNodeVisualState = 1 << 9
    }

    /// <summary>设备视觉状态固定为四态，禁止场景控制器自行扩展不可互通的字符串枚举。</summary>
    public enum BusinessSceneNodeVisualState
    {
        Normal,
        Alarm,
        Fault,
        Offline
    }

    /// <summary>
    /// 场景命令统一返回结构化结果。错误码用于桥接和协调器映射，消息只保存受控摘要，
    /// 不包含异常对象、Unity 层级路径或资源地址。
    /// </summary>
    [Serializable]
    public readonly struct BusinessSceneCommandResult
    {
        public bool Success { get; }
        public string ErrorCode { get; }
        public string Message { get; }

        private BusinessSceneCommandResult(bool success, string errorCode, string message)
        {
            Success = success;
            ErrorCode = errorCode ?? string.Empty;
            Message = message ?? string.Empty;
        }

        public static BusinessSceneCommandResult Completed(string message)
        {
            return new BusinessSceneCommandResult(true, string.Empty, message);
        }

        public static BusinessSceneCommandResult Failed(string errorCode, string message)
        {
            return new BusinessSceneCommandResult(false, errorCode, message);
        }

        public static BusinessSceneCommandResult Unsupported(BusinessSceneCapability capability)
        {
            return Failed("capability-unsupported", $"当前业务场景未声明能力：{capability}。");
        }
    }

    /// <summary>
    /// 总览代表建筑的异常视觉接口。运行时场景层只依赖稳定建筑 ID 和四态枚举，
    /// 高亮插件、材质和闪烁实现留在具体呈现组件，避免产生程序集反向依赖。
    /// </summary>
    public interface IOverviewBuildingVisualStatePresenter
    {
        void ApplyVisualState(BusinessSceneNodeVisualState visualState);
        void ClearVisualState();
        void ReleaseVisualState();
    }

    /// <summary>初始化上下文只携带稳定目录标识和事务标识，不暴露场景路径或加载对象。</summary>
    public readonly struct BusinessSceneInitializationContext
    {
        public string SceneId { get; }
        public string UnitySceneKey { get; }
        public string TransitionId { get; }
        public bool IsRecovery { get; }

        public BusinessSceneInitializationContext(string sceneId, string unitySceneKey, string transitionId, bool isRecovery)
        {
            SceneId = sceneId;
            UnitySceneKey = unitySceneKey;
            TransitionId = transitionId;
            IsRecovery = isRecovery;
        }
    }

    /// <summary>
    /// 所有业务场景必须实现的统一控制接口。初始化允许跨帧执行；其他命令返回同步结构化结果，
    /// 场景若未声明对应能力，必须返回 capability-unsupported，禁止静默空执行。
    /// </summary>
    public interface IBusinessSceneController
    {
        string SceneId { get; }
        BusinessSceneCapability Capabilities { get; }
        IEnumerator InitializeAsync(BusinessSceneInitializationContext context, Action<BusinessSceneCommandResult> completed);
        BusinessSceneCommandResult EnterProcessStep(string processId, string stepId, string unitId, bool isolate);
        BusinessSceneCommandResult FocusNode(string sceneNodeId, bool isolate);
        BusinessSceneCommandResult ClearSelection();
        BusinessSceneCommandResult UpdateNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState);
        BusinessSceneCommandResult ClearNodeVisualState(string sceneNodeId);
        BusinessSceneCommandResult SetRouteFlow(string routeId, bool enabled, float speedMultiplier);
        BusinessSceneCommandResult SetNodeVisibility(string sceneNodeId, bool visible);
        BusinessSceneCommandResult ResetScene();
        BusinessSceneCommandResult ReleaseScene();
        string GetStateDescription();
    }
}

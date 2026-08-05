using System;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 浏览器发往 Unity 的场景切换载荷。字段名保持协议小写形式，
    /// 使 JsonUtility 能直接匹配网页端 JSON，而不需要把不可信原始 JSON 暴露给业务场景。
    /// </summary>
    [Serializable]
    public sealed class SceneSwitchCommandPayload
    {
        public string sceneId;
        public string transitionId;
        public string sceneMappingVersion;
    }

    /// <summary>
    /// Unity 回传浏览器的有限加载进度载荷。它只包含稳定标识、阶段与归一化数值，
    /// 不允许携带 AsyncOperation、场景路径、层级名称或资源地址。
    /// </summary>
    [Serializable]
    public sealed class SceneLoadProgressPayload
    {
        public string requestId;
        public string sceneId;
        public string transitionId;
        public string stageCode;
        public float progress;
    }

    /// <summary>
    /// Unity 回传浏览器的场景成功完成载荷。失败永远通过 commandResult 回传，
    /// 因而 sceneChanged 的 success 固定为 true，调用端不能把失败恢复误提交为新场景。
    /// </summary>
    [Serializable]
    public sealed class SceneChangedPayload
    {
        public string requestId;
        public string sceneId;
        public string transitionId;
        public bool success;
        public string sceneState;
    }

    /// <summary>
    /// 场景切换协议的纯数据校验器。浏览器桥接层与编辑模式测试共用它，
    /// 让版本、标识、阶段和进度边界不依赖 MonoBehaviour 或 WebGL 环境。
    /// </summary>
    public static class SceneSwitchProtocolValidator
    {
        /// <summary>单条跨窗口稳定标识最大长度与前端协议一致，避免有限请求表接受超长键。</summary>
        public const int MaxIdentifierLength = 128;

        /// <summary>验证请求的三个不可拆分字段；场景映射版本不能由缺省值或旧构建绕过。</summary>
        public static bool IsValidCommand(SceneSwitchCommandPayload payload, string expectedSceneMappingVersion)
        {
            return payload != null &&
                   IsBoundedIdentifier(payload.sceneId) &&
                   IsBoundedIdentifier(payload.transitionId) &&
                   IsBoundedIdentifier(payload.sceneMappingVersion) &&
                   string.Equals(payload.sceneMappingVersion, expectedSceneMappingVersion, StringComparison.Ordinal);
        }

        /// <summary>验证进度范围与有限阶段；错误阶段或非有限数值都不能穿透至网页层。</summary>
        public static bool IsValidProgress(SceneLoadProgressPayload payload)
        {
            return payload != null &&
                   IsBoundedIdentifier(payload.requestId) &&
                   IsBoundedIdentifier(payload.sceneId) &&
                   IsBoundedIdentifier(payload.transitionId) &&
                   IsSceneLoadStageCode(payload.stageCode) &&
                   !float.IsNaN(payload.progress) &&
                   !float.IsInfinity(payload.progress) &&
                   payload.progress >= 0f &&
                   payload.progress <= 1f;
        }

        /// <summary>验证成功完成事件；失败不得伪装为 sceneChanged，必须改走结构化 commandResult。</summary>
        public static bool IsValidChanged(SceneChangedPayload payload)
        {
            return payload != null &&
                   IsBoundedIdentifier(payload.requestId) &&
                   IsBoundedIdentifier(payload.sceneId) &&
                   IsBoundedIdentifier(payload.transitionId) &&
                   payload.success;
        }

        /// <summary>统一稳定标识边界，避免各桥接分支对空值和超长值产生不一致处理。</summary>
        public static bool IsBoundedIdentifier(string value)
        {
            return !string.IsNullOrWhiteSpace(value) && value.Length <= MaxIdentifierLength;
        }

        /// <summary>只允许多场景协调器实际暴露的阶段，未知字符串不能被网页作为进度状态展示。</summary>
        public static bool IsSceneLoadStageCode(string value)
        {
            return string.Equals(value, "unloading-scene", StringComparison.Ordinal) ||
                   string.Equals(value, "loading-scene", StringComparison.Ordinal) ||
                   string.Equals(value, "initializing-scene", StringComparison.Ordinal) ||
                   string.Equals(value, "restoring-scene", StringComparison.Ordinal);
        }
    }

    /// <summary>
    /// 统一校验当前业务场景动作所使用的稳定标识和固定视觉状态。
    /// 校验器不维护任何场景映射：映射归属目录和业务控制器，桥接只阻止空值、超长值、
    /// 未知四态或网页试图携带引擎内部参数进入当前场景。
    /// </summary>
    public static class SceneActionProtocolValidator
    {
        /// <summary>流程的机组标识可以省略，由场景控制器基于受控默认值解析；其余标识必须存在。</summary>
        public static bool IsValidProcessStep(string processId, string stepId, string unitId)
        {
            return SceneSwitchProtocolValidator.IsBoundedIdentifier(processId) &&
                   SceneSwitchProtocolValidator.IsBoundedIdentifier(stepId) &&
                   (string.IsNullOrWhiteSpace(unitId) || SceneSwitchProtocolValidator.IsBoundedIdentifier(unitId));
        }

        /// <summary>聚焦、显隐和状态更新统一只接受三维节点稳定标识，禁止传入二维 nodeId 或层级路径。</summary>
        public static bool IsValidSceneNodeId(string sceneNodeId)
        {
            return SceneSwitchProtocolValidator.IsBoundedIdentifier(sceneNodeId);
        }

        /// <summary>路径流动只接受受控路径标识，路径是否存在由当前场景控制器返回明确业务错误。</summary>
        public static bool IsValidRouteId(string routeId)
        {
            return SceneSwitchProtocolValidator.IsBoundedIdentifier(routeId);
        }

        /// <summary>
        /// 将网页端固定小写四态转换为内部枚举。拒绝未知值，避免把字符串直接传入材质、
        /// 动画或任意脚本逻辑；转换成功后不会产生数组、字典或材质资源分配。
        /// </summary>
        public static bool TryParseVisualState(string visualState, out BusinessSceneNodeVisualState parsedState)
        {
            switch (visualState)
            {
                case "normal":
                    parsedState = BusinessSceneNodeVisualState.Normal;
                    return true;
                case "alarm":
                    parsedState = BusinessSceneNodeVisualState.Alarm;
                    return true;
                case "fault":
                    parsedState = BusinessSceneNodeVisualState.Fault;
                    return true;
                case "offline":
                    parsedState = BusinessSceneNodeVisualState.Offline;
                    return true;
                default:
                    parsedState = default;
                    return false;
            }
        }
    }
}

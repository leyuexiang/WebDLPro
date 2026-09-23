using System;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// Unity 运行时、网页桥接与构建元数据共享的协议契约。
    /// 构建门禁读取由这些常量生成的小型元数据，避免通过二进制字符串是否出现来猜测运行时能力。
    /// </summary>
    public static class WebGlProtocolContract
    {
        public const string Channel = "power3d-unity";
        public const int ProtocolVersion = 1;
        // 第五版元数据增加完整上行事件能力；缺少对象选中或选择清除事件的旧构建无法形成三维反向联动，必须阻止发布。
        public const int MetadataSchemaVersion = 5;
        // 第二版场景完成结构新增物理 sceneActivationId；全局信封版本保持不变，避免无关命令被迫升级。
        public const int SceneChangedSchemaVersion = 2;
        // 第一版失败恢复声明要求 commandResult 在自动恢复成功时携带新的物理场景激活标识。
        public const int SwitchSceneRecoverySchemaVersion = 1;
        // 第二版四态命令在来源时间之外增加显式修订二元组，保证同时间高修订不会被误判为重试。
        // 第三版节点状态结构增加壳内快照序号，并移除会误作因果门禁的可选来源修订标志。
        public const int SetNodeVisualStateSchemaVersion = 3;
        // 第一版清除命令只携带稳定三维节点和壳内快照序号，由场景控制器恢复登记时的基础视觉。
        public const int ClearNodeVisualStateSchemaVersion = 1;
        public const string MetadataFileName = "webgl-protocol-capabilities.json";

        /// <summary>
        /// 返回构建实际支持的完整下行命令能力。该数组与网页模板及 .jslib 白名单保持一致；
        /// 构建脚本只读取该小型元数据即可拒绝缺少清除交互描边能力的旧播放器。
        /// 每次返回新数组，避免编辑器构建代码改写运行时共享集合。
        /// </summary>
        public static string[] CreateCommandCapabilities()
        {
            return new[]
            {
                "init",
                "resize",
                "switchScene",
                "enterProcessStep",
                "resetScene",
                "focusNode",
                "clearSelection",
                "setNodeVisualState",
                "clearNodeVisualState",
                "setRouteFlow",
                "setNodeVisibility",
                "dispose"
            };
        }

        /// <summary>
        /// 返回构建实际支持的完整上行事件能力。
        /// 对象选中和选择清除共同组成三维到拓扑的反向链路，发布门禁必须静态核对两者，
        /// 不能只依赖网页模板运行时握手后才发现旧构建不兼容。
        /// </summary>
        public static string[] CreateEventCapabilities()
        {
            return new[]
            {
                "ready",
                "ack",
                "commandResult",
                "sceneLoadProgress",
                "sceneChanged",
                "objectSelected",
                "selectionCleared",
                "disposed"
            };
        }

        /// <summary>返回新数组，防止编辑器构建代码意外改写运行时共享的必填字段集合。</summary>
        public static string[] CreateSceneChangedRequiredFields()
        {
            return new[] { "requestId", "sceneId", "transitionId", "sceneActivationId", "success" };
        }

        /// <summary>强制重载是超时补偿的物理恢复保证，必须作为切换命令的显式必填字段发布。</summary>
        public static string[] CreateSwitchSceneRequiredFields()
        {
            return new[] { "sceneId", "transitionId", "sceneMappingVersion", "forceReload" };
        }

        /// <summary>自动恢复成功的失败结果必须声明原请求、失败状态和恢复后的物理场景激活标识。</summary>
        public static string[] CreateSwitchSceneRecoveryRequiredFields()
        {
            return new[] { "requestId", "success", "sceneActivationId" };
        }

        /// <summary>四态命令必须携带本地快照序号；平台时间和来源修订只保留为诊断字段。</summary>
        public static string[] CreateSetNodeVisualStateRequiredFields()
        {
            return new[] { "sceneNodeId", "visualState", "snapshotSequence", "statusUpdatedAt", "sourceRevision" };
        }

        /// <summary>清除命令不得携带颜色或四态；基础视觉只能由当前场景已登记的模型基线决定。</summary>
        public static string[] CreateClearNodeVisualStateRequiredFields()
        {
            return new[] { "sceneNodeId", "snapshotSequence" };
        }
    }

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
        // true 时协调器不能使用同场景快速路径，必须重建物理实例以清除超时动作的未知副作用。
        public bool forceReload;
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
        // 每次真实场景提交或恢复提交都会生成新标识；同场景快速完成不会改写它，供对象选择阻断 ABA 迟到回调。
        public string sceneActivationId;
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

        /// <summary>
        /// 验证请求的三个稳定标识；forceReload 是 JsonUtility 直接解析的固定布尔字段，
        /// 场景映射版本不能由缺省值或旧构建绕过。
        /// </summary>
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
                   IsBoundedIdentifier(payload.sceneActivationId) &&
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

        /// <summary>
        /// 聚焦选择标识用于跨前端与 Unity 的幂等关联。它只校验统一长度和非空边界，
        /// 不与 messageId（消息标识）或 transitionId（场景切换事务标识）隐式互换。
        /// </summary>
        public static bool IsValidSelectionId(string selectionId)
        {
            return SceneSwitchProtocolValidator.IsBoundedIdentifier(selectionId);
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

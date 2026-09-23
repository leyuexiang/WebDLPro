using System;
using System.Collections;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 新增场景的最小浏览控制器。四个场景只提供 Unity 场景切换和空拓扑占位，
    /// 不声明节点、设备状态或流程动作，待正式资料补齐后再扩展能力。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class UnavailableBusinessSceneController : MonoBehaviour, IBusinessSceneController
    {
        [SerializeField] private string _sceneId;
        private bool _released;

        public string SceneId => _sceneId;
        /// <summary>
        /// 占位场景没有业务能力，但必须支持释放：协调器在初始化失败或场景卸载时可无条件调用释放，
        /// 不会因为空内容再次得到“能力未声明”的噪声错误。
        /// </summary>
        public BusinessSceneCapability Capabilities =>
            IsEmptyPlaceholderScene
                ? BusinessSceneCapability.Initialize | BusinessSceneCapability.ResetScene | BusinessSceneCapability.Release
                : BusinessSceneCapability.Release;

        private bool IsEmptyPlaceholderScene => _sceneId == "wind-power" || _sceneId == "solar-power" ||
            _sceneId == "step-up-substation" || _sceneId == "step-down-substation";

        /// <summary>仅供受控编辑器生成器写入固定目录标识，不允许运行时改写场景身份。</summary>
        public void ConfigureForGeneratedScene(string sceneId)
        {
            if (Application.isPlaying)
            {
                throw new InvalidOperationException("运行时不能修改占位场景标识。");
            }
            _sceneId = sceneId;
        }

        public IEnumerator InitializeAsync(BusinessSceneInitializationContext context, Action<BusinessSceneCommandResult> completed)
        {
            // 仅校验固定场景身份；空拓扑不创建任何节点，也不猜测未提供的业务映射。
            if (context.SceneId == _sceneId && IsEmptyPlaceholderScene)
            {
                _released = false;
                completed?.Invoke(BusinessSceneCommandResult.Completed("新增场景空拓扑占位已就绪。"));
                yield break;
            }
            completed?.Invoke(BusinessSceneCommandResult.Failed(
                "scene-content-unavailable",
                $"场景 {context.SceneId} 尚未交付正式 Unity 内容。"));
            yield break;
        }

        public BusinessSceneCommandResult FocusNode(string sceneNodeId, bool isolate) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.FocusNode);
        public BusinessSceneCommandResult ClearSelection() => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ClearSelection);
        public BusinessSceneCommandResult UpdateNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.UpdateNodeVisualState);
        public BusinessSceneCommandResult ClearNodeVisualState(string sceneNodeId) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ClearNodeVisualState);
        public BusinessSceneCommandResult SetRouteFlow(string routeId, bool enabled, float speedMultiplier) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetRouteFlow);
        public BusinessSceneCommandResult SetNodeVisibility(string sceneNodeId, bool visible) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetNodeVisibility);
        public BusinessSceneCommandResult ResetScene() =>
            !_released && IsEmptyPlaceholderScene
                ? BusinessSceneCommandResult.Completed("新增场景空拓扑占位已复位。")
                : BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ResetScene);
        /// <summary>
        /// 空场景没有可回收的业务资源，仍以幂等成功封口生命周期。
        /// StopAllCoroutines 只清理本控制器未来可能启动的协程，不扫描全局对象或创建额外分配。
        /// </summary>
        public BusinessSceneCommandResult ReleaseScene()
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Completed("空业务场景控制器已释放。");
            }

            _released = true;
            StopAllCoroutines();
            return BusinessSceneCommandResult.Completed("空业务场景控制器已进入释放流程。");
        }
        public string GetStateDescription() => "content-unavailable";
    }
}

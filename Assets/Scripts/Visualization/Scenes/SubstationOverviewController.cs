using System;
using System.Collections;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>升降压站及已替换模型的风电、光伏共用最小浏览入口；保留类名避免资产引用漂移，不声明未确认的设备、流程和状态能力。</summary>
    [DisallowMultipleComponent]
    public sealed class SubstationOverviewController : MonoBehaviour, IBusinessSceneController, IBusinessSceneCameraResetController, IBusinessSceneNamedCameraPoseController
    {
        [SerializeField] private string _sceneId;
        [SerializeField] private Transform _sceneRoot;
        [SerializeField] private MonoBehaviour _cameraController;
        [SerializeField] private BusinessSceneNamedCameraPoseRegistry _namedCameraPoseRegistry;
        private bool _released;
        public const BusinessSceneCapability SupportedCapabilities = BusinessSceneCapability.Initialize | BusinessSceneCapability.ResetScene | BusinessSceneCapability.Release;
        public string SceneId => _sceneId;
        public BusinessSceneCapability Capabilities => _namedCameraPoseRegistry == null
            ? SupportedCapabilities
            : SupportedCapabilities | BusinessSceneCapability.MoveCameraToPose;

        public IEnumerator InitializeAsync(BusinessSceneInitializationContext context, Action<BusinessSceneCommandResult> completed)
        {
            // 四个场景必须显式绑定真实根节点和相机控制器；不能仅凭目录编号把空占位报告为就绪。
            if (context.SceneId != _sceneId || (_sceneId != "step-up-substation" && _sceneId != "step-down-substation" &&
                _sceneId != "wind-power" && _sceneId != "solar-power") ||
                _sceneRoot == null || !(_cameraController is IBusinessSceneCameraPoseController))
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed("substation-configuration-invalid", "变电站浏览场景身份或引用未配置。"));
                yield break;
            }
            _released = false;
            completed?.Invoke(BusinessSceneCommandResult.Completed("变电站浏览场景已就绪。"));
        }

        public BusinessSceneCommandResult ResetCamera()
        {
            if (_released || !(_cameraController is IBusinessSceneCameraPoseController camera))
                return BusinessSceneCommandResult.Failed("substation-not-ready", "变电站相机不可用。");
            camera.ResetToInitialTransform();
            return BusinessSceneCommandResult.Completed("已恢复变电站总览镜头。");
        }

        public BusinessSceneCommandResult MoveCameraToPose(string cameraPoseId)
        {
            if (_released || _namedCameraPoseRegistry == null)
                return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.MoveCameraToPose);
            return _namedCameraPoseRegistry.MoveCameraToPose(cameraPoseId);
        }
        public BusinessSceneCommandResult ResetScene() => ResetCamera();
        public BusinessSceneCommandResult ReleaseScene()
        {
            _released = true;
            return BusinessSceneCommandResult.Completed("变电站浏览场景已释放。");
        }
        public string GetStateDescription() => _released ? "released" : "overview";
        public BusinessSceneCommandResult FocusNode(string sceneNodeId, bool isolate) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.FocusNode);
        public BusinessSceneCommandResult ClearSelection() => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ClearSelection);
        public BusinessSceneCommandResult UpdateNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.UpdateNodeVisualState);
        public BusinessSceneCommandResult ClearNodeVisualState(string sceneNodeId) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ClearNodeVisualState);
        public BusinessSceneCommandResult SetRouteFlow(string routeId, bool enabled, float speedMultiplier) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetRouteFlow);
        public BusinessSceneCommandResult SetNodeVisibility(string sceneNodeId, bool visible) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetNodeVisibility);
    }
}

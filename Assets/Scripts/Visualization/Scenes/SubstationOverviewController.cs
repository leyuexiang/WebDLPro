using System;
using System.Collections;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>升降压站、换流站及已替换模型的风电、光伏共用浏览入口；三维节点与四态命令委托给场景内显式绑定的 PowerPlantProcessController。</summary>
    [DisallowMultipleComponent]
    public sealed class SubstationOverviewController : MonoBehaviour, IBusinessSceneController, IBusinessSceneCameraResetController, IBusinessSceneNamedCameraPoseController, IBusinessSceneProcessDetailController
    {
        [SerializeField] private string _sceneId;
        [SerializeField] private Transform _sceneRoot;
        [SerializeField] private MonoBehaviour _cameraController;
        [SerializeField] private BusinessSceneNamedCameraPoseRegistry _namedCameraPoseRegistry;
        // 业务场景控制器显式序列化，复用已有节点聚焦、反选和四态实现，禁止运行时按名称搜索组件。
        // 使用 MonoBehaviour 保存引用，避免场景运行程序集反向依赖默认 Assembly-CSharp。
        [SerializeField] private MonoBehaviour _processController;
        // 第三层协调器与二层控制器一样由场景资产显式绑定；桥接层通过本控制器消费统一第三层接口。
        [SerializeField] private MonoBehaviour _processDetailCoordinatorBehaviour;
        private IBusinessSceneNodeInteractionController ProcessController =>
            _processController as IBusinessSceneNodeInteractionController;
        private ProcessDetailCoordinator DetailCoordinator =>
            _processDetailCoordinatorBehaviour as ProcessDetailCoordinator;
        private bool _released;
        // 风电、光伏仍可复用同一浏览入口；未绑定流程控制器时只声明真实可用的基础能力。
        private const BusinessSceneCapability BrowsingCapabilities = BusinessSceneCapability.Initialize |
            BusinessSceneCapability.ResetScene |
            BusinessSceneCapability.Release;
        public const BusinessSceneCapability SupportedCapabilities = BrowsingCapabilities |
            BusinessSceneCapability.FocusNode |
            BusinessSceneCapability.ClearSelection |
            BusinessSceneCapability.UpdateNodeVisualState |
            BusinessSceneCapability.ClearNodeVisualState;
        public string SceneId => _sceneId;
        public BusinessSceneCapability Capabilities
        {
            get
            {
                BusinessSceneCapability capabilities = ProcessController == null
                    ? BrowsingCapabilities
                    : SupportedCapabilities;
                return _namedCameraPoseRegistry == null
                    ? capabilities
                    : capabilities | BusinessSceneCapability.MoveCameraToPose;
            }
        }

        public IEnumerator InitializeAsync(BusinessSceneInitializationContext context, Action<BusinessSceneCommandResult> completed)
        {
            bool requiresProcessDetail = _sceneId == "step-up-substation" || _sceneId == "step-down-substation" ||
                _sceneId == "converter-station" || _sceneId == "switching-station";
            if (context.SceneId != _sceneId || (_sceneId != "step-up-substation" && _sceneId != "step-down-substation" &&
                _sceneId != "wind-power" && _sceneId != "solar-power" && _sceneId != "converter-station" && _sceneId != "switching-station") ||
                _sceneRoot == null || !(_cameraController is IBusinessSceneCameraPoseController) ||
                (requiresProcessDetail && (ProcessController == null || DetailCoordinator == null)))
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
            if (DetailCoordinator != null && DetailCoordinator.IsActive)
            {
                return DetailCoordinator.ResetActiveCameraPose();
            }
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
            if (_released)
            {
                return BusinessSceneCommandResult.Completed("变电站浏览场景已经释放。");
            }

            BusinessSceneCommandResult detailResult = DetailCoordinator != null
                ? DetailCoordinator.Release()
                : BusinessSceneCommandResult.Completed("当前场景没有已装配的第三层协调器。");
            _released = true;
            return detailResult.Success
                ? BusinessSceneCommandResult.Completed("变电站浏览场景及第三层资源已释放。")
                : detailResult;
        }
        public string GetStateDescription() => _released ? "released" : "overview";
        public BusinessSceneCommandResult FocusNode(string sceneNodeId, bool isolate) => ProcessController == null
            ? BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.FocusNode)
            : ProcessController.TryFocusNode(sceneNodeId, isolate, out string focusMessage)
                ? BusinessSceneCommandResult.Completed(focusMessage)
                : BusinessSceneCommandResult.Failed("node-focus-failed", focusMessage);
        public BusinessSceneCommandResult ClearSelection() => ProcessController == null
            ? BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ClearSelection)
            : ProcessController.TryClearSelection(out string clearMessage)
                ? BusinessSceneCommandResult.Completed(clearMessage)
                : BusinessSceneCommandResult.Failed("selection-clear-failed", clearMessage);
        public BusinessSceneCommandResult UpdateNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState) => ProcessController == null
            ? BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.UpdateNodeVisualState)
            : ProcessController.UpdateNodeVisualState(sceneNodeId, visualState);
        public BusinessSceneCommandResult ClearNodeVisualState(string sceneNodeId) => ProcessController == null
            ? BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ClearNodeVisualState)
            : ProcessController.ClearNodeVisualState(sceneNodeId);

        public IEnumerator PrepareProcessDetailAsync(
            string sceneId,
            string processId,
            string stepId,
            string processDetailId,
            string transitionId,
            Action<BusinessSceneCommandResult> completed)
        {
            if (!TryUseDetailCoordinator(out ProcessDetailCoordinator coordinator, out BusinessSceneCommandResult unavailable))
            {
                completed?.Invoke(unavailable);
                yield break;
            }

            IEnumerator preparing = coordinator.PrepareAsync(
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
            return TryUseDetailCoordinator(out ProcessDetailCoordinator coordinator, out BusinessSceneCommandResult unavailable)
                ? coordinator.CommitPrepared(sceneId, processDetailId, transitionId)
                : unavailable;
        }

        public BusinessSceneCommandResult AbortPreparedProcessDetail(
            string sceneId,
            string processDetailId,
            string transitionId)
        {
            return TryUseDetailCoordinator(out ProcessDetailCoordinator coordinator, out BusinessSceneCommandResult unavailable)
                ? coordinator.AbortPrepared(sceneId, processDetailId, transitionId)
                : unavailable;
        }

        public IEnumerator EnterProcessDetailAsync(
            string sceneId,
            string processId,
            string stepId,
            string processDetailId,
            string transitionId,
            Action<BusinessSceneCommandResult> completed)
        {
            if (!TryUseDetailCoordinator(out ProcessDetailCoordinator coordinator, out BusinessSceneCommandResult unavailable))
            {
                completed?.Invoke(unavailable);
                yield break;
            }

            IEnumerator entering = coordinator.EnterAsync(
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
                (entering as IDisposable)?.Dispose();
            }
        }

        public BusinessSceneCommandResult ExitProcessDetail(
            string sceneId,
            string processDetailId,
            string transitionId)
        {
            return TryUseDetailCoordinator(out ProcessDetailCoordinator coordinator, out BusinessSceneCommandResult unavailable)
                ? coordinator.Exit(sceneId, processDetailId, transitionId)
                : unavailable;
        }

        public BusinessSceneCommandResult SetProcessDetailPlayback(
            string sceneId,
            string processDetailId,
            bool playing)
        {
            return TryUseDetailCoordinator(out ProcessDetailCoordinator coordinator, out BusinessSceneCommandResult unavailable)
                ? coordinator.SetPlayback(sceneId, processDetailId, playing)
                : unavailable;
        }

        public BusinessSceneCommandResult SetNodeVisibility(string sceneNodeId, bool visible) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetNodeVisibility);
        public BusinessSceneCommandResult SetRouteFlow(string routeId, bool enabled, float speedMultiplier) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetRouteFlow);
#if UNITY_EDITOR
        /// <summary>仅供编辑器生成器绑定当前场景的第三层协调器。</summary>
        public void ConfigureProcessDetailForEditor(MonoBehaviour processDetailCoordinatorBehaviour)
        {
            if (Application.isPlaying)
            {
                throw new InvalidOperationException("运行时不能修改第三层协调器配置。");
            }

            _processDetailCoordinatorBehaviour = processDetailCoordinatorBehaviour;
        }
#endif

        private bool TryUseDetailCoordinator(
            out ProcessDetailCoordinator coordinator,
            out BusinessSceneCommandResult failure)
        {
            coordinator = DetailCoordinator;
            if (_released)
            {
                failure = BusinessSceneCommandResult.Failed(
                    "scene-controller-released",
                    "变电站业务场景控制器已经释放。");
                return false;
            }
            if (coordinator == null)
            {
                failure = BusinessSceneCommandResult.Failed(
                    "process-detail-unsupported",
                    "当前变电站场景未装配第三层关键环节协调器。");
                return false;
            }

            failure = default;
            return true;
        }
    }
}

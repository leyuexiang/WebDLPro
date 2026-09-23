using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 总览场景控制器。当前负责独立场景生命周期和九个代表建筑的稳定点击代理；
    /// 建筑聚合、异常视觉、管道及区域影响继续由 R-008—R-014 分阶段接入。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class OverviewSceneController : MonoBehaviour, IBusinessSceneController, IBusinessSceneCameraResetController
    {
        // 与业务场景保持相同的单击判定阈值，避免相机拖拽结束时误触发建筑下钻。
        private const float PointerSelectionDragThreshold = 6f;
        private const float MaximumPickDistance = 5000f;

        private readonly Dictionary<string, OverviewBuildingPlaceholder> _buildingsById =
            new Dictionary<string, OverviewBuildingPlaceholder>(StringComparer.Ordinal);
        // 点击热路径直接按 Collider（碰撞体）读取建筑，不遍历九个占位对象，也不依赖对象名称或层级路径。
        private readonly Dictionary<Collider, OverviewBuildingPlaceholder> _buildingsByCollider =
            new Dictionary<Collider, OverviewBuildingPlaceholder>();
        // 故障来源节点由各建筑序列化配置；运行时只做字典查找，不按燃气、燃煤或对象名称写死分支。
        private readonly Dictionary<string, OverviewBuildingPlaceholder> _buildingsByFaultSourceNodeId =
            new Dictionary<string, OverviewBuildingPlaceholder>(StringComparer.Ordinal);
        // 同一建筑可由多个设备节点共同触发，只有最后一个活动故障清除后才恢复基础视觉。
        private readonly Dictionary<string, HashSet<string>> _activeFaultSourceNodeIdsByBuildingId =
            new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

        [SerializeField] private Camera _interactionCamera;

        private Vector2 _pointerPressPosition;
        private bool _pointerWasDragged;
        private bool _initialized;
        private bool _released;
        private string _activeBuildingId;
        // 总览相机控制接口首次复位时从已序列化的交互相机组件中解析并缓存，后续点击不再扫描组件。
        private IBusinessSceneCameraPoseController _cameraPoseController;

        // 事件只传递占位资产显式登记的建筑和目标场景标识；控制器不直接依赖多场景协调器。
        public event Action<string, string, string> BuildingSelected;
        public event Action BuildingSelectionCleared;

        public string SceneId => OverviewSceneCatalog.OverviewSceneId;
        public BusinessSceneCapability Capabilities =>
            BusinessSceneCapability.Initialize | BusinessSceneCapability.Release;
        public int RegisteredBuildingCount => _buildingsById.Count;
        public string ActiveBuildingId => _activeBuildingId ?? string.Empty;

        public IEnumerator InitializeAsync(BusinessSceneInitializationContext context, Action<BusinessSceneCommandResult> completed)
        {
            if (_released)
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-controller-released",
                    "总览控制器已经释放。"));
                yield break;
            }
            if (!string.Equals(context.SceneId, SceneId, StringComparison.Ordinal))
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-controller-mismatch",
                    "总览控制器场景标识与初始化目标不一致。"));
                yield break;
            }
            if (_interactionCamera == null)
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "overview-camera-missing",
                    "总览场景未配置交互相机。"));
                yield break;
            }

            _buildingsById.Clear();
            _buildingsByCollider.Clear();
            _buildingsByFaultSourceNodeId.Clear();
            _activeFaultSourceNodeIdsByBuildingId.Clear();
            // 目标场景只在初始化阶段校验一次；点击热路径直接读取占位组件，不创建集合或重复扫描。
            HashSet<string> targetSceneIds = new HashSet<string>(StringComparer.Ordinal);
            OverviewBuildingPlaceholder[] placeholders = GetComponentsInChildren<OverviewBuildingPlaceholder>(true);
            for (int index = 0; index < placeholders.Length; index++)
            {
                OverviewBuildingPlaceholder placeholder = placeholders[index];
                if (placeholder == null ||
                    string.IsNullOrWhiteSpace(placeholder.OverviewBuildingId) ||
                    string.IsNullOrWhiteSpace(placeholder.TargetSceneId) ||
                    !BusinessSceneCatalog.IsRequiredSceneId(placeholder.TargetSceneId) ||
                    placeholder.TargetRenderer == null ||
                    placeholder.InteractionCollider == null ||
                    placeholder.VisualStatePresenter == null)
                {
                    completed?.Invoke(BusinessSceneCommandResult.Failed(
                        "overview-building-binding-invalid",
                        "总览建筑缺少合法建筑标识、目标业务场景、渲染器、交互碰撞体或异常视觉呈现组件。"));
                    yield break;
                }
                if (_buildingsById.ContainsKey(placeholder.OverviewBuildingId))
                {
                    completed?.Invoke(BusinessSceneCommandResult.Failed(
                        "overview-building-id-duplicate",
                        $"总览建筑标识重复：{placeholder.OverviewBuildingId}。"));
                    yield break;
                }
                if (_buildingsByCollider.ContainsKey(placeholder.InteractionCollider))
                {
                    completed?.Invoke(BusinessSceneCommandResult.Failed(
                        "overview-building-collider-duplicate",
                        $"总览建筑 {placeholder.OverviewBuildingId} 与其他建筑共享交互碰撞体。"));
                    yield break;
                }
                if (!targetSceneIds.Add(placeholder.TargetSceneId))
                {
                    completed?.Invoke(BusinessSceneCommandResult.Failed(
                        "overview-building-target-scene-duplicate",
                        $"多个总览建筑重复映射目标业务场景：{placeholder.TargetSceneId}。"));
                    yield break;
                }

                IReadOnlyList<string> faultSourceNodeIds = placeholder.FaultSourceNodeIds;
                for (int sourceIndex = 0; sourceIndex < faultSourceNodeIds.Count; sourceIndex++)
                {
                    string faultSourceNodeId = faultSourceNodeIds[sourceIndex];
                    if (string.IsNullOrWhiteSpace(faultSourceNodeId))
                    {
                        completed?.Invoke(BusinessSceneCommandResult.Failed(
                            "overview-building-fault-source-invalid",
                            $"总览建筑 {placeholder.OverviewBuildingId} 配置了空故障来源节点 ID。"));
                        yield break;
                    }
                    if (_buildingsByFaultSourceNodeId.ContainsKey(faultSourceNodeId))
                    {
                        completed?.Invoke(BusinessSceneCommandResult.Failed(
                            "overview-building-fault-source-duplicate",
                            $"故障来源节点 {faultSourceNodeId} 被多个总览建筑重复绑定。"));
                        yield break;
                    }

                    _buildingsByFaultSourceNodeId.Add(faultSourceNodeId, placeholder);
                }

                _buildingsById.Add(placeholder.OverviewBuildingId, placeholder);
                _buildingsByCollider.Add(placeholder.InteractionCollider, placeholder);
            }

            _initialized = true;
            completed?.Invoke(BusinessSceneCommandResult.Completed(
                $"总览场景已就绪，代表建筑数：{_buildingsById.Count}。"));
            yield break;
        }

        private void Update()
        {
            if (!_initialized || _released)
            {
                return;
            }

            HandlePointerSelection();
        }

        /// <summary>
        /// 使用显式登记的交互碰撞体解析建筑标识和目标业务场景。地面、空白区域和未登记碰撞体均返回 false，
        /// 不会把对象名称、父级路径或坐标转换成业务标识。
        /// </summary>
        public bool TryResolveBuilding(
            Ray ray,
            out string overviewBuildingId,
            out string targetSceneId,
            out GameObject buildingRoot)
        {
            overviewBuildingId = string.Empty;
            targetSceneId = string.Empty;
            buildingRoot = null;
            if (!_initialized || _released ||
                !Physics.Raycast(ray, out RaycastHit hit, MaximumPickDistance, ~0, QueryTriggerInteraction.Ignore) ||
                !_buildingsByCollider.TryGetValue(hit.collider, out OverviewBuildingPlaceholder placeholder))
            {
                return false;
            }

            overviewBuildingId = placeholder.OverviewBuildingId;
            targetSceneId = placeholder.TargetSceneId;
            buildingRoot = placeholder.gameObject;
            return true;
        }

        private void HandlePointerSelection()
        {
            if (Input.GetMouseButtonDown(0))
            {
                _pointerPressPosition = Input.mousePosition;
                _pointerWasDragged = false;
                return;
            }
            if (Input.GetMouseButton(0))
            {
                if (!_pointerWasDragged)
                {
                    Vector2 pointerDelta = (Vector2)Input.mousePosition - _pointerPressPosition;
                    _pointerWasDragged = pointerDelta.sqrMagnitude >=
                        PointerSelectionDragThreshold * PointerSelectionDragThreshold;
                }

                return;
            }
            if (!Input.GetMouseButtonUp(0))
            {
                _pointerWasDragged = false;
                return;
            }

            Vector2 releaseDelta = (Vector2)Input.mousePosition - _pointerPressPosition;
            bool wasDragged = _pointerWasDragged ||
                releaseDelta.sqrMagnitude >= PointerSelectionDragThreshold * PointerSelectionDragThreshold;
            _pointerWasDragged = false;
            if (wasDragged || EventSystem.current != null && EventSystem.current.IsPointerOverGameObject())
            {
                return;
            }

            Ray ray = _interactionCamera.ScreenPointToRay(Input.mousePosition);
            if (TryResolveBuilding(
                    ray,
                    out string overviewBuildingId,
                    out string targetSceneId,
                    out GameObject buildingRoot))
            {
                _activeBuildingId = overviewBuildingId;
                // 稳定建筑事件由上层桥接适配器订阅；场景运行程序集不反向依赖 WebGL 通信实现。
                BuildingSelected?.Invoke(
                    overviewBuildingId,
                    targetSceneId,
                    buildingRoot.name);
                return;
            }

            ClearActiveSelection();
        }

        private void ClearActiveSelection()
        {
            if (string.IsNullOrEmpty(_activeBuildingId))
            {
                return;
            }

            _activeBuildingId = string.Empty;
            BuildingSelectionCleared?.Invoke();
        }

        /// <summary>
        /// 按建筑资产配置的来源节点应用故障。未绑定节点属于其它业务场景或尚未接入的设备，安全忽略而不阻断完整快照。
        /// </summary>
        public BusinessSceneCommandResult ApplyFaultSourceVisualState(
            string faultSourceNodeId,
            BusinessSceneNodeVisualState visualState)
        {
            if (_released || !_initialized)
            {
                return BusinessSceneCommandResult.Failed(
                    "overview-controller-unavailable",
                    "总览场景控制器尚未就绪，不能更新故障来源状态。");
            }
            if (visualState != BusinessSceneNodeVisualState.Fault)
            {
                return BusinessSceneCommandResult.Failed(
                    "overview-fault-source-state-unsupported",
                    "总览建筑来源节点只响应故障状态；恢复必须使用清除命令。");
            }
            if (string.IsNullOrWhiteSpace(faultSourceNodeId) ||
                !_buildingsByFaultSourceNodeId.TryGetValue(faultSourceNodeId, out OverviewBuildingPlaceholder building))
            {
                return BusinessSceneCommandResult.Completed($"状态节点 {faultSourceNodeId} 未绑定沙盘建筑，已忽略。");
            }
            if (building.VisualStatePresenter == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "overview-building-presenter-missing",
                    $"总览建筑 {building.OverviewBuildingId} 缺少异常视觉呈现组件。");
            }

            if (!_activeFaultSourceNodeIdsByBuildingId.TryGetValue(
                    building.OverviewBuildingId,
                    out HashSet<string> activeSourceNodeIds))
            {
                activeSourceNodeIds = new HashSet<string>(StringComparer.Ordinal);
                _activeFaultSourceNodeIdsByBuildingId.Add(building.OverviewBuildingId, activeSourceNodeIds);
            }

            if (activeSourceNodeIds.Add(faultSourceNodeId) && activeSourceNodeIds.Count == 1)
            {
                building.VisualStatePresenter.ApplyVisualState(BusinessSceneNodeVisualState.Fault);
            }

            return BusinessSceneCommandResult.Completed(
                $"故障来源节点 {faultSourceNodeId} 已作用于总览建筑 {building.OverviewBuildingId}。");
        }

        /// <summary>清除单个来源节点；同一建筑仍有其它活动故障时保持当前故障效果。</summary>
        public BusinessSceneCommandResult ClearFaultSourceVisualState(string faultSourceNodeId)
        {
            if (_released || !_initialized)
            {
                return BusinessSceneCommandResult.Failed(
                    "overview-controller-unavailable",
                    "总览场景控制器尚未就绪，不能清除故障来源状态。");
            }
            if (string.IsNullOrWhiteSpace(faultSourceNodeId) ||
                !_buildingsByFaultSourceNodeId.TryGetValue(faultSourceNodeId, out OverviewBuildingPlaceholder building))
            {
                return BusinessSceneCommandResult.Completed($"状态节点 {faultSourceNodeId} 未绑定沙盘建筑，无需清除。");
            }
            if (!_activeFaultSourceNodeIdsByBuildingId.TryGetValue(
                    building.OverviewBuildingId,
                    out HashSet<string> activeSourceNodeIds) ||
                !activeSourceNodeIds.Remove(faultSourceNodeId))
            {
                return BusinessSceneCommandResult.Completed(
                    $"故障来源节点 {faultSourceNodeId} 当前未激活，无需清除。");
            }

            if (activeSourceNodeIds.Count == 0)
            {
                _activeFaultSourceNodeIdsByBuildingId.Remove(building.OverviewBuildingId);
                building.VisualStatePresenter?.ClearVisualState();
            }

            return BusinessSceneCommandResult.Completed(
                $"故障来源节点 {faultSourceNodeId} 已从总览建筑 {building.OverviewBuildingId} 清除。");
        }

        public BusinessSceneCommandResult ApplyBuildingVisualState(
            string overviewBuildingId,
            BusinessSceneNodeVisualState visualState)
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Failed(
                    "scene-controller-released",
                    "总览控制器已经释放，不能更新建筑异常视觉。");
            }
            if (!_initialized ||
                string.IsNullOrWhiteSpace(overviewBuildingId) ||
                !_buildingsById.TryGetValue(overviewBuildingId, out OverviewBuildingPlaceholder building))
            {
                return BusinessSceneCommandResult.Failed(
                    "overview-building-unknown",
                    $"未知总览建筑标识：{overviewBuildingId}。");
            }
            if (building.VisualStatePresenter == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "overview-building-presenter-missing",
                    $"总览建筑 {overviewBuildingId} 缺少异常视觉呈现组件。");
            }

            building.VisualStatePresenter.ApplyVisualState(visualState);
            return BusinessSceneCommandResult.Completed(
                visualState == BusinessSceneNodeVisualState.Normal
                    ? $"总览建筑 {overviewBuildingId} 已恢复基础视觉。"
                    : $"总览建筑 {overviewBuildingId} 已更新为 {visualState} 异常视觉。");
        }

        /// <summary>
        /// 清除总览建筑的动态异常视觉。后续完整状态快照发现设备组不再上报时，
        /// 由聚合器调用本入口恢复基础视觉，不把“缺失状态”误解释为离线。
        /// </summary>
        public BusinessSceneCommandResult ClearBuildingVisualState(string overviewBuildingId)
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Failed(
                    "scene-controller-released",
                    "总览控制器已经释放，不能清除建筑异常视觉。");
            }
            if (!_initialized ||
                string.IsNullOrWhiteSpace(overviewBuildingId) ||
                !_buildingsById.TryGetValue(overviewBuildingId, out OverviewBuildingPlaceholder building))
            {
                return BusinessSceneCommandResult.Failed(
                    "overview-building-unknown",
                    $"未知总览建筑标识：{overviewBuildingId}。");
            }
            if (building.VisualStatePresenter == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "overview-building-presenter-missing",
                    $"总览建筑 {overviewBuildingId} 缺少异常视觉呈现组件。");
            }

            building.VisualStatePresenter.ClearVisualState();
            return BusinessSceneCommandResult.Completed($"总览建筑 {overviewBuildingId} 已清除异常视觉。");
        }

        public BusinessSceneCommandResult FocusNode(string sceneNodeId, bool isolate)
        {
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.FocusNode);
        }

        public BusinessSceneCommandResult ClearSelection()
        {
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ClearSelection);
        }

        public BusinessSceneCommandResult UpdateNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState)
        {
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.UpdateNodeVisualState);
        }

        public BusinessSceneCommandResult ClearNodeVisualState(string sceneNodeId)
        {
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ClearNodeVisualState);
        }

        public BusinessSceneCommandResult SetRouteFlow(string routeId, bool enabled, float speedMultiplier)
        {
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetRouteFlow);
        }

        public BusinessSceneCommandResult SetNodeVisibility(string sceneNodeId, bool visible)
        {
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetNodeVisibility);
        }

        /// <summary>
        /// 平滑恢复总览相机首次加载时缓存的位置和旋转，并清除当前建筑选择。
        /// 建筑异常状态呈现器不在此处重置，因此故障高亮、停流和球形脉冲继续保持当前状态。
        /// 选择清除事件由桥接命令成功后统一发送，避免控制器事件和命令处理各发送一次。
        /// </summary>
        public BusinessSceneCommandResult ResetCamera()
        {
            if (_released || !_initialized)
            {
                return BusinessSceneCommandResult.Failed("overview-controller-unavailable", "总览场景控制器尚未就绪。");
            }

            if (_cameraPoseController == null)
            {
                MonoBehaviour[] cameraBehaviours = _interactionCamera.GetComponents<MonoBehaviour>();
                for (int behaviourIndex = 0; behaviourIndex < cameraBehaviours.Length; behaviourIndex++)
                {
                    if (cameraBehaviours[behaviourIndex] is IBusinessSceneCameraPoseController resolvedController)
                    {
                        _cameraPoseController = resolvedController;
                        break;
                    }
                }
            }

            if (_cameraPoseController == null)
            {
                return BusinessSceneCommandResult.Failed("camera-reset-unavailable", "总览场景缺少相机复位控制器。");
            }

            _cameraPoseController.ResetToInitialTransform();
            // 只清空选择标识，不调用 ClearActiveSelection；selectionCleared（选择清除）由桥接层成功后统一上报。
            _activeBuildingId = string.Empty;
            return BusinessSceneCommandResult.Completed("已开始恢复总览场景的初始镜头并清除建筑选择，故障效果保持不变。");
        }

        public BusinessSceneCommandResult ResetScene()
        {
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ResetScene);
        }

        public BusinessSceneCommandResult ReleaseScene()
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Completed("总览场景控制器已释放。");
            }

            foreach (KeyValuePair<string, OverviewBuildingPlaceholder> pair in _buildingsById)
            {
                // 场景退出时子对象可能先销毁，不能用 ?. 绕过 Unity 的失效对象检查。
                OverviewBuildingPlaceholder placeholder = pair.Value;
                if (placeholder != null && placeholder.VisualStatePresenter != null)
                {
                    placeholder.VisualStatePresenter.ReleaseVisualState();
                }
            }
            _released = true;
            _initialized = false;
            _activeBuildingId = string.Empty;
            _cameraPoseController = null;
            _buildingsById.Clear();
            _buildingsByCollider.Clear();
            _buildingsByFaultSourceNodeId.Clear();
            _activeFaultSourceNodeIdsByBuildingId.Clear();
            StopAllCoroutines();
            return BusinessSceneCommandResult.Completed("总览场景控制器已释放。");
        }

        public string GetStateDescription()
        {
            if (_released)
            {
                return "released";
            }

            return _initialized
                ? $"ready;buildings={_buildingsById.Count};selected={ActiveBuildingId}"
                : "not-initialized";
        }

#if UNITY_EDITOR
        /// <summary>仅供编辑器场景生成器写入总览交互相机，运行时不允许重配场景引用。</summary>
        public void ConfigureForEditor(Camera interactionCamera)
        {
            if (Application.isPlaying)
            {
                throw new InvalidOperationException("运行时不能修改总览交互相机。");
            }

            _interactionCamera = interactionCamera;
        }
#endif
    }
}

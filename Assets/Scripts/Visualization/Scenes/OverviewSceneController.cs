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
    public sealed class OverviewSceneController : MonoBehaviour, IBusinessSceneController
    {
        // 与业务场景保持相同的单击判定阈值，避免相机拖拽结束时误触发建筑下钻。
        private const float PointerSelectionDragThreshold = 6f;
        private const float MaximumPickDistance = 5000f;

        private readonly Dictionary<string, OverviewBuildingPlaceholder> _buildingsById =
            new Dictionary<string, OverviewBuildingPlaceholder>(StringComparer.Ordinal);
        // 点击热路径直接按 Collider（碰撞体）读取建筑，不遍历九个占位对象，也不依赖对象名称或层级路径。
        private readonly Dictionary<Collider, OverviewBuildingPlaceholder> _buildingsByCollider =
            new Dictionary<Collider, OverviewBuildingPlaceholder>();

        [SerializeField] private Camera _interactionCamera;

        private Vector2 _pointerPressPosition;
        private bool _pointerWasDragged;
        private bool _initialized;
        private bool _released;
        private string _activeBuildingId;

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

        public BusinessSceneCommandResult EnterProcessStep(string processId, string stepId, string unitId, bool isolate)
        {
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.EnterProcessStep);
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
                pair.Value.VisualStatePresenter?.ReleaseVisualState();
            }
            _released = true;
            _initialized = false;
            _activeBuildingId = string.Empty;
            _buildingsById.Clear();
            _buildingsByCollider.Clear();
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

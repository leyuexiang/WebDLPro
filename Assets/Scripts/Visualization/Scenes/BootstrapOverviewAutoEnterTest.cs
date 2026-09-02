using System;
using System.Collections;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// Bootstrap 本地联调辅助器：从 Bootstrap 场景直接进入播放模式时，
    /// 先通过正式多场景协调器进入总览；点击总览建筑后，再将显式目标场景转交给同一协调器。
    /// 该组件只在 Unity 编辑器中执行，发布构建仍由网页平台下发 switchScene 命令。
    /// </summary>
    [DisallowMultipleComponent]
    [DefaultExecutionOrder(1000)]
    public sealed class BootstrapOverviewAutoEnterTest : MonoBehaviour
    {
        private const string InitialOverviewTransitionId = "transition.bootstrap-overview-test";

#if UNITY_EDITOR
        /// <summary>
        /// 自动化播放模式测试在加载 Bootstrap 前启用此门禁，避免辅助跳转抢占测试自己的场景事务。
        /// 仅保存在当前脚本域内，退出播放或重新编译后自动恢复默认值。
        /// </summary>
        public static bool SuppressForAutomatedTests { get; set; }

        private MultiSceneCoordinator _coordinator;
        private OverviewSceneController _overviewController;
        private string _pendingTransitionId = string.Empty;
        private int _buildingTransitionSequence;
#endif

        private IEnumerator Start()
        {
#if !UNITY_EDITOR
            // 正式构建必须等待受控平台命令，测试辅助器不得自行改变生产启动流程。
            yield break;
#else
            // 延后一帧，确保同一 BootstrapRuntime 上的协调器和网页桥接器均已完成 Start。
            yield return null;
            if (SuppressForAutomatedTests)
            {
                yield break;
            }

            _coordinator = GetComponent<MultiSceneCoordinator>();
            if (_coordinator == null)
            {
                Debug.LogError("[Bootstrap总览测试] BootstrapRuntime 缺少 MultiSceneCoordinator，无法进入总览。", this);
                yield break;
            }
            if (_coordinator.State != MultiSceneCoordinatorState.Idle ||
                !string.IsNullOrEmpty(_coordinator.ActiveSceneId))
            {
                // 若平台或其他测试已先发起事务，不抢占其提交权，避免本地辅助逻辑改变正式协议时序。
                Debug.LogWarning("[Bootstrap总览测试] 协调器已开始处理其他场景事务，跳过自动进入总览。", this);
                yield break;
            }

            _coordinator.ActiveControllerChanged += HandleActiveControllerChanged;
            _coordinator.SceneSwitchCompleted += HandleSceneSwitchCompleted;
            SubmitSceneSwitch(OverviewSceneCatalog.OverviewSceneId, InitialOverviewTransitionId);
#endif
        }

#if UNITY_EDITOR
        /// <summary>
        /// 活动控制器变化时只订阅当前总览实例。旧总览在卸载前立即解除，避免迟到点击切换新场景。
        /// </summary>
        private void HandleActiveControllerChanged(IBusinessSceneController controller)
        {
            UnsubscribeOverviewController();
            _overviewController = controller as OverviewSceneController;
            if (_overviewController != null)
            {
                _overviewController.BuildingSelected += HandleOverviewBuildingSelected;
            }
        }

        /// <summary>
        /// 编辑器本地没有网页平台回发命令，因此把总览组件已校验的目标 sceneId 直接交给正式协调器。
        /// 建筑名称和层级不参与映射；加载期间拒绝重复点击，避免新事务无意义地取代当前请求。
        /// </summary>
        private void HandleOverviewBuildingSelected(string overviewBuildingId, string targetSceneId, string buildingName)
        {
            if (_coordinator == null ||
                _coordinator.State != MultiSceneCoordinatorState.Ready ||
                !string.Equals(_coordinator.ActiveSceneId, OverviewSceneCatalog.OverviewSceneId, StringComparison.Ordinal) ||
                !string.IsNullOrEmpty(_pendingTransitionId))
            {
                return;
            }

            _buildingTransitionSequence++;
            string transitionId = $"transition.bootstrap-building-{_buildingTransitionSequence}";
            Debug.Log(
                $"[Bootstrap总览测试] 点击建筑 {overviewBuildingId}，正在进入场景 {targetSceneId}。",
                this);
            SubmitSceneSwitch(targetSceneId, transitionId);
        }

        private void SubmitSceneSwitch(string sceneId, string transitionId)
        {
            _pendingTransitionId = transitionId;
            if (_coordinator.RequestSwitchScene(sceneId, transitionId))
            {
                return;
            }

            _pendingTransitionId = string.Empty;
            Debug.LogError($"[Bootstrap总览测试] 场景 {sceneId} 的切换请求未被协调器接收。", this);
        }

        private void HandleSceneSwitchCompleted(SceneSwitchResult result)
        {
            if (!string.Equals(result.TransitionId, _pendingTransitionId, StringComparison.Ordinal))
            {
                return;
            }

            _pendingTransitionId = string.Empty;
            if (result.Success)
            {
                Debug.Log($"[Bootstrap总览测试] 已进入场景 {result.SceneId}。", this);
                return;
            }

            Debug.LogError(
                $"[Bootstrap总览测试] 进入场景 {result.SceneId} 失败，错误码：{result.ErrorCode}，阶段：{result.StageCode}。",
                this);
        }

        private void UnsubscribeOverviewController()
        {
            if (_overviewController == null)
            {
                return;
            }

            _overviewController.BuildingSelected -= HandleOverviewBuildingSelected;
            _overviewController = null;
        }
#endif

        private void OnDestroy()
        {
#if UNITY_EDITOR
            UnsubscribeOverviewController();
            if (_coordinator != null)
            {
                _coordinator.ActiveControllerChanged -= HandleActiveControllerChanged;
                _coordinator.SceneSwitchCompleted -= HandleSceneSwitchCompleted;
            }
#endif
        }
    }
}

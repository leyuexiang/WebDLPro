using System;
using System.Collections.Generic;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 当前业务场景可选的命名镜头位能力。
    /// 调用方只能传入场景内已登记的稳定标识，不能跨协议传入位置、旋转或 Unity 层级路径。
    /// </summary>
    public interface IBusinessSceneNamedCameraPoseController
    {
        BusinessSceneCommandResult MoveCameraToPose(string cameraPoseId);
    }

    /// <summary>
    /// 命名镜头步骤所需的模型视觉聚焦能力。
    /// 接口位于场景运行程序集，避免镜头注册表反向依赖具体发电控制器实现。
    /// </summary>
    public interface IBusinessSceneNamedCameraVisualFocusController
    {
        bool TryApplyNamedCameraVisualFocus(IReadOnlyList<GameObject> targets, out string message);
    }

    /// <summary>
    /// 将稳定镜头点标识映射到场景中的显式 Transform，并在移动前委托发电流程控制器应用模型视觉聚焦。
    /// 每个步骤可绑定一个或多个模型：目标保持原材质并使用脉冲描边，其余场景模型统一半透明。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class BusinessSceneNamedCameraPoseRegistry : MonoBehaviour
    {
        [Serializable]
        private sealed class CameraPoseBinding
        {
            [SerializeField] private string _cameraPoseId;
            [SerializeField] private Transform _targetPose;
            [Tooltip("当前步骤需要保持原材质并显示脉冲描边的一个或多个模型；其余场景模型由发电流程控制器统一淡化。")]
            [SerializeField] private GameObject[] _highlightTargets = Array.Empty<GameObject>();

            public string CameraPoseId => _cameraPoseId;
            public Transform TargetPose => _targetPose;
            public GameObject[] HighlightTargets => _highlightTargets ?? Array.Empty<GameObject>();
        }

        [Header("相机控制器")]
        [Tooltip("必须实现 IBusinessSceneCameraPoseController；燃气和燃煤场景均复用现有 PowerPlantFreeCameraController。")]
        [SerializeField] private MonoBehaviour _cameraControllerBehaviour;
        [Tooltip("复用发电场景现有的模型描边闪烁与上下文半透明逻辑；每个命名镜头步骤都会先应用模型视觉聚焦。")]
        [SerializeField] private MonoBehaviour _visualFocusControllerBehaviour;

        [Header("命名镜头点")]
        [Tooltip("稳定 cameraPoseId、场景占位点与步骤高亮模型组的显式映射；每个镜头点必须至少配置一个有效高亮目标。")]
        [SerializeField] private CameraPoseBinding[] _cameraPoses = Array.Empty<CameraPoseBinding>();

        // 运行时只在初始化阶段建立一次索引；每次按钮调用均为常数时间查询，不扫描场景层级。
        private readonly Dictionary<string, CameraPoseBinding> _posesById =
            new Dictionary<string, CameraPoseBinding>(StringComparer.Ordinal);

        private IBusinessSceneCameraPoseController _cameraController;
        private IBusinessSceneNamedCameraVisualFocusController _visualFocusController;
        private bool _cacheInitialized;
        private bool _configurationValid;

        private void Awake()
        {
            CacheBindings();
        }

        /// <summary>
        /// 原子执行步骤视觉聚焦与固定镜头插值。视觉聚焦失败时不会移动相机，避免出现镜头已切换但模型效果缺失的半完成状态。
        /// </summary>
        public BusinessSceneCommandResult MoveCameraToPose(string cameraPoseId)
        {
            if (!_cacheInitialized)
            {
                CacheBindings();
            }

            if (!_configurationValid || _cameraController == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "camera-pose-configuration-invalid",
                    "当前场景的命名镜头点、相机控制器或模型视觉聚焦配置无效。");
            }

            if (string.IsNullOrWhiteSpace(cameraPoseId) ||
                !_posesById.TryGetValue(cameraPoseId, out CameraPoseBinding binding) ||
                binding == null ||
                binding.TargetPose == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "camera-pose-unknown",
                    $"当前场景未登记镜头点：{cameraPoseId}。");
            }

            string visualMessage = string.Empty;
            if (_visualFocusController == null ||
                !_visualFocusController.TryApplyNamedCameraVisualFocus(binding.HighlightTargets, out visualMessage))
            {
                return BusinessSceneCommandResult.Failed(
                    "camera-pose-visual-focus-invalid",
                    string.IsNullOrWhiteSpace(visualMessage) ? "当前镜头步骤缺少模型高亮配置。" : visualMessage);
            }

            _cameraController.MoveToPose(binding.TargetPose);
            return BusinessSceneCommandResult.Completed($"已高亮步骤模型并开始移动到镜头点：{cameraPoseId}。");
        }

        /// <summary>
        /// 平滑恢复到当前场景相机首次加载时缓存的位置和旋转。
        /// 该入口复用自由相机现有补间，不修改流程步骤、模型显隐、描边、选中或设备四态。
        /// </summary>
        public BusinessSceneCommandResult ResetCamera()
        {
            if (!_cacheInitialized)
            {
                CacheBindings();
            }

            if (_cameraController == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "camera-reset-configuration-invalid",
                    "当前场景缺少可用的相机复位控制器。");
            }

            _cameraController.ResetToInitialTransform();
            return BusinessSceneCommandResult.Completed("已开始恢复当前场景的初始镜头。");
        }

        /// <summary>
        /// 将序列化数组转换为只读运行索引。重复标识、空标识、空镜头引用或空高亮目标会使配置整体失效。
        /// </summary>
        private void CacheBindings()
        {
            _posesById.Clear();
            _cameraController = _cameraControllerBehaviour as IBusinessSceneCameraPoseController;
            _visualFocusController = _visualFocusControllerBehaviour as IBusinessSceneNamedCameraVisualFocusController;
            _configurationValid = _cameraController != null && _visualFocusController != null;

            CameraPoseBinding[] poses = _cameraPoses ?? Array.Empty<CameraPoseBinding>();
            for (int poseIndex = 0; poseIndex < poses.Length; poseIndex++)
            {
                CameraPoseBinding binding = poses[poseIndex];
                GameObject[] highlightTargets = binding?.HighlightTargets;
                if (binding == null ||
                    string.IsNullOrWhiteSpace(binding.CameraPoseId) ||
                    binding.TargetPose == null ||
                    highlightTargets == null ||
                    highlightTargets.Length == 0 ||
                    ContainsNullTarget(highlightTargets) ||
                    _posesById.ContainsKey(binding.CameraPoseId))
                {
                    _configurationValid = false;
                    continue;
                }

                _posesById.Add(binding.CameraPoseId, binding);
            }

            _cacheInitialized = true;
        }

        /// <summary>初始化阶段校验模型组，避免按钮点击后才发现空引用并留下半完成镜头状态。</summary>
        private static bool ContainsNullTarget(GameObject[] targets)
        {
            for (int targetIndex = 0; targetIndex < targets.Length; targetIndex++)
            {
                if (targets[targetIndex] == null)
                {
                    return true;
                }
            }

            return false;
        }
    }
}

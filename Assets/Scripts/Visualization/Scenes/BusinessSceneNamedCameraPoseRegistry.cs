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
    /// 将稳定镜头点标识映射到场景中的显式 Transform，并委托现有自由相机控制器播放平滑插值。
    /// 本组件不修改流程步骤、模型显隐、描边、选中状态或设备四态，仅负责相机位置和旋转。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class BusinessSceneNamedCameraPoseRegistry : MonoBehaviour
    {
        [Serializable]
        private sealed class CameraPoseBinding
        {
            [SerializeField] private string _cameraPoseId;
            [SerializeField] private Transform _targetPose;

            public string CameraPoseId => _cameraPoseId;
            public Transform TargetPose => _targetPose;
        }

        [Header("相机控制器")]
        [Tooltip("必须实现 IBusinessSceneCameraPoseController；燃气和燃煤场景均复用现有 PowerPlantFreeCameraController。")]
        [SerializeField] private MonoBehaviour _cameraControllerBehaviour;

        [Header("命名镜头点")]
        [Tooltip("稳定 cameraPoseId 与场景占位点的显式映射。燃煤场景可先保留空数组，后续再追加镜头点。")]
        [SerializeField] private CameraPoseBinding[] _cameraPoses = Array.Empty<CameraPoseBinding>();

        // 运行时只在初始化阶段建立一次索引；每次按钮调用均为常数时间查询，不扫描场景层级。
        private readonly Dictionary<string, Transform> _posesById =
            new Dictionary<string, Transform>(StringComparer.Ordinal);

        private IBusinessSceneCameraPoseController _cameraController;
        private bool _cacheInitialized;
        private bool _configurationValid;

        private void Awake()
        {
            CacheBindings();
        }

        /// <summary>
        /// 播放到已登记镜头点的插值动画。该方法只调用相机位接口，不接触任何流程或视觉状态。
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
                    "当前场景的命名镜头点配置无效或缺少相机控制器。");
            }

            if (string.IsNullOrWhiteSpace(cameraPoseId) ||
                !_posesById.TryGetValue(cameraPoseId, out Transform targetPose) ||
                targetPose == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "camera-pose-unknown",
                    $"当前场景未登记镜头点：{cameraPoseId}。");
            }

            _cameraController.MoveToPose(targetPose);
            return BusinessSceneCommandResult.Completed($"已开始移动到镜头点：{cameraPoseId}。");
        }

        /// <summary>
        /// 将序列化数组转换为只读运行索引。空数组是合法的预留接口；重复标识、空标识或空引用会使配置整体失效。
        /// </summary>
        private void CacheBindings()
        {
            _posesById.Clear();
            _cameraController = _cameraControllerBehaviour as IBusinessSceneCameraPoseController;
            _configurationValid = _cameraController != null;

            CameraPoseBinding[] poses = _cameraPoses ?? Array.Empty<CameraPoseBinding>();
            for (int poseIndex = 0; poseIndex < poses.Length; poseIndex++)
            {
                CameraPoseBinding binding = poses[poseIndex];
                if (binding == null ||
                    string.IsNullOrWhiteSpace(binding.CameraPoseId) ||
                    binding.TargetPose == null ||
                    _posesById.ContainsKey(binding.CameraPoseId))
                {
                    _configurationValid = false;
                    continue;
                }

                _posesById.Add(binding.CameraPoseId, binding.TargetPose);
            }

            _cacheInitialized = true;
        }
    }
}

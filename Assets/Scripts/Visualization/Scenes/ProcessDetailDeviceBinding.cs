using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Scripting;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 第三层包装预制体的统一设备绑定器。所有稳定标识、展示锚点、相机位和适配器均由编辑器序列化，
    /// 运行时不按名称搜索模型，也不把气流或右侧透明壳加入状态材质覆盖集合。
    /// </summary>
    [Preserve]
    [DisallowMultipleComponent]
    public sealed class ProcessDetailDeviceBinding : MonoBehaviour, IProcessDetailMultiBindingController
    {
        [Header("稳定标识")]
        [SerializeField] private string _processDetailId;
        [SerializeField] private string _resourceId;
        [SerializeField] private string _cameraPoseId;
        // 每个状态节点与视觉适配器按索引一一对应；动态目标独立登记，播放命令不受四态影响。
        [SerializeField] private string[] _stateNodeIds = Array.Empty<string>();
        [SerializeField] private string[] _dynamicTargetIds = Array.Empty<string>();

        [Header("显式引用")]
        [SerializeField] private Transform _displayAnchor;
        [SerializeField] private Transform _cameraPose;
        [SerializeField] private MonoBehaviour[] _dynamicTargetBehaviours = Array.Empty<MonoBehaviour>();
        [SerializeField] private MonoBehaviour[] _visualStateTargetBehaviours = Array.Empty<MonoBehaviour>();
        [SerializeField] private ProcessDetailOwnedResourceMarker _resourceMarker;

        private IProcessDetailDynamicTarget[] _dynamicTargets;
        private IProcessDetailVisualStateTarget[] _visualStateTargets;
        private bool _released;

        public string ProcessDetailId => _processDetailId ?? string.Empty;
        public string ResourceId => _resourceId ?? string.Empty;
        public string CameraPoseId => _cameraPoseId ?? string.Empty;
        public string StateNodeId => _stateNodeIds != null && _stateNodeIds.Length > 0 ? _stateNodeIds[0] : string.Empty;
        public IReadOnlyList<string> StateNodeIds => _stateNodeIds ?? Array.Empty<string>();
        public IReadOnlyList<string> DynamicTargetIds => _dynamicTargetIds ?? Array.Empty<string>();
        public Transform DisplayAnchor => _displayAnchor;
        public Transform CameraPose => _cameraPose;

        public BusinessSceneCommandResult ValidateBinding(ProcessDetailCatalogEntry entry)
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Failed(
                    "process-detail-instance-released",
                    "关键环节包装实例已经释放。" );
            }
            if (entry == null || _displayAnchor == null || _cameraPose == null || _resourceMarker == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "process-detail-instance-binding-invalid",
                    "关键环节包装缺少目录项、展示锚点、相机位或资源释放标记。" );
            }

            if (!TryResolveAdapters())
            {
                return BusinessSceneCommandResult.Failed(
                    "process-detail-instance-adapter-invalid",
                    "关键环节包装缺少动态目标或状态视觉适配器。" );
            }

            bool identifiersMatch =
                string.Equals(entry.ProcessDetailId, _processDetailId, StringComparison.Ordinal) &&
                string.Equals(entry.ResourceId, _resourceId, StringComparison.Ordinal) &&
                string.Equals(entry.CameraPoseId, _cameraPoseId, StringComparison.Ordinal) &&
                IdentifiersMatch(entry.StateNodeIds, _stateNodeIds) &&
                IdentifiersMatch(entry.DynamicTargetIds, _dynamicTargetIds) &&
                string.Equals(_resourceMarker.ResourceId, _resourceId, StringComparison.Ordinal);
            return identifiersMatch
                ? BusinessSceneCommandResult.Completed("关键环节包装显式绑定校验完成。")
                : BusinessSceneCommandResult.Failed(
                    "process-detail-instance-id-mismatch",
                    "关键环节包装标识与本地目录不一致。" );
        }

        /// <summary>
        /// 兼容旧单节点调用；实例未激活时仅应用最新视觉状态，播放基线保持预制体自身配置。
        /// 通用协调器使用下面的多节点重放接口，设备四态不会隐式改变动画、粒子或气流。
        /// </summary>
        public BusinessSceneCommandResult PrepareForActivation(bool hasVisualState, BusinessSceneNodeVisualState visualState)
        {
            return PrepareForActivation(hasVisualState
                ? new Dictionary<string, BusinessSceneNodeVisualState> { { StateNodeId, visualState } }
                : null);
        }

        public BusinessSceneCommandResult ApplyVisualState(BusinessSceneNodeVisualState visualState)
        {
            return ApplyVisualState(StateNodeId, visualState);
        }

        public BusinessSceneCommandResult ClearVisualState()
        {
            return ClearVisualState(StateNodeId);
        }

        /// <summary>按节点索引重放多设备状态，避免加载或状态热路径扫描模型层级。</summary>
        public BusinessSceneCommandResult PrepareForActivation(IReadOnlyDictionary<string, BusinessSceneNodeVisualState> visualStates)
        {
            for (int index = 0; index < _stateNodeIds.Length; index++)
            {
                BusinessSceneCommandResult result = visualStates != null && visualStates.TryGetValue(_stateNodeIds[index], out BusinessSceneNodeVisualState visualState)
                    ? _visualStateTargets[index].ApplyVisualState(visualState)
                    : _visualStateTargets[index].ClearVisualState();
                if (!result.Success)
                {
                    return result;
                }
            }
            return BusinessSceneCommandResult.Completed("关键环节已在激活前应用最新视觉状态。");
        }

        public BusinessSceneCommandResult ApplyVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState)
        {
            int index = FindStateNodeIndex(sceneNodeId);
            return !IsAvailable() || index < 0
                ? BusinessSceneCommandResult.Failed("process-detail-instance-unavailable", "关键环节包装实例、节点或适配器不可用。")
                : _visualStateTargets[index].ApplyVisualState(visualState);
        }

        public BusinessSceneCommandResult ClearVisualState(string sceneNodeId)
        {
            int index = FindStateNodeIndex(sceneNodeId);
            return !IsAvailable() || index < 0
                ? BusinessSceneCommandResult.Failed("process-detail-instance-unavailable", "关键环节包装实例、节点或适配器不可用。")
                : _visualStateTargets[index].ClearVisualState();
        }

        /// <summary>独立设置当前包装实例的动态播放许可，不读取或修改设备视觉状态。</summary>
        public BusinessSceneCommandResult SetPlayback(bool playing)
        {
            if (!IsAvailable())
            {
                return BusinessSceneCommandResult.Failed(
                    "process-detail-instance-unavailable",
                    "关键环节包装实例或动态适配器不可用。" );
            }

            for (int index = 0; index < _dynamicTargets.Length; index++)
            {
                _dynamicTargets[index].SetPlayback(playing);
            }
            return BusinessSceneCommandResult.Completed(
                playing ? "关键环节动态效果已开始播放。" : "关键环节动态效果已停止。" );
        }

        public void StopForRelease()
        {
            if (_dynamicTargets == null)
            {
                return;
            }
            for (int index = 0; index < _dynamicTargets.Length; index++)
            {
                _dynamicTargets[index]?.StopForRelease();
            }
        }

        public void ReleaseInstance()
        {
            if (_released)
            {
                return;
            }

            _released = true;
            for (int index = 0; _dynamicTargets != null && index < _dynamicTargets.Length; index++)
            {
                _dynamicTargets[index]?.Release();
            }
            for (int index = 0; _visualStateTargets != null && index < _visualStateTargets.Length; index++)
            {
                _visualStateTargets[index]?.Release();
            }
            _dynamicTargets = null;
            _visualStateTargets = null;
        }

        private bool TryResolveAdapters()
        {
            if (_stateNodeIds == null || _dynamicTargetIds == null || _visualStateTargetBehaviours == null ||
                _dynamicTargetBehaviours == null || _stateNodeIds.Length == 0 ||
                _stateNodeIds.Length != _visualStateTargetBehaviours.Length ||
                _dynamicTargetIds.Length != _dynamicTargetBehaviours.Length)
            {
                return false;
            }
            _dynamicTargets = new IProcessDetailDynamicTarget[_dynamicTargetBehaviours.Length];
            _visualStateTargets = new IProcessDetailVisualStateTarget[_visualStateTargetBehaviours.Length];
            for (int index = 0; index < _dynamicTargets.Length; index++)
            {
                _dynamicTargets[index] = _dynamicTargetBehaviours[index] as IProcessDetailDynamicTarget;
                if (_dynamicTargets[index] == null)
                {
                    return false;
                }
            }
            for (int index = 0; index < _visualStateTargets.Length; index++)
            {
                _visualStateTargets[index] = _visualStateTargetBehaviours[index] as IProcessDetailVisualStateTarget;
                if (_visualStateTargets[index] == null)
                {
                    return false;
                }
            }
            return true;
        }

        private bool IsAvailable()
        {
            return !_released && _dynamicTargets != null && _visualStateTargets != null;
        }

        private int FindStateNodeIndex(string sceneNodeId)
        {
            for (int index = 0; index < _stateNodeIds.Length; index++)
            {
                if (string.Equals(_stateNodeIds[index], sceneNodeId, StringComparison.Ordinal))
                {
                    return index;
                }
            }
            return -1;
        }

        private static bool IdentifiersMatch(IReadOnlyList<string> expected, string[] actual)
        {
            if (expected == null || actual == null || expected.Count != actual.Length)
            {
                return false;
            }
            for (int index = 0; index < actual.Length; index++)
            {
                if (!string.Equals(expected[index], actual[index], StringComparison.Ordinal))
                {
                    return false;
                }
            }
            return true;
        }

#if UNITY_EDITOR
        /// <summary>仅供包装预制体生成器写入全部显式数组引用。</summary>
        public void ConfigureForEditor(
            string processDetailId,
            string resourceId,
            string cameraPoseId,
            IReadOnlyList<string> stateNodeIds,
            IReadOnlyList<string> dynamicTargetIds,
            Transform displayAnchor,
            Transform cameraPose,
            MonoBehaviour[] dynamicTargetBehaviours,
            MonoBehaviour[] visualStateTargetBehaviours,
            ProcessDetailOwnedResourceMarker resourceMarker)
        {
            _processDetailId = processDetailId;
            _resourceId = resourceId;
            _cameraPoseId = cameraPoseId;
            _stateNodeIds = CopyIdentifiers(stateNodeIds);
            _dynamicTargetIds = CopyIdentifiers(dynamicTargetIds);
            _displayAnchor = displayAnchor;
            _cameraPose = cameraPose;
            _dynamicTargetBehaviours = dynamicTargetBehaviours ?? Array.Empty<MonoBehaviour>();
            _visualStateTargetBehaviours = visualStateTargetBehaviours ?? Array.Empty<MonoBehaviour>();
            _resourceMarker = resourceMarker;
        }

        private static string[] CopyIdentifiers(IReadOnlyList<string> identifiers)
        {
            if (identifiers == null || identifiers.Count == 0)
            {
                return Array.Empty<string>();
            }
            string[] result = new string[identifiers.Count];
            for (int index = 0; index < result.Length; index++)
            {
                result[index] = identifiers[index];
            }
            return result;
        }
#endif
    }
}

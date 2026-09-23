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
        // 每个状态节点与视觉适配器按索引一一对应；动态目标独立登记，但播放许可由状态重放结果驱动。
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
        private bool[] _hasVisualStates;
        private BusinessSceneNodeVisualState[] _visualStates;
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
        /// 兼容旧单节点调用；实例未激活时仅应用最新视觉状态，并按故障状态设置动态播放许可。
        /// 通用协调器使用下面的多节点重放接口；状态缺失按非故障处理，故障停止全部动态效果。
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

        /// <summary>
        /// 按节点索引重放多设备状态，避免加载或状态热路径扫描模型层级。
        /// 状态缺失按非故障处理，因此动态效果保持播放；任一已登记节点为故障时停止全部动态效果。
        /// </summary>
        public BusinessSceneCommandResult PrepareForActivation(IReadOnlyDictionary<string, BusinessSceneNodeVisualState> visualStates)
        {
            for (int index = 0; index < _stateNodeIds.Length; index++)
            {
                BusinessSceneNodeVisualState visualState = default;
                bool hasState = visualStates != null;
                if (hasState)
                {
                    hasState = visualStates.TryGetValue(_stateNodeIds[index], out visualState);
                }
                BusinessSceneCommandResult result = hasState
                    ? _visualStateTargets[index].ApplyVisualState(visualState)
                    : _visualStateTargets[index].ClearVisualState();
                if (!result.Success)
                {
                    return result;
                }

                _hasVisualStates[index] = hasState;
                _visualStates[index] = visualState;
            }

            ApplyDynamicPlaybackForCurrentStates();
            return BusinessSceneCommandResult.Completed("关键环节已在激活前应用最新视觉状态。");
        }

        public BusinessSceneCommandResult ApplyVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState)
        {
            int index = FindStateNodeIndex(sceneNodeId);
            if (!IsAvailable() || index < 0)
            {
                return BusinessSceneCommandResult.Failed("process-detail-instance-unavailable", "关键环节包装实例、节点或适配器不可用。");
            }

            BusinessSceneCommandResult result = _visualStateTargets[index].ApplyVisualState(visualState);
            if (result.Success)
            {
                _hasVisualStates[index] = true;
                _visualStates[index] = visualState;
                ApplyDynamicPlaybackForCurrentStates();
            }
            return result;
        }

        public BusinessSceneCommandResult ClearVisualState(string sceneNodeId)
        {
            int index = FindStateNodeIndex(sceneNodeId);
            if (!IsAvailable() || index < 0)
            {
                return BusinessSceneCommandResult.Failed("process-detail-instance-unavailable", "关键环节包装实例、节点或适配器不可用。");
            }

            BusinessSceneCommandResult result = _visualStateTargets[index].ClearVisualState();
            if (result.Success)
            {
                _hasVisualStates[index] = false;
                ApplyDynamicPlaybackForCurrentStates();
            }
            return result;
        }

        /// <summary>
        /// 保留历史播放命令的兼容入口，但播放许可只由当前设备状态决定。
        /// 参数不会覆盖状态结果，避免正常状态被旧命令错误停止或故障状态被旧命令错误启动。
        /// </summary>
        public BusinessSceneCommandResult SetPlayback(bool playing)
        {
            if (!IsAvailable())
            {
                return BusinessSceneCommandResult.Failed(
                    "process-detail-instance-unavailable",
                    "关键环节包装实例或动态适配器不可用。" );
            }

            ApplyDynamicPlaybackForCurrentStates();
            return BusinessSceneCommandResult.Completed("关键环节动态效果已按当前设备状态更新。");
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
            _hasVisualStates = new bool[_stateNodeIds.Length];
            _visualStates = new BusinessSceneNodeVisualState[_stateNodeIds.Length];
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

        /// <summary>
        /// 根据已接收的节点状态统一控制动态目标：任一故障停止，全部非故障或无状态时播放。
        /// 状态数组只在绑定初始化时分配，后续状态更新不创建临时集合。
        /// </summary>
        private void ApplyDynamicPlaybackForCurrentStates()
        {
            bool hasFault = false;
            for (int index = 0; index < _hasVisualStates.Length; index++)
            {
                if (_hasVisualStates[index] && _visualStates[index] == BusinessSceneNodeVisualState.Fault)
                {
                    hasFault = true;
                    break;
                }
            }

            bool playing = !hasFault;
            for (int index = 0; index < _dynamicTargets.Length; index++)
            {
                _dynamicTargets[index].SetPlayback(playing, hasFault);
            }
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

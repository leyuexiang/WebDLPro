using System;
using System.Collections.Generic;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 单个第三层关键环节的稳定目录项。网页只传入业务标识，资源文件与相机参数均由 Unity 本地目录解析；
    /// 编辑器预制体引用只用于制作期装配和编辑器直载，播放器构建不会通过该字段绕过独立资源包。
    /// </summary>
    [Serializable]
    public sealed class ProcessDetailCatalogEntry
    {
        [SerializeField] private string _sceneId;
        [SerializeField] private string _processId;
        [SerializeField] private string _stepId;
        [SerializeField] private string _processDetailId;
        [SerializeField] private string _resourceId;
        [SerializeField] private string _cameraPoseId;
        // 同一关键环节可投影多个逻辑设备；数组内容只保存稳定 sceneNodeId，不保存模型路径。
        [SerializeField] private string[] _stateNodeIds = Array.Empty<string>();
        [SerializeField] private string[] _dynamicTargetIds = Array.Empty<string>();
        [SerializeField] private BusinessSceneAvailability _availability;
#if UNITY_EDITOR
        [SerializeField] private GameObject _editorPrefab;
#endif

        public string SceneId => _sceneId;
        public string ProcessId => _processId;
        public string StepId => _stepId;
        public string ProcessDetailId => _processDetailId;
        public string ResourceId => _resourceId;
        public string CameraPoseId => _cameraPoseId;
        // 保留首节点别名，兼容已有编辑器检查；通用运行时使用 StateNodeIds 数组。
        public string StateNodeId => _stateNodeIds != null && _stateNodeIds.Length > 0 ? _stateNodeIds[0] : string.Empty;
        public IReadOnlyList<string> StateNodeIds => _stateNodeIds ?? Array.Empty<string>();
        public IReadOnlyList<string> DynamicTargetIds => _dynamicTargetIds ?? Array.Empty<string>();
        public BusinessSceneAvailability Availability => _availability;
#if UNITY_EDITOR
        public GameObject EditorPrefab => _editorPrefab;
#endif

        public ProcessDetailCatalogEntry(
            string sceneId,
            string processId,
            string stepId,
            string processDetailId,
            string resourceId,
            string cameraPoseId,
            string stateNodeId,
            BusinessSceneAvailability availability)
        {
            _sceneId = sceneId;
            _processId = processId;
            _stepId = stepId;
            _processDetailId = processDetailId;
            _resourceId = resourceId;
            _cameraPoseId = cameraPoseId;
            _stateNodeIds = string.IsNullOrWhiteSpace(stateNodeId)
                ? Array.Empty<string>()
                : new[] { stateNodeId };
            _dynamicTargetIds = Array.Empty<string>();
            _availability = availability;
        }

        /// <summary>创建具有多个设备状态和动态目标的目录项；输入数组会复制，避免制作期外部修改影响运行时目录。</summary>
        public ProcessDetailCatalogEntry(
            string sceneId,
            string processId,
            string stepId,
            string processDetailId,
            string resourceId,
            string cameraPoseId,
            IReadOnlyList<string> stateNodeIds,
            IReadOnlyList<string> dynamicTargetIds,
            BusinessSceneAvailability availability)
        {
            _sceneId = sceneId;
            _processId = processId;
            _stepId = stepId;
            _processDetailId = processDetailId;
            _resourceId = resourceId;
            _cameraPoseId = cameraPoseId;
            _stateNodeIds = CopyIdentifiers(stateNodeIds);
            _dynamicTargetIds = CopyIdentifiers(dynamicTargetIds);
            _availability = availability;
        }

        public bool ContainsStateNode(string sceneNodeId)
        {
            string[] stateNodeIds = _stateNodeIds ?? Array.Empty<string>();
            for (int index = 0; index < stateNodeIds.Length; index++)
            {
                if (string.Equals(stateNodeIds[index], sceneNodeId, StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        private static string[] CopyIdentifiers(IReadOnlyList<string> identifiers)
        {
            if (identifiers == null || identifiers.Count == 0)
            {
                return Array.Empty<string>();
            }
            string[] copy = new string[identifiers.Count];
            for (int index = 0; index < copy.Length; index++)
            {
                copy[index] = identifiers[index];
            }
            return copy;
        }

#if UNITY_EDITOR
        /// <summary>仅供编辑器生成器绑定包装预制体；正式播放器通过资源编号读取独立资源包。</summary>
        public void SetEditorPrefabForEditor(GameObject editorPrefab)
        {
            _editorPrefab = editorPrefab;
        }
#endif
    }

    /// <summary>
    /// 第三层关键环节目录。目录允许任意业务场景登记零到多个环节；当前已登记燃气轮机正式项和
    /// 燃煤锅炉燃烧占位项，其他未交付场景保持空缺，不创建伪资源或占位动作。
    /// </summary>
    [CreateAssetMenu(fileName = "ProcessDetailCatalog", menuName = "WebDLPro/Process Detail Catalog")]
    public sealed class ProcessDetailCatalog : ScriptableObject
    {
        public const int MaximumEntryCount = 128;

        [SerializeField] private ProcessDetailCatalogEntry[] _entries = Array.Empty<ProcessDetailCatalogEntry>();

        [NonSerialized] private Dictionary<string, ProcessDetailCatalogEntry> _byDetailId;
        [NonSerialized] private HashSet<string> _stateNodeKeys;

        public IReadOnlyList<ProcessDetailCatalogEntry> Entries =>
            Array.AsReadOnly(_entries ?? Array.Empty<ProcessDetailCatalogEntry>());

        public bool TryGet(string sceneId, string processDetailId, out ProcessDetailCatalogEntry entry)
        {
            EnsureIndex();
            if (_byDetailId.TryGetValue(processDetailId ?? string.Empty, out entry) &&
                string.Equals(entry.SceneId, sceneId, StringComparison.Ordinal))
            {
                return true;
            }

            entry = null;
            return false;
        }

        /// <summary>
        /// 目录校验只要求现有条目完整唯一，不要求九个业务场景都存在条目。
        /// 这样未来可按场景逐步增加正式资源，同时阻止重复资源、相机位或状态节点造成运行时歧义。
        /// </summary>
        public IReadOnlyList<BusinessSceneCatalogValidationIssue> ValidateForRuntime()
        {
            List<BusinessSceneCatalogValidationIssue> issues = new List<BusinessSceneCatalogValidationIssue>();
            ProcessDetailCatalogEntry[] entries = _entries ?? Array.Empty<ProcessDetailCatalogEntry>();
            if (entries.Length > MaximumEntryCount)
            {
                issues.Add(new BusinessSceneCatalogValidationIssue(
                    "process-detail-catalog.capacity",
                    $"关键环节目录最多允许 {MaximumEntryCount} 项。"));
            }

            HashSet<string> detailIds = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> resourceIds = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> cameraPoseIds = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> sceneStepKeys = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> registeredDynamicTargetIds = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < entries.Length; index++)
            {
                ProcessDetailCatalogEntry entry = entries[index];
                if (entry == null || !BusinessSceneCatalog.IsRequiredSceneId(entry.SceneId))
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue(
                        "process-detail-catalog.scene-id",
                        "关键环节目录存在空值或未知业务场景。"));
                    continue;
                }

                if (!IsValidIdentifier(entry.ProcessId) || !IsValidIdentifier(entry.StepId) ||
                    !IsValidIdentifier(entry.ProcessDetailId) || !detailIds.Add(entry.ProcessDetailId))
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue(
                        "process-detail-catalog.detail-id",
                        "关键环节目录存在空值、超长或重复的流程/步骤/环节标识。"));
                }

                if (!IsValidIdentifier(entry.ResourceId) || !resourceIds.Add(entry.ResourceId))
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue(
                        "process-detail-catalog.resource-id",
                        "关键环节目录存在空值、超长或重复资源标识。"));
                }

                if (!IsValidIdentifier(entry.CameraPoseId) || !cameraPoseIds.Add(entry.CameraPoseId))
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue(
                        "process-detail-catalog.camera-pose-id",
                        "关键环节目录存在空值、超长或重复相机位标识。"));
                }

                IReadOnlyList<string> stateNodeIds = entry.StateNodeIds;
                IReadOnlyList<string> dynamicTargetIds = entry.DynamicTargetIds;
                if (stateNodeIds.Count == 0)
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue(
                        "process-detail-catalog.state-node-id",
                        "关键环节目录缺少状态节点标识。"));
                }
                HashSet<string> entryStateNodeIds = new HashSet<string>(StringComparer.Ordinal);
                for (int stateNodeIndex = 0; stateNodeIndex < stateNodeIds.Count; stateNodeIndex++)
                {
                    string stateNodeId = stateNodeIds[stateNodeIndex];
                    if (!SceneActionProtocolValidator.IsValidSceneNodeId(stateNodeId) ||
                        !entryStateNodeIds.Add(stateNodeId))
                    {
                        issues.Add(new BusinessSceneCatalogValidationIssue(
                            "process-detail-catalog.state-node-id",
                            "关键环节目录存在非法或环节内重复状态节点标识。"));
                    }
                }
                for (int targetIndex = 0; targetIndex < dynamicTargetIds.Count; targetIndex++)
                {
                    if (!IsValidIdentifier(dynamicTargetIds[targetIndex]) ||
                        !registeredDynamicTargetIds.Add(dynamicTargetIds[targetIndex]))
                    {
                        issues.Add(new BusinessSceneCatalogValidationIssue(
                            "process-detail-catalog.dynamic-target-id",
                            "关键环节目录存在非法或重复动态目标标识。"));
                    }
                }

                string sceneStepKey = $"{entry.SceneId}\u001f{entry.ProcessId}\u001f{entry.StepId}";
                if (!sceneStepKeys.Add(sceneStepKey))
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue(
                        "process-detail-catalog.scene-step-duplicate",
                        "同一场景流程步骤不能映射到多个关键环节。"));
                }

                if (entry.Availability != BusinessSceneAvailability.Available)
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue(
                        "process-detail-catalog.unresolved",
                        $"关键环节 {entry.ProcessDetailId} 尚未解析正式资源。"));
                }
            }

            return issues;
        }

        /// <summary>查询当前场景是否显式登记指定状态节点；状态热路径只执行哈希查找。</summary>
        public bool ContainsStateNode(string sceneId, string sceneNodeId)
        {
            EnsureIndex();
            return _stateNodeKeys.Contains(CreateSceneNodeKey(sceneId, sceneNodeId));
        }

#if UNITY_EDITOR
        /// <summary>仅供编辑器生成器和编辑模式测试原子写入目录。</summary>
        public void SetEntriesForEditor(IReadOnlyList<ProcessDetailCatalogEntry> entries)
        {
            if (entries == null)
            {
                _entries = Array.Empty<ProcessDetailCatalogEntry>();
            }
            else
            {
                _entries = new ProcessDetailCatalogEntry[entries.Count];
                for (int index = 0; index < entries.Count; index++)
                {
                    _entries[index] = entries[index];
                }
            }

            _byDetailId = null;
            _stateNodeKeys = null;
        }
#endif

        private static bool IsValidIdentifier(string value)
        {
            return SceneSwitchProtocolValidator.IsBoundedIdentifier(value);
        }

        private void OnValidate()
        {
            _byDetailId = null;
            _stateNodeKeys = null;
        }

        private void EnsureIndex()
        {
            if (_byDetailId != null)
            {
                return;
            }

            _byDetailId = new Dictionary<string, ProcessDetailCatalogEntry>(StringComparer.Ordinal);
            _stateNodeKeys = new HashSet<string>(StringComparer.Ordinal);
            ProcessDetailCatalogEntry[] entries = _entries ?? Array.Empty<ProcessDetailCatalogEntry>();
            for (int index = 0; index < entries.Length; index++)
            {
                ProcessDetailCatalogEntry entry = entries[index];
                if (entry == null)
                {
                    continue;
                }
                if (!string.IsNullOrWhiteSpace(entry.ProcessDetailId) && !_byDetailId.ContainsKey(entry.ProcessDetailId))
                {
                    _byDetailId.Add(entry.ProcessDetailId, entry);
                }
                IReadOnlyList<string> stateNodeIds = entry.StateNodeIds;
                for (int nodeIndex = 0; nodeIndex < stateNodeIds.Count; nodeIndex++)
                {
                    _stateNodeKeys.Add(CreateSceneNodeKey(entry.SceneId, stateNodeIds[nodeIndex]));
                }
            }
        }

        private static string CreateSceneNodeKey(string sceneId, string sceneNodeId)
        {
            return (sceneId ?? string.Empty) + "\u001f" + (sceneNodeId ?? string.Empty);
        }
    }
}

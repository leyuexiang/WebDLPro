using System;
using System.Collections.Generic;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>场景内容可用性必须由正式清单声明，未解析条目不能进入真实加载流程。</summary>
    public enum BusinessSceneAvailability
    {
        Unresolved,
        Available
    }

    /// <summary>
    /// 单个业务场景的只读目录项。Unity 场景键和路径必须来自正式发布清单，
    /// 不能根据 sceneId、标题、模型名或现有文件名自动生成。
    /// </summary>
    [Serializable]
    public sealed class BusinessSceneCatalogEntry
    {
        [SerializeField] private string _sceneId;
        [SerializeField] private string _unitySceneKey;
        [SerializeField] private string _scenePath;
        [SerializeField] private BusinessSceneAvailability _availability;
        [SerializeField] private BusinessSceneCapability _declaredCapabilities;

        public string SceneId => _sceneId;
        public string UnitySceneKey => _unitySceneKey;
        public string ScenePath => _scenePath;
        public BusinessSceneAvailability Availability => _availability;
        public BusinessSceneCapability DeclaredCapabilities => _declaredCapabilities;

        public BusinessSceneCatalogEntry(
            string sceneId,
            string unitySceneKey,
            string scenePath,
            BusinessSceneAvailability availability,
            BusinessSceneCapability declaredCapabilities)
        {
            _sceneId = sceneId;
            _unitySceneKey = unitySceneKey;
            _scenePath = scenePath;
            _availability = availability;
            _declaredCapabilities = declaredCapabilities;
        }
    }

    /// <summary>目录校验问题使用稳定代码，编辑器、构建脚本和测试可据此统一阻止错误发布。</summary>
    public readonly struct BusinessSceneCatalogValidationIssue
    {
        public string Code { get; }
        public string Message { get; }

        public BusinessSceneCatalogValidationIssue(string code, string message)
        {
            Code = code;
            Message = message;
        }
    }

    /// <summary>
    /// Unity 侧九场景目录资产。当前仓库缺少正式场景键和八个业务场景文件，因此不预置猜测条目；
    /// 只有九项完整、唯一、可用且文件存在的正式配置才能通过 ValidateForRuntime。
    /// </summary>
    [CreateAssetMenu(fileName = "BusinessSceneCatalog", menuName = "WebDLPro/Business Scene Catalog")]
    public sealed class BusinessSceneCatalog : ScriptableObject
    {
        public const string BootstrapScenePath = "Assets/Scenes/Bootstrap.unity";

        private static readonly string[] RequiredSceneIds =
        {
            "coal-power",
            "gas-power",
            "wind-power",
            "solar-power",
            "substation",
            "distribution",
            "consumption",
            "microgrid",
            "dispatch"
        };

        [SerializeField] private BusinessSceneCatalogEntry[] _entries = Array.Empty<BusinessSceneCatalogEntry>();

        [NonSerialized] private Dictionary<string, BusinessSceneCatalogEntry> _bySceneId;
        [NonSerialized] private Dictionary<string, BusinessSceneCatalogEntry> _byUnitySceneKey;
        [NonSerialized] private Dictionary<string, BusinessSceneCatalogEntry> _byScenePath;

        public IReadOnlyList<BusinessSceneCatalogEntry> Entries => Array.AsReadOnly(_entries ?? Array.Empty<BusinessSceneCatalogEntry>());

        public static IReadOnlyList<string> GetRequiredSceneIds()
        {
            return Array.AsReadOnly((string[])RequiredSceneIds.Clone());
        }

        public static bool IsRequiredSceneId(string sceneId)
        {
            return Array.IndexOf(RequiredSceneIds, sceneId) >= 0;
        }

        public bool TryGetBySceneId(string sceneId, out BusinessSceneCatalogEntry entry)
        {
            EnsureIndexes();
            return _bySceneId.TryGetValue(sceneId ?? string.Empty, out entry);
        }

        public bool TryGetByUnitySceneKey(string unitySceneKey, out BusinessSceneCatalogEntry entry)
        {
            EnsureIndexes();
            return _byUnitySceneKey.TryGetValue(unitySceneKey ?? string.Empty, out entry);
        }

        public bool TryGetByScenePath(string scenePath, out BusinessSceneCatalogEntry entry)
        {
            EnsureIndexes();
            return _byScenePath.TryGetValue(scenePath ?? string.Empty, out entry);
        }

        /// <summary>
        /// 校验固定九项、三类唯一标识、正式可用状态和场景路径；运行时校验不依赖 AssetDatabase，
        /// 文件存在性由编辑器发布校验补充，避免运行包引入编辑器程序集。
        /// </summary>
        public IReadOnlyList<BusinessSceneCatalogValidationIssue> ValidateForRuntime()
        {
            List<BusinessSceneCatalogValidationIssue> issues = new List<BusinessSceneCatalogValidationIssue>();
            BusinessSceneCatalogEntry[] entries = _entries ?? Array.Empty<BusinessSceneCatalogEntry>();
            if (entries.Length != RequiredSceneIds.Length)
            {
                issues.Add(new BusinessSceneCatalogValidationIssue("scene-catalog.count", "场景目录必须且只能包含九个业务场景。"));
            }

            HashSet<string> sceneIds = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> unitySceneKeys = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> scenePaths = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < entries.Length; index++)
            {
                BusinessSceneCatalogEntry entry = entries[index];
                if (entry == null || !IsRequiredSceneId(entry.SceneId) || !sceneIds.Add(entry.SceneId))
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue("scene-catalog.scene-id", "场景目录存在空值、未知或重复 sceneId。"));
                    continue;
                }
                if (string.IsNullOrWhiteSpace(entry.UnitySceneKey) || !unitySceneKeys.Add(entry.UnitySceneKey))
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue("scene-catalog.unity-key", "场景目录存在空值或重复 unitySceneKey。"));
                }
                if (string.IsNullOrWhiteSpace(entry.ScenePath) || !scenePaths.Add(entry.ScenePath))
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue("scene-catalog.scene-path", "场景目录存在空值或重复场景路径。"));
                }
                else if (string.Equals(entry.ScenePath, BootstrapScenePath, StringComparison.Ordinal))
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue("scene-catalog.bootstrap-reused", "业务场景路径不能指向 Bootstrap 启动场景。"));
                }
                if (entry.Availability != BusinessSceneAvailability.Available)
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue("scene-catalog.unresolved", $"场景 {entry.SceneId} 尚未解析正式 Unity 内容。"));
                }
            }

            for (int requiredIndex = 0; requiredIndex < RequiredSceneIds.Length; requiredIndex++)
            {
                if (!sceneIds.Contains(RequiredSceneIds[requiredIndex]))
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue("scene-catalog.missing", $"固定场景 {RequiredSceneIds[requiredIndex]} 未登记。"));
                }
            }

            return issues;
        }

#if UNITY_EDITOR
        /// <summary>只允许编辑器生成器和编辑模式测试整体写入条目；运行包中不暴露目录改写入口。</summary>
        public void SetEntriesForEditor(IReadOnlyList<BusinessSceneCatalogEntry> entries)
        {
            if (entries == null)
            {
                _entries = Array.Empty<BusinessSceneCatalogEntry>();
            }
            else
            {
                _entries = new BusinessSceneCatalogEntry[entries.Count];
                for (int index = 0; index < entries.Count; index++)
                {
                    _entries[index] = entries[index];
                }
            }
            InvalidateIndexes();
        }
#endif

        private void OnValidate()
        {
            InvalidateIndexes();
        }

        private void EnsureIndexes()
        {
            if (_bySceneId != null)
            {
                return;
            }

            _bySceneId = new Dictionary<string, BusinessSceneCatalogEntry>(StringComparer.Ordinal);
            _byUnitySceneKey = new Dictionary<string, BusinessSceneCatalogEntry>(StringComparer.Ordinal);
            _byScenePath = new Dictionary<string, BusinessSceneCatalogEntry>(StringComparer.Ordinal);
            BusinessSceneCatalogEntry[] entries = _entries ?? Array.Empty<BusinessSceneCatalogEntry>();
            for (int index = 0; index < entries.Length; index++)
            {
                BusinessSceneCatalogEntry entry = entries[index];
                if (entry == null)
                {
                    continue;
                }
                AddFirst(_bySceneId, entry.SceneId, entry);
                AddFirst(_byUnitySceneKey, entry.UnitySceneKey, entry);
                AddFirst(_byScenePath, entry.ScenePath, entry);
            }
        }

        private void InvalidateIndexes()
        {
            _bySceneId = null;
            _byUnitySceneKey = null;
            _byScenePath = null;
        }

        private static void AddFirst(Dictionary<string, BusinessSceneCatalogEntry> index, string key, BusinessSceneCatalogEntry entry)
        {
            if (!string.IsNullOrWhiteSpace(key) && !index.ContainsKey(key))
            {
                index.Add(key, entry);
            }
        }
    }
}

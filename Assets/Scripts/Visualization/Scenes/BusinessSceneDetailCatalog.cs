using System;
using System.Collections.Generic;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 单个业务场景的设备细节资源目录项。这里只登记稳定资源标识，不保存模型层级路径或资源包地址；
    /// 发布侧加载器必须通过正式资源清单解析 detailResourceId，禁止根据 sceneId 拼接文件名。
    /// </summary>
    [Serializable]
    public sealed class BusinessSceneDetailCatalogEntry
    {
        [SerializeField] private string _sceneId;
        [SerializeField] private string _detailResourceId;
        [SerializeField] private BusinessSceneAvailability _availability;

        public string SceneId => _sceneId;
        public string DetailResourceId => _detailResourceId;
        public BusinessSceneAvailability Availability => _availability;

        public BusinessSceneDetailCatalogEntry(
            string sceneId,
            string detailResourceId,
            BusinessSceneAvailability availability)
        {
            _sceneId = sceneId;
            _detailResourceId = detailResourceId;
            _availability = availability;
        }
    }

    /// <summary>
    /// 九个业务场景的设备细节资源目录。厂区壳体仍由业务场景本体持有并常驻；
    /// 本目录只描述可独立加载和释放的设备细节资源，不承担壳体对象绑定。
    /// </summary>
    [CreateAssetMenu(fileName = "BusinessSceneDetailCatalog", menuName = "WebDLPro/Business Scene Detail Catalog")]
    public sealed class BusinessSceneDetailCatalog : ScriptableObject
    {
        [SerializeField] private BusinessSceneDetailCatalogEntry[] _entries = Array.Empty<BusinessSceneDetailCatalogEntry>();

        [NonSerialized] private Dictionary<string, BusinessSceneDetailCatalogEntry> _bySceneId;

        public IReadOnlyList<BusinessSceneDetailCatalogEntry> Entries =>
            Array.AsReadOnly(_entries ?? Array.Empty<BusinessSceneDetailCatalogEntry>());

        public bool TryGetBySceneId(string sceneId, out BusinessSceneDetailCatalogEntry entry)
        {
            EnsureIndex();
            return _bySceneId.TryGetValue(sceneId ?? string.Empty, out entry);
        }

        /// <summary>
        /// 正式发布要求九个业务场景各有且仅有一个设备细节资源标识。
        /// 资源标识必须显式配置、唯一且有界；未知、未解析或重复条目均阻止运行时接入。
        /// </summary>
        public IReadOnlyList<BusinessSceneCatalogValidationIssue> ValidateForRuntime()
        {
            List<BusinessSceneCatalogValidationIssue> issues = new List<BusinessSceneCatalogValidationIssue>();
            BusinessSceneDetailCatalogEntry[] entries = _entries ?? Array.Empty<BusinessSceneDetailCatalogEntry>();
            IReadOnlyList<string> requiredSceneIds = BusinessSceneCatalog.GetRequiredSceneIds();
            if (entries.Length != requiredSceneIds.Count)
            {
                issues.Add(new BusinessSceneCatalogValidationIssue(
                    "scene-detail-catalog.count",
                    "设备细节目录必须且只能包含九个业务场景。"));
            }

            HashSet<string> sceneIds = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> resourceIds = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < entries.Length; index++)
            {
                BusinessSceneDetailCatalogEntry entry = entries[index];
                if (entry == null || !BusinessSceneCatalog.IsRequiredSceneId(entry.SceneId) || !sceneIds.Add(entry.SceneId))
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue(
                        "scene-detail-catalog.scene-id",
                        "设备细节目录存在空值、未知或重复 sceneId。"));
                    continue;
                }

                if (!SceneSwitchProtocolValidator.IsBoundedIdentifier(entry.DetailResourceId) ||
                    !resourceIds.Add(entry.DetailResourceId))
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue(
                        "scene-detail-catalog.resource-id",
                        "设备细节目录存在空值、超长或重复 detailResourceId。"));
                }

                if (entry.Availability != BusinessSceneAvailability.Available)
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue(
                        "scene-detail-catalog.unresolved",
                        $"场景 {entry.SceneId} 的设备细节资源尚未解析。"));
                }
            }

            for (int requiredIndex = 0; requiredIndex < requiredSceneIds.Count; requiredIndex++)
            {
                if (!sceneIds.Contains(requiredSceneIds[requiredIndex]))
                {
                    issues.Add(new BusinessSceneCatalogValidationIssue(
                        "scene-detail-catalog.missing",
                        $"固定场景 {requiredSceneIds[requiredIndex]} 未登记设备细节资源。"));
                }
            }

            return issues;
        }

#if UNITY_EDITOR
        /// <summary>仅供编辑器生成器和编辑模式测试整体写入正式目录。</summary>
        public void SetEntriesForEditor(IReadOnlyList<BusinessSceneDetailCatalogEntry> entries)
        {
            if (entries == null)
            {
                _entries = Array.Empty<BusinessSceneDetailCatalogEntry>();
            }
            else
            {
                _entries = new BusinessSceneDetailCatalogEntry[entries.Count];
                for (int index = 0; index < entries.Count; index++)
                {
                    _entries[index] = entries[index];
                }
            }

            _bySceneId = null;
        }
#endif

        private void OnValidate()
        {
            _bySceneId = null;
        }

        private void EnsureIndex()
        {
            if (_bySceneId != null)
            {
                return;
            }

            _bySceneId = new Dictionary<string, BusinessSceneDetailCatalogEntry>(StringComparer.Ordinal);
            BusinessSceneDetailCatalogEntry[] entries = _entries ?? Array.Empty<BusinessSceneDetailCatalogEntry>();
            for (int index = 0; index < entries.Length; index++)
            {
                BusinessSceneDetailCatalogEntry entry = entries[index];
                if (entry != null && !string.IsNullOrWhiteSpace(entry.SceneId) && !_bySceneId.ContainsKey(entry.SceneId))
                {
                    _bySceneId.Add(entry.SceneId, entry);
                }
            }
        }
    }
}

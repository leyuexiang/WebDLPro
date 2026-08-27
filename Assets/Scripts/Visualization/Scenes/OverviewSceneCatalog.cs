using System;
using System.Collections.Generic;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 独立总览场景目录。该目录只描述全局 Overview 场景，不加入固定九项 BusinessSceneCatalog，
    /// 避免总览场景改变业务 sceneId 闭集和既有业务资源校验。
    /// </summary>
    [CreateAssetMenu(fileName = "OverviewSceneCatalog", menuName = "WebDLPro/Overview Scene Catalog")]
    public sealed class OverviewSceneCatalog : ScriptableObject
    {
        public const string OverviewSceneId = "overview";
        public const string OverviewScenePath = "Assets/Scenes/Overview/Overview.unity";

        [SerializeField] private OverviewSceneCatalogEntry _entry;

        public OverviewSceneCatalogEntry Entry => _entry;

        public static bool IsOverviewSceneId(string sceneId)
        {
            return string.Equals(sceneId, OverviewSceneId, StringComparison.Ordinal);
        }

        public bool TryCreateRuntimeEntry(out BusinessSceneCatalogEntry runtimeEntry, out string message)
        {
            runtimeEntry = null;
            IReadOnlyList<OverviewSceneCatalogValidationIssue> issues = ValidateForRuntime();
            if (issues.Count > 0)
            {
                message = issues[0].Message;
                return false;
            }

            runtimeEntry = new BusinessSceneCatalogEntry(
                _entry.SceneId,
                _entry.UnitySceneKey,
                _entry.ScenePath,
                BusinessSceneAvailability.Available,
                _entry.DeclaredCapabilities);
            message = string.Empty;
            return true;
        }

        public IReadOnlyList<OverviewSceneCatalogValidationIssue> ValidateForRuntime()
        {
            List<OverviewSceneCatalogValidationIssue> issues = new List<OverviewSceneCatalogValidationIssue>();
            if (_entry == null ||
                !string.Equals(_entry.SceneId, OverviewSceneId, StringComparison.Ordinal) ||
                string.IsNullOrWhiteSpace(_entry.UnitySceneKey) ||
                string.IsNullOrWhiteSpace(_entry.ScenePath) ||
                !string.Equals(_entry.ScenePath, OverviewScenePath, StringComparison.Ordinal))
            {
                issues.Add(new OverviewSceneCatalogValidationIssue(
                    "overview-catalog.entry-invalid",
                    "总览场景目录必须登记唯一的 overview 场景及固定路径。"));
            }

            return issues;
        }

#if UNITY_EDITOR
        /// <summary>仅供编辑器生成器写入总览条目，运行时不允许改变全局场景身份。</summary>
        public void SetEntryForEditor(OverviewSceneCatalogEntry entry)
        {
            if (Application.isPlaying)
            {
                throw new InvalidOperationException("运行时不能修改总览场景目录。");
            }

            _entry = entry;
        }
#endif

        private void OnValidate()
        {
            if (_entry != null && string.IsNullOrWhiteSpace(_entry.SceneId))
            {
                _entry.SetSceneId(OverviewSceneId);
            }
        }
    }

    [Serializable]
    public sealed class OverviewSceneCatalogEntry
    {
        [SerializeField] private string _sceneId;
        [SerializeField] private string _unitySceneKey;
        [SerializeField] private string _scenePath;
        [SerializeField] private BusinessSceneCapability _declaredCapabilities;

        public string SceneId => _sceneId;
        public string UnitySceneKey => _unitySceneKey;
        public string ScenePath => _scenePath;
        public BusinessSceneCapability DeclaredCapabilities => _declaredCapabilities;

        public OverviewSceneCatalogEntry(
            string sceneId,
            string unitySceneKey,
            string scenePath,
            BusinessSceneCapability declaredCapabilities)
        {
            _sceneId = sceneId;
            _unitySceneKey = unitySceneKey;
            _scenePath = scenePath;
            _declaredCapabilities = declaredCapabilities;
        }

        public void SetSceneId(string sceneId)
        {
            _sceneId = sceneId;
        }
    }

    public readonly struct OverviewSceneCatalogValidationIssue
    {
        public string Code { get; }
        public string Message { get; }

        public OverviewSceneCatalogValidationIssue(string code, string message)
        {
            Code = code;
            Message = message;
        }
    }
}

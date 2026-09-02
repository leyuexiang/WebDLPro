using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.Scripting;
using UnityObject = UnityEngine.Object;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 第三层独立预制体加载器。编辑器直接实例化目录中的制作期预制体；WebGL 从同级
    /// ProcessDetailBundles（关键环节资源包）目录下载经过发布标识和哈希校验的独立资源包。
    /// </summary>
    [Preserve]
    [DisallowMultipleComponent]
    public sealed class ProcessDetailAssetBundleLoader : MonoBehaviour, IProcessDetailResourceLoader
    {
        public const string BundleDirectoryName = "ProcessDetailBundles";
        public const string CatalogFileName = "process-detail-catalog.json";
        private const int SupportedCatalogSchemaVersion = 1;

        private sealed class EmptyLease : IDisposable
        {
            public void Dispose()
            {
            }
        }

        private sealed class AssetBundleLease : IDisposable
        {
            private AssetBundle _bundle;

            public AssetBundleLease(AssetBundle bundle)
            {
                _bundle = bundle;
            }

            public void Dispose()
            {
                AssetBundle bundle = _bundle;
                _bundle = null;
                if (bundle != null)
                {
                    // 实例先由 ProcessDetailLoadHandle 销毁，再解除资源包租约；false 避免销毁仍被延迟销毁对象引用的资源。
                    bundle.Unload(false);
                }
            }
        }

        [Serializable]
        private sealed class CatalogDocument
        {
            public int schemaVersion;
            public string releaseId;
            public EntryDocument[] entries;
        }

        [Serializable]
        private sealed class EntryDocument
        {
            public string processDetailId;
            public string resourceId;
            public string bundleName;
            public string fileName;
            public string hash;
            public uint crc;
            public long sizeBytes;
            public string assetPath;
        }

        private CatalogDocument _catalog;
        private Dictionary<string, EntryDocument> _entriesByResourceId;
        private bool _catalogAttempted;
        private bool _disposed;
        private Transform _stagingRoot;

        public IEnumerator LoadAsync(ProcessDetailCatalogEntry entry, Action<ProcessDetailLoadResult> completed)
        {
            if (_disposed || entry == null)
            {
                completed?.Invoke(ProcessDetailLoadResult.Failed(
                    "process-detail-loader-unavailable",
                    "关键环节加载器不可用。"));
                yield break;
            }

#if UNITY_EDITOR
            // 制作期直载仍通过同一未激活实例契约，确保编辑器和 WebGL 的首次显示顺序一致。
            yield return null;
            GameObject editorPrefab = entry.EditorPrefab;
            if (editorPrefab == null)
            {
                completed?.Invoke(ProcessDetailLoadResult.Failed(
                    "process-detail-prefab-missing",
                    "关键环节目录缺少编辑器包装预制体。"));
                yield break;
            }

            GameObject editorInstance = CreateHiddenInstance(editorPrefab);
            completed?.Invoke(editorInstance != null
                ? ProcessDetailLoadResult.Completed(new ProcessDetailLoadHandle(editorInstance, new EmptyLease()))
                : ProcessDetailLoadResult.Failed("process-detail-instantiate-failed", "关键环节包装预制体实例化失败。"));
#else
            bool catalogReady = false;
            yield return EnsureCatalogAsync(value => catalogReady = value);
            if (!catalogReady || !_entriesByResourceId.TryGetValue(entry.ResourceId, out EntryDocument document) ||
                !string.Equals(document.processDetailId, entry.ProcessDetailId, StringComparison.Ordinal))
            {
                completed?.Invoke(ProcessDetailLoadResult.Failed(
                    "process-detail-catalog-invalid",
                    "关键环节资源目录缺失或与当前发布不一致。"));
                yield break;
            }

            if (!TryParseHash(document.hash, out Hash128 hash))
            {
                completed?.Invoke(ProcessDetailLoadResult.Failed(
                    "process-detail-bundle-hash-invalid",
                    "关键环节资源包哈希无效。"));
                yield break;
            }

            AssetBundle bundle = null;
            using (UnityWebRequest request = UnityWebRequestAssetBundle.GetAssetBundle(
                       BuildRuntimeUrl($"{BundleDirectoryName}/{document.fileName}"),
                       hash,
                       document.crc))
            {
                yield return request.SendWebRequest();
                if (_disposed || request.result != UnityWebRequest.Result.Success)
                {
                    completed?.Invoke(ProcessDetailLoadResult.Failed(
                        "process-detail-bundle-load-failed",
                        "关键环节资源包下载或校验失败。"));
                    yield break;
                }

                bundle = DownloadHandlerAssetBundle.GetContent(request);
            }

            if (bundle == null)
            {
                completed?.Invoke(ProcessDetailLoadResult.Failed(
                    "process-detail-bundle-invalid",
                    "关键环节资源包无法解码。"));
                yield break;
            }

            AssetBundleRequest assetRequest = bundle.LoadAssetAsync<GameObject>(document.assetPath);
            yield return assetRequest;
            GameObject prefab = assetRequest.asset as GameObject;
            if (_disposed || prefab == null)
            {
                bundle.Unload(false);
                completed?.Invoke(ProcessDetailLoadResult.Failed(
                    "process-detail-prefab-missing",
                    "关键环节资源包缺少登记的包装预制体。"));
                yield break;
            }

            GameObject instance = CreateHiddenInstance(prefab);
            if (instance == null)
            {
                bundle.Unload(false);
                completed?.Invoke(ProcessDetailLoadResult.Failed(
                    "process-detail-instantiate-failed",
                    "关键环节包装预制体实例化失败。"));
                yield break;
            }

            completed?.Invoke(ProcessDetailLoadResult.Completed(
                new ProcessDetailLoadHandle(instance, new AssetBundleLease(bundle))));
#endif
        }

        private IEnumerator EnsureCatalogAsync(Action<bool> completed)
        {
            if (_catalog != null && _entriesByResourceId != null)
            {
                completed?.Invoke(true);
                yield break;
            }
            if (_catalogAttempted || _disposed)
            {
                completed?.Invoke(false);
                yield break;
            }

            _catalogAttempted = true;
            using (UnityWebRequest request = UnityWebRequest.Get(BuildRuntimeUrl($"{BundleDirectoryName}/{CatalogFileName}")))
            {
                yield return request.SendWebRequest();
                if (_disposed || request.result != UnityWebRequest.Result.Success ||
                    string.IsNullOrWhiteSpace(request.downloadHandler?.text))
                {
                    completed?.Invoke(false);
                    yield break;
                }

                CatalogDocument catalog;
                try
                {
                    catalog = JsonUtility.FromJson<CatalogDocument>(request.downloadHandler.text);
                }
                catch
                {
                    completed?.Invoke(false);
                    yield break;
                }

                if (!TryBuildIndex(catalog, out Dictionary<string, EntryDocument> index))
                {
                    completed?.Invoke(false);
                    yield break;
                }

                _catalog = catalog;
                _entriesByResourceId = index;
                completed?.Invoke(true);
            }
        }

        private bool TryBuildIndex(CatalogDocument catalog, out Dictionary<string, EntryDocument> index)
        {
            index = null;
            if (catalog == null || catalog.schemaVersion != SupportedCatalogSchemaVersion ||
                !SceneBundleRuntimeLoader.IsExpectedCatalogReleaseId(Application.version, catalog.releaseId) ||
                catalog.entries == null)
            {
                return false;
            }

            Dictionary<string, EntryDocument> result = new Dictionary<string, EntryDocument>(StringComparer.Ordinal);
            HashSet<string> detailIds = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> bundleNames = new HashSet<string>(StringComparer.Ordinal);
            for (int entryIndex = 0; entryIndex < catalog.entries.Length; entryIndex++)
            {
                EntryDocument entry = catalog.entries[entryIndex];
                if (entry == null || !IsSafeSegment(entry.bundleName) || !IsSafeSegment(entry.fileName) ||
                    !SceneSwitchProtocolValidator.IsBoundedIdentifier(entry.processDetailId) ||
                    !SceneSwitchProtocolValidator.IsBoundedIdentifier(entry.resourceId) ||
                    string.IsNullOrWhiteSpace(entry.assetPath) || entry.sizeBytes <= 0 ||
                    !TryParseHash(entry.hash, out _) || !detailIds.Add(entry.processDetailId) ||
                    !bundleNames.Add(entry.bundleName) || !result.TryAdd(entry.resourceId, entry))
                {
                    return false;
                }
            }

            index = result;
            return true;
        }

        private GameObject CreateHiddenInstance(GameObject prefab)
        {
            if (prefab == null || _disposed)
            {
                return null;
            }

            EnsureStagingRoot();
            GameObject instance = Instantiate(prefab, _stagingRoot, false);
            // 父级在实例化时保持未激活，先关闭实例自身再脱离临时父级，任何 OnEnable 都不会提前执行。
            instance.SetActive(false);
            instance.transform.SetParent(null, false);
            return instance;
        }

        private void EnsureStagingRoot()
        {
            if (_stagingRoot != null)
            {
                return;
            }

            GameObject staging = new GameObject("ProcessDetailLoadStaging");
            staging.hideFlags = HideFlags.HideAndDontSave;
            staging.transform.SetParent(transform, false);
            staging.SetActive(false);
            _stagingRoot = staging.transform;
        }

        private static bool IsSafeSegment(string value)
        {
            return !string.IsNullOrWhiteSpace(value) && value.IndexOf('/') < 0 && value.IndexOf('\\') < 0 &&
                   value.IndexOf("..", StringComparison.Ordinal) < 0;
        }

        private static bool TryParseHash(string value, out Hash128 hash)
        {
            hash = default;
            if (string.IsNullOrWhiteSpace(value) || value.Length != 32)
            {
                return false;
            }

            for (int index = 0; index < value.Length; index++)
            {
                char character = value[index];
                bool isDigit = character >= '0' && character <= '9';
                bool isLowerHex = character >= 'a' && character <= 'f';
                bool isUpperHex = character >= 'A' && character <= 'F';
                if (!isDigit && !isLowerHex && !isUpperHex)
                {
                    return false;
                }
            }

            try
            {
                hash = Hash128.Parse(value);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static string BuildRuntimeUrl(string relativePath)
        {
            Uri currentPage = new Uri(Application.absoluteURL);
            return new Uri(currentPage, relativePath).AbsoluteUri;
        }

        public void DisposeRuntime()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _catalog = null;
            _entriesByResourceId?.Clear();
            _entriesByResourceId = null;
            if (_stagingRoot != null)
            {
                if (Application.isPlaying)
                {
                    UnityObject.Destroy(_stagingRoot.gameObject);
                }
                else
                {
                    UnityObject.DestroyImmediate(_stagingRoot.gameObject);
                }
                _stagingRoot = null;
            }
        }

        private void OnDestroy()
        {
            DisposeRuntime();
        }
    }
}

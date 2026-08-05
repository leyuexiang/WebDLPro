using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.SceneManagement;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 业务场景资产包加载结果。只向协调器暴露场景实例和稳定错误码，
    /// 不泄露下载地址、资产路径以外的文件系统信息或网络异常文本。
    /// </summary>
    public readonly struct SceneBundleLoadResult
    {
        public bool Success { get; }
        public Scene Scene { get; }
        public string ErrorCode { get; }

        private SceneBundleLoadResult(bool success, Scene scene, string errorCode)
        {
            Success = success;
            Scene = scene;
            ErrorCode = errorCode ?? string.Empty;
        }

        public static SceneBundleLoadResult Completed(Scene scene)
        {
            return new SceneBundleLoadResult(true, scene, string.Empty);
        }

        public static SceneBundleLoadResult Failed(string errorCode)
        {
            return new SceneBundleLoadResult(false, default, errorCode);
        }
    }

    /// <summary>
    /// WebGL 业务场景资产包加载器。
    /// 编辑器运行时仍直接按正式目录加载场景，保证编辑器测试与人工编辑不依赖发布产物；
    /// 已发布的 WebGL 则从统一入口同级的 SceneBundles 读取受限目录，并用构建哈希走 Unity 缓存。
    /// 同一时刻只为当前业务场景保留一个资产包租约，卸载后即释放内存句柄，磁盘缓存仍可供同版本回切复用。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SceneBundleRuntimeLoader : MonoBehaviour
    {
        private const string CatalogFileName = "scene-catalog.json";
        private const string BundleDirectoryName = "SceneBundles";

        private readonly Dictionary<string, AssetBundle> _loadedBundles = new Dictionary<string, AssetBundle>(StringComparer.Ordinal);
        private readonly Dictionary<string, List<string>> _bundleNamesBySceneId = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        private SceneBundleCatalogDocument _catalog;
        private Dictionary<string, SceneBundleDocument> _bundleByName;
        private bool _catalogAttempted;
        private bool _disposed;

        /// <summary>
        /// 加载指定正式目录项。编辑器使用已登记的场景路径；正式 WebGL 必须先验证外部目录、
        /// 递归加载其声明的共享依赖，再以资产包中的真实场景路径提交加法加载。
        /// </summary>
        public IEnumerator LoadSceneAsync(BusinessSceneCatalogEntry entry, Action<SceneBundleLoadResult> completed)
        {
            if (_disposed || entry == null || string.IsNullOrWhiteSpace(entry.SceneId))
            {
                completed?.Invoke(SceneBundleLoadResult.Failed("scene-bundle-loader-unavailable"));
                yield break;
            }

            if (Application.isEditor)
            {
                yield return LoadEditorSceneAsync(entry, completed);
                yield break;
            }

            bool catalogReady = false;
            yield return EnsureCatalogAsync(value => catalogReady = value);
            if (!catalogReady || !TryGetSceneBundleName(entry.SceneId, out string sceneBundleName))
            {
                completed?.Invoke(SceneBundleLoadResult.Failed("scene-bundle-catalog-invalid"));
                yield break;
            }

            List<string> leaseBundleNames = new List<string>();
            // 在开始递归下载前就登记空租约。协调器可能在任一 yield 后用新事务取代当前请求；
            // 提前登记可让取消路径释放已经下载的共享依赖，而不会等到场景成功加载后才有清理入口。
            ReleaseSceneBundle(entry.SceneId);
            _bundleNamesBySceneId[entry.SceneId] = leaseBundleNames;
            HashSet<string> visitingBundleNames = new HashSet<string>(StringComparer.Ordinal);
            bool bundleReady = false;
            yield return LoadBundleTreeAsync(sceneBundleName, leaseBundleNames, visitingBundleNames, value => bundleReady = value);
            if (!bundleReady || !_loadedBundles.TryGetValue(sceneBundleName, out AssetBundle sceneBundle) || sceneBundle == null)
            {
                ReleaseSceneBundle(entry.SceneId);
                completed?.Invoke(SceneBundleLoadResult.Failed("scene-bundle-load-failed"));
                yield break;
            }

            string[] scenePaths = sceneBundle.GetAllScenePaths();
            if (!ContainsScenePath(scenePaths, entry.ScenePath))
            {
                ReleaseSceneBundle(entry.SceneId);
                completed?.Invoke(SceneBundleLoadResult.Failed("scene-bundle-content-invalid"));
                yield break;
            }

            // AssetBundle（资源包）只负责提供已经校验的场景内容和依赖，Unity 2022 不提供其场景加载方法。
            // 必须由 SceneManager（场景管理器）按资源包已登记且已核验的路径执行加法加载；场景包租约在场景存活期间保持，
            // 因而不会在异步加载或场景运行时提前释放资源包及其共享依赖。
            AsyncOperation loadOperation = SceneManager.LoadSceneAsync(entry.ScenePath, LoadSceneMode.Additive);
            if (loadOperation == null)
            {
                ReleaseSceneBundle(entry.SceneId);
                completed?.Invoke(SceneBundleLoadResult.Failed("scene-bundle-scene-load-failed"));
                yield break;
            }

            while (!loadOperation.isDone)
            {
                if (_disposed)
                {
                    ReleaseSceneBundle(entry.SceneId);
                    completed?.Invoke(SceneBundleLoadResult.Failed("scene-bundle-loader-unavailable"));
                    yield break;
                }
                yield return null;
            }

            Scene loadedScene = SceneManager.GetSceneByPath(entry.ScenePath);
            if (!loadedScene.IsValid() || !loadedScene.isLoaded)
            {
                ReleaseSceneBundle(entry.SceneId);
                completed?.Invoke(SceneBundleLoadResult.Failed("scene-bundle-scene-load-failed"));
                yield break;
            }

            // 成功后继续沿用起始时登记的租约；该租约同时覆盖共享依赖和场景包，
            // 后续场景卸载、失败恢复、事务取代均无需区分下载中或已提交两个状态。
            completed?.Invoke(SceneBundleLoadResult.Completed(loadedScene));
        }

        /// <summary>
        /// 场景卸载完成后由协调器调用。使用 Unload(false) 释放资产包文件和下载缓冲区，
        /// 不在场景仍被 Unity 卸载过程引用时强制销毁对象；已校验的同版本内容仍由 Unity 缓存复用。
        /// </summary>
        public void ReleaseSceneBundle(string sceneId)
        {
            if (string.IsNullOrWhiteSpace(sceneId) || !_bundleNamesBySceneId.TryGetValue(sceneId, out List<string> bundleNames))
            {
                return;
            }

            _bundleNamesBySceneId.Remove(sceneId);
            ReleaseBundleNames(bundleNames);
        }

        /// <summary>
        /// 运行壳释放时清空所有内存中的资产包句柄。方法幂等，不清空 Unity 的哈希缓存，
        /// 因此回切同一发布版本仍可命中缓存；版本切换由新目录中的哈希自然隔离。
        /// </summary>
        public void DisposeRuntime()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            List<string> sceneIds = new List<string>(_bundleNamesBySceneId.Keys);
            for (int index = 0; index < sceneIds.Count; index++)
            {
                ReleaseSceneBundle(sceneIds[index]);
            }

            List<AssetBundle> remainingBundles = new List<AssetBundle>(_loadedBundles.Values);
            _loadedBundles.Clear();
            for (int index = 0; index < remainingBundles.Count; index++)
            {
                if (remainingBundles[index] != null)
                {
                    remainingBundles[index].Unload(false);
                }
            }

            _bundleNamesBySceneId.Clear();
            _bundleByName = null;
            _catalog = null;
        }

        private IEnumerator LoadEditorSceneAsync(BusinessSceneCatalogEntry entry, Action<SceneBundleLoadResult> completed)
        {
            AsyncOperation loadOperation;
            try
            {
                loadOperation = SceneManager.LoadSceneAsync(entry.ScenePath, LoadSceneMode.Additive);
            }
            catch
            {
                completed?.Invoke(SceneBundleLoadResult.Failed("scene-load-failed"));
                yield break;
            }

            if (loadOperation == null)
            {
                completed?.Invoke(SceneBundleLoadResult.Failed("scene-load-failed"));
                yield break;
            }

            while (!loadOperation.isDone)
            {
                if (_disposed)
                {
                    completed?.Invoke(SceneBundleLoadResult.Failed("scene-bundle-loader-unavailable"));
                    yield break;
                }
                yield return null;
            }

            Scene loadedScene = SceneManager.GetSceneByPath(entry.ScenePath);
            completed?.Invoke(loadedScene.IsValid() && loadedScene.isLoaded
                ? SceneBundleLoadResult.Completed(loadedScene)
                : SceneBundleLoadResult.Failed("scene-load-failed"));
        }

        private IEnumerator EnsureCatalogAsync(Action<bool> completed)
        {
            if (_catalog != null && _bundleByName != null)
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
                if (request.result != UnityWebRequest.Result.Success || string.IsNullOrWhiteSpace(request.downloadHandler?.text))
                {
                    completed?.Invoke(false);
                    yield break;
                }

                SceneBundleCatalogDocument catalog;
                try
                {
                    catalog = JsonUtility.FromJson<SceneBundleCatalogDocument>(request.downloadHandler.text);
                }
                catch
                {
                    completed?.Invoke(false);
                    yield break;
                }

                if (!TryBuildCatalogIndex(catalog, out Dictionary<string, SceneBundleDocument> bundleByName))
                {
                    completed?.Invoke(false);
                    yield break;
                }

                _catalog = catalog;
                _bundleByName = bundleByName;
                completed?.Invoke(true);
            }
        }

        private IEnumerator LoadBundleTreeAsync(
            string bundleName,
            List<string> leaseBundleNames,
            HashSet<string> visitingBundleNames,
            Action<bool> completed)
        {
            if (_disposed || !_bundleByName.TryGetValue(bundleName, out SceneBundleDocument document))
            {
                completed?.Invoke(false);
                yield break;
            }
            if (!visitingBundleNames.Add(bundleName))
            {
                completed?.Invoke(false);
                yield break;
            }

            string[] dependencies = document.dependencies ?? Array.Empty<string>();
            for (int index = 0; index < dependencies.Length; index++)
            {
                bool dependencyReady = false;
                yield return LoadBundleTreeAsync(dependencies[index], leaseBundleNames, visitingBundleNames, value => dependencyReady = value);
                if (!dependencyReady)
                {
                    visitingBundleNames.Remove(bundleName);
                    completed?.Invoke(false);
                    yield break;
                }
            }

            visitingBundleNames.Remove(bundleName);
            if (!_loadedBundles.ContainsKey(bundleName))
            {
                if (!TryParseBundleHash(document.hash, out Hash128 hash))
                {
                    completed?.Invoke(false);
                    yield break;
                }

                using (UnityWebRequest request = UnityWebRequestAssetBundle.GetAssetBundle(BuildRuntimeUrl($"{BundleDirectoryName}/{document.fileName}"), hash, document.crc))
                {
                    yield return request.SendWebRequest();
                    if (request.result != UnityWebRequest.Result.Success)
                    {
                        completed?.Invoke(false);
                        yield break;
                    }

                    AssetBundle bundle = DownloadHandlerAssetBundle.GetContent(request);
                    if (bundle == null)
                    {
                        completed?.Invoke(false);
                        yield break;
                    }
                    _loadedBundles.Add(bundleName, bundle);
                }
            }

            if (!leaseBundleNames.Contains(bundleName))
            {
                // 依赖先加入、根包后加入；释放时逆序，保证先释放场景包再释放共享依赖。
                leaseBundleNames.Add(bundleName);
            }
            completed?.Invoke(true);
        }

        private void ReleaseBundleNames(List<string> bundleNames)
        {
            if (bundleNames == null)
            {
                return;
            }

            for (int index = bundleNames.Count - 1; index >= 0; index--)
            {
                string bundleName = bundleNames[index];
                if (_loadedBundles.TryGetValue(bundleName, out AssetBundle bundle))
                {
                    _loadedBundles.Remove(bundleName);
                    if (bundle != null)
                    {
                        bundle.Unload(false);
                    }
                }
            }
        }

        private bool TryGetSceneBundleName(string sceneId, out string bundleName)
        {
            bundleName = string.Empty;
            SceneBundleSceneDocument[] scenes = _catalog?.scenes ?? Array.Empty<SceneBundleSceneDocument>();
            for (int index = 0; index < scenes.Length; index++)
            {
                if (string.Equals(scenes[index].sceneId, sceneId, StringComparison.Ordinal))
                {
                    bundleName = scenes[index].bundleName ?? string.Empty;
                    return _bundleByName.ContainsKey(bundleName);
                }
            }
            return false;
        }

        private static bool TryBuildCatalogIndex(SceneBundleCatalogDocument catalog, out Dictionary<string, SceneBundleDocument> bundleByName)
        {
            bundleByName = null;
            if (catalog == null || string.IsNullOrWhiteSpace(catalog.releaseId) || catalog.bundles == null || catalog.scenes == null)
            {
                return false;
            }

            Dictionary<string, SceneBundleDocument> result = new Dictionary<string, SceneBundleDocument>(StringComparer.Ordinal);
            for (int index = 0; index < catalog.bundles.Length; index++)
            {
                SceneBundleDocument document = catalog.bundles[index];
                if (document == null || !IsSafeBundleSegment(document.bundleName) || !IsSafeBundleSegment(document.fileName) ||
                    string.IsNullOrWhiteSpace(document.hash) || result.ContainsKey(document.bundleName))
                {
                    return false;
                }
                result.Add(document.bundleName, document);
            }

            HashSet<string> sceneIds = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < catalog.scenes.Length; index++)
            {
                SceneBundleSceneDocument scene = catalog.scenes[index];
                if (scene == null || !BusinessSceneCatalog.IsRequiredSceneId(scene.sceneId) || !sceneIds.Add(scene.sceneId) ||
                    !result.ContainsKey(scene.bundleName ?? string.Empty))
                {
                    return false;
                }
            }

            bundleByName = result;
            return sceneIds.Count == BusinessSceneCatalog.GetRequiredSceneIds().Count;
        }

        private static bool ContainsScenePath(string[] scenePaths, string expectedScenePath)
        {
            if (scenePaths == null || string.IsNullOrWhiteSpace(expectedScenePath))
            {
                return false;
            }
            for (int index = 0; index < scenePaths.Length; index++)
            {
                if (string.Equals(scenePaths[index], expectedScenePath, StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        private static bool IsSafeBundleSegment(string value)
        {
            return !string.IsNullOrWhiteSpace(value) && value.IndexOf('/') < 0 && value.IndexOf('\\') < 0 && value.IndexOf("..", StringComparison.Ordinal) < 0;
        }

        /// <summary>
        /// Unity 2022 的 Hash128 仅保证提供 Parse；先自行验证固定 32 位十六进制文本，
        /// 再调用 Parse，避免把远端目录中的异常值转换为未处理异常或不受控错误信息。
        /// </summary>
        private static bool TryParseBundleHash(string value, out Hash128 hash)
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
                bool isLowercaseHex = character >= 'a' && character <= 'f';
                bool isUppercaseHex = character >= 'A' && character <= 'F';
                if (!isDigit && !isLowercaseHex && !isUppercaseHex)
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

        private void OnDestroy()
        {
            DisposeRuntime();
        }

        [Serializable]
        private sealed class SceneBundleCatalogDocument
        {
            public string releaseId;
            public SceneBundleDocument[] bundles;
            public SceneBundleSceneDocument[] scenes;
        }

        [Serializable]
        private sealed class SceneBundleDocument
        {
            public string bundleName;
            public string fileName;
            public string hash;
            public uint crc;
            public string[] dependencies;
        }

        [Serializable]
        private sealed class SceneBundleSceneDocument
        {
            public string sceneId;
            public string bundleName;
        }
    }
}

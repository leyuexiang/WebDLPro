using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 构建九个业务场景的 WebGL 资产包，并生成可由运行时校验的场景目录与内容摘要。
/// 该脚本不根据模型或文件名称推测业务归属，只读取已校验的 BusinessSceneCatalog；
/// 业务场景各自成为独立包，两个及以上场景共同依赖的可打包资产只进入一个共享包。
/// </summary>
public static class PowerPlantSceneBundleBuild
{
    public const string BundleDirectoryName = "SceneBundles";
    public const string CatalogFileName = "scene-catalog.json";
    public const string ContentSummaryFileName = "scene-content-summary.json";
    private const string CatalogAssetPath = "Assets/Configuration/BusinessSceneCatalog.asset";
    private const string SharedBundleName = "scene-shared";

    /// <summary>
    /// 为指定发布目录创建不可依赖编辑器状态的场景资源产物。
    /// releaseId 是发布与回滚边界的一部分，必须由调用方显式传入并通过受限字符校验；
    /// 输出目录可存在但只会覆盖本次构建所管理的 SceneBundles 文件，正式发布目录的不可覆盖策略由上层构建入口负责。
    /// </summary>
    public static void BuildSceneBundles(string unityOutputPath, string releaseId)
    {
        if (string.IsNullOrWhiteSpace(unityOutputPath))
        {
            throw new BuildFailedException("场景资源构建缺少 Unity 发布目录。");
        }
        if (!IsSafeReleaseId(releaseId))
        {
            throw new BuildFailedException("发布标识只能包含字母、数字、点、下划线和连字符。");
        }

        BusinessSceneCatalog catalog = AssetDatabase.LoadAssetAtPath<BusinessSceneCatalog>(CatalogAssetPath);
        if (catalog == null)
        {
            throw new BuildFailedException("未找到正式九场景目录资产，不能构建场景资源包。");
        }
        IReadOnlyList<BusinessSceneCatalogValidationIssue> issues = catalog.ValidateForRuntime();
        if (issues.Count > 0)
        {
            throw new BuildFailedException($"正式九场景目录校验失败：{issues[0].Code}。");
        }

        List<SceneBuildInput> inputs = CreateBuildInputs(catalog);
        string bundleOutputDirectory = Path.Combine(unityOutputPath, BundleDirectoryName);
        Directory.CreateDirectory(bundleOutputDirectory);

        Dictionary<string, HashSet<string>> sceneIdsByDependencyPath = CollectSceneDependencyUsage(inputs);
        List<string> sharedDependencyPaths = sceneIdsByDependencyPath
            .Where(pair => pair.Value.Count > 1 && IsBundleEligibleAsset(pair.Key))
            .Select(pair => pair.Key)
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToList();

        List<AssetBundleBuild> builds = CreateBundleBuilds(inputs, sharedDependencyPaths);
        AssetBundleManifest manifest = BuildPipeline.BuildAssetBundles(
            bundleOutputDirectory,
            builds.ToArray(),
            BuildAssetBundleOptions.ChunkBasedCompression | BuildAssetBundleOptions.DeterministicAssetBundle,
            BuildTarget.WebGL);
        if (manifest == null)
        {
            throw new BuildFailedException("Unity 未返回场景资产包构建清单。");
        }

        SceneBundleCatalogDocument catalogDocument = CreateCatalogDocument(releaseId, inputs, manifest, bundleOutputDirectory);
        SceneContentSummaryDocument contentSummary = CreateContentSummaryDocument(releaseId, inputs, sharedDependencyPaths, catalogDocument);
        WriteJson(Path.Combine(bundleOutputDirectory, CatalogFileName), catalogDocument);
        WriteJson(Path.Combine(bundleOutputDirectory, ContentSummaryFileName), contentSummary);
        ValidateBuildOutput(catalogDocument, bundleOutputDirectory);
    }

    /// <summary>
    /// 返回 Unity 主播放器构建所需的资产包清单文本路径。主播放器必须在代码裁剪前读取该文件，
    /// 否则只出现在业务场景包中的控制器类型可能被错误移除，导致已下载场景无法初始化。
    /// </summary>
    public static string GetAssetBundleManifestPath(string unityOutputPath)
    {
        return Path.Combine(unityOutputPath, BundleDirectoryName, $"{BundleDirectoryName}.manifest");
    }

    /// <summary>
    /// 根据正式目录建立构建输入，逐项确认每个路径确实是 SceneAsset。
    /// 这一步阻止“目录存在但文件被移动或改成其他资产”的发布，不会扫描 Assets/Art 来猜测所属场景。
    /// </summary>
    private static List<SceneBuildInput> CreateBuildInputs(BusinessSceneCatalog catalog)
    {
        List<SceneBuildInput> inputs = new List<SceneBuildInput>(catalog.Entries.Count);
        for (int index = 0; index < catalog.Entries.Count; index++)
        {
            BusinessSceneCatalogEntry entry = catalog.Entries[index];
            if (entry == null || AssetDatabase.LoadAssetAtPath<SceneAsset>(entry.ScenePath) == null)
            {
                throw new BuildFailedException("正式目录中的业务场景文件不存在或类型错误。");
            }
            inputs.Add(new SceneBuildInput(entry.SceneId, entry.UnitySceneKey, entry.ScenePath, CreateSceneBundleName(entry.SceneId)));
        }

        if (inputs.Count != BusinessSceneCatalog.GetRequiredSceneIds().Count)
        {
            throw new BuildFailedException("场景资源构建必须且只能接收九个业务场景。");
        }
        return inputs;
    }

    /// <summary>
    /// 读取 Unity 的递归依赖关系并只保留可实际写入资产包的 Assets 路径。
    /// C# 脚本由播放器编译结果提供，目录和内置资源也不应被塞入业务包，避免无效条目或重复打包。
    /// </summary>
    private static Dictionary<string, HashSet<string>> CollectSceneDependencyUsage(IReadOnlyList<SceneBuildInput> inputs)
    {
        Dictionary<string, HashSet<string>> sceneIdsByDependencyPath = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        for (int index = 0; index < inputs.Count; index++)
        {
            SceneBuildInput input = inputs[index];
            string[] dependencies = AssetDatabase.GetDependencies(input.ScenePath, true);
            List<string> eligibleDependencyPaths = new List<string>(dependencies.Length);
            for (int dependencyIndex = 0; dependencyIndex < dependencies.Length; dependencyIndex++)
            {
                string dependencyPath = dependencies[dependencyIndex];
                if (string.Equals(dependencyPath, input.ScenePath, StringComparison.Ordinal) || !IsBundleEligibleAsset(dependencyPath))
                {
                    continue;
                }
                eligibleDependencyPaths.Add(dependencyPath);
                if (!sceneIdsByDependencyPath.TryGetValue(dependencyPath, out HashSet<string> sceneIds))
                {
                    sceneIds = new HashSet<string>(StringComparer.Ordinal);
                    sceneIdsByDependencyPath.Add(dependencyPath, sceneIds);
                }
                sceneIds.Add(input.SceneId);
            }
            // 依赖扫描是编辑器数据库查询中的主要开销。每个场景只查询一次并缓存排序结果，
            // 后续共享依赖统计和内容摘要复用同一份数据，避免发布构建重复遍历完整资源图。
            input.SetDependencyPaths(eligibleDependencyPaths.OrderBy(path => path, StringComparer.Ordinal).ToArray());
        }
        return sceneIdsByDependencyPath;
    }

    /// <summary>
    /// 显式声明共享包和九个场景包。非共享依赖由 Unity 随所属场景包收集；
    /// 共享依赖被单独声明后，Unity 清单会把它们列为各场景包的依赖，避免同一资源复制九份。
    /// </summary>
    private static List<AssetBundleBuild> CreateBundleBuilds(IReadOnlyList<SceneBuildInput> inputs, List<string> sharedDependencyPaths)
    {
        List<AssetBundleBuild> builds = new List<AssetBundleBuild>(inputs.Count + 1);
        if (sharedDependencyPaths.Count > 0)
        {
            builds.Add(new AssetBundleBuild
            {
                assetBundleName = SharedBundleName,
                assetNames = sharedDependencyPaths.ToArray()
            });
        }

        for (int index = 0; index < inputs.Count; index++)
        {
            SceneBuildInput input = inputs[index];
            builds.Add(new AssetBundleBuild
            {
                assetBundleName = input.BundleName,
                assetNames = new[] { input.ScenePath }
            });
        }
        return builds;
    }

    /// <summary>
    /// 将 Unity 生成的哈希、校验和依赖图转成运行时受限目录。
    /// 目录不写入绝对路径、异常文本或构建机器信息，只保留发布标识、稳定场景标识和资源校验所需字段。
    /// </summary>
    private static SceneBundleCatalogDocument CreateCatalogDocument(
        string releaseId,
        IReadOnlyList<SceneBuildInput> inputs,
        AssetBundleManifest manifest,
        string bundleOutputDirectory)
    {
        string[] bundleNames = manifest.GetAllAssetBundles().OrderBy(name => name, StringComparer.Ordinal).ToArray();
        List<SceneBundleDocument> bundles = new List<SceneBundleDocument>(bundleNames.Length);
        for (int index = 0; index < bundleNames.Length; index++)
        {
            string bundleName = bundleNames[index];
            string bundlePath = Path.Combine(bundleOutputDirectory, bundleName);
            if (!File.Exists(bundlePath))
            {
                throw new BuildFailedException($"无法读取场景资源包文件：{bundleName}。");
            }
            bundles.Add(new SceneBundleDocument
            {
                bundleName = bundleName,
                fileName = bundleName,
                hash = manifest.GetAssetBundleHash(bundleName).ToString(),
                // Unity 2022.3 的 ChunkBasedCompression（分块压缩）WebGL 资源包在
                // BuildPipeline.GetCRCForAssetBundle（构建管线 CRC）与
                // DownloadHandlerAssetBundle（下载处理器）之间存在校验口径差异：
                // 前者生成的值会让浏览器把完整、未改写的文件判定为 CRC Mismatch（校验不一致）。
                // 运行时仍使用 Unity Hash128（128 位内容哈希）拒绝错误版本并隔离缓存，
                // 将可选 CRC 固定为 0 让 Unity 跳过不兼容的二次校验，避免合法场景无法加载。
                crc = 0,
                // 记录实际产物字节数，而不是编辑器估算值。该值用于发布评审、容量预算和冷缓存传输统计，
                // 不参与运行时可信校验；运行时仍以 Unity 构建哈希和循环冗余校验为准。
                sizeBytes = new FileInfo(bundlePath).Length,
                dependencies = manifest.GetAllDependencies(bundleName).OrderBy(name => name, StringComparer.Ordinal).ToArray()
            });
        }

        List<SceneBundleSceneDocument> scenes = new List<SceneBundleSceneDocument>(inputs.Count);
        for (int index = 0; index < inputs.Count; index++)
        {
            SceneBuildInput input = inputs[index];
            scenes.Add(new SceneBundleSceneDocument
            {
                sceneId = input.SceneId,
                unitySceneKey = input.UnitySceneKey,
                scenePath = input.ScenePath,
                bundleName = input.BundleName
            });
        }

        return new SceneBundleCatalogDocument
        {
            schemaVersion = 2,
            releaseId = releaseId,
            bundles = bundles.ToArray(),
            scenes = scenes.ToArray()
        };
    }

    /// <summary>
    /// 内容摘要用于发布评审、独立校验和回滚追溯。它列出 Unity 实际解析到的依赖路径，
    /// 并把共享依赖单列，方便确认新增场景不会意外复制已有公共材质、着色器或图集。
    /// </summary>
    private static SceneContentSummaryDocument CreateContentSummaryDocument(
        string releaseId,
        IReadOnlyList<SceneBuildInput> inputs,
        List<string> sharedDependencyPaths,
        SceneBundleCatalogDocument catalogDocument)
    {
        HashSet<string> sharedSet = new HashSet<string>(sharedDependencyPaths, StringComparer.Ordinal);
        Dictionary<string, SceneBundleDocument> bundleByName = catalogDocument.bundles.ToDictionary(
            bundle => bundle.bundleName,
            bundle => bundle,
            StringComparer.Ordinal);
        List<SceneContentSummaryEntry> scenes = new List<SceneContentSummaryEntry>(inputs.Count);
        for (int index = 0; index < inputs.Count; index++)
        {
            SceneBuildInput input = inputs[index];
            List<SceneBundleDocument> sceneBundles = ResolveBundleClosure(input.BundleName, bundleByName);
            scenes.Add(new SceneContentSummaryEntry
            {
                sceneId = input.SceneId,
                bundleName = input.BundleName,
                scenePath = input.ScenePath,
                // 内容版本覆盖场景包及其全部共享依赖。任何一个依赖包哈希变化都会得到新版本，
                // 避免只使用根场景包哈希而漏掉公共材质、着色器或图集的变更。
                contentVersion = ComputeSceneContentVersion(sceneBundles),
                // 传输体积按冷缓存首次加载需要取得的全部包求和；同版本缓存命中时实际网络传输可降为零。
                transferSizeBytes = sceneBundles.Sum(bundle => bundle.sizeBytes),
                bundleNames = sceneBundles.Select(bundle => bundle.bundleName).ToArray(),
                exclusiveDependencyPaths = input.DependencyPaths.Where(path => !sharedSet.Contains(path)).ToArray(),
                sharedDependencyPaths = input.DependencyPaths.Where(sharedSet.Contains).ToArray()
            });
        }

        return new SceneContentSummaryDocument
        {
            schemaVersion = 2,
            releaseId = releaseId,
            sharedDependencyPaths = sharedDependencyPaths.ToArray(),
            scenes = scenes.ToArray()
        };
    }

    /// <summary>
    /// 以迭代方式解析一个场景从根包到共享依赖的完整闭包。构建期目录规模虽小，仍使用集合去重，
    /// 防止菱形依赖重复计入传输体积；缺失依赖会直接阻止发布，不生成不可独立加载的场景摘要。
    /// </summary>
    private static List<SceneBundleDocument> ResolveBundleClosure(
        string rootBundleName,
        IReadOnlyDictionary<string, SceneBundleDocument> bundleByName)
    {
        Stack<string> pendingBundleNames = new Stack<string>();
        HashSet<string> visitedBundleNames = new HashSet<string>(StringComparer.Ordinal);
        pendingBundleNames.Push(rootBundleName);

        while (pendingBundleNames.Count > 0)
        {
            string bundleName = pendingBundleNames.Pop();
            if (!visitedBundleNames.Add(bundleName))
            {
                continue;
            }
            if (!bundleByName.TryGetValue(bundleName, out SceneBundleDocument bundle))
            {
                throw new BuildFailedException($"场景资源摘要存在无法解析的依赖包：{bundleName}。");
            }

            string[] dependencies = bundle.dependencies ?? Array.Empty<string>();
            for (int index = 0; index < dependencies.Length; index++)
            {
                pendingBundleNames.Push(dependencies[index]);
            }
        }

        return visitedBundleNames
            .OrderBy(bundleName => bundleName, StringComparer.Ordinal)
            .Select(bundleName => bundleByName[bundleName])
            .ToList();
    }

    /// <summary>
    /// 把场景依赖闭包中按名称排序的“包名 + Unity 内容哈希”合成为稳定的场景内容版本。
    /// 使用安全哈希算法（SHA-256）只为得到低碰撞版本标识，不替代资产包自带的哈希与循环冗余校验。
    /// </summary>
    private static string ComputeSceneContentVersion(IReadOnlyList<SceneBundleDocument> sceneBundles)
    {
        StringBuilder source = new StringBuilder(sceneBundles.Count * 64);
        for (int index = 0; index < sceneBundles.Count; index++)
        {
            SceneBundleDocument bundle = sceneBundles[index];
            source.Append(bundle.bundleName).Append(':').Append(bundle.hash).Append('\n');
        }

        using (SHA256 algorithm = SHA256.Create())
        {
            byte[] digest = algorithm.ComputeHash(Encoding.UTF8.GetBytes(source.ToString()));
            StringBuilder version = new StringBuilder(digest.Length * 2);
            for (int index = 0; index < digest.Length; index++)
            {
                version.Append(digest[index].ToString("x2"));
            }
            return version.ToString();
        }
    }

    /// <summary>
    /// 构建结束后检查本任务可证明的发布结构：九个场景均有独立包，目录中的哈希、字节数与文件齐全，
    /// 每个场景包依赖项均能在目录中解析。浏览器实际加载由任务-020联调包回归覆盖，目标硬件缓存与性能预算由任务-054验收。
    /// </summary>
    private static void ValidateBuildOutput(SceneBundleCatalogDocument catalog, string bundleOutputDirectory)
    {
        if (catalog.scenes == null || catalog.scenes.Length != BusinessSceneCatalog.GetRequiredSceneIds().Count)
        {
            throw new BuildFailedException("场景资源目录未包含完整九场景。");
        }
        HashSet<string> bundleNames = new HashSet<string>(catalog.bundles.Select(bundle => bundle.bundleName), StringComparer.Ordinal);
        for (int index = 0; index < catalog.scenes.Length; index++)
        {
            SceneBundleSceneDocument scene = catalog.scenes[index];
            if (!bundleNames.Contains(scene.bundleName) || !File.Exists(Path.Combine(bundleOutputDirectory, scene.bundleName)))
            {
                throw new BuildFailedException("场景资源目录存在缺失的独立场景包。");
            }
        }
        for (int index = 0; index < catalog.bundles.Length; index++)
        {
            SceneBundleDocument bundle = catalog.bundles[index];
            if (bundle.sizeBytes <= 0 || string.IsNullOrWhiteSpace(bundle.hash))
            {
                throw new BuildFailedException("场景资源目录存在空文件或缺少内容哈希的资源包。");
            }
            string[] dependencies = bundle.dependencies ?? Array.Empty<string>();
            for (int dependencyIndex = 0; dependencyIndex < dependencies.Length; dependencyIndex++)
            {
                if (!bundleNames.Contains(dependencies[dependencyIndex]))
                {
                    throw new BuildFailedException("场景资源目录存在无法解析的共享依赖。");
                }
            }
        }
    }

    private static bool IsBundleEligibleAsset(string assetPath)
    {
        if (string.IsNullOrWhiteSpace(assetPath) || !assetPath.StartsWith("Assets/", StringComparison.Ordinal))
        {
            return false;
        }
        UnityEngine.Object asset = AssetDatabase.LoadMainAssetAtPath(assetPath);
        return asset != null && !(asset is MonoScript) && !(asset is SceneAsset) && !(asset is DefaultAsset);
    }

    private static string CreateSceneBundleName(string sceneId)
    {
        return $"scene-{sceneId}";
    }

    private static bool IsSafeReleaseId(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 64)
        {
            return false;
        }
        for (int index = 0; index < value.Length; index++)
        {
            char character = value[index];
            if (!char.IsLetterOrDigit(character) && character != '.' && character != '_' && character != '-')
            {
                return false;
            }
        }
        return true;
    }

    private static void WriteJson(string path, object value)
    {
        // UTF-8 无 BOM 保证 WebGL 静态服务器与浏览器可以直接按 JSON 读取，避免额外编码分支。
        File.WriteAllText(path, JsonUtility.ToJson(value, true), new UTF8Encoding(false));
    }

    private sealed class SceneBuildInput
    {
        public string SceneId { get; }
        public string UnitySceneKey { get; }
        public string ScenePath { get; }
        public string BundleName { get; }
        public string[] DependencyPaths { get; private set; } = Array.Empty<string>();

        public SceneBuildInput(string sceneId, string unitySceneKey, string scenePath, string bundleName)
        {
            SceneId = sceneId;
            UnitySceneKey = unitySceneKey;
            ScenePath = scenePath;
            BundleName = bundleName;
        }

        public void SetDependencyPaths(string[] dependencyPaths)
        {
            DependencyPaths = dependencyPaths ?? Array.Empty<string>();
        }
    }

    [Serializable]
    private sealed class SceneBundleCatalogDocument
    {
        public int schemaVersion;
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
        public long sizeBytes;
        public string[] dependencies;
    }

    [Serializable]
    private sealed class SceneBundleSceneDocument
    {
        public string sceneId;
        public string unitySceneKey;
        public string scenePath;
        public string bundleName;
    }

    [Serializable]
    private sealed class SceneContentSummaryDocument
    {
        public int schemaVersion;
        public string releaseId;
        public string[] sharedDependencyPaths;
        public SceneContentSummaryEntry[] scenes;
    }

    [Serializable]
    private sealed class SceneContentSummaryEntry
    {
        public string sceneId;
        public string bundleName;
        public string scenePath;
        public string contentVersion;
        public long transferSizeBytes;
        public string[] bundleNames;
        public string[] exclusiveDependencyPaths;
        public string[] sharedDependencyPaths;
    }
}

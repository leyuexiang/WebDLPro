using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 构建第三层关键环节独立预制体资源包和受限目录。当前发布包含燃气轮机正式项与燃煤锅炉燃烧占位项，
/// 目录结构支持每个场景零到多个条目，且与主播放器共用同一 releaseId（发布标识）。
/// </summary>
public static class PowerPlantProcessDetailBundleBuild
{
    public const string BundleDirectoryName = "ProcessDetailBundles";
    public const string CatalogFileName = "process-detail-catalog.json";
    private const string CatalogAssetPath = "Assets/Configuration/ProcessDetailCatalog.asset";

    [Serializable]
    private sealed class CatalogDocument
    {
        public int schemaVersion = 1;
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

    public static void BuildProcessDetailBundles(string unityOutputPath, string releaseId)
    {
        if (string.IsNullOrWhiteSpace(unityOutputPath) || !IsSafeReleaseId(releaseId))
        {
            throw new BuildFailedException("关键环节资源构建缺少合法输出目录或发布标识。");
        }

        ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogAssetPath);
        if (catalog == null)
        {
            throw new BuildFailedException("未找到正式关键环节目录资产。");
        }
        IReadOnlyList<BusinessSceneCatalogValidationIssue> issues = catalog.ValidateForRuntime();
        if (issues.Count > 0)
        {
            throw new BuildFailedException($"关键环节目录校验失败：{issues[0].Code}。");
        }

        string outputDirectory = Path.Combine(unityOutputPath, BundleDirectoryName);
        Directory.CreateDirectory(outputDirectory);
        ProcessDetailCatalogEntry[] entries = catalog.Entries.ToArray();
        if (entries.Length == 0)
        {
            WriteCatalog(outputDirectory, releaseId, Array.Empty<EntryDocument>());
            return;
        }

        AssetBundleBuild[] builds = new AssetBundleBuild[entries.Length];
        Dictionary<string, string> assetPathsByDetailId = new Dictionary<string, string>(StringComparer.Ordinal);
        Dictionary<string, string> bundleNamesByDetailId = new Dictionary<string, string>(StringComparer.Ordinal);
        for (int index = 0; index < entries.Length; index++)
        {
            ProcessDetailCatalogEntry entry = entries[index];
            GameObject prefab = entry.EditorPrefab;
            string assetPath = prefab != null ? AssetDatabase.GetAssetPath(prefab) : string.Empty;
            if (prefab == null || string.IsNullOrWhiteSpace(assetPath) ||
                PrefabUtility.GetPrefabAssetType(prefab) == PrefabAssetType.NotAPrefab)
            {
                throw new BuildFailedException($"关键环节 {entry.ProcessDetailId} 缺少正式包装预制体。");
            }

            string bundleName = CreateBundleName(entry.ProcessDetailId);
            builds[index] = new AssetBundleBuild
            {
                assetBundleName = bundleName,
                assetNames = new[] { assetPath }
            };
            assetPathsByDetailId.Add(entry.ProcessDetailId, assetPath);
            bundleNamesByDetailId.Add(entry.ProcessDetailId, bundleName);
        }

        AssetBundleManifest manifest = BuildPipeline.BuildAssetBundles(
            outputDirectory,
            builds,
            BuildAssetBundleOptions.ChunkBasedCompression | BuildAssetBundleOptions.DeterministicAssetBundle,
            BuildTarget.WebGL);
        if (manifest == null)
        {
            throw new BuildFailedException("Unity 未返回关键环节资源包构建清单。");
        }

        EntryDocument[] documents = new EntryDocument[entries.Length];
        for (int index = 0; index < entries.Length; index++)
        {
            ProcessDetailCatalogEntry entry = entries[index];
            string bundleName = bundleNamesByDetailId[entry.ProcessDetailId];
            string bundlePath = Path.Combine(outputDirectory, bundleName);
            if (!File.Exists(bundlePath))
            {
                throw new BuildFailedException($"关键环节资源包文件不存在：{bundleName}。");
            }

            documents[index] = new EntryDocument
            {
                processDetailId = entry.ProcessDetailId,
                resourceId = entry.ResourceId,
                bundleName = bundleName,
                fileName = bundleName,
                hash = manifest.GetAssetBundleHash(bundleName).ToString(),
                // 与场景资源包保持一致：Unity 2022.3 WebGL 分块压缩仅使用 Hash128，关闭不兼容的可选 CRC 二次校验。
                crc = 0,
                sizeBytes = new FileInfo(bundlePath).Length,
                assetPath = assetPathsByDetailId[entry.ProcessDetailId]
            };
        }

        WriteCatalog(outputDirectory, releaseId, documents);
    }

    private static void WriteCatalog(string outputDirectory, string releaseId, EntryDocument[] entries)
    {
        CatalogDocument document = new CatalogDocument
        {
            releaseId = releaseId,
            entries = entries
        };
        File.WriteAllText(
            Path.Combine(outputDirectory, CatalogFileName),
            JsonUtility.ToJson(document, true),
            new UTF8Encoding(false));
    }

    private static string CreateBundleName(string processDetailId)
    {
        StringBuilder builder = new StringBuilder("process-detail-");
        for (int index = 0; index < processDetailId.Length; index++)
        {
            char character = char.ToLowerInvariant(processDetailId[index]);
            builder.Append(char.IsLetterOrDigit(character) ? character : '-');
        }
        return builder.ToString();
    }

    private static bool IsSafeReleaseId(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 128)
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
}

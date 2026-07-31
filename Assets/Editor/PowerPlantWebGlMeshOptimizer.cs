using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;

/// <summary>
/// 为燃气电厂的静态 FBX 资产应用适用于 WebGL 的导入设置。
/// 该工具只调整 Importer，不会修改 FBX 源文件、场景层级、材质引用或流程映射。
/// </summary>
public static class PowerPlantWebGlMeshOptimizer
{
    private const string ArtRoot = "Assets/Art";

    [MenuItem("Tools/Power Plant/WebGL/报告模型导入设置")]
    public static void ReportSettings()
    {
        List<string> paths = FindFbxPaths();
        int readableCount = 0;
        int highCompressionCount = 0;

        foreach (string path in paths)
        {
            ModelImporter importer = AssetImporter.GetAtPath(path) as ModelImporter;
            if (importer == null)
            {
                continue;
            }

            if (importer.isReadable)
            {
                readableCount++;
            }

            if (importer.meshCompression == ModelImporterMeshCompression.High)
            {
                highCompressionCount++;
            }
        }

        UnityEngine.Debug.Log(
            $"[PowerPlantWebGlMeshOptimizer] FBX={paths.Count}; " +
            $"高压缩={highCompressionCount}; 可读网格={readableCount}。");
    }

    [MenuItem("Tools/Power Plant/WebGL/应用 WebGL 网格优化")]
    public static void ApplyWebGlSettings()
    {
        List<string> paths = FindFbxPaths();
        int changedCount = 0;

        foreach (string path in paths)
        {
            ModelImporter importer = AssetImporter.GetAtPath(path) as ModelImporter;
            if (importer == null)
            {
                continue;
            }

            bool changed = false;

            if (importer.meshCompression != ModelImporterMeshCompression.High)
            {
                importer.meshCompression = ModelImporterMeshCompression.High;
                changed = true;
            }

            // 本场景的运行时交互只读取 Renderer、Bounds 和材质，不访问 Mesh.vertices / triangles。
            // 关闭该副本可避免 WebGL 同时保留 CPU 与 GPU 两套顶点数据。
            if (importer.isReadable)
            {
                importer.isReadable = false;
                changed = true;
            }

            if (!importer.optimizeMeshVertices)
            {
                importer.optimizeMeshVertices = true;
                changed = true;
            }

            if (!importer.optimizeMeshPolygons)
            {
                importer.optimizeMeshPolygons = true;
                changed = true;
            }

            // 厂区 FBX 不以相机、灯光或约束作为场景内容，禁止导入可减少无用的运行时对象。
            if (importer.importCameras)
            {
                importer.importCameras = false;
                changed = true;
            }

            if (importer.importLights)
            {
                importer.importLights = false;
                changed = true;
            }

            if (importer.importConstraints)
            {
                importer.importConstraints = false;
                changed = true;
            }

            if (!changed)
            {
                continue;
            }

            importer.SaveAndReimport();
            changedCount++;
        }

        AssetDatabase.SaveAssets();
        UnityEngine.Debug.Log(
            $"[PowerPlantWebGlMeshOptimizer] 已为 {changedCount}/{paths.Count} 个 FBX 应用 WebGL 网格优化。" +
            "请重新构建 WebGL 并在目标浏览器中复测内存。");
    }

    private static List<string> FindFbxPaths()
    {
        string[] guids = AssetDatabase.FindAssets("t:Model", new[] { ArtRoot });
        List<string> paths = new List<string>(guids.Length);

        foreach (string guid in guids)
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            if (string.Equals(Path.GetExtension(path), ".fbx", StringComparison.OrdinalIgnoreCase))
            {
                paths.Add(path);
            }
        }

        paths.Sort(StringComparer.Ordinal);
        return paths;
    }
}

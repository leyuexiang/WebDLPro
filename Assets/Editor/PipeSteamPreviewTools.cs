using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// 为当前场景中用户选中的管道创建管内体积蒸汽层。
/// 体积层复用管道封闭网格作为边界，烟雾密度由光线步进着色器在网格内部计算，
/// 不需要额外内壁模型；工具只修改场景实例，不修改源模型文件。
/// </summary>
public static class PipeSteamPreviewTools
{
    private const string SteamChildName = "__PipeSteamPreview";
    private const string SteamMaterialPath = "Assets/Shaders/PipeSteam.mat";
    private const string ShellMaterialPath = "Assets/Shaders/PipeShellPreview.mat";
    private const string VolumetricShaderName = "自定义/URP/管内体积蒸汽";

    /// <summary>
    /// 对当前选中的一个或多个管道批量生成体积蒸汽。
    /// 每个目标只要求自身存在 MeshFilter 和 MeshRenderer，避免选中“整体”等场景根节点时递归修改无关模型。
    /// </summary>
    [MenuItem("Tools/WebDLPro/资源烘焙/管内蒸汽/生成体积烟雾")]
    public static void BuildVolumetricPreview()
    {
        GameObject[] selections = Selection.gameObjects;
        if (selections.Length == 0)
        {
            Debug.LogError("[PipeSteamPreview] 请先选中一个或多个管道对象。");
            return;
        }

        Material steamMaterial = AssetDatabase.LoadAssetAtPath<Material>(SteamMaterialPath);
        Material shellMaterial = AssetDatabase.LoadAssetAtPath<Material>(ShellMaterialPath);
        if (steamMaterial == null || steamMaterial.shader == null || steamMaterial.shader.name != VolumetricShaderName)
        {
            Debug.LogError($"[PipeSteamPreview] 未找到有效的体积蒸汽材质：{SteamMaterialPath}");
            return;
        }

        if (shellMaterial == null)
        {
            Debug.LogError($"[PipeSteamPreview] 未找到透明管道外壳材质：{ShellMaterialPath}");
            return;
        }

        int successCount = 0;
        int skippedCount = 0;
        HashSet<GameObject> processedTargets = new HashSet<GameObject>();
        for (int index = 0; index < selections.Length; index++)
        {
            GameObject target = selections[index];
            if (target == null || target.name == SteamChildName || !processedTargets.Add(target))
            {
                skippedCount++;
                continue;
            }

            if (ApplyToTarget(target, steamMaterial, shellMaterial))
            {
                successCount++;
            }
            else
            {
                skippedCount++;
            }
        }

        Scene activeScene = SceneManager.GetActiveScene();
        if (successCount > 0)
        {
            EditorSceneManager.MarkSceneDirty(activeScene);
            AssetDatabase.SaveAssets();
            EditorSceneManager.SaveScene(activeScene);
        }

        Debug.Log($"[PipeSteamPreview] 批量完成：成功={successCount}，跳过={skippedCount}。" +
                  "蒸汽材质参数保持当前属性面板设置未被覆盖。");
    }

    /// <summary>
    /// 只处理选中对象本身，避免对没有明确管道边界的场景聚合根节点递归创建体积烟雾。
    /// </summary>
    private static bool ApplyToTarget(GameObject target, Material steamMaterial, Material shellMaterial)
    {
        MeshFilter sourceFilter = target.GetComponent<MeshFilter>();
        MeshRenderer sourceRenderer = target.GetComponent<MeshRenderer>();
        if (sourceFilter == null || sourceFilter.sharedMesh == null || sourceRenderer == null)
        {
            Debug.LogWarning($"[PipeSteamPreview] 已跳过 {target.name}：对象自身不是可处理的单网格管道。", target);
            return false;
        }

        Transform steamTransform = target.transform.Find(SteamChildName);
        if (steamTransform == null)
        {
            GameObject steamObject = new GameObject(SteamChildName);
            Undo.RegisterCreatedObjectUndo(steamObject, "创建管内体积蒸汽层");
            steamTransform = steamObject.transform;
            steamTransform.SetParent(target.transform, false);
        }

        MeshFilter steamFilter = steamTransform.GetComponent<MeshFilter>();
        if (steamFilter == null)
        {
            steamFilter = Undo.AddComponent<MeshFilter>(steamTransform.gameObject);
        }

        MeshRenderer steamRenderer = steamTransform.GetComponent<MeshRenderer>();
        if (steamRenderer == null)
        {
            steamRenderer = Undo.AddComponent<MeshRenderer>(steamTransform.gameObject);
        }

        // 体积边界必须与原管道完全重合，不能缩放或沿法线移动，否则弯头和分支会与原路径错位。
        steamTransform.localPosition = Vector3.zero;
        steamTransform.localRotation = Quaternion.identity;
        steamTransform.localScale = Vector3.one;
        steamFilter.sharedMesh = sourceFilter.sharedMesh;
        steamRenderer.sharedMaterial = steamMaterial;
        steamRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        steamRenderer.receiveShadows = false;
        steamRenderer.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
        steamRenderer.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;
        steamTransform.gameObject.SetActive(true);

        // 外壳材质只写入当前场景实例的 MeshRenderer，源 FBX 和原始材质资产保持不变。
        Undo.RecordObject(sourceRenderer, "设置管道体积烟雾透明边界");
        sourceRenderer.sharedMaterial = shellMaterial;
        EditorUtility.SetDirty(steamFilter);
        EditorUtility.SetDirty(steamRenderer);
        EditorUtility.SetDirty(sourceRenderer);
        return true;
    }

    [MenuItem("Tools/WebDLPro/资源烘焙/管内蒸汽/生成体积烟雾", true)]
    private static bool ValidateBuildVolumetricPreview()
    {
        return !EditorApplication.isPlayingOrWillChangePlaymode &&
               SceneManager.GetActiveScene().IsValid() &&
               Selection.gameObjects.Length > 0;
    }
}

using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// 为风机 Prefab 一次性配置全息透明、特征线框和参考图所示旋转方向。
/// 所有修改通过 PrefabUtility 写回 Prefab 资产，不修改 FBX 源文件。
/// </summary>
public static class WindTurbinePrefabSetup
{
    private const string PrefabPath = "Assets/Art/风机/FJPrefab.prefab";
    private const string WireframeDirectory = "Assets/Art/Generated/WindTurbineWireframe";
    private const string HologramMaterialPath = "Assets/Shaders/Hologram_Body.mat";
    private const string WireframeMaterialPath = "Assets/Shaders/Hologram_Wireframe.mat";
    private const string ControllerName = "WindTurbineRotationController";
    private const float WireframeFeatureAngle = 52f;

    private sealed class MeshBindingData
    {
        public MeshFilter sourceFilter;
        public Mesh wireframeMesh;
    }

    [MenuItem("Tools/WebDLPro/风机/配置全息与旋转", false, 220)]
    public static void ConfigureWindTurbinePrefab()
    {
        if (EditorApplication.isPlayingOrWillChangePlaymode)
        {
            EditorUtility.DisplayDialog("无法配置风机", "请先退出播放模式。", "确定");
            return;
        }

        GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
        if (prefab == null)
        {
            EditorUtility.DisplayDialog("无法配置风机", $"未找到 Prefab：{PrefabPath}", "确定");
            return;
        }

        EnsureDirectory();
        GameObject root = PrefabUtility.LoadPrefabContents(PrefabPath);
        try
        {
            MeshBindingData[] bindings = BakeWireframes(root);
            ConfigureHologram(root, bindings);
            ConfigureRotations(root);
            PrefabUtility.SaveAsPrefabAsset(root, PrefabPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Selection.activeObject = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            Debug.Log($"[WindTurbinePrefabSetup] 已完成：全息透明 + 线框={bindings.Length} 个 + 旋转配置。", prefab);
        }
        finally
        {
            PrefabUtility.UnloadPrefabContents(root);
        }
    }

    [MenuItem("Tools/WebDLPro/风机/配置全息与旋转", true)]
    private static bool ValidateConfigureWindTurbinePrefab()
    {
        return !EditorApplication.isPlayingOrWillChangePlaymode;
    }

    [MenuItem("Tools/WebDLPro/风机/仅烘焙线框", false, 221)]
    public static void BakeWindTurbineWireframes()
    {
        if (EditorApplication.isPlayingOrWillChangePlaymode)
        {
            Debug.LogError("[WindTurbinePrefabSetup] 请先退出播放模式。");
            return;
        }

        GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
        if (prefab == null)
        {
            Debug.LogError($"[WindTurbinePrefabSetup] 未找到 Prefab：{PrefabPath}");
            return;
        }

        EnsureDirectory();
        int count = 0;
        HashSet<Mesh> processedMeshes = new HashSet<Mesh>();
        foreach (MeshFilter filter in prefab.GetComponentsInChildren<MeshFilter>(true))
        {
            if (filter.sharedMesh == null || !processedMeshes.Add(filter.sharedMesh))
            {
                continue;
            }

            Mesh wireframe = WireframeOverlayBaker.BuildWireframeMesh(filter.sharedMesh, WireframeFeatureAngle);
            if (wireframe == null)
            {
                continue;
            }

            string assetPath = GetWindTurbineWireframePath(filter.sharedMesh);
            Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(assetPath);
            if (existing != null)
            {
                EditorUtility.CopySerialized(wireframe, existing);
                UnityEngine.Object.DestroyImmediate(wireframe);
            }
            else
            {
                AssetDatabase.CreateAsset(wireframe, assetPath);
            }

            count++;
        }

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log($"[WindTurbinePrefabSetup] 风机线框烘焙完成：{count} 个唯一网格。", prefab);
    }

    public static string GetWindTurbineWireframePath(Mesh source)
    {
        if (source == null)
        {
            return string.Empty;
        }

        string sourceAssetPath = AssetDatabase.GetAssetPath(source);
        string modelPrefix = string.IsNullOrEmpty(sourceAssetPath)
            ? string.Empty
            : System.IO.Path.GetFileNameWithoutExtension(sourceAssetPath) + "_";
        string fileName = SanitizeFileName(modelPrefix + source.name) + "_Wire.asset";
        return $"{WireframeDirectory}/{fileName}";
    }

    private static MeshBindingData[] BakeWireframes(GameObject root)
    {
        List<MeshBindingData> bindings = new List<MeshBindingData>();
        HashSet<Mesh> processedMeshes = new HashSet<Mesh>();
        foreach (MeshFilter filter in root.GetComponentsInChildren<MeshFilter>(true))
        {
            if (filter.sharedMesh == null || !processedMeshes.Add(filter.sharedMesh))
            {
                continue;
            }

            string assetPath = GetWindTurbineWireframePath(filter.sharedMesh);
            Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(assetPath);
            Mesh wireframe = existing;
            if (wireframe == null)
            {
                wireframe = WireframeOverlayBaker.BuildWireframeMesh(filter.sharedMesh, WireframeFeatureAngle);
                if (wireframe != null)
                {
                    AssetDatabase.CreateAsset(wireframe, assetPath);
                }
            }

            bindings.Add(new MeshBindingData { sourceFilter = filter, wireframeMesh = wireframe });
        }

        AssetDatabase.SaveAssets();
        return bindings.ToArray();
    }

    private static void ConfigureHologram(GameObject root, MeshBindingData[] bindings)
    {
        Material hologramMaterial = AssetDatabase.LoadAssetAtPath<Material>(HologramMaterialPath);
        Material wireframeMaterial = AssetDatabase.LoadAssetAtPath<Material>(WireframeMaterialPath);
        WireframeHologramEffect effect = root.GetComponent<WireframeHologramEffect>();
        if (effect == null)
        {
            effect = root.AddComponent<WireframeHologramEffect>();
        }

        SerializedObject serializedEffect = new SerializedObject(effect);
        serializedEffect.Update();
        serializedEffect.FindProperty("hologramMaterial").objectReferenceValue = hologramMaterial;
        serializedEffect.FindProperty("wireframeMaterial").objectReferenceValue = wireframeMaterial;
        serializedEffect.FindProperty("effectEnabled").boolValue = true;
        serializedEffect.FindProperty("opacityBreathing").boolValue = true;
        serializedEffect.FindProperty("breathingSpeed").floatValue = 0.65f;
        serializedEffect.FindProperty("breathingAmplitude").floatValue = 0.28f;
        serializedEffect.FindProperty("exteriorOpacity").floatValue = 0.10f;
        serializedEffect.FindProperty("extraTransparentOpacity").floatValue = 0.05f;
        SerializedProperty exteriorTargetsProperty = serializedEffect.FindProperty("exteriorTargets");
        string[] exteriorNames = { "机舱", "塔架", "底座 (2)", "支架", "6齿轮箱体", "减速器", "发电机", "FY/轮毂", "FY/旋翼", "FY/叶片" };
        exteriorTargetsProperty.arraySize = exteriorNames.Length;
        for (int index = 0; index < exteriorNames.Length; index++)
        {
            exteriorTargetsProperty.GetArrayElementAtIndex(index).objectReferenceValue = root.transform.Find(exteriorNames[index]);
        }

        SerializedProperty extraTransparentTargetsProperty = serializedEffect.FindProperty("extraTransparentTargets");
        string[] extraTransparentNames = { "机舱", "6齿轮箱体" };
        extraTransparentTargetsProperty.arraySize = extraTransparentNames.Length;
        for (int index = 0; index < extraTransparentNames.Length; index++)
        {
            extraTransparentTargetsProperty.GetArrayElementAtIndex(index).objectReferenceValue = root.transform.Find(extraTransparentNames[index]);
        }

        serializedEffect.FindProperty("wireframeMesh").objectReferenceValue = null;

        SerializedProperty bindingsProperty = serializedEffect.FindProperty("wireframeBindings");
        bindingsProperty.arraySize = bindings.Length;
        for (int index = 0; index < bindings.Length; index++)
        {
            SerializedProperty bindingProperty = bindingsProperty.GetArrayElementAtIndex(index);
            bindingProperty.FindPropertyRelative("sourceFilter").objectReferenceValue = bindings[index].sourceFilter;
            bindingProperty.FindPropertyRelative("wireframeMesh").objectReferenceValue = bindings[index].wireframeMesh;
        }

        serializedEffect.ApplyModifiedPropertiesWithoutUndo();
        EditorUtility.SetDirty(effect);

        WireframeHologramManager manager = root.GetComponent<WireframeHologramManager>();
        if (manager != null)
        {
            UnityEngine.Object.DestroyImmediate(manager, true);
        }
    }

    private static void ConfigureRotations(GameObject root)
    {
        WindTurbineRotationController controller = root.GetComponent<WindTurbineRotationController>();
        if (controller == null)
        {
            controller = root.AddComponent<WindTurbineRotationController>();
        }

        Vector3 rotationAxis = Vector3.forward;
        WindTurbineRotationController.RotationTarget blade = CreateTarget("FY · 顺时针", root.transform.Find("FY"), rotationAxis, 18f);
        Vector3 gearAxis = Vector3.up;
        string[] counterClockwiseNames =
        {
            "YJXX001", "YJXX002", "YJXX003",
            "二级行星齿轮001", "二级行星齿轮002", "二级行星齿轮003"
        };
        WindTurbineRotationController.RotationTarget[] counterClockwise = new WindTurbineRotationController.RotationTarget[counterClockwiseNames.Length];
        for (int index = 0; index < counterClockwiseNames.Length; index++)
        {
            Transform gear = root.transform.Find(counterClockwiseNames[index]);
            string gearLabel = counterClockwiseNames[index];
            Vector3 pivot = gearLabel == "二级行星齿轮001"
                ? gear.GetComponent<MeshFilter>().sharedMesh.bounds.center
                : Vector3.zero;
            float speed = index < 3 ? -42f : 42f;
            Vector3 axis = index < 3 ? Vector3.forward : Vector3.up;
            counterClockwise[index] = CreateTarget(
                gearLabel + " · 逆时针", gear, axis, speed, pivot);
        }
        controller.Configure(blade, counterClockwise, Array.Empty<WindTurbineRotationController.RotationTarget>());
        SerializedObject serializedController = new SerializedObject(controller);
        serializedController.Update();
        serializedController.FindProperty("_playOnEnable").boolValue = true;
        serializedController.FindProperty("_useUnscaledTime").boolValue = false;
        serializedController.ApplyModifiedPropertiesWithoutUndo();
        EditorUtility.SetDirty(controller);
    }

    private static WindTurbineRotationController.RotationTarget CreateTarget(
        string label,
        Transform target,
        Vector3 axis,
        float speed,
        Vector3 localPivot = default(Vector3))
    {
        return new WindTurbineRotationController.RotationTarget
        {
            label = label,
            target = target,
            localAxis = axis,
            speedDegreesPerSecond = speed,
            localPivot = localPivot
        };
    }

    private static void EnsureDirectory()
    {
        if (!AssetDatabase.IsValidFolder("Assets/Art/Generated"))
        {
            AssetDatabase.CreateFolder("Assets/Art", "Generated");
        }

        if (!AssetDatabase.IsValidFolder(WireframeDirectory))
        {
            AssetDatabase.CreateFolder("Assets/Art/Generated", "WindTurbineWireframe");
        }
    }

    private static string SanitizeFileName(string fileName)
    {
        char[] invalidCharacters = System.IO.Path.GetInvalidFileNameChars();
        string sanitized = fileName;
        for (int index = 0; index < invalidCharacters.Length; index++)
        {
            sanitized = sanitized.Replace(invalidCharacters[index], '_');
        }

        return sanitized;
    }
}

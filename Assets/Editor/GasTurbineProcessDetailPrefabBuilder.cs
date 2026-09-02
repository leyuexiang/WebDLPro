using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 生成燃气轮机第三层包装预制体、正式目录资产并装配燃气业务场景。
/// 制作期允许扫描源模型生成稳定渲染器数组；运行时只读取序列化结果，不执行名称或层级搜索。
/// </summary>
public static class GasTurbineProcessDetailPrefabBuilder
{
    public const string SourcePrefabPath = "Assets/Art/C4D项目/WaiKeHeBing_AnimationDemo.prefab";
    public const string OutputFolderPath = "Assets/ProcessDetails/GasPower/GasTurbine";
    public const string OutputPrefabPath = OutputFolderPath + "/GasTurbineProcessDetail.prefab";
    public const string CatalogAssetPath = "Assets/Configuration/ProcessDetailCatalog.asset";
    public const string GasPowerScenePath = "Assets/Scenes/Business/GasPower.unity";
    private const string VisualStateConfigPath = "Assets/Configuration/PowerPlantVisualStateConfig.asset";
    // 第三层展示区固定在厂区坐标之外；相机位保留演示场景已验证的模型相对观察偏移。
    private static readonly Vector3 RemoteDisplayPosition = new Vector3(10000f, 0f, 0f);
    private static readonly Vector3 CameraOffsetFromDisplay = new Vector3(-10.86195f, 2.483585f, -1.561808f);

    [MenuItem("Tools/WebDLPro/关键环节/生成燃气轮机第三层资源")]
    public static void CreateOrUpdate()
    {
        EnsureFolder(OutputFolderPath);
        GameObject sourcePrefab = AssetDatabase.LoadAssetAtPath<GameObject>(SourcePrefabPath);
        PowerPlantVisualStateConfig visualConfig = AssetDatabase.LoadAssetAtPath<PowerPlantVisualStateConfig>(VisualStateConfigPath);
        if (sourcePrefab == null || visualConfig == null)
        {
            throw new InvalidOperationException("缺少燃气轮机源预制体或设备四态视觉配置。" );
        }

        GameObject wrapperPrefab = CreateWrapperPrefab(sourcePrefab, visualConfig);
        ProcessDetailCatalog catalog = CreateOrUpdateCatalog(wrapperPrefab);
        ConfigureGasPowerScene(catalog);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log($"[ProcessDetailBuilder] 已生成燃气轮机第三层资源：{OutputPrefabPath}");
    }

    private static GameObject CreateWrapperPrefab(
        GameObject sourcePrefab,
        PowerPlantVisualStateConfig visualConfig)
    {
        GameObject host = new GameObject("GasTurbineProcessDetail");
        host.SetActive(false);
        try
        {
            Transform displayAnchor = new GameObject("DisplayAnchor").transform;
            displayAnchor.SetParent(host.transform, false);
            displayAnchor.localPosition = RemoteDisplayPosition;
            displayAnchor.localRotation = Quaternion.identity;

            GameObject modelInstance = PrefabUtility.InstantiatePrefab(sourcePrefab, displayAnchor) as GameObject;
            if (modelInstance == null)
            {
                throw new InvalidOperationException("无法创建燃气轮机源预制体的嵌套实例。" );
            }
            modelInstance.transform.localPosition = Vector3.zero;
            modelInstance.transform.localRotation = Quaternion.identity;
            modelInstance.transform.localScale = Vector3.one;

            Transform cameraPose = new GameObject("CameraPose").transform;
            cameraPose.SetParent(host.transform, false);
            // 采用已验证的模型相对观察偏移，并整体平移到显式远端展示区；不使用运行时包围盒计算。
            cameraPose.localPosition = RemoteDisplayPosition + CameraOffsetFromDisplay;
            cameraPose.localRotation = Quaternion.Euler(8.457968f, 86.63072f, -0.0002123377f);

            WaiKeHeBingAnimationController animationController =
                modelInstance.GetComponent<WaiKeHeBingAnimationController>();
            WaiKeHeBingGasFlowEffectController gasFlowController =
                modelInstance.GetComponent<WaiKeHeBingGasFlowEffectController>();
            WaiKeHeBingGasVolumeController gasVolumeController =
                modelInstance.GetComponent<WaiKeHeBingGasVolumeController>();
            if (animationController == null || gasFlowController == null || gasVolumeController == null)
            {
                throw new InvalidOperationException("燃气轮机源预制体缺少三个已确认动态控制器。" );
            }

            GasTurbineProcessDetailDynamicAdapter dynamicAdapter =
                host.AddComponent<GasTurbineProcessDetailDynamicAdapter>();
            dynamicAdapter.ConfigureForEditor(animationController, gasFlowController, gasVolumeController);

            ProcessDetailStateVisualAdapter visualAdapter =
                host.AddComponent<ProcessDetailStateVisualAdapter>();
            Renderer[] visualRenderers = CollectStateVisualRenderers(
                modelInstance,
                animationController,
                gasVolumeController);
            if (visualRenderers.Length == 0)
            {
                throw new InvalidOperationException("燃气轮机包装未收集到可用于四态视觉的设备渲染器。" );
            }
            visualAdapter.ConfigureForEditor(
                visualRenderers,
                visualConfig.AlarmColor,
                visualConfig.FaultColor,
                visualConfig.OfflineColor,
                0.72f);

            ProcessDetailOwnedResourceMarker marker =
                host.AddComponent<ProcessDetailOwnedResourceMarker>();
            marker.ConfigureForEditor("process-detail-resource.gas-power.gas-turbine");

            ProcessDetailDeviceBinding binding = host.AddComponent<ProcessDetailDeviceBinding>();
            binding.ConfigureForEditor(
                "process-detail.gas-power.gas-turbine",
                "process-detail-resource.gas-power.gas-turbine",
                "camera-pose.gas-power.gas-turbine",
                new[] { "gas-turbine" },
                new[] { "gas-turbine" },
                displayAnchor,
                cameraPose,
                new MonoBehaviour[] { dynamicAdapter },
                new MonoBehaviour[] { visualAdapter },
                marker);

            GameObject prefab = PrefabUtility.SaveAsPrefabAsset(host, OutputPrefabPath);
            if (prefab == null)
            {
                throw new InvalidOperationException("燃气轮机第三层包装预制体保存失败。" );
            }
            return prefab;
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    /// <summary>
    /// 编辑器只扫描一次源实例：排除全部粒子渲染器、蓝红体积渲染器和右侧透明外壳，
    /// 其余支持基础色属性的网格渲染器按层级顺序固化到包装预制体。
    /// </summary>
    private static Renderer[] CollectStateVisualRenderers(
        GameObject modelInstance,
        WaiKeHeBingAnimationController animationController,
        WaiKeHeBingGasVolumeController gasVolumeController)
    {
        HashSet<Renderer> excluded = new HashSet<Renderer>();
        AddSerializedRendererArray(animationController, "_rightShellRenderers", excluded);
        AddSerializedRenderer(gasVolumeController, "_blueVolumeRenderer", excluded);
        AddSerializedRenderer(gasVolumeController, "_redVolumeRenderer", excluded);

        int baseColorId = Shader.PropertyToID("_BaseColor");
        int alternateBaseColorId = Shader.PropertyToID("_BASE_COLOR");
        Renderer[] allRenderers = modelInstance.GetComponentsInChildren<Renderer>(true);
        List<Renderer> result = new List<Renderer>(allRenderers.Length);
        for (int rendererIndex = 0; rendererIndex < allRenderers.Length; rendererIndex++)
        {
            Renderer renderer = allRenderers[rendererIndex];
            if (!(renderer is MeshRenderer) || excluded.Contains(renderer))
            {
                continue;
            }

            Material[] materials = renderer.sharedMaterials;
            bool allSlotsSupported = materials != null && materials.Length > 0;
            for (int materialIndex = 0; allSlotsSupported && materialIndex < materials.Length; materialIndex++)
            {
                Material material = materials[materialIndex];
                allSlotsSupported = material != null &&
                    (material.HasProperty(baseColorId) || material.HasProperty(alternateBaseColorId));
            }
            if (allSlotsSupported)
            {
                result.Add(renderer);
            }
        }

        return result.ToArray();
    }

    private static void AddSerializedRendererArray(
        UnityEngine.Object target,
        string propertyName,
        ISet<Renderer> destination)
    {
        SerializedProperty property = new SerializedObject(target).FindProperty(propertyName);
        if (property == null || !property.isArray)
        {
            return;
        }
        for (int index = 0; index < property.arraySize; index++)
        {
            Renderer renderer = property.GetArrayElementAtIndex(index).objectReferenceValue as Renderer;
            if (renderer != null)
            {
                destination.Add(renderer);
            }
        }
    }

    private static void AddSerializedRenderer(
        UnityEngine.Object target,
        string propertyName,
        ISet<Renderer> destination)
    {
        Renderer renderer = new SerializedObject(target).FindProperty(propertyName)?.objectReferenceValue as Renderer;
        if (renderer != null)
        {
            destination.Add(renderer);
        }
    }

    private static ProcessDetailCatalog CreateOrUpdateCatalog(GameObject wrapperPrefab)
    {
        ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogAssetPath);
        if (catalog == null)
        {
            catalog = ScriptableObject.CreateInstance<ProcessDetailCatalog>();
            AssetDatabase.CreateAsset(catalog, CatalogAssetPath);
        }

        ProcessDetailCatalogEntry entry = new ProcessDetailCatalogEntry(
            "gas-power",
            "gas-power-generation",
            "gas-turbine",
            "process-detail.gas-power.gas-turbine",
            "process-detail-resource.gas-power.gas-turbine",
            "camera-pose.gas-power.gas-turbine",
            "gas-turbine",
            BusinessSceneAvailability.Available);
        entry.SetEditorPrefabForEditor(wrapperPrefab);
        List<ProcessDetailCatalogEntry> entries = new List<ProcessDetailCatalogEntry>(catalog.Entries.Count + 1);
        bool replaced = false;
        for (int index = 0; index < catalog.Entries.Count; index++)
        {
            ProcessDetailCatalogEntry existing = catalog.Entries[index];
            if (string.Equals(existing?.ProcessDetailId, entry.ProcessDetailId, StringComparison.Ordinal))
            {
                entries.Add(entry);
                replaced = true;
            }
            else
            {
                entries.Add(existing);
            }
        }
        if (!replaced)
        {
            entries.Add(entry);
        }
        catalog.SetEntriesForEditor(entries);
        EditorUtility.SetDirty(catalog);
        return catalog;
    }

    private static void ConfigureGasPowerScene(ProcessDetailCatalog catalog)
    {
        Scene existingScene = SceneManager.GetSceneByPath(GasPowerScenePath);
        bool wasLoaded = existingScene.IsValid() && existingScene.isLoaded;
        Scene scene = wasLoaded
            ? existingScene
            : EditorSceneManager.OpenScene(GasPowerScenePath, OpenSceneMode.Additive);
        try
        {
            GameObject runtimeRoot = FindRoot(scene, "PowerPlantRuntime");
            GameObject businessRoot = FindRoot(scene, "场景");
            GameObject cameraObject = FindRoot(scene, "Main Camera");
            PowerPlantProcessController processController =
                runtimeRoot.GetComponent<PowerPlantProcessController>();
            PowerPlantFreeCameraController cameraController =
                cameraObject.GetComponent<PowerPlantFreeCameraController>();
            if (processController == null || cameraController == null)
            {
                throw new InvalidOperationException("燃气场景缺少流程控制器或自由相机控制器。" );
            }

            ProcessDetailAssetBundleLoader loader =
                runtimeRoot.GetComponent<ProcessDetailAssetBundleLoader>() ??
                runtimeRoot.AddComponent<ProcessDetailAssetBundleLoader>();
            ProcessDetailCoordinator coordinator =
                runtimeRoot.GetComponent<ProcessDetailCoordinator>() ??
                runtimeRoot.AddComponent<ProcessDetailCoordinator>();

            Transform mount = runtimeRoot.transform.Find("ProcessDetailMount");
            if (mount == null)
            {
                mount = new GameObject("ProcessDetailMount").transform;
                mount.SetParent(runtimeRoot.transform, false);
            }
            mount.localPosition = Vector3.zero;
            mount.localRotation = Quaternion.identity;
            mount.localScale = Vector3.one;

            coordinator.ConfigureForEditor(
                "gas-power",
                catalog,
                loader,
                mount,
                businessRoot.transform,
                processController,
                cameraController);
            EditorUtility.SetDirty(loader);
            EditorUtility.SetDirty(coordinator);
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
        }
        finally
        {
            if (!wasLoaded && scene.IsValid() && scene.isLoaded)
            {
                EditorSceneManager.CloseScene(scene, true);
            }
        }
    }

    private static GameObject FindRoot(Scene scene, string rootName)
    {
        GameObject[] roots = scene.GetRootGameObjects();
        for (int index = 0; index < roots.Length; index++)
        {
            if (string.Equals(roots[index].name, rootName, StringComparison.Ordinal))
            {
                return roots[index];
            }
        }
        throw new InvalidOperationException($"燃气场景缺少根对象：{rootName}。" );
    }

    private static void EnsureFolder(string assetPath)
    {
        string[] segments = assetPath.Split('/');
        string current = segments[0];
        for (int index = 1; index < segments.Length; index++)
        {
            string next = $"{current}/{segments[index]}";
            if (!AssetDatabase.IsValidFolder(next))
            {
                AssetDatabase.CreateFolder(current, segments[index]);
            }
            current = next;
        }
    }
}

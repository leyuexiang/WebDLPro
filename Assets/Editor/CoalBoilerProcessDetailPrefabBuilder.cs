using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 生成燃煤锅炉燃烧第三层占位包装预制体、增量登记关键环节目录，并装配燃煤业务场景。
/// 当前版本只接入模型加载、远端展示、专用相机位和设备状态视觉；动态目标数组保持为空，
/// 不接入播放/停止控制。后续模型调整后可重复执行生成命令，稳定标识和场景挂载关系不会改变。
/// </summary>
public static class CoalBoilerProcessDetailPrefabBuilder
{
    public const string SourcePrefabPath = "Assets/Art/C4D项目/燃煤燃烧系统.prefab";
    public const string OutputFolderPath = "Assets/ProcessDetails/CoalPower/Boiler";
    public const string OutputPrefabPath = OutputFolderPath + "/CoalBoilerProcessDetail.prefab";
    public const string CatalogAssetPath = "Assets/Configuration/ProcessDetailCatalog.asset";
    public const string CoalPowerScenePath = "Assets/Scenes/Business/CoalPower.unity";

    private const string VisualStateConfigPath = "Assets/Configuration/PowerPlantVisualStateConfig.asset";
    private const string ProcessDetailId = "process-detail.coal-power.boiler";
    private const string ResourceId = "process-detail-resource.coal-power.boiler";
    private const string CameraPoseId = "camera-pose.coal-power.boiler";
    private const string StateNodeId = "node.coal-boiler";

    // 第三层展示区与二层厂区保持显式空间隔离，满足协调器至少 1000 米的远端距离校验。
    private static readonly Vector3 RemoteDisplayPosition = new Vector3(10000f, 0f, 0f);

    [MenuItem("Tools/WebDLPro/关键环节/生成燃煤锅炉燃烧第三层占位资源")]
    public static void CreateOrUpdate()
    {
        EnsureFolder(OutputFolderPath);
        GameObject sourcePrefab = AssetDatabase.LoadAssetAtPath<GameObject>(SourcePrefabPath);
        PowerPlantVisualStateConfig visualConfig =
            AssetDatabase.LoadAssetAtPath<PowerPlantVisualStateConfig>(VisualStateConfigPath);
        if (sourcePrefab == null || visualConfig == null)
        {
            throw new InvalidOperationException("缺少燃煤燃烧系统源预制体或设备四态视觉配置。");
        }

        GameObject wrapperPrefab = CreateWrapperPrefab(sourcePrefab, visualConfig);
        ProcessDetailCatalog catalog = CreateOrUpdateCatalog(wrapperPrefab);
        ConfigureCoalPowerScene(catalog);

        IReadOnlyList<BusinessSceneCatalogValidationIssue> issues = catalog.ValidateForRuntime();
        if (issues.Count > 0)
        {
            throw new InvalidOperationException($"燃煤关键环节目录校验失败：{issues[0].Code}。");
        }

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log($"[ProcessDetailBuilder] 已生成燃煤锅炉燃烧第三层占位资源：{OutputPrefabPath}");
    }

    /// <summary>
    /// 创建与燃气轮机一致的第三层包装结构。源模型作为嵌套预制体保留，后续替换或调整源模型后
    /// 可重新生成包装资源；包装根默认禁用，由关键环节加载事务在提交阶段统一激活。
    /// </summary>
    private static GameObject CreateWrapperPrefab(
        GameObject sourcePrefab,
        PowerPlantVisualStateConfig visualConfig)
    {
        GameObject host = new GameObject("CoalBoilerProcessDetail");
        host.SetActive(false);
        try
        {
            Transform displayAnchor = new GameObject("DisplayAnchor").transform;
            displayAnchor.SetParent(host.transform, false);
            displayAnchor.localPosition = RemoteDisplayPosition;
            displayAnchor.localRotation = Quaternion.identity;
            displayAnchor.localScale = Vector3.one;

            GameObject modelInstance = PrefabUtility.InstantiatePrefab(sourcePrefab, displayAnchor) as GameObject;
            if (modelInstance == null)
            {
                throw new InvalidOperationException("无法创建燃煤燃烧系统源预制体的嵌套实例。");
            }
            modelInstance.transform.localPosition = Vector3.zero;
            modelInstance.transform.localRotation = Quaternion.identity;
            modelInstance.transform.localScale = Vector3.one;

            // 当前只做静态占位，不让源模型在启用时自行循环播放；后续接入独立动态适配器时再移除此覆盖。
            DisableAutomaticPlayback(modelInstance);

            Bounds modelBounds = CalculateModelBounds(modelInstance);
            Transform cameraPose = CreateCameraPose(host.transform, modelBounds);

            Renderer[] visualRenderers = CollectStateVisualRenderers(modelInstance);
            if (visualRenderers.Length == 0)
            {
                throw new InvalidOperationException("燃煤锅炉包装未收集到可用于四态视觉的设备渲染器。");
            }

            ProcessDetailStateVisualAdapter visualAdapter =
                host.AddComponent<ProcessDetailStateVisualAdapter>();
            visualAdapter.ConfigureForEditor(
                visualRenderers,
                visualConfig.AlarmColor,
                visualConfig.FaultColor,
                visualConfig.OfflineColor,
                0.72f);

            ProcessDetailOwnedResourceMarker marker =
                host.AddComponent<ProcessDetailOwnedResourceMarker>();
            marker.ConfigureForEditor(ResourceId);

            ProcessDetailDeviceBinding binding = host.AddComponent<ProcessDetailDeviceBinding>();
            binding.ConfigureForEditor(
                ProcessDetailId,
                ResourceId,
                CameraPoseId,
                new[] { StateNodeId },
                Array.Empty<string>(),
                displayAnchor,
                cameraPose,
                Array.Empty<MonoBehaviour>(),
                new MonoBehaviour[] { visualAdapter },
                marker);

            GameObject prefab = PrefabUtility.SaveAsPrefabAsset(host, OutputPrefabPath);
            if (prefab == null)
            {
                throw new InvalidOperationException("燃煤锅炉第三层占位包装预制体保存失败。");
            }
            return prefab;
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    /// <summary>
    /// 仅在包装实例上关闭自动演示，不修改美术源预制体。这样第三层占位激活后保持静态，
    /// 页面播放/停止命令也不会误绑定到尚未冻结的模型动画结构。
    /// </summary>
    private static void DisableAutomaticPlayback(GameObject modelInstance)
    {
        ControlValveEffectController[] controllers =
            modelInstance.GetComponentsInChildren<ControlValveEffectController>(true);
        for (int index = 0; index < controllers.Length; index++)
        {
            SerializedObject serializedController = new SerializedObject(controllers[index]);
            SerializedProperty playOnEnable = serializedController.FindProperty("_playOnEnable");
            SerializedProperty loopDemo = serializedController.FindProperty("_loopDemo");
            if (playOnEnable != null)
            {
                playOnEnable.boolValue = false;
            }
            if (loopDemo != null)
            {
                loopDemo.boolValue = false;
            }
            serializedController.ApplyModifiedPropertiesWithoutUndo();
        }
    }

    /// <summary>
    /// 制作期一次性计算模型包围盒并写入专用相机位。运行时不扫描渲染器，也不依赖模型名称推断镜头。
    /// 镜头沿模型较短的 Z 轴观察，使横向较长的整套燃烧系统能完整进入宽屏画面。
    /// </summary>
    private static Transform CreateCameraPose(Transform host, Bounds modelBounds)
    {
        Transform cameraPose = new GameObject("CameraPose").transform;
        cameraPose.SetParent(host, false);

        Vector3 target = RemoteDisplayPosition + modelBounds.center;
        float horizontalHalfExtent = Mathf.Max(modelBounds.extents.x, 1f);
        float depth = Mathf.Max(modelBounds.extents.z, 1f);
        float distance = Mathf.Max(42f, horizontalHalfExtent * 1.8f + depth);
        Vector3 position = target + new Vector3(0f, Mathf.Max(8f, modelBounds.extents.y * 1.4f), -distance);
        cameraPose.localPosition = position;
        cameraPose.localRotation = Quaternion.LookRotation(target - position, Vector3.up);
        cameraPose.localScale = Vector3.one;
        return cameraPose;
    }

    private static Bounds CalculateModelBounds(GameObject modelInstance)
    {
        Renderer[] renderers = modelInstance.GetComponentsInChildren<Renderer>(true);
        bool hasBounds = false;
        Bounds bounds = default;
        for (int index = 0; index < renderers.Length; index++)
        {
            if (renderers[index] is ParticleSystemRenderer)
            {
                continue;
            }

            if (!hasBounds)
            {
                bounds = renderers[index].bounds;
                hasBounds = true;
            }
            else
            {
                bounds.Encapsulate(renderers[index].bounds);
            }
        }

        if (!hasBounds)
        {
            throw new InvalidOperationException("燃煤燃烧系统源预制体没有可计算展示范围的渲染器。");
        }

        // 渲染器包围盒是世界坐标；转换到展示锚点本地空间，避免远端展示偏移被相机位重复叠加。
        Transform displayAnchor = modelInstance.transform.parent;
        Vector3 localCenter = displayAnchor.InverseTransformPoint(bounds.center);
        Vector3 localSize = displayAnchor.InverseTransformVector(bounds.size);
        return new Bounds(
            localCenter,
            new Vector3(Mathf.Abs(localSize.x), Mathf.Abs(localSize.y), Mathf.Abs(localSize.z)));
    }

    /// <summary>
    /// 编辑器只扫描一次源实例并固化渲染器数组。排除粒子、控制阀透明外壳和气体体积，
    /// 同时跳过不支持基础色属性的材质，避免状态投影破坏特效材质或在运行时触发无效查询。
    /// </summary>
    private static Renderer[] CollectStateVisualRenderers(GameObject modelInstance)
    {
        HashSet<Renderer> excluded = new HashSet<Renderer>();
        ControlValveEffectController[] controllers =
            modelInstance.GetComponentsInChildren<ControlValveEffectController>(true);
        for (int index = 0; index < controllers.Length; index++)
        {
            SerializedObject serializedController = new SerializedObject(controllers[index]);
            AddSerializedRenderer(serializedController, "_shellRenderer", excluded);
            AddSerializedRenderer(serializedController, "_gasVolumeRenderer", excluded);
        }

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

    private static void AddSerializedRenderer(
        SerializedObject serializedController,
        string propertyName,
        ISet<Renderer> destination)
    {
        Renderer renderer = serializedController.FindProperty(propertyName)?.objectReferenceValue as Renderer;
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
            "coal-power",
            "coal-power-generation",
            "boiler",
            ProcessDetailId,
            ResourceId,
            CameraPoseId,
            new[] { StateNodeId },
            Array.Empty<string>(),
            BusinessSceneAvailability.Available);
        entry.SetEditorPrefabForEditor(wrapperPrefab);

        List<ProcessDetailCatalogEntry> entries =
            new List<ProcessDetailCatalogEntry>(catalog.Entries.Count + 1);
        bool replaced = false;
        for (int index = 0; index < catalog.Entries.Count; index++)
        {
            ProcessDetailCatalogEntry existing = catalog.Entries[index];
            if (string.Equals(existing?.ProcessDetailId, ProcessDetailId, StringComparison.Ordinal))
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

    /// <summary>
    /// 为燃煤场景装配与燃气场景相同的通用加载器、协调器和挂载点。
    /// 只新增第三层运行时外壳，不改动现有二层设备、厂房结构和旧流程绑定。
    /// </summary>
    private static void ConfigureCoalPowerScene(ProcessDetailCatalog catalog)
    {
        Scene existingScene = SceneManager.GetSceneByPath(CoalPowerScenePath);
        bool wasLoaded = existingScene.IsValid() && existingScene.isLoaded;
        Scene scene = wasLoaded
            ? existingScene
            : EditorSceneManager.OpenScene(CoalPowerScenePath, OpenSceneMode.Additive);
        try
        {
            GameObject runtimeRoot = FindRoot(scene, "PowerPlantRuntime");
            GameObject businessRoot = FindRootIgnoringOuterWhitespace(scene, "SceneRoot");
            GameObject cameraObject = FindRoot(scene, "Main Camera");
            PowerPlantProcessController processController =
                runtimeRoot.GetComponent<PowerPlantProcessController>();
            PowerPlantFreeCameraController cameraController =
                cameraObject.GetComponent<PowerPlantFreeCameraController>();
            if (processController == null || cameraController == null)
            {
                throw new InvalidOperationException("燃煤场景缺少流程控制器或自由相机控制器。");
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
                "coal-power",
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
        throw new InvalidOperationException($"燃煤场景缺少根对象：{rootName}。");
    }

    private static GameObject FindRootIgnoringOuterWhitespace(Scene scene, string rootName)
    {
        GameObject[] roots = scene.GetRootGameObjects();
        for (int index = 0; index < roots.Length; index++)
        {
            if (string.Equals(roots[index].name.Trim(), rootName, StringComparison.Ordinal))
            {
                return roots[index];
            }
        }
        throw new InvalidOperationException($"燃煤场景缺少根对象：{rootName}。");
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

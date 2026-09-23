using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 为升压站、降压站和换流站生成三项保护关键环节，为开关站生成母线保护与线路保护两项第三层包装 Prefab，
/// 增量登记 ProcessDetailCatalog，并为四个业务场景装配通用关键环节协调器。
/// 源 FBX 作为嵌套模型实例保留；模型没有已核验动态效果时只接入统一静态动态协议。
/// </summary>
public static class SubstationProtectionProcessDetailPrefabBuilder
{
    private const string CatalogAssetPath = "Assets/Configuration/ProcessDetailCatalog.asset";
    private const string VisualStateConfigPath = "Assets/Configuration/PowerPlantVisualStateConfig.asset";
    private const string OutputRootPath = "Assets/ProcessDetails/Substations";
    private const float RemoteDisplayX = 10000f;

    private sealed class ProtectionDetailSpec
    {
        public readonly string SceneId;
        public readonly string ScenePath;
        public readonly string SceneFolderName;
        public readonly string ProcessId;
        public readonly string StepId;
        public readonly string StateNodeId;
        public readonly string SourceModelPath;
        public readonly string OutputPrefabPath;
        public readonly string ProcessDetailId;
        public readonly string ResourceId;
        public readonly string CameraPoseId;

        public ProtectionDetailSpec(
            string sceneId,
            string scenePath,
            string sceneFolderName,
            string stepId,
            string stateNodeId,
            string sourceModelPath,
            string prefabName)
        {
            SceneId = sceneId;
            ScenePath = scenePath;
            SceneFolderName = sceneFolderName;
            ProcessId = sceneId + "-operation";
            StepId = stepId;
            StateNodeId = stateNodeId;
            SourceModelPath = sourceModelPath;
            OutputPrefabPath = $"{OutputRootPath}/{sceneFolderName}/Protection/{prefabName}.prefab";
            ProcessDetailId = $"process-detail.{sceneId}.{stepId}";
            ResourceId = $"process-detail-resource.{sceneId}.{stepId}";
            CameraPoseId = $"camera-pose.{sceneId}.{stepId}";
        }
    }

    private sealed class GeneratedProtectionDetail
    {
        public readonly ProtectionDetailSpec Spec;
        public readonly GameObject Prefab;

        public GeneratedProtectionDetail(ProtectionDetailSpec spec, GameObject prefab)
        {
            Spec = spec;
            Prefab = prefab;
        }
    }

    private static readonly ProtectionDetailSpec[] Specs = CreateSpecs();

    [MenuItem("Tools/WebDLPro/关键环节/生成变电站三项保护第三层资源")]
    public static void CreateOrUpdate()
    {
        EnsureFolder(OutputRootPath);
        PowerPlantVisualStateConfig visualConfig =
            AssetDatabase.LoadAssetAtPath<PowerPlantVisualStateConfig>(VisualStateConfigPath);
        ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogAssetPath);
        if (visualConfig == null || catalog == null)
        {
            throw new InvalidOperationException("缺少设备四态视觉配置或正式关键环节目录资产。");
        }

        List<GeneratedProtectionDetail> generated = new List<GeneratedProtectionDetail>(Specs.Length);
        for (int index = 0; index < Specs.Length; index++)
        {
            ProtectionDetailSpec spec = Specs[index];
            EnsureFolder($"{OutputRootPath}/{spec.SceneFolderName}/Protection");
            GameObject prefab = CreateWrapperPrefab(spec, visualConfig);
            generated.Add(new GeneratedProtectionDetail(spec, prefab));
        }

        UpdateCatalog(catalog, generated);
        ConfigureScenes(catalog);

        IReadOnlyList<BusinessSceneCatalogValidationIssue> issues = catalog.ValidateForRuntime();
        if (issues.Count > 0)
        {
            throw new InvalidOperationException($"变电站保护关键环节目录校验失败：{issues[0].Code}，{issues[0].Message}");
        }

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        Selection.activeObject = generated[generated.Count - 1].Prefab;
        Debug.Log($"[ProcessDetailBuilder] 已生成 {generated.Count} 个变电站保护关键环节包装 Prefab。");
    }

    private static GameObject CreateWrapperPrefab(
        ProtectionDetailSpec spec,
        PowerPlantVisualStateConfig visualConfig)
    {
        GameObject sourceModel = AssetDatabase.LoadAssetAtPath<GameObject>(spec.SourceModelPath);
        if (sourceModel == null)
        {
            throw new InvalidOperationException($"缺少保护关键环节源模型：{spec.SourceModelPath}");
        }

        GameObject existingPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(spec.OutputPrefabPath);
        bool hasExistingCameraPose = existingPrefab != null && existingPrefab.transform.Find("CameraPose") != null;
        GameObject host = new GameObject(GetWrapperName(spec));
        host.SetActive(false);
        try
        {
            Transform displayAnchor = new GameObject("DisplayAnchor").transform;
            displayAnchor.SetParent(host.transform, false);
            displayAnchor.localPosition = new Vector3(RemoteDisplayX, 0f, 0f);
            displayAnchor.localRotation = Quaternion.identity;
            displayAnchor.localScale = Vector3.one;

            GameObject modelInstance = PrefabUtility.InstantiatePrefab(sourceModel, displayAnchor) as GameObject;
            if (modelInstance == null)
            {
                throw new InvalidOperationException($"无法创建保护关键环节源模型的嵌套实例：{spec.SourceModelPath}");
            }
            modelInstance.transform.localPosition = Vector3.zero;
            modelInstance.transform.localRotation = Quaternion.identity;
            modelInstance.transform.localScale = Vector3.one;
            modelInstance.SetActive(true);

            Renderer[] visualRenderers = CollectStateVisualRenderers(modelInstance);
            if (visualRenderers.Length == 0)
            {
                throw new InvalidOperationException($"保护关键环节包装未收集到 MeshRenderer：{spec.SourceModelPath}");
            }

            Transform cameraPose = ProcessDetailCameraPosePreservation.CreateCameraPose(
                host.transform,
                spec.OutputPrefabPath,
                displayAnchor);
            if (!hasExistingCameraPose)
            {
                ConfigureInitialCameraPose(cameraPose, displayAnchor, visualRenderers);
            }

            SubstationProtectionProcessDetailDynamicAdapter dynamicAdapter =
                host.AddComponent<SubstationProtectionProcessDetailDynamicAdapter>();

            ProcessDetailStateVisualAdapter visualAdapter =
                host.AddComponent<ProcessDetailStateVisualAdapter>();
            visualAdapter.ConfigureForEditor(
                true,
                true,
                visualRenderers,
                visualConfig.AlarmColor,
                visualConfig.FaultColor,
                visualConfig.OfflineColor,
                0.72f);

            ProcessDetailOwnedResourceMarker marker = host.AddComponent<ProcessDetailOwnedResourceMarker>();
            marker.ConfigureForEditor(spec.ResourceId);

            ProcessDetailDeviceBinding binding = host.AddComponent<ProcessDetailDeviceBinding>();
            binding.ConfigureForEditor(
                spec.ProcessDetailId,
                spec.ResourceId,
                spec.CameraPoseId,
                new[] { spec.StateNodeId },
                new[] { spec.StateNodeId },
                displayAnchor,
                cameraPose,
                new MonoBehaviour[] { dynamicAdapter },
                new MonoBehaviour[] { visualAdapter },
                marker);

            GameObject prefab = PrefabUtility.SaveAsPrefabAsset(host, spec.OutputPrefabPath);
            if (prefab == null)
            {
                throw new InvalidOperationException($"保护关键环节包装 Prefab 保存失败：{spec.OutputPrefabPath}");
            }
            return prefab;
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    private static Renderer[] CollectStateVisualRenderers(GameObject modelInstance)
    {
        Renderer[] allRenderers = modelInstance.GetComponentsInChildren<Renderer>(true);
        List<Renderer> result = new List<Renderer>(allRenderers.Length);
        int baseColorId = Shader.PropertyToID("_BaseColor");
        int alternateBaseColorId = Shader.PropertyToID("_BASE_COLOR");
        for (int index = 0; index < allRenderers.Length; index++)
        {
            Renderer renderer = allRenderers[index];
            if (!(renderer is MeshRenderer))
            {
                continue;
            }

            Material[] materials = renderer.sharedMaterials;
            bool supported = materials != null && materials.Length > 0;
            for (int materialIndex = 0; supported && materialIndex < materials.Length; materialIndex++)
            {
                Material material = materials[materialIndex];
                supported = material != null &&
                    (material.HasProperty(baseColorId) || material.HasProperty(alternateBaseColorId));
            }
            if (supported)
            {
                result.Add(renderer);
            }
        }
        return result.ToArray();
    }

    private static void ConfigureInitialCameraPose(
        Transform cameraPose,
        Transform displayAnchor,
        Renderer[] renderers)
    {
        Bounds bounds = default;
        bool hasBounds = false;
        for (int index = 0; index < renderers.Length; index++)
        {
            Renderer renderer = renderers[index];
            if (!hasBounds)
            {
                bounds = renderer.bounds;
                hasBounds = true;
            }
            else
            {
                bounds.Encapsulate(renderer.bounds);
            }
        }

        if (!hasBounds)
        {
            cameraPose.localPosition = displayAnchor.localPosition + new Vector3(0f, 50f, 100f);
            cameraPose.localRotation = Quaternion.Euler(20f, 180f, 0f);
            return;
        }

        float radius = Mathf.Max(bounds.size.x, Mathf.Max(bounds.size.y, bounds.size.z));
        Vector3 target = bounds.center;
        Vector3 offset = new Vector3(radius * 0.65f, radius * 0.45f, radius * 1.2f);
        Vector3 position = target + offset;
        cameraPose.localPosition = position;
        cameraPose.localRotation = Quaternion.LookRotation(target - position, Vector3.up);
        cameraPose.localScale = Vector3.one;
    }

    private static void UpdateCatalog(
        ProcessDetailCatalog catalog,
        IReadOnlyList<GeneratedProtectionDetail> generated)
    {
        Dictionary<string, GeneratedProtectionDetail> generatedById =
            new Dictionary<string, GeneratedProtectionDetail>(StringComparer.Ordinal);
        for (int index = 0; index < generated.Count; index++)
        {
            generatedById.Add(generated[index].Spec.ProcessDetailId, generated[index]);
        }

        List<ProcessDetailCatalogEntry> entries =
            new List<ProcessDetailCatalogEntry>(catalog.Entries.Count + generated.Count);
        HashSet<string> replacedIds = new HashSet<string>(StringComparer.Ordinal);
        for (int index = 0; index < catalog.Entries.Count; index++)
        {
            ProcessDetailCatalogEntry existing = catalog.Entries[index];
            if (existing != null && generatedById.TryGetValue(existing.ProcessDetailId, out GeneratedProtectionDetail replacement))
            {
                entries.Add(CreateCatalogEntry(replacement.Spec, replacement.Prefab));
                replacedIds.Add(existing.ProcessDetailId);
            }
            else
            {
                entries.Add(existing);
            }
        }

        for (int index = 0; index < generated.Count; index++)
        {
            GeneratedProtectionDetail item = generated[index];
            if (!replacedIds.Contains(item.Spec.ProcessDetailId))
            {
                entries.Add(CreateCatalogEntry(item.Spec, item.Prefab));
            }
        }

        catalog.SetEntriesForEditor(entries);
        EditorUtility.SetDirty(catalog);
    }

    private static ProcessDetailCatalogEntry CreateCatalogEntry(
        ProtectionDetailSpec spec,
        GameObject prefab)
    {
        ProcessDetailCatalogEntry entry = new ProcessDetailCatalogEntry(
            spec.SceneId,
            spec.ProcessId,
            spec.StepId,
            spec.ProcessDetailId,
            spec.ResourceId,
            spec.CameraPoseId,
            new[] { spec.StateNodeId },
            new[] { spec.StateNodeId },
            BusinessSceneAvailability.Available);
        entry.SetEditorPrefabForEditor(prefab);
        return entry;
    }

    private static void ConfigureScenes(ProcessDetailCatalog catalog)
    {
        HashSet<string> configuredScenes = new HashSet<string>(StringComparer.Ordinal);
        for (int index = 0; index < Specs.Length; index++)
        {
            ProtectionDetailSpec spec = Specs[index];
            if (!configuredScenes.Add(spec.ScenePath))
            {
                continue;
            }
            ConfigureScene(spec.ScenePath, spec.SceneId, catalog);
        }
    }

    private static void ConfigureScene(string scenePath, string sceneId, ProcessDetailCatalog catalog)
    {
        Scene existingScene = SceneManager.GetSceneByPath(scenePath);
        bool wasLoaded = existingScene.IsValid() && existingScene.isLoaded;
        Scene scene = wasLoaded
            ? existingScene
            : EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Additive);
        try
        {
            GameObject runtimeRoot = FindRoot(scene, "PowerPlantRuntime");
            GameObject businessRoot = FindRootIgnoringOuterWhitespace(scene, "SceneRoot");
            GameObject cameraObject = FindRoot(scene, "Main Camera");
            PowerPlantProcessController processController =
                runtimeRoot.GetComponent<PowerPlantProcessController>();
            SubstationOverviewController overviewController =
                runtimeRoot.GetComponent<SubstationOverviewController>();
            PowerPlantFreeCameraController cameraController =
                cameraObject.GetComponent<PowerPlantFreeCameraController>();
            if (processController == null || overviewController == null || cameraController == null)
            {
                throw new InvalidOperationException($"场景 {scenePath} 缺少 PowerPlantProcessController 或 PowerPlantFreeCameraController。");
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
                sceneId,
                catalog,
                loader,
                mount,
                businessRoot.transform,
                processController,
                cameraController);
            overviewController.ConfigureProcessDetailForEditor(coordinator);
            EditorUtility.SetDirty(loader);
            EditorUtility.SetDirty(coordinator);
            EditorUtility.SetDirty(overviewController);
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
        throw new InvalidOperationException($"场景 {scene.path} 缺少根对象：{rootName}。");
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
        throw new InvalidOperationException($"场景 {scene.path} 缺少根对象：{rootName}。");
    }

    private static string GetWrapperName(ProtectionDetailSpec spec)
    {
        string sceneName = spec.SceneFolderName;
        string stepName = spec.StepId == "transformer-protection"
            ? "TransformerProtection"
            : spec.StepId == "busbar-protection"
                ? "BusbarProtection"
                : "LineProtection";
        return $"{sceneName}{stepName}ProcessDetail";
    }

    private static ProtectionDetailSpec[] CreateSpecs()
    {
        string transformerPath = "Assets/Art/变电站关键环节/变压保护.fbx";
        string busbarPath = "Assets/Art/变电站关键环节/母线保护.fbx";
        string linePath = "Assets/Art/变电站关键环节/线路保护.fbx";
        List<ProtectionDetailSpec> specs = new List<ProtectionDetailSpec>(11);
        AddSceneSpecs(
            specs,
            "step-up-substation",
            "Assets/Scenes/Business/StepUpSubstation.unity",
            "StepUpSubstation",
            "step-up",
            transformerPath,
            busbarPath,
            linePath);
        AddSceneSpecs(
            specs,
            "step-down-substation",
            "Assets/Scenes/Business/StepDownSubstation.unity",
            "StepDownSubstation",
            "step-down",
            transformerPath,
            busbarPath,
            linePath);
        AddSceneSpecs(
            specs,
            "converter-station",
            "Assets/Scenes/Business/ConverterStation.unity",
            "ConverterStation",
            "converter",
            transformerPath,
            busbarPath,
            linePath);
        AddSwitchingSceneSpecs(
            specs,
            "Assets/Scenes/Business/SwitchingStation.unity",
            "SwitchingStation",
            busbarPath,
            linePath);
        return specs.ToArray();
    }

    private static void AddSceneSpecs(
        List<ProtectionDetailSpec> specs,
        string sceneId,
        string scenePath,
        string sceneFolderName,
        string technology,
        string transformerPath,
        string busbarPath,
        string linePath)
    {
        specs.Add(new ProtectionDetailSpec(
            sceneId,
            scenePath,
            sceneFolderName,
            "transformer-protection",
            $"node.{technology}-transformer",
            transformerPath,
            "TransformerProtectionProcessDetail"));
        specs.Add(new ProtectionDetailSpec(
            sceneId,
            scenePath,
            sceneFolderName,
            "busbar-protection",
            $"unit.{technology}-protection.control",
            busbarPath,
            "BusbarProtectionProcessDetail"));
        specs.Add(new ProtectionDetailSpec(
            sceneId,
            scenePath,
            sceneFolderName,
            "line-protection",
            $"node.{technology}-breaker",
            linePath,
            "LineProtectionProcessDetail"));
    }

    private static void AddSwitchingSceneSpecs(
        List<ProtectionDetailSpec> specs,
        string scenePath,
        string sceneFolderName,
        string busbarPath,
        string linePath)
    {
        specs.Add(new ProtectionDetailSpec(
            "switching-station",
            scenePath,
            sceneFolderName,
            "busbar-protection",
            "unit.switching-protection.control",
            busbarPath,
            "BusbarProtectionProcessDetail"));
        specs.Add(new ProtectionDetailSpec(
            "switching-station",
            scenePath,
            sceneFolderName,
            "line-protection",
            "node.switching-breaker",
            linePath,
            "LineProtectionProcessDetail"));
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

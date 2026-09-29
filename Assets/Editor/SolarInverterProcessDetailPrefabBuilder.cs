using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 使用“逆变器关键环节9.28”模型生成第三层包装 Prefab，
/// 增量登记目录，并为光伏业务场景装配通用关键环节协调器。
/// </summary>
public static class SolarInverterProcessDetailPrefabBuilder
{
    public const string OutputFolderPath = "Assets/ProcessDetails/SolarPower/Inverter";
    public const string OutputPrefabPath = OutputFolderPath + "/SolarInverterProcessDetail.prefab";
    public const string CatalogAssetPath = "Assets/Configuration/ProcessDetailCatalog.asset";
    public const string SolarPowerScenePath = "Assets/Scenes/Business/SolarPower.unity";
    public const string SourceModelAssetPath =
        "Assets/Art/光伏场景/关键环节/逆变器关键环节/逆变器关键环节9.28.fbx";
    public const string SourceModelName = "逆变器关键环节9.28";

    private const string VisualStateConfigPath = "Assets/Configuration/PowerPlantVisualStateConfig.asset";
    private const string ProcessDetailId = "process-detail.solar-power.inverter";
    private const string ResourceId = "process-detail-resource.solar-power.inverter";
    private const string CameraPoseId = "camera-pose.solar-power.inverter";
    private const string StateNodeId = "node.solar-inverter";
    private static readonly Vector3 RemoteDisplayPosition = new Vector3(10000f, 0f, 0f);

    [MenuItem("Tools/WebDLPro/关键环节/从9.28模型生成光伏逆变器第三层资源")]
    public static void CreateOrUpdateFromModel()
    {
        GameObject source = AssetDatabase.LoadAssetAtPath<GameObject>(SourceModelAssetPath);
        if (source == null || !string.Equals(source.name, SourceModelName, StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"未找到光伏关键环节模型：{SourceModelAssetPath}。");
        }
        Scene scene = EditorSceneManager.GetSceneByPath(SolarPowerScenePath);
        if (!scene.IsValid() || !scene.isLoaded)
        {
            throw new InvalidOperationException("请先打开正式光伏业务场景，再生成逆变器第三层资源。");
        }

        PowerPlantVisualStateConfig visualConfig =
            AssetDatabase.LoadAssetAtPath<PowerPlantVisualStateConfig>(VisualStateConfigPath);
        if (visualConfig == null)
        {
            throw new InvalidOperationException("缺少设备四态视觉配置。");
        }

        EnsureFolder(OutputFolderPath);
        GameObject wrapperPrefab = CreateWrapperPrefab(source, visualConfig.FaultColor);
        ProcessDetailCatalog catalog = CreateOrUpdateCatalog(wrapperPrefab);
        ConfigureSolarPowerScene(catalog, scene);

        IReadOnlyList<BusinessSceneCatalogValidationIssue> issues = catalog.ValidateForRuntime();
        if (issues.Count > 0)
        {
            throw new InvalidOperationException($"光伏逆变器关键环节目录校验失败：{issues[0].Code}。");
        }

        AssetDatabase.SaveAssets();
        EditorSceneManager.SaveScene(scene);
        AssetDatabase.Refresh();
        Selection.activeObject = wrapperPrefab;
        Debug.Log($"[ProcessDetailBuilder] 已生成光伏逆变器第三层资源：{OutputPrefabPath}");
    }

    private static GameObject CreateWrapperPrefab(GameObject source, Color faultColor)
    {
        GameObject host = new GameObject("SolarInverterProcessDetail");
        host.SetActive(false);
        try
        {
            Transform displayAnchor = new GameObject("DisplayAnchor").transform;
            displayAnchor.SetParent(host.transform, false);
            displayAnchor.localPosition = RemoteDisplayPosition;

            GameObject model = UnityEngine.Object.Instantiate(source, displayAnchor);
            model.name = source.name;
            model.transform.localPosition = Vector3.zero;
            model.transform.localRotation = Quaternion.identity;
            model.transform.localScale = Vector3.one;
            model.SetActive(true);

            Renderer[] wires = ResolveRenderers(
                model.transform,
                "电线",
                "电线.001",
                "电线.002",
                "电线.003",
                "电线.004",
                "电线.005");
            Renderer reverseInverter = ResolveRenderers(model.transform, "逆变器（反向）")[0];
            Renderer controlLine = ResolveRenderers(model.transform, "控制线")[0];
            Renderer combinerBox = ResolveRenderers(model.transform, "汇流箱")[0];
            Renderer[] faultEquipment = { reverseInverter, wires[1], combinerBox };
            Renderer[] flowLines = new Renderer[wires.Length + 1];
            Array.Copy(wires, flowLines, wires.Length);
            flowLines[wires.Length] = controlLine;
            ValidateBindings(wires, faultEquipment);
            // 全部六条电线和控制线统一停流；故障红色只绑定反向逆变器、电线.001和汇流箱。
            SolarInverterWireFlowPrefabBuilder.ConfigureWireFlowEffects(flowLines);

            SolarInverterProcessDetailDynamicAdapter dynamicAdapter =
                host.AddComponent<SolarInverterProcessDetailDynamicAdapter>();
            dynamicAdapter.ConfigureForEditor(flowLines, faultColor);

            SolarInverterFaultVisualAdapter visualAdapter =
                host.AddComponent<SolarInverterFaultVisualAdapter>();
            visualAdapter.ConfigureForEditor(faultEquipment, faultColor);

            Transform cameraPose = ProcessDetailCameraPosePreservation.CreateCameraPose(
                host.transform,
                OutputPrefabPath,
                displayAnchor);

            ProcessDetailOwnedResourceMarker marker = host.AddComponent<ProcessDetailOwnedResourceMarker>();
            marker.ConfigureForEditor(ResourceId);

            ProcessDetailDeviceBinding binding = host.AddComponent<ProcessDetailDeviceBinding>();
            binding.ConfigureForEditor(
                ProcessDetailId,
                ResourceId,
                CameraPoseId,
                new[] { StateNodeId },
                new[] { StateNodeId },
                displayAnchor,
                cameraPose,
                new MonoBehaviour[] { dynamicAdapter },
                new MonoBehaviour[] { visualAdapter },
                marker);

            GameObject prefab = PrefabUtility.SaveAsPrefabAsset(host, OutputPrefabPath);
            if (prefab == null)
            {
                throw new InvalidOperationException("光伏逆变器第三层包装 Prefab 保存失败。");
            }
            return prefab;
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    private static Renderer[] ResolveRenderers(Transform root, params string[] paths)
    {
        Renderer[] result = new Renderer[paths.Length];
        for (int index = 0; index < paths.Length; index++)
        {
            Transform child = root.Find(paths[index]);
            result[index] = child != null ? child.GetComponent<Renderer>() : null;
            if (result[index] == null)
            {
                throw new InvalidOperationException($"逆变器关键环节缺少显式 Renderer：{paths[index]}。");
            }
        }
        return result;
    }

    private static void ValidateBindings(Renderer[] wires, Renderer[] inverters)
    {
        int baseColorId = Shader.PropertyToID("_BaseColor");
        int alternateBaseColorId = Shader.PropertyToID("_BASE_COLOR");
        // 新 FBX 的线材质未必沿用旧版流动 Shader；故障变色是必需效果，流速停止则由运行时按属性可用性追加。
        for (int index = 0; index < wires.Length; index++)
        {
            bool foundColor = false;
            Material[] materials = wires[index].sharedMaterials;
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                Material material = materials[materialIndex];
                foundColor |= material != null &&
                    (material.HasProperty(baseColorId) || material.HasProperty(alternateBaseColorId));
            }
            if (!foundColor)
            {
                throw new InvalidOperationException($"电线 {wires[index].name} 没有可用于故障变色的材质属性。");
            }
        }

        for (int index = 0; index < inverters.Length; index++)
        {
            bool found = false;
            Material[] materials = inverters[index].sharedMaterials;
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                Material material = materials[materialIndex];
                found |= material != null &&
                    (material.HasProperty(baseColorId) || material.HasProperty(alternateBaseColorId));
            }
            if (!found)
            {
                throw new InvalidOperationException($"故障设备 {inverters[index].name} 没有支持底色属性的材质槽。");
            }
        }
    }

    private static ProcessDetailCatalog CreateOrUpdateCatalog(GameObject wrapperPrefab)
    {
        ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogAssetPath);
        if (catalog == null)
        {
            throw new InvalidOperationException("未找到正式关键环节目录资产。");
        }

        ProcessDetailCatalogEntry entry = new ProcessDetailCatalogEntry(
            "solar-power",
            "solar-power-generation",
            "inverter",
            ProcessDetailId,
            ResourceId,
            CameraPoseId,
            new[] { StateNodeId },
            new[] { StateNodeId },
            BusinessSceneAvailability.Available);
        entry.SetEditorPrefabForEditor(wrapperPrefab);

        List<ProcessDetailCatalogEntry> entries = new List<ProcessDetailCatalogEntry>(catalog.Entries.Count + 1);
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

    private static void ConfigureSolarPowerScene(ProcessDetailCatalog catalog, Scene scene)
    {
        GameObject runtimeRoot = FindRoot(scene, "PowerPlantRuntime");
        GameObject businessRoot = FindRoot(scene, "SceneRoot");
        GameObject cameraObject = FindRoot(scene, "Main Camera");
        PowerPlantProcessController processController = runtimeRoot.GetComponent<PowerPlantProcessController>();
        PowerPlantFreeCameraController cameraController = cameraObject.GetComponent<PowerPlantFreeCameraController>();
        if (processController == null || cameraController == null)
        {
            throw new InvalidOperationException("光伏场景缺少流程控制器或自由相机控制器。");
        }

        Transform inverterEquipmentRoot = businessRoot.transform.Find("Equipment/逆变器控制");
        if (inverterEquipmentRoot == null)
        {
            throw new InvalidOperationException("光伏场景缺少逆变器设备根节点：SceneRoot/Equipment/逆变器控制。");
        }
        GameObject[] visualStateTargets = ResolveSceneObjects(
            inverterEquipmentRoot,
            "汇流箱＋逆变器",
            "汇流箱＋逆变器.001",
            "汇流箱＋逆变器.002",
            "汇流箱＋逆变器.003",
            "汇流箱＋逆变器.004",
            "汇流箱＋逆变器.005");
        processController.ConfigureVisualStateBindingsForEditor(visualStateTargets);
        EditorUtility.SetDirty(processController);

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
            "solar-power",
            catalog,
            loader,
            mount,
            businessRoot.transform,
            processController,
            cameraController);
        EditorUtility.SetDirty(loader);
        EditorUtility.SetDirty(coordinator);
        EditorSceneManager.MarkSceneDirty(scene);
    }

    private static GameObject[] ResolveSceneObjects(Transform root, params string[] childNames)
    {
        GameObject[] result = new GameObject[childNames.Length];
        for (int index = 0; index < childNames.Length; index++)
        {
            Transform child = root.Find(childNames[index]);
            if (child == null)
            {
                throw new InvalidOperationException($"光伏场景缺少显式设备目标：{childNames[index]}。");
            }
            result[index] = child.gameObject;
        }
        return result;
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
        throw new InvalidOperationException($"光伏场景缺少根对象：{rootName}。");
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

using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 由光伏场景中选中的“逆变器关键环节”模型生成第三层包装 Prefab，
/// 增量登记目录，并为光伏业务场景装配通用关键环节协调器。
/// </summary>
public static class SolarInverterProcessDetailPrefabBuilder
{
    public const string OutputFolderPath = "Assets/ProcessDetails/SolarPower/Inverter";
    public const string OutputPrefabPath = OutputFolderPath + "/SolarInverterProcessDetail.prefab";
    public const string CatalogAssetPath = "Assets/Configuration/ProcessDetailCatalog.asset";
    public const string SolarPowerScenePath = "Assets/Scenes/Business/SolarPower.unity";

    private const string VisualStateConfigPath = "Assets/Configuration/PowerPlantVisualStateConfig.asset";
    private const string ProcessDetailId = "process-detail.solar-power.inverter";
    private const string ResourceId = "process-detail-resource.solar-power.inverter";
    private const string CameraPoseId = "camera-pose.solar-power.inverter";
    private const string StateNodeId = "node.solar-inverter";
    private const string TargetMaterialName = "材质.002";
    private static readonly Vector3 RemoteDisplayPosition = new Vector3(10000f, 0f, 0f);

    [MenuItem("Tools/WebDLPro/关键环节/从选中节点生成光伏逆变器第三层资源")]
    public static void CreateOrUpdateFromSelection()
    {
        GameObject source = Selection.activeGameObject;
        if (source == null || !string.Equals(source.name, "逆变器关键环节", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("请在光伏场景中选中根节点“逆变器关键环节”。");
        }
        if (!string.Equals(source.scene.path, SolarPowerScenePath, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("选中的逆变器关键环节不属于正式光伏业务场景。");
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
        ConfigureSolarPowerScene(catalog, source.scene);

        IReadOnlyList<BusinessSceneCatalogValidationIssue> issues = catalog.ValidateForRuntime();
        if (issues.Count > 0)
        {
            throw new InvalidOperationException($"光伏逆变器关键环节目录校验失败：{issues[0].Code}。");
        }

        AssetDatabase.SaveAssets();
        EditorSceneManager.SaveScene(source.scene);
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

            Renderer[] wires = ResolveRenderers(model.transform, "电线1", "电线2", "电线3");
            Renderer[] inverters = ResolveRenderers(model.transform, "逆变器", "逆变器.001", "逆变器.002");
            ValidateBindings(wires, inverters);

            SolarInverterProcessDetailDynamicAdapter dynamicAdapter =
                host.AddComponent<SolarInverterProcessDetailDynamicAdapter>();
            dynamicAdapter.ConfigureForEditor(wires);

            SolarInverterFaultVisualAdapter visualAdapter =
                host.AddComponent<SolarInverterFaultVisualAdapter>();
            visualAdapter.ConfigureForEditor(inverters, TargetMaterialName, faultColor);

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
        int flowSpeedId = Shader.PropertyToID("_FlowSpeed");
        for (int index = 0; index < wires.Length; index++)
        {
            bool found = false;
            Material[] materials = wires[index].sharedMaterials;
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                found |= materials[materialIndex] != null && materials[materialIndex].HasProperty(flowSpeedId);
            }
            if (!found)
            {
                throw new InvalidOperationException($"电线 {wires[index].name} 没有 _FlowSpeed 材质槽。");
            }
        }

        for (int index = 0; index < inverters.Length; index++)
        {
            bool found = false;
            Material[] materials = inverters[index].sharedMaterials;
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                found |= materials[materialIndex] != null &&
                    string.Equals(materials[materialIndex].name, TargetMaterialName, StringComparison.Ordinal);
            }
            if (!found)
            {
                throw new InvalidOperationException($"逆变器 {inverters[index].name} 缺少 {TargetMaterialName} 材质槽。");
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

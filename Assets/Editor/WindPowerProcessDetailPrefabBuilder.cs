using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

/// <summary>Builds the three wind-power detail resources and binds the existing business scene.</summary>
public static class WindPowerProcessDetailPrefabBuilder
{
    private const string ScenePath = "Assets/Scenes/Business/WindPower.unity";
    private const string CatalogPath = "Assets/Configuration/ProcessDetailCatalog.asset";
    private const string VisualConfigPath = "Assets/Configuration/PowerPlantVisualStateConfig.asset";
    private const string Folder = "Assets/ProcessDetails/WindPower";
    private static readonly Vector3 RemotePosition = new Vector3(10000f, 0f, 0f);

    [MenuItem("Tools/WebDLPro/关键环节/生成风电齿轮箱、风机和偏航系统第三层资源")]
    public static void CreateOrUpdate()
    {
        if (Application.isPlaying)
            throw new InvalidOperationException("第三层资源只能在编辑模式生成。");
        ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogPath);
        PowerPlantVisualStateConfig config = AssetDatabase.LoadAssetAtPath<PowerPlantVisualStateConfig>(VisualConfigPath);
        if (catalog == null || config == null)
            throw new InvalidOperationException("缺少关键环节目录或四态视觉配置。");

        GameObject gearbox = Build("Gearbox", "GearboxProcessDetail", "Assets/Art/齿轮箱/CLXPrefab.prefab",
            "gearbox", "node.wind-gearbox", config);
        GameObject turbine = Build("WindTurbine", "WindTurbineProcessDetail", "Assets/Art/风机/FJPrefab.prefab",
            "wind-turbine", "node.wind-turbine", config);
        GameObject yaw = Build("YawSystem", "YawSystemProcessDetail", "Assets/Art/新模型9.23/偏航系统.prefab",
            "yaw-system", "node.wind-yaw-system", config);
        List<ProcessDetailCatalogEntry> entries = new List<ProcessDetailCatalogEntry>(catalog.Entries);
        Upsert(entries, gearbox, "gearbox", "node.wind-gearbox");
        Upsert(entries, turbine, "wind-turbine", "node.wind-turbine");
        Upsert(entries, yaw, "yaw-system", "node.wind-yaw-system");
        catalog.SetEntriesForEditor(entries);
        if (catalog.ValidateForRuntime().Count != 0)
            throw new InvalidOperationException("风电目录配置校验失败：" + catalog.ValidateForRuntime()[0].Code);
        EditorUtility.SetDirty(catalog);
        ConfigureScene(catalog);
        AssetDatabase.SaveAssets();
        Debug.Log("[ProcessDetailBuilder] 风电齿轮箱、风机和偏航系统第三层资源已装配。");
    }

    private static GameObject Build(string subfolder, string name, string sourcePath, string step,
        string nodeId, PowerPlantVisualStateConfig config)
    {
        EnsureFolder(Folder + "/" + subfolder);
        string path = Folder + "/" + subfolder + "/" + name + ".prefab";
        // 已生成的预制体可能带有后续手动追加的标注、全息排除或环绕脚本配置；
        // 以源模型为基准重建会抹掉这些增强（曾导致风机环节 orbit/标注丢失），因此存在即跳过，
        // 只有显式删除该预制体后才能强制按最新源模型重建。
        GameObject existing = AssetDatabase.LoadAssetAtPath<GameObject>(path);
        if (existing != null)
        {
            Debug.Log("[ProcessDetailBuilder] 预制体已存在，跳过重建（如需重建请先删除该预制体）：" + path);
            return existing;
        }
        GameObject source = AssetDatabase.LoadAssetAtPath<GameObject>(sourcePath);
        if (source == null) throw new InvalidOperationException("缺少源模型：" + sourcePath);
        GameObject host = new GameObject(name);
        host.SetActive(false);
        try
        {
            Transform anchor = new GameObject("DisplayAnchor").transform;
            anchor.SetParent(host.transform, false);
            anchor.localPosition = RemotePosition;
            GameObject model = PrefabUtility.InstantiatePrefab(source, anchor) as GameObject;
            if (model == null) throw new InvalidOperationException("无法实例化源模型：" + sourcePath);
            // Keep the nested prefab's authored transform: FJPrefab uses an offset pivot.
            Transform pose = ProcessDetailCameraPosePreservation.CreateCameraPose(host.transform, path, anchor);
            // Older temporary wrappers stored the offset relative to the wrapper origin. Keep that
            // authored offset while moving the pose into the same remote display region as the anchor.
            if (Mathf.Abs(pose.localPosition.x) < 1000f)
            {
                pose.localPosition += RemotePosition;
            }
            if (Vector3.Distance(pose.position, anchor.position) < 0.01f)
            {
                Renderer[] modelRenderers = model.GetComponentsInChildren<Renderer>(true);
                Bounds bounds = new Bounds(model.transform.position, Vector3.one);
                bool hasBounds = false;
                foreach (Renderer renderer in modelRenderers)
                {
                    if (!(renderer is MeshRenderer)) continue;
                    if (!hasBounds) { bounds = renderer.bounds; hasBounds = true; }
                    else bounds.Encapsulate(renderer.bounds);
                }
                float distance = Mathf.Max(12f, bounds.extents.magnitude * 1.7f);
                pose.position = bounds.center + new Vector3(distance, distance * 0.35f, distance);
                pose.rotation = Quaternion.LookRotation(bounds.center - pose.position, Vector3.up);
            }

            WindTurbineRotationController[] rotations = model.GetComponentsInChildren<WindTurbineRotationController>(true);
            GearboxExplodedView[] views = model.GetComponentsInChildren<GearboxExplodedView>(true);
            // The source orbit script competes with the business-scene snapshot camera.
            foreach (GearboxOrbitCamera orbit in model.GetComponentsInChildren<GearboxOrbitCamera>(true))
                orbit.enabled = false;
            // 动态目标按源模型能力分流：风机/齿轮箱走专用控制器；偏航系统复用源模型自带齿轮 Animator。
            ProcessDetailDynamicTargetBase dynamic;
            if (rotations.Length > 0 || views.Length > 0)
            {
                WindPowerProcessDetailDynamicAdapter windDynamic = host.AddComponent<WindPowerProcessDetailDynamicAdapter>();
                windDynamic.ConfigureForEditor(rotations, views);
                dynamic = windDynamic;
            }
            else
            {
                Animator[] gearAnimators = model.GetComponentsInChildren<Animator>(true);
                if (gearAnimators.Length == 0)
                    throw new InvalidOperationException("源模型没有可绑定的动态组件：" + sourcePath);
                YawSystemProcessDetailDynamicAdapter yawDynamic = host.AddComponent<YawSystemProcessDetailDynamicAdapter>();
                yawDynamic.ConfigureForEditor(gearAnimators);
                dynamic = yawDynamic;
            }

            List<Renderer> stateRenderers = new List<Renderer>();
            foreach (Renderer renderer in model.GetComponentsInChildren<Renderer>(true))
            {
                if (!(renderer is MeshRenderer)) continue;
                Material[] materials = renderer.sharedMaterials;
                if (materials == null || materials.Length == 0) continue;
                bool supported = true;
                foreach (Material material in materials)
                    supported &= material != null && (material.HasProperty("_BaseColor") || material.HasProperty("_BASE_COLOR"));
                if (supported) stateRenderers.Add(renderer);
            }
            if (stateRenderers.Count == 0)
                throw new InvalidOperationException("源模型没有支持四态的渲染器：" + sourcePath);
            ProcessDetailStateVisualAdapter visual = host.AddComponent<ProcessDetailStateVisualAdapter>();
            visual.ConfigureForEditor(true, true, stateRenderers.ToArray(), config.AlarmColor,
                config.FaultColor, config.OfflineColor, 0.72f);
            string prefix = "process-detail.wind-power." + step;
            string resourceId = "process-detail-resource.wind-power." + step;
            ProcessDetailOwnedResourceMarker marker = host.AddComponent<ProcessDetailOwnedResourceMarker>();
            marker.ConfigureForEditor(resourceId);
            ProcessDetailDeviceBinding binding = host.AddComponent<ProcessDetailDeviceBinding>();
            binding.ConfigureForEditor(prefix, resourceId, "camera-pose.wind-power." + step,
                new[] { nodeId }, new[] { nodeId }, anchor, pose,
                new MonoBehaviour[] { dynamic }, new MonoBehaviour[] { visual }, marker);
            return PrefabUtility.SaveAsPrefabAsset(host, path);
        }
        finally { UnityEngine.Object.DestroyImmediate(host); }
    }

    private static void Upsert(List<ProcessDetailCatalogEntry> entries, GameObject prefab, string step, string nodeId)
    {
        string id = "process-detail.wind-power." + step;
        ProcessDetailCatalogEntry entry = new ProcessDetailCatalogEntry("wind-power", "wind-power-generation",
            step, id, "process-detail-resource.wind-power." + step, "camera-pose.wind-power." + step,
            new[] { nodeId }, new[] { nodeId }, BusinessSceneAvailability.Available);
        entry.SetEditorPrefabForEditor(prefab);
        int index = entries.FindIndex(item => item != null && item.ProcessDetailId == id);
        if (index < 0) entries.Add(entry);
        else entries[index] = entry;
    }

    private static void ConfigureScene(ProcessDetailCatalog catalog)
    {
        Scene scene = SceneManager.GetSceneByPath(ScenePath);
        if (!scene.IsValid() || !scene.isLoaded)
            throw new InvalidOperationException("请先打开风电场景，避免覆盖未保存的场景修改。");
        GameObject runtime = FindRoot(scene, "PowerPlantRuntime");
        GameObject business = FindRoot(scene, "SceneRoot");
        GameObject camera = FindRoot(scene, "Main Camera");
        PowerPlantProcessController process = runtime.GetComponent<PowerPlantProcessController>();
        PowerPlantFreeCameraController freeCamera = camera.GetComponent<PowerPlantFreeCameraController>();
        SubstationOverviewController overview = runtime.GetComponent<SubstationOverviewController>();
        Transform mount = runtime.transform.Find("ProcessDetailMount");
        if (process == null || freeCamera == null || overview == null || mount == null)
            throw new InvalidOperationException("风电场景缺少控制器、自由相机或第三层挂载点。");
        ProcessDetailAssetBundleLoader loader = runtime.GetComponent<ProcessDetailAssetBundleLoader>();
        if (loader == null) loader = runtime.AddComponent<ProcessDetailAssetBundleLoader>();
        ProcessDetailCoordinator coordinator = runtime.GetComponent<ProcessDetailCoordinator>();
        if (coordinator == null) coordinator = runtime.AddComponent<ProcessDetailCoordinator>();
        coordinator.ConfigureForEditor("wind-power", catalog, loader, mount, business.transform, process, freeCamera);
        overview.ConfigureProcessDetailForEditor(coordinator);
        EditorUtility.SetDirty(coordinator);
        EditorUtility.SetDirty(overview);
        EditorSceneManager.MarkSceneDirty(scene);
        EditorSceneManager.SaveScene(scene);
    }

    private static GameObject FindRoot(Scene scene, string name)
    {
        foreach (GameObject root in scene.GetRootGameObjects())
            if (root.name == name) return root;
        throw new InvalidOperationException("风电场景缺少根节点：" + name);
    }

    private static void EnsureFolder(string path)
    {
        string[] segments = path.Split('/');
        string current = segments[0];
        for (int i = 1; i < segments.Length; i++)
        {
            string next = current + "/" + segments[i];
            if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(current, segments[i]);
            current = next;
        }
    }
}

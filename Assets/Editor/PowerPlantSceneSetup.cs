using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// 提供燃气场景的历史批量配置入口，并为燃煤场景创建运行时外壳。
/// 燃气入口保持既有模板兼容；燃煤的节点、模型和视觉状态绑定改由控制器属性面板（Inspector）维护，
/// 构建后的运行时始终只读取场景中已序列化的对象引用，不按模型名称查找。
/// </summary>
public static class PowerPlantSceneSetup
{
    private const string SceneRootName = "场景";
    private const string RuntimeRootName = "PowerPlantRuntime";
    private const string ContextFadeShaderPath = "Assets/Shaders/PowerPlantContextFadeURP.shader";
    private const string ContextFadeMaterialPath = "Assets/Shaders/PowerPlant_ContextFade.mat";

    private const string CoalSceneRootName = "SceneRoot";
    private const string CoalEquipmentRootName = "Equipment";

    [MenuItem("Tools/WebDLPro/Configure Current Power Plant Scene")]
    private static void ConfigureCurrentScene()
    {
        Scene activeScene = SceneManager.GetActiveScene();
        GameObject sceneRoot = GameObject.Find(SceneRootName);
        if (sceneRoot == null)
        {
            EditorUtility.DisplayDialog("无法配置燃气发电场景", $"当前场景中未找到根对象“{SceneRootName}”。", "确定");
            return;
        }

        Material contextFadeMaterial = LoadOrCreateContextFadeMaterial();
        if (contextFadeMaterial == null)
        {
            EditorUtility.DisplayDialog("无法配置燃气发电场景", $"未找到或无法创建上下文半透明材质：{ContextFadeMaterialPath}", "确定");
            return;
        }

        GameObject runtimeRoot = GameObject.Find(RuntimeRootName);
        if (runtimeRoot == null)
        {
            runtimeRoot = new GameObject(RuntimeRootName);
            Undo.RegisterCreatedObjectUndo(runtimeRoot, "Create Power Plant Runtime");
        }

        PowerPlantProcessController controller = runtimeRoot.GetComponent<PowerPlantProcessController>();
        if (controller == null)
        {
            controller = Undo.AddComponent<PowerPlantProcessController>(runtimeRoot);
        }

        if (runtimeRoot.GetComponent<UnityIframeBridgeManager>() == null)
        {
            Undo.AddComponent<UnityIframeBridgeManager>(runtimeRoot);
        }

        Camera interactionCamera = Camera.main;
        if (interactionCamera != null && interactionCamera.GetComponent<PowerPlantFreeCameraController>() == null)
        {
            Undo.AddComponent<PowerPlantFreeCameraController>(interactionCamera.gameObject);
        }

        controller.ConfigureForCurrentSampleScene(
            sceneRoot.transform,
            interactionCamera,
            contextFadeMaterial,
            new[] { GetRequiredObject(sceneRoot.transform, "地面") },
            GetRequiredObjects(sceneRoot.transform,
                "排水口管道002", "海水进水口管道", "排水口管道1", "管道5", "凝结水到锅炉管道2", "Circle001", "余热锅炉管道001", "汽轮机管道1", "取水泵站管道"),
            GetDirectChildren(sceneRoot.transform),
            GetRequiredObjects(sceneRoot.transform,
                "余热锅炉管道001", "余热锅炉", "凝结水到锅炉管道2", "冷凝水泵2", "凝汽器", "冷凝水泵1",
                "排水口管道1", "排水口管道002", "海水进水口管道", "海水进口管道支架", "取水泵站", "取水泵站管道", "Circle001"),
            GetRequiredObject(sceneRoot.transform, "烟囱"),
            GetRequiredObject(sceneRoot.transform, "燃气轮机"),
            GetRequiredObject(sceneRoot.transform, "余热锅炉"),
            GetRequiredObject(sceneRoot.transform, "低中高压汽轮机"),
            GetRequiredObject(sceneRoot.transform, "发电机"),
            GetRequiredObject(sceneRoot.transform, "变压站+电网"));
        EditorUtility.SetDirty(runtimeRoot);
        EditorSceneManager.MarkSceneDirty(activeScene);
        EditorSceneManager.SaveScene(activeScene);
        Selection.activeGameObject = runtimeRoot;

        Debug.Log("[PowerPlantSceneSetup] 已写入场景对象的直接绑定；管道流动由静态材质持续播放。", runtimeRoot);
    }

    /// <summary>
    /// 创建或选中燃煤运行时外壳，但不写入任何模型绑定。
    ///
    /// 燃煤的 sceneNodeId、目标对象、四态目标和显隐集合全部属于场景资产，必须在
    /// PowerPlantProcessController 的属性面板（Inspector）中通过对象引用配置并保存。
    /// 该入口只负责创建桥接所需的空壳，避免再次把模型名称固化到编辑器代码中。
    /// </summary>
    [MenuItem("Tools/WebDLPro/Configure Coal Power Scene (Inspector)")]
    [MenuItem("Tools/WebDLPro/Configure Coal Power Scene")]
    private static void PrepareCoalSceneForInspector()
    {
        Scene activeScene = SceneManager.GetActiveScene();
        GameObject sceneRoot = GameObject.Find(CoalSceneRootName);
        if (sceneRoot == null)
        {
            EditorUtility.DisplayDialog("无法准备燃煤发电场景", $"当前场景中未找到根对象“{CoalSceneRootName}”。", "确定");
            return;
        }

        Transform equipment = sceneRoot.transform.Find(CoalEquipmentRootName);
        if (equipment == null)
        {
            EditorUtility.DisplayDialog("无法准备燃煤发电场景", $"场景根对象下未找到设备根“{CoalEquipmentRootName}”。", "确定");
            return;
        }

        GameObject runtimeRoot = GameObject.Find(RuntimeRootName);
        if (runtimeRoot == null)
        {
            runtimeRoot = new GameObject(RuntimeRootName);
            Undo.RegisterCreatedObjectUndo(runtimeRoot, "Create Coal Power Runtime");
        }

        if (runtimeRoot.GetComponent<PowerPlantProcessController>() == null)
        {
            Undo.AddComponent<PowerPlantProcessController>(runtimeRoot);
        }

        if (runtimeRoot.GetComponent<UnityIframeBridgeManager>() == null)
        {
            Undo.AddComponent<UnityIframeBridgeManager>(runtimeRoot);
        }

        Camera interactionCamera = Camera.main;
        if (interactionCamera != null && interactionCamera.GetComponent<PowerPlantFreeCameraController>() == null)
        {
            Undo.AddComponent<PowerPlantFreeCameraController>(interactionCamera.gameObject);
        }

        EditorUtility.SetDirty(runtimeRoot);
        EditorSceneManager.MarkSceneDirty(activeScene);
        EditorSceneManager.SaveScene(activeScene);
        Selection.activeGameObject = runtimeRoot;

        Debug.Log(
            "[PowerPlantSceneSetup] 已准备燃煤运行时外壳。请在 PowerPlantProcessController 属性面板中配置流程标识、场景根和节点对象引用；本工具未写入模型绑定。",
            runtimeRoot);
    }

    private static GameObject GetRequiredObject(Transform root, string objectName)
    {
        Transform target = root.Find(objectName);
        if (target == null)
        {
            throw new MissingReferenceException($"未找到场景对象：{objectName}");
        }

        return target.gameObject;
    }

    private static GameObject[] GetRequiredObjects(Transform root, params string[] objectNames)
    {
        GameObject[] objects = new GameObject[objectNames.Length];
        for (int index = 0; index < objectNames.Length; index++)
        {
            objects[index] = GetRequiredObject(root, objectNames[index]);
        }

        return objects;
    }

    private static GameObject[] GetDirectChildren(Transform root)
    {
        GameObject[] objects = new GameObject[root.childCount];
        for (int index = 0; index < root.childCount; index++)
        {
            objects[index] = root.GetChild(index).gameObject;
        }

        return objects;
    }

    private static Material LoadOrCreateContextFadeMaterial()
    {
        Material material = AssetDatabase.LoadAssetAtPath<Material>(ContextFadeMaterialPath);
        if (material != null)
        {
            return material;
        }

        Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ContextFadeShaderPath);
        if (shader == null)
        {
            Debug.LogError($"[PowerPlantSceneSetup] 未找到上下文半透明 Shader：{ContextFadeShaderPath}");
            return null;
        }

        material = new Material(shader)
        {
            name = "PowerPlant_ContextFade"
        };
        material.SetFloat("_Opacity", 0.22f);
        AssetDatabase.CreateAsset(material, ContextFadeMaterialPath);
        AssetDatabase.SaveAssets();
        return material;
    }

    [MenuItem("Tools/WebDLPro/Configure Current Power Plant Scene", true)]
    private static bool ValidateConfigureCurrentScene()
    {
        return SceneManager.GetActiveScene().IsValid();
    }
}

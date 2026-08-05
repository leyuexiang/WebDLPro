using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// 将已验证的 SampleScene 模型映射写入运行时控制器。
/// 该命令只在编辑器中运行一次；构建后的运行时仅使用序列化对象引用，不再按模型名称查找。
/// </summary>
public static class PowerPlantSceneSetup
{
    private const string SceneRootName = "场景";
    private const string RuntimeRootName = "PowerPlantRuntime";
    private const string ContextFadeShaderPath = "Assets/Shaders/PowerPlantContextFadeURP.shader";
    private const string ContextFadeMaterialPath = "Assets/Shaders/PowerPlant_ContextFade.mat";

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

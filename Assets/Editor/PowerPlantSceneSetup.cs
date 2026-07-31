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
    private const string GasFlowMaterialPath = "Assets/Shaders/PipelineFlow_Gas.mat";
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

        Material gasFlowMaterial = AssetDatabase.LoadAssetAtPath<Material>(GasFlowMaterialPath);
        if (gasFlowMaterial == null)
        {
            EditorUtility.DisplayDialog("无法配置燃气发电场景", $"未找到流动材质：{GasFlowMaterialPath}", "确定");
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

        controller.ConfigureForCurrentSampleScene(sceneRoot.transform, interactionCamera, gasFlowMaterial, contextFadeMaterial);
        EditorUtility.SetDirty(runtimeRoot);
        EditorSceneManager.MarkSceneDirty(activeScene);
        EditorSceneManager.SaveScene(activeScene);
        Selection.activeGameObject = runtimeRoot;

        Debug.Log("[PowerPlantSceneSetup] 已将 SampleScene 的模型映射、管道 1/2/3/4/5/6/7/9 流动路由和 iframe 运行时对象写入场景。", runtimeRoot);
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

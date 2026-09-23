using UnityEngine;

/// <summary>
/// iframe 桥接兜底引导器。
/// 正式场景由编辑器配置命令持久化 PowerPlantRuntime；只有在未配置场景时才创建最小桥接对象，
/// 不再生成测试立方体或污染厂区画面。
/// </summary>
public static class UnityIframeTestBootstrap
{
    // 在场景加载后执行，优先复用 SampleScene 中已持久化的通信对象，避免生成重复桥接器。
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void CreateTestSceneObjects()
    {
        if (Object.FindFirstObjectByType<UnityIframeBridgeManager>() != null)
        {
            return;
        }

        // 未配置场景时仍可完成协议握手，但流程命令会返回 controller-unavailable，
        // 以明确提示开发者执行 Tools/WebDLPro/Configure Current Power Plant Scene。
        GameObject root = new GameObject("PowerPlantRuntimeFallback");
        Object.DontDestroyOnLoad(root);
        root.AddComponent<UnityIframeBridgeManager>();
        Debug.LogWarning("[UnityIframeBridge] 未发现 PowerPlantRuntime。请在 SampleScene 中执行 Tools/WebDLPro/Configure Current Power Plant Scene。");
    }
}

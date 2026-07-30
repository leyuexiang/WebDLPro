using UnityEngine;

/// <summary>
/// 第一阶段场景自动引导器。
/// 该脚本在场景加载前创建通信管理器和可点击立方体，因此不需要手工修改 SampleScene，
/// 也能保证后续新建空场景时仍具备同一套通信验证能力。
/// </summary>
public static class UnityIframeTestBootstrap
{
    // 在场景加载后执行，优先复用 SampleScene 中已持久化的通信对象，避免生成重复立方体。
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void CreateTestSceneObjects()
    {
        if (Object.FindFirstObjectByType<UnityIframeBridgeManager>() != null)
        {
            return;
        }

        // 根对象统一承载运行期测试对象，便于在层级面板中识别和清理。
        GameObject root = new GameObject("IframeWebGLTestRoot");
        Object.DontDestroyOnLoad(root);

        UnityIframeBridgeManager bridgeManager = root.AddComponent<UnityIframeBridgeManager>();
        GameObject testCube = GameObject.CreatePrimitive(PrimitiveType.Cube);
        testCube.name = "IframeTestCube";
        testCube.transform.position = Vector3.zero;
        testCube.transform.localScale = Vector3.one * 2f;
        testCube.GetComponent<Renderer>().material.color = new Color(0.12f, 0.45f, 0.76f, 1f);
        bridgeManager.TestObjectRenderer = testCube.GetComponent<Renderer>();

        // OnMouseDown 使用立方体自带 BoxCollider，无需额外射线检测与每帧轮询。
        UnityIframeTestObject testObject = testCube.AddComponent<UnityIframeTestObject>();
        testObject.Initialize("DEMO-CUBE-001", "WebGL 测试立方体");
    }
}

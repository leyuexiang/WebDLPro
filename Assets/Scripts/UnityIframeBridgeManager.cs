using System;
using System.Runtime.InteropServices;
using UnityEngine;

/// <summary>
/// Unity 与父页面 iframe 容器之间的通信管理器。
/// WebGL 运行时通过 .jslib 浏览器桥接层收发消息；编辑器与非 WebGL 平台仅输出日志，
/// 这样可以在打包前安全检查脚本、场景与点击交互。
/// </summary>
public sealed class UnityIframeBridgeManager : MonoBehaviour
{
    private const string ProtocolChannel = "power3d-unity";
    private const int ProtocolVersion = 1;

    /// <summary>供测试立方体点击组件调用的当前通信管理器实例。</summary>
    public static UnityIframeBridgeManager Instance { get; private set; }

    /// <summary>测试指令与尺寸消息会显示在这里，便于无需 UI 资源即可验证通信。</summary>
    public string StatusText { get; private set; } = "等待父页面初始化…";

    /// <summary>
    /// 可在场景中序列化保存的测试对象渲染器。
    /// 未手动绑定时会按固定测试对象名称查找，确保默认场景和自动回退场景都能验证颜色变化。
    /// </summary>
    [SerializeField] private Renderer _testObjectRenderer;

    /// <summary>供自动引导器注入测试对象渲染器，避免运行期重复查询组件。</summary>
    public Renderer TestObjectRenderer
    {
        get => _testObjectRenderer;
        set => _testObjectRenderer = value;
    }

    private string _instanceId = "local-demo-001";
    private PowerPlantProcessController _processController;

#if UNITY_WEBGL && !UNITY_EDITOR
    /// <summary>初始化浏览器消息监听器，并让其在 Unity 可接收消息后发送 ready。</summary>
    [DllImport("__Internal")]
    private static extern void Power3dUnityBridge_Initialize(string gameObjectName, string instanceId);

    /// <summary>将 Unity 生成的 JSON 消息交给浏览器桥接层并转发至父页面。</summary>
    [DllImport("__Internal")]
    private static extern void Power3dUnityBridge_SendToParent(string messageJson);
#endif

    /// <summary>
    /// 浏览器侧数据协议。payload 使用固定的测试字段，避免 JsonUtility 无法解析动态字典，
    /// 生产阶段可按业务消息类型拆分为更严格的数据模型。
    /// </summary>
    [Serializable]
    private sealed class BridgeMessage
    {
        public string channel;
        public int version;
        public string instanceId;
        public string messageId;
        public string type;
        public BridgePayload payload;
        public long timestamp;
    }

    /// <summary>测试与燃气发电业务命令共享的固定负载字段。</summary>
    [Serializable]
    private sealed class BridgePayload
    {
        public string text;
        public string message;
        public string deviceCode;
        public string deviceName;
        public string requestId;
        public string processId;
        public string stepId;
        public string unitId;
        public string nodeId;
        public string nodeName;
        public string routeId;
        public string errorCode;
        public string sceneState;
        public bool isolate;
        public bool enabled;
        public float speed;
        public float width;
        public float height;
    }

    private void Awake()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        // 左侧平台控件被点击后，iframe 中的 Unity 画布会暂时失去焦点。
        // 保持 WebGL 运行循环可用，确保父页面的 postMessage 指令能立即更新三维画面，
        // 而不需要用户再次点击画布来恢复渲染。
        Application.runInBackground = true;
#endif

        // 场景测试仅保留一个桥接实例，避免切换场景后同一消息被重复处理。
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }

        Instance = this;
        DontDestroyOnLoad(gameObject);
        _instanceId = ReadQueryParameter("instanceId", _instanceId);

        TryBindTestObjectRenderer();
        TryBindProcessController();
    }

    private void Start()
    {
        // Start 在场景全部 Awake 完成后执行；再次尝试绑定可规避根对象先于子对象初始化的顺序差异。
        TryBindTestObjectRenderer();
        TryBindProcessController();
        if (_testObjectRenderer != null)
        {
            _testObjectRenderer.material.color = new Color(1f, 0.45f, 0.76f, 1f);
        }

#if UNITY_WEBGL && !UNITY_EDITOR
        // 传入实际 GameObject 名称，.jslib 会用它精确调用 ReceiveFromParent。
        Power3dUnityBridge_Initialize(gameObject.name, _instanceId);
#else
        Debug.Log($"[UnityIframeBridge] 编辑器测试模式已启动，实例标识：{_instanceId}");
#endif
    }

    /// <summary>
    /// 由 .jslib 的 SendMessage 调用。方法名不可修改，否则浏览器桥接层无法将消息送入 Unity。
    /// 先校验协议与实例标识，再根据类型执行业务操作，避免外部页面的无关消息影响场景。
    /// </summary>
    public void ReceiveFromParent(string messageJson)
    {
        if (string.IsNullOrWhiteSpace(messageJson))
        {
            return;
        }

        BridgeMessage message;
        try
        {
            message = JsonUtility.FromJson<BridgeMessage>(messageJson);
        }
        catch (Exception exception)
        {
            Debug.LogWarning($"[UnityIframeBridge] 无法解析父页面消息：{exception.Message}");
            return;
        }

        if (message == null || message.channel != ProtocolChannel || message.version != ProtocolVersion || message.instanceId != _instanceId || string.IsNullOrWhiteSpace(message.type))
        {
            Debug.LogWarning("[UnityIframeBridge] 已拒绝不符合协议或实例标识的消息。");
            return;
        }

        switch (message.type)
        {
            case "init":
                HandleInitialize(message);
                break;
            case "test-command":
                HandleTestCommand(message.payload);
                break;
            case "resize":
                StatusText = $"收到容器尺寸：{message.payload?.width:0} × {message.payload?.height:0}";
                break;
            case "enterProcessStep":
                HandleEnterProcessStep(message);
                break;
            case "resetScene":
                HandleResetScene(message);
                break;
            case "focusNode":
                HandleFocusNode(message);
                break;
            case "setNodeVisibility":
                HandleSetNodeVisibility(message);
                break;
            case "setRouteFlow":
                HandleSetRouteFlow(message);
                break;
            default:
                SendCommandResult(message, false, "unsupported-command", $"不支持的命令：{message.type}");
                break;
        }
    }

    /// <summary>由测试物体点击组件调用，模拟未来三维设备点击后向低代码平台回传设备编码。</summary>
    public void ReportObjectClick(string deviceCode, string deviceName)
    {
        StatusText = $"已点击对象：{deviceName}";
        SendToParent("object-click", new BridgePayload { deviceCode = deviceCode, deviceName = deviceName });
    }

    /// <summary>由真实厂区对象点击交互调用，向父页面回传稳定业务节点 ID。</summary>
    public void ReportObjectSelected(string nodeId, string nodeName)
    {
        StatusText = $"已选择对象：{nodeName}";
        SendToParent("objectSelected", new BridgePayload
        {
            nodeId = nodeId,
            nodeName = nodeName,
            sceneState = _processController != null ? _processController.GetStateDescription() : string.Empty
        });
    }

    private void HandleInitialize(BridgeMessage message)
    {
        StatusText = "已完成父页面初始化。";
        TryBindProcessController();
        SendToParent("ack", new BridgePayload
        {
            requestId = message.messageId,
            message = "Unity 已完成初始化",
            sceneState = _processController != null ? _processController.GetStateDescription() : string.Empty
        });
    }

    private void HandleEnterProcessStep(BridgeMessage message)
    {
        if (!TryGetProcessController(message, out PowerPlantProcessController controller))
        {
            return;
        }

        BridgePayload payload = message.payload;
        string processId = string.IsNullOrWhiteSpace(payload?.processId) ? "gas-power-generation" : payload.processId;
        string stepId = payload?.stepId;
        string unitId = payload?.unitId;
        bool isolate = payload == null || payload.isolate;
        bool success = controller.TryEnterProcessStep(processId, stepId, unitId, isolate, out string resultMessage);
        StatusText = resultMessage;
        SendCommandResult(message, success, success ? string.Empty : "invalid-process-step", resultMessage);
    }

    private void HandleResetScene(BridgeMessage message)
    {
        if (!TryGetProcessController(message, out PowerPlantProcessController controller))
        {
            return;
        }

        bool success = controller.TryResetScene(out string resultMessage);
        StatusText = resultMessage;
        SendCommandResult(message, success, success ? string.Empty : "reset-failed", resultMessage);
    }

    private void HandleFocusNode(BridgeMessage message)
    {
        if (!TryGetProcessController(message, out PowerPlantProcessController controller))
        {
            return;
        }

        BridgePayload payload = message.payload;
        bool success = controller.TryFocusNode(payload?.nodeId, payload != null && payload.isolate, out string resultMessage);
        StatusText = resultMessage;
        SendCommandResult(message, success, success ? string.Empty : "invalid-node", resultMessage);
    }

    private void HandleSetNodeVisibility(BridgeMessage message)
    {
        if (!TryGetProcessController(message, out PowerPlantProcessController controller))
        {
            return;
        }

        BridgePayload payload = message.payload;
        bool success = controller.TrySetNodeVisibility(payload?.nodeId, payload != null && payload.enabled, out string resultMessage);
        StatusText = resultMessage;
        SendCommandResult(message, success, success ? string.Empty : "invalid-node", resultMessage);
    }

    private void HandleSetRouteFlow(BridgeMessage message)
    {
        if (!TryGetProcessController(message, out PowerPlantProcessController controller))
        {
            return;
        }

        BridgePayload payload = message.payload;
        float speed = payload != null && !Mathf.Approximately(payload.speed, 0f) ? payload.speed : 1f;
        bool success = controller.TrySetRouteFlow(payload?.routeId, payload != null && payload.enabled, speed, out string resultMessage);
        StatusText = resultMessage;
        SendCommandResult(message, success, success ? string.Empty : "invalid-route", resultMessage);
    }

    private bool TryGetProcessController(BridgeMessage message, out PowerPlantProcessController controller)
    {
        TryBindProcessController();
        controller = _processController;
        if (controller != null)
        {
            return true;
        }

        StatusText = "场景流程控制器尚未配置。";
        SendCommandResult(message, false, "controller-unavailable", StatusText);
        return false;
    }

    private void SendCommandResult(BridgeMessage command, bool success, string errorCode, string resultMessage)
    {
        SendToParent("commandResult", new BridgePayload
        {
            requestId = command.messageId,
            message = resultMessage,
            errorCode = errorCode,
            sceneState = _processController != null ? _processController.GetStateDescription() : string.Empty
        });
    }

    private void HandleTestCommand(BridgePayload payload)
    {
        string text = payload?.text ?? string.Empty;
        StatusText = $"收到平台消息：{text}";

        // 改变测试立方体颜色，以便在 WebGL 页面中直观看到消息被 Unity 成功处理。
        if (_testObjectRenderer != null)
        {
            _testObjectRenderer.material.color = new Color(0.15f, 0.75f, 0.95f, 1f);
        }

        SendToParent("test-result", new BridgePayload { message = $"Unity 已执行测试指令：{text}" });
    }

    private void SendToParent(string type, BridgePayload payload)
    {
        BridgeMessage message = new BridgeMessage
        {
            channel = ProtocolChannel,
            version = ProtocolVersion,
            instanceId = _instanceId,
            messageId = $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid():N}",
            type = type,
            payload = payload,
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };

        string messageJson = JsonUtility.ToJson(message);
#if UNITY_WEBGL && !UNITY_EDITOR
        Power3dUnityBridge_SendToParent(messageJson);
#else
        Debug.Log($"[UnityIframeBridge] 模拟回传：{messageJson}");
#endif
    }

    /// <summary>
    /// 仅在初始化阶段查找一次测试立方体并缓存其渲染器。
    /// 后续消息处理只使用缓存引用，避免每条跨窗口消息都触发层级查询。
    /// </summary>
    private void TryBindTestObjectRenderer()
    {
        if (_testObjectRenderer != null)
        {
            return;
        }

        GameObject testObject = GameObject.Find("IframeTestCube");
        _testObjectRenderer = testObject != null ? testObject.GetComponent<Renderer>() : null;
    }

    private void TryBindProcessController()
    {
        if (_processController == null)
        {
            _processController = FindFirstObjectByType<PowerPlantProcessController>();
        }
    }

    private static string ReadQueryParameter(string key, string fallbackValue)
    {
        string url = Application.absoluteURL;
        if (string.IsNullOrWhiteSpace(url))
        {
            return fallbackValue;
        }

        string marker = $"{key}=";
        int startIndex = url.IndexOf(marker, StringComparison.Ordinal);
        if (startIndex < 0)
        {
            return fallbackValue;
        }

        startIndex += marker.Length;
        int endIndex = url.IndexOf('&', startIndex);
        string value = endIndex < 0 ? url.Substring(startIndex) : url.Substring(startIndex, endIndex - startIndex);
        return string.IsNullOrWhiteSpace(value) ? fallbackValue : Uri.UnescapeDataString(value);
    }

    private void OnGUI()
    {
        // 正式包不呈现测试面板，开发阶段保留状态提示以方便 iframe 联调。
#if UNITY_EDITOR || DEVELOPMENT_BUILD
        GUI.Box(new Rect(12, 12, 500, 64), $"Unity iframe 通信测试\n{StatusText}");
#endif
    }
}

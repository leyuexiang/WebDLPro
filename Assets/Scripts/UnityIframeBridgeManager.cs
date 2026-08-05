using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// Unity 与父页面 iframe 容器之间的通信管理器。
/// WebGL 运行时通过 .jslib 浏览器桥接层收发消息；编辑器与非 WebGL 平台仅输出日志，
/// 这样可以在打包前安全检查脚本、场景与点击交互。
/// </summary>
public sealed class UnityIframeBridgeManager : MonoBehaviour
{
    private const string ProtocolChannel = "power3d-unity";
    private const int ProtocolVersion = 1;
    private const int MaxTrackedSceneRequests = 64;
    private const string LocalSceneMappingVersion = "unpublished";

    /// <summary>供测试立方体点击组件调用的当前通信管理器实例。</summary>
    public static UnityIframeBridgeManager Instance { get; private set; }

    /// <summary>测试指令与尺寸消息会显示在这里，便于无需 UI 资源即可验证通信。</summary>
    public string StatusText { get; private set; } = "等待父页面初始化…";

    /// <summary>当前已激活业务控制器的只读引用；跨场景时仅由协调器事件更新，禁止按对象名称重新查询。</summary>
    public IBusinessSceneController CurrentSceneController => _sceneController;

    /// <summary>浏览器桥接初始化次数。一个常驻 Unity 实例的该值只能是 1。</summary>
    public int BrowserBridgeInitializationCount { get; private set; }

    /// <summary>当前协调器订阅数只能是零或一；重复场景切换不得叠加回调。</summary>
    public int SceneCoordinatorSubscriptionCount => _sceneCoordinatorSubscribed ? 1 : 0;

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
    // 场景映射版本由受控 iframe 入口参数传入；switchScene 必须与当前运行时握手的映射一致。
    private string _sceneMappingVersion = LocalSceneMappingVersion;
    private IBusinessSceneController _sceneController;
    private MultiSceneCoordinator _sceneCoordinator;
    // 保留实际订阅对象，确保协调器被销毁或替换时先解除旧委托，避免新协调器因标志残留而未绑定。
    private MultiSceneCoordinator _subscribedSceneCoordinator;
    private bool _sceneCoordinatorSubscribed;
    // 桥接器可由兜底引导器先于 Bootstrap 创建；订阅场景加载事件后，正式启动壳出现时只重绑一次，
    // 不需要在 Update 中持续查询协调器或每帧分配查找结果。
    private bool _sceneLoadedSubscribed;
    private bool _releaseRequested;
    private bool _browserBridgeInitialized;
    // 仅保存正在执行的 transitionId → 原始 requestId，容量与前端待确认表一致，避免异步回调失去来源关联或无界增长。
    private readonly Dictionary<string, string> _sceneRequestIdsByTransition = new Dictionary<string, string>(StringComparer.Ordinal);

#if UNITY_WEBGL && !UNITY_EDITOR
    /// <summary>初始化浏览器消息监听器，并让其在 Unity 可接收消息后发送 ready。</summary>
    [DllImport("__Internal")]
    private static extern void Power3dUnityBridge_Initialize(string gameObjectName, string instanceId);

    /// <summary>将 Unity 生成的 JSON 消息交给浏览器桥接层并转发至父页面。</summary>
    [DllImport("__Internal")]
    private static extern void Power3dUnityBridge_SendToParent(string messageJson);

    /// <summary>
    /// 在发送 disposed 回执后调用浏览器桥接层释放 Unity WebGL 实例。
    /// 浏览器桥接层内部具有幂等保护并会移除 message 监听器，避免重复释放产生异常。
    /// </summary>
    [DllImport("__Internal")]
    private static extern void Power3dUnityBridge_Release();
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
        // sceneNodeId 是 Unity 场景映射中的稳定三维节点标识；nodeId 只兼容旧对象选择回传，
        // 新的聚焦、状态和显隐命令禁止将二维拓扑标识隐式复用为三维节点标识。
        public string sceneNodeId;
        public string nodeName;
        public string routeId;
        public string visualState;
        public string errorCode;
        public string sceneState;
        public string sceneId;
        public string transitionId;
        public string sceneMappingVersion;
        public string stageCode;
        public bool success;
        public bool isolate;
        public bool enabled;
        public float width;
        public float height;
        public float progress;
    }

    private void Awake()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        // 左侧平台控件被点击后，iframe 中的 Unity 画布会暂时失去焦点。
        // 保持 WebGL 运行循环可用，确保父页面的 postMessage 指令能立即更新三维画面，
        // 而不需要用户再次点击画布来恢复渲染。
        Application.runInBackground = true;
#endif

        // 业务场景可能仍序列化旧桥接组件；重复时只销毁本组件，不能 Destroy(gameObject)，
        // 否则会连带销毁同一根对象上的燃气控制器、测试面板和用户正在编辑的场景资源。
        if (Instance != null && Instance != this)
        {
            Destroy(this);
            return;
        }

        Instance = this;
        DontDestroyOnLoad(gameObject);
        _instanceId = ReadQueryParameter("instanceId", _instanceId);
        _sceneMappingVersion = ReadQueryParameter("sceneMappingVersion", _sceneMappingVersion);

        TryBindTestObjectRenderer();
        SubscribeSceneLoaded();
        TryBindSceneController();
    }

    private void Start()
    {
        // Start 在场景全部 Awake 完成后执行；再次尝试绑定可规避根对象先于子对象初始化的顺序差异。
        TryBindTestObjectRenderer();
        TryBindSceneController();
        if (_testObjectRenderer != null)
        {
            _testObjectRenderer.material.color = new Color(1f, 0.45f, 0.76f, 1f);
        }

        EnsureBrowserBridgeInitialized();
    }

    /// <summary>
    /// 常驻桥接器在生命周期内只允许初始化浏览器监听一次。场景切换只重绑控制器，
    /// 绝不再次注册 window.message 监听器或创建第二个 Unity WebGL 实例。
    /// </summary>
    private void EnsureBrowserBridgeInitialized()
    {
        if (_browserBridgeInitialized)
        {
            return;
        }

        _browserBridgeInitialized = true;
        BrowserBridgeInitializationCount++;
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

        // 释放已开始后不再执行任何场景命令；重复 dispose 仍返回成功回执，保证调用端可安全重试。
        if (_releaseRequested)
        {
            if (message.type == "dispose")
            {
                SendDisposed(message, true, "Unity 实例已进入释放流程。");
            }
            else
            {
                SendCommandResult(message, false, "runtime-releasing", "Unity 实例正在释放，无法执行场景命令。");
            }
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
                // 统一通过处理器回填原始请求标识，避免父页面保留无界待确认项。
                HandleResize(message);
                break;
            case "switchScene":
                HandleSwitchScene(message);
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
            case "setNodeVisualState":
                HandleSetNodeVisualState(message);
                break;
            case "setRouteFlow":
                HandleSetRouteFlow(message);
                break;
            case "setNodeVisibility":
                HandleSetNodeVisibility(message);
                break;
            case "dispose":
                HandleDispose(message);
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
        // 释放流程开始后不再产生场景回调，避免已卸载父页面收到迟到的选中事件。
        if (_releaseRequested)
        {
            return;
        }
        StatusText = $"已选择对象：{nodeName}";
        SendToParent("objectSelected", new BridgePayload
        {
            nodeId = nodeId,
            nodeName = nodeName,
            sceneState = GetSceneStateDescription()
        });
    }

    private void HandleInitialize(BridgeMessage message)
    {
        StatusText = "已完成父页面初始化。";
        TryBindSceneController();
        SendToParent("ack", new BridgePayload
        {
            // init 的 ack 必须明确成功，否则父页面会将默认 false 判为握手失败。
            success = true,
            requestId = message.messageId,
            message = "Unity 已完成初始化",
            sceneState = GetSceneStateDescription()
        });
    }

    /// <summary>
    /// 尺寸命令不直接修改固定画布样式；Unity WebGL 运行时会依据容器 CSS 尺寸重建渲染目标。
    /// 此处仅记录结果并回填原始请求标识，让父页面能及时清理待确认表。
    /// </summary>
    private void HandleResize(BridgeMessage message)
    {
        BridgePayload payload = message.payload;
        StatusText = $"已同步场景容器尺寸：{payload?.width ?? 0f} × {payload?.height ?? 0f}";
        SendCommandResult(message, true, string.Empty, StatusText);
    }

    /// <summary>
    /// 接收受控 iframe 的场景切换请求。请求确认只表示协调器已接管事务，不能替代最终 sceneChanged；
    /// 最终成功与失败分别由场景完成事件和结构化 commandResult 回填同一原始 requestId。
    /// </summary>
    private void HandleSwitchScene(BridgeMessage message)
    {
        BridgePayload payload = message.payload;
        SceneSwitchCommandPayload switchPayload = new SceneSwitchCommandPayload
        {
            sceneId = payload?.sceneId,
            transitionId = payload?.transitionId,
            sceneMappingVersion = payload?.sceneMappingVersion
        };
        if (!SceneSwitchProtocolValidator.IsBoundedIdentifier(switchPayload.sceneId) ||
            !SceneSwitchProtocolValidator.IsBoundedIdentifier(switchPayload.transitionId) ||
            !SceneSwitchProtocolValidator.IsBoundedIdentifier(switchPayload.sceneMappingVersion))
        {
            SendCommandResult(message, false, "scene-switch-payload-invalid", "场景切换缺少合法场景标识、事务标识或映射版本。");
            return;
        }
        if (!SceneSwitchProtocolValidator.IsValidCommand(switchPayload, _sceneMappingVersion))
        {
            SendCommandResult(message, false, "scene-mapping-version-mismatch", "场景映射版本与当前 Unity 运行时不一致。");
            return;
        }

        TryBindSceneController();
        if (_sceneCoordinator == null)
        {
            SendCommandResult(message, false, "scene-coordinator-unavailable", "多场景协调器尚未就绪，无法切换业务场景。");
            return;
        }
        if (_sceneRequestIdsByTransition.ContainsKey(switchPayload.transitionId))
        {
            SendCommandResult(message, false, "transition-duplicate", "同一场景切换事务已在处理中。");
            return;
        }
        if (_sceneRequestIdsByTransition.Count >= MaxTrackedSceneRequests)
        {
            SendCommandResult(message, false, "scene-request-capacity", "场景切换待确认请求已达到安全上限。");
            return;
        }

        // 先登记原始 requestId：协调器对未知场景会同步回调失败，必须让该回调也能精确关联请求。
        _sceneRequestIdsByTransition.Add(switchPayload.transitionId, message.messageId);
        bool accepted = _sceneCoordinator.RequestSwitchScene(switchPayload.sceneId, switchPayload.transitionId);
        if (!accepted)
        {
            // 即时失败回调已删除登记项；若底层在未回调的异常路径返回 false，主动清理避免泄漏。
            _sceneRequestIdsByTransition.Remove(switchPayload.transitionId);
            return;
        }

        StatusText = $"已接收场景切换请求：{switchPayload.sceneId}。";
        SendToParent("ack", new BridgePayload
        {
            requestId = message.messageId,
            success = true,
            message = "Unity 已接收场景切换请求，正在异步加载。",
            sceneId = switchPayload.sceneId,
            transitionId = switchPayload.transitionId,
            sceneState = GetSceneStateDescription()
        });
    }

    /// <summary>
    /// 先以 disposed 回填 dispose 原始 messageId，再请求浏览器桥接层退出 Unity 实例。
    /// 这样父页面可确认远端已接收释放命令；重复调用由 _releaseRequested 和桥接层双重幂等保护。
    /// </summary>
    private void HandleDispose(BridgeMessage message)
    {
        _releaseRequested = true;
        UnsubscribeSceneLoaded();
        _sceneCoordinator?.DisposeRuntime();
        UnsubscribeFromSceneCoordinator();
        _sceneController = null;
        // 释放期间的协调器回调不会再发向已释放父页面，立即清理映射避免保留旧 requestId。
        _sceneRequestIdsByTransition.Clear();
        if (_sceneCoordinator == null)
        {
            // 兼容直接打开旧 SampleScene 的本地联调；正式 Bootstrap 路径由协调器统一释放活动控制器。
            _sceneController?.ReleaseScene();
        }
        StatusText = "Unity 实例正在释放。";
        SendDisposed(message, true, StatusText);

#if UNITY_WEBGL && !UNITY_EDITOR
        Power3dUnityBridge_Release();
#else
        Debug.Log("[UnityIframeBridge] 编辑器测试模式已完成模拟释放。");
#endif
    }

    /// <summary>
    /// disposed 是释放命令的最终回执，requestId 始终回填原始 dispose 消息标识。
    /// 即使重复释放也会返回成功状态，避免父页面因网络重试而进入异常分支。
    /// </summary>
    private void SendDisposed(BridgeMessage command, bool success, string resultMessage)
    {
        SendToParent("disposed", new BridgePayload
        {
            requestId = command.messageId,
            success = success,
            message = resultMessage,
            sceneState = GetSceneStateDescription()
        });
    }

    private void HandleEnterProcessStep(BridgeMessage message)
    {
        BridgePayload payload = message.payload;
        string processId = payload?.processId;
        string stepId = payload?.stepId;
        string unitId = payload?.unitId;
        if (!SceneActionProtocolValidator.IsValidProcessStep(processId, stepId, unitId))
        {
            SendCommandResult(message, false, "process-step-payload-invalid", "流程命令缺少合法流程、步骤或机组标识。");
            return;
        }
        if (!TryGetSceneController(message, BusinessSceneCapability.EnterProcessStep, out IBusinessSceneController controller))
        {
            return;
        }
        bool isolate = payload == null || payload.isolate;
        BusinessSceneCommandResult result = controller.EnterProcessStep(processId, stepId, unitId, isolate);
        SendSceneCommandResult(message, result);
    }

    private void HandleResetScene(BridgeMessage message)
    {
        if (!TryGetSceneController(message, BusinessSceneCapability.ResetScene, out IBusinessSceneController controller))
        {
            return;
        }

        SendSceneCommandResult(message, controller.ResetScene());
    }

    private void HandleFocusNode(BridgeMessage message)
    {
        BridgePayload payload = message.payload;
        if (!SceneActionProtocolValidator.IsValidSceneNodeId(payload?.sceneNodeId))
        {
            SendCommandResult(message, false, "scene-node-payload-invalid", "聚焦命令缺少合法三维节点标识。");
            return;
        }
        if (!TryGetSceneController(message, BusinessSceneCapability.FocusNode, out IBusinessSceneController controller))
        {
            return;
        }
        SendSceneCommandResult(message, controller.FocusNode(payload.sceneNodeId, payload.isolate));
    }

    /// <summary>
    /// 四态视觉命令只把已解析的稳定节点标识和固定枚举交给当前控制器。
    /// 控制器自行复用材质或材质属性块；桥接绝不接收颜色、材质名或任意渲染对象引用。
    /// </summary>
    private void HandleSetNodeVisualState(BridgeMessage message)
    {
        BridgePayload payload = message.payload;
        if (!SceneActionProtocolValidator.IsValidSceneNodeId(payload?.sceneNodeId) ||
            !SceneActionProtocolValidator.TryParseVisualState(payload?.visualState, out BusinessSceneNodeVisualState visualState))
        {
            SendCommandResult(message, false, "node-visual-state-payload-invalid", "设备状态命令缺少合法三维节点标识或固定四态状态。");
            return;
        }
        if (!TryGetSceneController(message, BusinessSceneCapability.UpdateNodeVisualState, out IBusinessSceneController controller))
        {
            return;
        }

        SendSceneCommandResult(message, controller.UpdateNodeVisualState(payload.sceneNodeId, visualState));
    }

    /// <summary>
    /// 路径流动只接受路径标识和开关。速度统一由场景自身配置为基线值，
    /// 防止网页端通过高频或极端倍速参数造成不可控的动画和资源开销。
    /// </summary>
    private void HandleSetRouteFlow(BridgeMessage message)
    {
        BridgePayload payload = message.payload;
        if (!SceneActionProtocolValidator.IsValidRouteId(payload?.routeId))
        {
            SendCommandResult(message, false, "route-payload-invalid", "路径命令缺少合法路径标识。");
            return;
        }
        if (!TryGetSceneController(message, BusinessSceneCapability.SetRouteFlow, out IBusinessSceneController controller))
        {
            return;
        }

        SendSceneCommandResult(message, controller.SetRouteFlow(payload.routeId, payload.enabled, 1f));
    }

    private void HandleSetNodeVisibility(BridgeMessage message)
    {
        BridgePayload payload = message.payload;
        if (!SceneActionProtocolValidator.IsValidSceneNodeId(payload?.sceneNodeId))
        {
            SendCommandResult(message, false, "scene-node-payload-invalid", "显隐命令缺少合法三维节点标识。");
            return;
        }
        if (!TryGetSceneController(message, BusinessSceneCapability.SetNodeVisibility, out IBusinessSceneController controller))
        {
            return;
        }
        SendSceneCommandResult(message, controller.SetNodeVisibility(payload.sceneNodeId, payload.enabled));
    }

    /// <summary>命令只能进入当前活动统一控制器；未声明能力时返回结构化错误，禁止静默空执行。</summary>
    private bool TryGetSceneController(
        BridgeMessage message,
        BusinessSceneCapability requiredCapability,
        out IBusinessSceneController controller)
    {
        TryBindSceneController();
        controller = _sceneController;
        if (controller == null)
        {
            StatusText = "当前没有已初始化的业务场景控制器。";
            SendCommandResult(message, false, "controller-unavailable", StatusText);
            return false;
        }
        if ((controller.Capabilities & requiredCapability) != requiredCapability)
        {
            StatusText = $"当前业务场景未声明能力：{requiredCapability}。";
            SendCommandResult(message, false, "capability-unsupported", StatusText);
            controller = null;
            return false;
        }

        return true;
    }

    private void SendSceneCommandResult(BridgeMessage message, BusinessSceneCommandResult result)
    {
        StatusText = result.Message;
        SendCommandResult(message, result.Success, result.ErrorCode, result.Message);
    }

    private void SendCommandResult(BridgeMessage command, bool success, string errorCode, string resultMessage)
    {
        SendCommandResult(
            command.messageId,
            success,
            errorCode,
            resultMessage,
            command.payload?.sceneId,
            command.payload?.transitionId);
    }

    /// <summary>
    /// 场景协调器的异步结果没有原始 BridgeMessage 实例，因此按已登记 requestId 回传。
    /// sceneId 与 transitionId 仅用于请求关联，绝不包含 Unity 层级路径、资源地址或异常对象。
    /// </summary>
    private void SendCommandResult(
        string requestId,
        bool success,
        string errorCode,
        string resultMessage,
        string sceneId = null,
        string transitionId = null)
    {
        SendToParent("commandResult", new BridgePayload
        {
            requestId = requestId,
            // commandResult 与原始 messageId 一一对应；success 供父页面结束待确认记录。
            success = success,
            message = resultMessage,
            errorCode = errorCode,
            sceneId = sceneId,
            transitionId = transitionId,
            sceneState = GetSceneStateDescription()
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

    /// <summary>
    /// 正式路径只从 MultiSceneCoordinator 取得活动控制器；直接打开旧 SampleScene 时，
    /// 兼容注册表按实际控制器组件解析一次，不根据场景文件名或对象显示名称猜测身份。
    /// </summary>
    private void TryBindSceneController()
    {
        MultiSceneCoordinator discoveredCoordinator = MultiSceneCoordinator.Instance ?? GetComponent<MultiSceneCoordinator>();
        if (!ReferenceEquals(_sceneCoordinator, discoveredCoordinator))
        {
            UnsubscribeFromSceneCoordinator();
            _sceneCoordinator = discoveredCoordinator;
        }
        if (_sceneCoordinator != null)
        {
            if (!_sceneCoordinatorSubscribed)
            {
                _sceneCoordinator.ActiveControllerChanged += HandleActiveControllerChanged;
                _sceneCoordinator.SceneLoadProgress += HandleSceneLoadProgress;
                _sceneCoordinator.SceneSwitchCompleted += HandleSceneSwitchCompleted;
                _subscribedSceneCoordinator = _sceneCoordinator;
                _sceneCoordinatorSubscribed = true;
            }
            _sceneController = _sceneCoordinator.ActiveController;
            return;
        }
        if (_sceneController == null)
        {
            BusinessSceneControllerRegistry.TryResolveLegacyLoadedScene(
                SceneManager.GetActiveScene(),
                out _sceneController,
                out _);
        }
    }

    /// <summary>
    /// 常驻桥接器不依赖 Bootstrap 与兜底对象的脚本执行顺序。仅在场景加载时尝试重绑：
    /// 正式协调器在场景 Awake 阶段完成单例注册后即可被取得，同时避免 Update 轮询造成无意义查询。
    /// </summary>
    private void SubscribeSceneLoaded()
    {
        if (_sceneLoadedSubscribed)
        {
            return;
        }

        SceneManager.sceneLoaded += HandleSceneLoaded;
        _sceneLoadedSubscribed = true;
    }

    /// <summary>
    /// 释放与销毁时均会调用。重复调用安全，确保父页面退出后不再由后续场景加载触发桥接重绑。
    /// </summary>
    private void UnsubscribeSceneLoaded()
    {
        if (!_sceneLoadedSubscribed)
        {
            return;
        }

        SceneManager.sceneLoaded -= HandleSceneLoaded;
        _sceneLoadedSubscribed = false;
    }

    /// <summary>
    /// 新场景可能承载正式 Bootstrap 协调器，也可能只是业务场景。桥接器始终优先保留已发现的协调器，
    /// 仅在未释放状态下重绑，避免释放后的延迟加载再次恢复任何 Unity 到浏览器回调。
    /// </summary>
    private void HandleSceneLoaded(Scene loadedScene, LoadSceneMode loadMode)
    {
        if (_releaseRequested)
        {
            return;
        }

        TryBindSceneController();
    }

    private void HandleActiveControllerChanged(IBusinessSceneController controller)
    {
        _sceneController = controller;
    }

    /// <summary>
    /// 仅转发当前仍被 requestId 映射跟踪的进度，且再次验证有限阶段和归一化范围。
    /// 协调器已经过滤旧事务；桥接层仍保留本次校验，防止未来实现绕过协调器时向前端发送非法进度。
    /// </summary>
    private void HandleSceneLoadProgress(SceneSwitchProgress progress)
    {
        if (_releaseRequested || !_sceneRequestIdsByTransition.TryGetValue(progress.TransitionId, out string requestId))
        {
            return;
        }

        SceneLoadProgressPayload progressPayload = new SceneLoadProgressPayload
        {
            requestId = requestId,
            sceneId = progress.SceneId,
            transitionId = progress.TransitionId,
            stageCode = progress.StageCode,
            progress = progress.Progress
        };
        if (!SceneSwitchProtocolValidator.IsValidProgress(progressPayload))
        {
            return;
        }

        SendToParent("sceneLoadProgress", new BridgePayload
        {
            requestId = progressPayload.requestId,
            sceneId = progressPayload.sceneId,
            transitionId = progressPayload.transitionId,
            stageCode = progressPayload.stageCode,
            progress = progressPayload.progress
        });
    }

    /// <summary>
    /// 场景最终结果按 transitionId 找回原请求。成功只发送 sceneChanged；失败使用 commandResult，
    /// 这样前端不会把失败切换误当成已完成场景，也能在快速切换时分别关联被取代的旧请求。
    /// </summary>
    private void HandleSceneSwitchCompleted(SceneSwitchResult result)
    {
        if (!_sceneRequestIdsByTransition.TryGetValue(result.TransitionId, out string requestId))
        {
            return;
        }

        _sceneRequestIdsByTransition.Remove(result.TransitionId);
        if (_releaseRequested)
        {
            return;
        }
        if (result.Success)
        {
            StatusText = result.Message;
            SceneChangedPayload changedPayload = new SceneChangedPayload
            {
                requestId = requestId,
                sceneId = result.SceneId,
                transitionId = result.TransitionId,
                success = true,
                sceneState = GetSceneStateDescription()
            };
            if (!SceneSwitchProtocolValidator.IsValidChanged(changedPayload))
            {
                return;
            }
            SendToParent("sceneChanged", new BridgePayload
            {
                requestId = changedPayload.requestId,
                sceneId = changedPayload.sceneId,
                transitionId = changedPayload.transitionId,
                success = changedPayload.success,
                sceneState = changedPayload.sceneState
            });
            return;
        }

        StatusText = result.Message;
        SendCommandResult(
            requestId,
            false,
            string.IsNullOrWhiteSpace(result.ErrorCode) ? "scene-switch-failed" : result.ErrorCode,
            result.Message,
            result.SceneId,
            result.TransitionId);
    }

    private string GetSceneStateDescription()
    {
        return _sceneController != null ? _sceneController.GetStateDescription() : string.Empty;
    }

    private void OnDestroy()
    {
        UnsubscribeSceneLoaded();
        UnsubscribeFromSceneCoordinator();
        _sceneRequestIdsByTransition.Clear();
        if (Instance == this)
        {
            Instance = null;
        }
    }

    /// <summary>
    /// 对协调器的三个事件统一解除订阅。方法可重复调用；保存订阅对象而非仅使用当前查找结果，
    /// 避免协调器重建后旧委托保留桥接器，或订阅标志阻止新协调器完成重绑。
    /// </summary>
    private void UnsubscribeFromSceneCoordinator()
    {
        if (_sceneCoordinatorSubscribed && !ReferenceEquals(_subscribedSceneCoordinator, null))
        {
            _subscribedSceneCoordinator.ActiveControllerChanged -= HandleActiveControllerChanged;
            _subscribedSceneCoordinator.SceneLoadProgress -= HandleSceneLoadProgress;
            _subscribedSceneCoordinator.SceneSwitchCompleted -= HandleSceneSwitchCompleted;
        }
        _subscribedSceneCoordinator = null;
        _sceneCoordinatorSubscribed = false;
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

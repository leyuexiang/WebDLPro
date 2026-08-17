using System;
using System.Collections.Generic;
using System.Globalization;
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
    private const int MaxTrackedSceneRequests = 64;
    private const int MaxTrackedFocusSelections = 64;
    // 与前端设备状态缓存默认上限一致；容量固定后，每次查找和更新均为常数时间且不会无界保留节点标识。
    private const int MaxTrackedNodeVisualStates = 500;
    // JavaScript 可无损表达的最大整数；来源修订号超过该边界会在浏览器与 C# 之间产生精度歧义，必须拒绝。
    private const long MaxJavaScriptSafeInteger = 9007199254740991L;
    private const string LocalSceneMappingVersion = "unpublished";

    /// <summary>
    /// 当前物理场景中单个三维节点最近成功应用的壳内快照序号。
    /// 使用值类型避免最多五百项状态索引为每次更新分配托管对象；平台时间与来源修订不参与比较。
    /// </summary>
    private readonly struct NodeVisualStateWatermark
    {
        public long SnapshotSequence { get; }

        public NodeVisualStateWatermark(long snapshotSequence)
        {
            SnapshotSequence = snapshotSequence;
        }
    }

    /// <summary>供测试立方体点击组件调用的当前通信管理器实例。</summary>
    public static UnityIframeBridgeManager Instance { get; private set; }

    /// <summary>
    /// 最近一次有限状态摘要，仅供编辑器测试面板和自动化断言读取。
    /// WebGL 不再在画面上绘制该文本；状态变化通过 Debug 日志进入浏览器开发者工具控制台。
    /// </summary>
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
    // 聚焦选择以队列保存淘汰顺序、以哈希集合提供常数时间查重；容量固定，避免长期运行时历史无界增长。
    private readonly Queue<string> _recentFocusSelectionIds = new Queue<string>();
    private readonly HashSet<string> _recentFocusSelectionIdSet = new HashSet<string>(StringComparer.Ordinal);
    // 水位只属于当前活动控制器。只有壳会话内快照序号可阻止异步迟到状态覆盖，平台字段仅供诊断。
    private readonly Dictionary<string, NodeVisualStateWatermark> _nodeVisualStateWatermarks =
        new Dictionary<string, NodeVisualStateWatermark>(StringComparer.Ordinal);

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

    /// <summary>
    /// 对象选择上行只允许场景、三维节点和物理激活标识三个业务字段。
    /// 独立模型避免 JsonUtility 把通用负载中的空 nodeName、nodeId 或命令开关序列化后触发前端严格字段拒绝。
    /// </summary>
    [Serializable]
    private sealed class ObjectSelectedBridgePayload
    {
        public string sceneId;
        public string sceneNodeId;
        public string sceneActivationId;
    }

    /// <summary>对象选择专用信封保持与通用协议相同的来源关联字段，但负载使用最小白名单模型。</summary>
    [Serializable]
    private sealed class ObjectSelectedBridgeMessage
    {
        public string channel;
        public int version;
        public string instanceId;
        public string messageId;
        public string type;
        public ObjectSelectedBridgePayload payload;
        public long timestamp;
    }

    /// <summary>
    /// 初始化确认和释放确认的最小上行负载。
    /// JsonUtility（Unity 内置 JSON 序列化工具）会把通用对象的未赋值字段写入 JSON；
    /// 因此确认消息不能复用含 sceneActivationId（物理场景激活标识）的通用 BridgePayload，
    /// 否则空字符串会越过协议边界并被前端正确拒绝。
    /// </summary>
    [Serializable]
    private sealed class RequestAcknowledgementBridgePayload
    {
        public string requestId;
        public bool success;
        public string message;
        public string sceneState;
    }

    /// <summary>确认专用信封只包含协议允许的最小载荷，防止未使用字段污染 ack 或 disposed 消息。</summary>
    [Serializable]
    private sealed class RequestAcknowledgementBridgeMessage
    {
        public string channel;
        public int version;
        public string instanceId;
        public string messageId;
        public string type;
        public RequestAcknowledgementBridgePayload payload;
        public long timestamp;
    }

    /// <summary>
    /// 常规命令结果不声明 sceneActivationId。
    /// 该字段只属于“场景失败但旧场景已自动恢复”的特殊结果，普通命令、初始化和未恢复的失败都不能发送空占位。
    /// </summary>
    [Serializable]
    private sealed class CommandResultBridgePayload
    {
        public string requestId;
        public bool success;
        public string message;
        public string errorCode;
        public string sceneId;
        public string transitionId;
        public string sceneState;
    }

    /// <summary>常规命令结果使用独立信封，确保可选恢复标识未被 JsonUtility 自动写入。</summary>
    [Serializable]
    private sealed class CommandResultBridgeMessage
    {
        public string channel;
        public int version;
        public string instanceId;
        public string messageId;
        public string type;
        public CommandResultBridgePayload payload;
        public long timestamp;
    }

    /// <summary>失败恢复结果只在已有非空恢复实例标识时采用该专用负载。</summary>
    [Serializable]
    private sealed class RecoveredCommandResultBridgePayload
    {
        public string requestId;
        public bool success;
        public string message;
        public string errorCode;
        public string sceneId;
        public string transitionId;
        public string sceneState;
        public string sceneActivationId;
    }

    /// <summary>恢复场景结果专用信封保证 sceneActivationId 只出现在协议允许的异常恢复分支。</summary>
    [Serializable]
    private sealed class RecoveredCommandResultBridgeMessage
    {
        public string channel;
        public int version;
        public string instanceId;
        public string messageId;
        public string type;
        public RecoveredCommandResultBridgePayload payload;
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
        // sceneNodeId 是 Unity 场景映射中的稳定三维节点标识；nodeId 仅用于下行旧命令兼容，
        // objectSelected 上行事件必须只写入 sceneNodeId，禁止将二维拓扑标识隐式复用为三维节点标识。
        public string sceneNodeId;
        // sceneActivationId 是 MultiSceneCoordinator 真实提交场景实例时生成的标识；
        // 它不同于 transitionId，用于网页端阻断“场景 A → B → 场景 A”里的首个 A 迟到对象选择。
        public string sceneActivationId;
        // selectionId 只关联一次二维选择到三维聚焦；它不同于信封 messageId 和场景切换 transitionId，
        // Unity 使用该字段幂等处理浏览器重发，避免相机动画与描边被重复触发。
        public string selectionId;
        public string nodeName;
        public string routeId;
        public string visualState;
        // 本地快照序号从一开始单调递增，是三维迟到隔离的唯一依据；零表示旧协议或字段缺失，必须拒绝。
        public long snapshotSequence;
        // 状态来源时间由前端从已校验外层协议规范化后透传，仅用于诊断，不参与覆盖排序。
        public string statusUpdatedAt;
        // 平台来源修订号必填但只作诊断；服务重启后可以变小，不能用它拒绝后到合法快照。
        public long sourceRevision;
        public string errorCode;
        public string sceneState;
        public string sceneId;
        public string transitionId;
        public string sceneMappingVersion;
        // 必填布尔字段由网页端显式发送；缺省 false 仅用于 JsonUtility 初始化，不代表协议允许省略。
        public bool forceReload;
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
    /// WebGL 首个场景完成加载后的桥接兜底入口。
    ///
    /// 正常路径仍由 BootstrapRuntime（启动运行时根对象）上已序列化的组件在 Start 中初始化浏览器桥。
    /// 但 WebGL 的播放器启动、场景资源裁剪和浏览器线程调度会使该生命周期回调缺失时难以从外层恢复；
    /// 因此在首个场景加载完成后再执行一次仅 WebGL 有效的幂等补偿。它优先复用场景中已存在的组件，
    /// 仅在组件意外缺失时创建最小常驻根对象，保证不会生成第二个消息监听器或第二个 Unity 实例。
    /// </summary>
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void EnsureWebGlBridgeAfterInitialSceneLoad()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        UnityIframeBridgeManager manager = Instance;
        if (manager == null)
        {
            manager = FindFirstObjectByType<UnityIframeBridgeManager>();
        }

        if (manager == null)
        {
            // 只有首屏场景序列化组件意外缺失时才创建；AddComponent 会先完成 Awake，
            // 从而读取 instanceId 和 sceneMappingVersion，随后再调用同一幂等初始化方法。
            GameObject fallbackRoot = new GameObject("WebGlIframeBridgeFallback");
            manager = fallbackRoot.AddComponent<UnityIframeBridgeManager>();
        }

        manager.EnsureBrowserBridgeInitialized();
#endif
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
        // 仅记录一次固定阶段，不记录来源、地址、载荷或场景对象，便于在浏览器控制台确认
        // C# 生命周期已实际进入桥接调用，同时不扩大生产日志的敏感信息范围。
        Debug.Log("[UnityIframeBridge] 正在初始化 WebGL 浏览器桥接。");
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

        if (message == null ||
            message.channel != WebGlProtocolContract.Channel ||
            message.version != WebGlProtocolContract.ProtocolVersion ||
            message.instanceId != _instanceId ||
            string.IsNullOrWhiteSpace(message.type))
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
            case "clearSelection":
                HandleClearSelection(message);
                break;
            case "setNodeVisualState":
                HandleSetNodeVisualState(message);
                break;
            case "clearNodeVisualState":
                HandleClearNodeVisualState(message);
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
        LogStatusToBrowserConsole();
        SendToParent("object-click", new BridgePayload { deviceCode = deviceCode, deviceName = deviceName });
    }

    /// <summary>
    /// 由真实厂区对象点击交互调用，向父页面回传已登记的稳定三维节点标识。
    /// 二维拓扑节点和外部设备均由前端按原子清单显式反查，本方法不得根据对象名称推导或回传二维节点。
    /// </summary>
    public void ReportObjectSelected(string sceneNodeId, string nodeName)
    {
        // 释放流程开始后不再产生场景回调，避免已卸载父页面收到迟到的选中事件。
        if (_releaseRequested)
        {
            return;
        }
        // 对象选择只能来自当前已激活、已登记且具有物理实例标识的业务场景。
        // 没有场景上下文、激活实例或合法三维标识时直接阻断，避免场景切换过程中的迟到事件被新同名场景错误解析。
        TryBindSceneController();
        if (_sceneController == null ||
            _sceneCoordinator == null ||
            !SceneSwitchProtocolValidator.IsBoundedIdentifier(_sceneController.SceneId) ||
            !SceneSwitchProtocolValidator.IsBoundedIdentifier(_sceneCoordinator.ActiveSceneActivationId) ||
            !SceneActionProtocolValidator.IsValidSceneNodeId(sceneNodeId))
        {
            return;
        }
        StatusText = $"已选择对象：{nodeName}";
        LogStatusToBrowserConsole();
        SendObjectSelectedToParent(
            _sceneController.SceneId,
            sceneNodeId,
            _sceneCoordinator.ActiveSceneActivationId);
    }

    /// <summary>
    /// 生成对象选择专用最小信封。字段集合与前端 isWebglObjectSelectedPayload（对象选择负载校验器）完全一致，
    /// 不回传对象名称、二维节点、材质信息或其他命令默认值。
    /// </summary>
    private void SendObjectSelectedToParent(string sceneId, string sceneNodeId, string sceneActivationId)
    {
        long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        ObjectSelectedBridgeMessage message = new ObjectSelectedBridgeMessage
        {
            channel = WebGlProtocolContract.Channel,
            version = WebGlProtocolContract.ProtocolVersion,
            instanceId = _instanceId,
            messageId = $"{timestamp}-{Guid.NewGuid():N}",
            type = "objectSelected",
            payload = new ObjectSelectedBridgePayload
            {
                sceneId = sceneId,
                sceneNodeId = sceneNodeId,
                sceneActivationId = sceneActivationId
            },
            timestamp = timestamp
        };
        SendSerializedMessage(JsonUtility.ToJson(message));
    }

    private void HandleInitialize(BridgeMessage message)
    {
        StatusText = "已完成父页面初始化。";
        LogStatusToBrowserConsole();
        TryBindSceneController();
        // init 的 ack（初始化确认）必须使用最小模型，不能让通用负载带出空的可选恢复标识。
        SendRequestAcknowledgement("ack", message.messageId, true, "Unity 已完成初始化", GetSceneStateDescription());
    }

    /// <summary>
    /// 尺寸命令不直接修改固定画布样式；Unity WebGL 运行时会依据容器 CSS 尺寸重建渲染目标。
    /// 此处仅记录结果并回填原始请求标识，让父页面能及时清理待确认表。
    /// </summary>
    private void HandleResize(BridgeMessage message)
    {
        BridgePayload payload = message.payload;
        StatusText = $"已同步场景容器尺寸：{payload?.width ?? 0f} × {payload?.height ?? 0f}";
        LogStatusToBrowserConsole();
        SendCommandResult(message, true, string.Empty, StatusText);
    }

    /// <summary>
    /// 接收受控 iframe 的场景切换请求。请求确认只表示协调器已接管事务，不能替代最终 sceneChanged；
    /// 最终成功与失败分别由场景完成事件和结构化 commandResult 回填同一原始 requestId。
    /// forceReload 会原样传给协调器，桥接层不得根据当前场景自行吞掉物理恢复请求。
    /// </summary>
    private void HandleSwitchScene(BridgeMessage message)
    {
        BridgePayload payload = message.payload;
        SceneSwitchCommandPayload switchPayload = new SceneSwitchCommandPayload
        {
            sceneId = payload?.sceneId,
            transitionId = payload?.transitionId,
            sceneMappingVersion = payload?.sceneMappingVersion,
            forceReload = payload != null && payload.forceReload
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
        StatusText = $"已接收场景切换请求：{switchPayload.sceneId}。";
        LogStatusToBrowserConsole();
        /*
         * 接收确认必须早于 RequestSwitchScene（请求场景切换）。协调器可能在同一调用栈内立即上报
         * sceneLoadProgress（场景加载进度）或失败结果；前端只有收到 ack 后才会把该请求标记为
         * awaitingSceneResult（等待场景终态），因此顺序错误会让首个进度被严格拒绝并失去超时刷新依据。
         * 确认使用最小模型，避免通用 BridgePayload 将空 sceneActivationId 写入 JSON。
         */
        SendRequestAcknowledgement(
            "ack",
            message.messageId,
            true,
            "Unity 已接收场景切换请求，正在异步加载。",
            GetSceneStateDescription());
        bool accepted = _sceneCoordinator.RequestSwitchScene(
            switchPayload.sceneId,
            switchPayload.transitionId,
            switchPayload.forceReload);
        if (!accepted)
        {
            // 即时失败回调已删除登记项；若底层在未回调的异常路径返回 false，主动清理避免泄漏。
            _sceneRequestIdsByTransition.Remove(switchPayload.transitionId);
            return;
        }
    }

    /// <summary>
    /// 先以 disposed 回填 dispose 原始 messageId，再请求浏览器桥接层退出 Unity 实例。
    /// 这样父页面可确认远端已接收释放命令；重复调用由 _releaseRequested 和桥接层双重幂等保护。
    /// </summary>
    private void HandleDispose(BridgeMessage message)
    {
        _releaseRequested = true;
        UnsubscribeSceneLoaded();
        // 兼容旧 SampleScene 无协调器路径：先保存控制器，再解除桥接引用；正式协调器会自行释放活动控制器。
        IBusinessSceneController legacyController = _sceneCoordinator == null ? _sceneController : null;
        _sceneCoordinator?.DisposeRuntime();
        UnsubscribeFromSceneCoordinator();
        BindSceneController(null);
        // 释放期间的协调器回调不会再发向已释放父页面，立即清理映射避免保留旧 requestId。
        _sceneRequestIdsByTransition.Clear();
        ClearFocusSelectionIds();
        if (_sceneCoordinator == null)
        {
            // 兼容直接打开旧 SampleScene 的本地联调；正式 Bootstrap 路径由协调器统一释放活动控制器。
            legacyController?.ReleaseScene();
        }
        StatusText = "Unity 实例正在释放。";
        LogStatusToBrowserConsole();
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
        SendRequestAcknowledgement("disposed", command.messageId, success, resultMessage, GetSceneStateDescription());
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

    /// <summary>
    /// 处理拓扑节点选择的三维描边命令。
    /// 节点标识只用于更新当前交互描边，实际控制器不得移动镜头；isolate 仍只控制显隐上下文。
    /// </summary>
    private void HandleFocusNode(BridgeMessage message)
    {
        BridgePayload payload = message.payload;
        if (!SceneActionProtocolValidator.IsValidSceneNodeId(payload?.sceneNodeId) ||
            !SceneActionProtocolValidator.IsValidSelectionId(payload?.selectionId))
        {
            SendCommandResult(message, false, "focus-payload-invalid", "聚焦命令缺少合法三维节点标识或选择标识。");
            return;
        }
        if (!TryGetSceneController(message, BusinessSceneCapability.FocusNode, out IBusinessSceneController controller))
        {
            return;
        }

        // 同一 selectionId 可能因 commandResult 丢失而由浏览器原样重发；返回成功但不再次调用控制器，
        // 防止重复更新描边或选择事件产生重复副作用。
        if (_recentFocusSelectionIdSet.Contains(payload.selectionId))
        {
            SendCommandResult(message, true, string.Empty, "重复聚焦选择已幂等忽略。");
            return;
        }

        // 在调用控制器前登记：即使业务节点返回失败，同一选择也只能执行一次，保持与前端协调器语义一致。
        RememberFocusSelectionId(payload.selectionId);
        SendSceneCommandResult(message, controller.FocusNode(payload.sceneNodeId, payload.isolate));
    }

    /// <summary>
    /// 处理拓扑空白点击的三维清除命令。
    /// 该命令不读取或修改节点标识，也不调用 resetScene；实际控制器只关闭交互描边，
    /// 因而不会改变当前场景、流程步骤、模型显隐和镜头状态。
    /// </summary>
    private void HandleClearSelection(BridgeMessage message)
    {
        if (!TryGetSceneController(message, BusinessSceneCapability.ClearSelection, out IBusinessSceneController controller))
        {
            return;
        }

        SendSceneCommandResult(message, controller.ClearSelection());
    }

    /// <summary>
    /// 记录最近一次聚焦选择。队列与哈希集合始终同步，超过固定容量时只淘汰最旧标识；
    /// 单次操作为常数时间，不保存命令载荷、控制器引用或异步对象。
    /// </summary>
    private void RememberFocusSelectionId(string selectionId)
    {
        _recentFocusSelectionIds.Enqueue(selectionId);
        _recentFocusSelectionIdSet.Add(selectionId);
        while (_recentFocusSelectionIds.Count > MaxTrackedFocusSelections)
        {
            string expiredSelectionId = _recentFocusSelectionIds.Dequeue();
            _recentFocusSelectionIdSet.Remove(expiredSelectionId);
        }
    }

    /// <summary>释放桥接器时同步清空两个集合，避免常驻对象残留上一个父页面的选择关联。</summary>
    private void ClearFocusSelectionIds()
    {
        _recentFocusSelectionIds.Clear();
        _recentFocusSelectionIdSet.Clear();
    }

    /// <summary>
    /// 四态视觉命令只把已解析的稳定节点标识和固定枚举交给当前控制器。
    /// 控制器自行复用材质或材质属性块；桥接绝不接收颜色、材质名或任意渲染对象引用。
    /// </summary>
    private void HandleSetNodeVisualState(BridgeMessage message)
    {
        BridgePayload payload = message.payload;
        if (!SceneActionProtocolValidator.IsValidSceneNodeId(payload?.sceneNodeId) ||
            !SceneActionProtocolValidator.TryParseVisualState(payload?.visualState, out BusinessSceneNodeVisualState visualState) ||
            !DateTimeOffset.TryParse(payload?.statusUpdatedAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _) ||
            payload.snapshotSequence <= 0 ||
            payload.snapshotSequence > MaxJavaScriptSafeInteger ||
            payload.sourceRevision < 0 ||
            payload.sourceRevision > MaxJavaScriptSafeInteger)
        {
            // 快照序号是唯一因果依据；其余字段仍校验格式，防止损坏的诊断数据穿透到场景控制器。
            SendCommandResult(message, false, "node-visual-state-payload-invalid", "设备状态命令缺少合法三维节点标识、固定四态状态或本地快照序号。");
            return;
        }
        if (!TryGetSceneController(message, BusinessSceneCapability.UpdateNodeVisualState, out IBusinessSceneController controller))
        {
            return;
        }

        NodeVisualStateWatermark incomingWatermark = new NodeVisualStateWatermark(payload.snapshotSequence);
        bool hasAppliedWatermark = _nodeVisualStateWatermarks.TryGetValue(payload.sceneNodeId, out NodeVisualStateWatermark latestAppliedWatermark);
        if (hasAppliedWatermark && IsOutdatedOrDuplicate(incomingWatermark, latestAppliedWatermark))
        {
            // 相同序号重试或更小序号迟到均返回成功但不重复调用控制器，便于浏览器清理待确认项。
            SendCommandResult(message, true, string.Empty, "重复或迟到的设备状态已幂等忽略。");
            return;
        }
        if (!hasAppliedWatermark &&
            _nodeVisualStateWatermarks.Count >= MaxTrackedNodeVisualStates)
        {
            SendCommandResult(message, false, "node-visual-state-capacity", "当前场景的设备状态因果水位已达到安全上限。");
            return;
        }

        BusinessSceneCommandResult result = controller.UpdateNodeVisualState(payload.sceneNodeId, visualState);
        if (result.Success)
        {
            // 仅记录成功应用的本地序号；控制器失败时保留原命令重试机会，不能把未执行命令误标为已处理。
            _nodeVisualStateWatermarks[payload.sceneNodeId] = incomingWatermark;
        }
        SendSceneCommandResult(message, result);
    }

    /// <summary>
    /// 完整快照中设备消失时撤销其动态四态覆盖。清除和设置共用同一节点水位，
    /// 因此更旧的设置命令即使在清除后迟到，也只能幂等完成而不能重新染色。
    /// </summary>
    private void HandleClearNodeVisualState(BridgeMessage message)
    {
        BridgePayload payload = message.payload;
        if (!SceneActionProtocolValidator.IsValidSceneNodeId(payload?.sceneNodeId) ||
            payload.snapshotSequence <= 0 ||
            payload.snapshotSequence > MaxJavaScriptSafeInteger)
        {
            SendCommandResult(message, false, "node-visual-state-clear-payload-invalid", "设备状态清除命令缺少合法三维节点标识或本地快照序号。");
            return;
        }
        if (!TryGetSceneController(message, BusinessSceneCapability.ClearNodeVisualState, out IBusinessSceneController controller))
        {
            return;
        }

        NodeVisualStateWatermark incomingWatermark = new NodeVisualStateWatermark(payload.snapshotSequence);
        bool hasAppliedWatermark = _nodeVisualStateWatermarks.TryGetValue(payload.sceneNodeId, out NodeVisualStateWatermark latestAppliedWatermark);
        if (hasAppliedWatermark && IsOutdatedOrDuplicate(incomingWatermark, latestAppliedWatermark))
        {
            SendCommandResult(message, true, string.Empty, "重复或迟到的设备状态清除已幂等忽略。");
            return;
        }
        if (!hasAppliedWatermark && _nodeVisualStateWatermarks.Count >= MaxTrackedNodeVisualStates)
        {
            SendCommandResult(message, false, "node-visual-state-capacity", "当前场景的设备状态因果水位已达到安全上限。");
            return;
        }

        BusinessSceneCommandResult result = controller.ClearNodeVisualState(payload.sceneNodeId);
        if (result.Success)
        {
            _nodeVisualStateWatermarks[payload.sceneNodeId] = incomingWatermark;
        }
        SendSceneCommandResult(message, result);
    }

    /// <summary>
    /// 与前端权威快照使用相同顺序：相同序号是幂等重试，更小序号是迟到任务，只有更大序号可执行。
    /// 比较为常数时间且不会创建临时集合。
    /// </summary>
    private static bool IsOutdatedOrDuplicate(NodeVisualStateWatermark incoming, NodeVisualStateWatermark latest)
    {
        return incoming.SnapshotSequence <= latest.SnapshotSequence;
    }

    /// <summary>
    /// 活动控制器变化意味着物理场景实例已变化；清空旧场景水位后，新实例可接收自己的首份完整状态基线。
    /// 同一控制器重复绑定不清空，确保普通同场景拓扑事务和命令重试仍受旧时间保护。
    /// </summary>
    private void BindSceneController(IBusinessSceneController controller)
    {
        if (ReferenceEquals(_sceneController, controller))
        {
            return;
        }

        _sceneController = controller;
        ClearNodeVisualStateWatermarks();
    }

    /// <summary>释放当前控制器的有限因果索引；字典不包含 Unity 对象，清空不会触发资源销毁或额外分配。</summary>
    private void ClearNodeVisualStateWatermarks()
    {
        _nodeVisualStateWatermarks.Clear();
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
            LogStatusToBrowserConsole(true);
            SendCommandResult(message, false, "controller-unavailable", StatusText);
            return false;
        }
        if ((controller.Capabilities & requiredCapability) != requiredCapability)
        {
            StatusText = $"当前业务场景未声明能力：{requiredCapability}。";
            LogStatusToBrowserConsole(true);
            SendCommandResult(message, false, "capability-unsupported", StatusText);
            controller = null;
            return false;
        }

        return true;
    }

    private void SendSceneCommandResult(BridgeMessage message, BusinessSceneCommandResult result)
    {
        StatusText = result.Message;
        LogStatusToBrowserConsole(!result.Success);
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
    /// sceneId 与 transitionId 仅用于请求关联；sceneActivationId 只在目标失败但旧场景已自动恢复时出现，
    /// 表示恢复后的新物理实例。所有字段均为受控摘要，不包含 Unity 层级路径、资源地址或异常对象。
    /// </summary>
    private void SendCommandResult(
        string requestId,
        bool success,
        string errorCode,
        string resultMessage,
        string sceneId = null,
        string transitionId = null,
        string sceneActivationId = null)
    {
        // 只有自动恢复已经产生新的非空物理场景实例时，才允许回传 sceneActivationId。
        // 其他路径使用不含该字段的模型，避免 JsonUtility 把 null 序列化为空字符串而违反前端协议。
        if (!string.IsNullOrWhiteSpace(sceneActivationId))
        {
            SendRecoveredCommandResult(
                requestId,
                success,
                errorCode,
                resultMessage,
                sceneId,
                transitionId,
                sceneActivationId,
                GetSceneStateDescription());
            return;
        }

        SendCommandResultWithoutRecovery(
            requestId,
            success,
            errorCode,
            resultMessage,
            sceneId,
            transitionId,
            GetSceneStateDescription());
    }

    /// <summary>
    /// 发送初始化确认或释放确认。
    /// 这两个消息只需要原请求标识、结果、受控说明和当前场景摘要；使用专用模型可保证 JSON
    /// 不含空 sceneActivationId（物理场景激活标识）或其他未使用通用字段。
    /// </summary>
    private void SendRequestAcknowledgement(
        string type,
        string requestId,
        bool success,
        string resultMessage,
        string sceneState)
    {
        long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        RequestAcknowledgementBridgeMessage message = new RequestAcknowledgementBridgeMessage
        {
            channel = WebGlProtocolContract.Channel,
            version = WebGlProtocolContract.ProtocolVersion,
            instanceId = _instanceId,
            messageId = $"{timestamp}-{Guid.NewGuid():N}",
            type = type,
            payload = new RequestAcknowledgementBridgePayload
            {
                requestId = requestId,
                success = success,
                message = resultMessage,
                sceneState = sceneState
            },
            timestamp = timestamp
        };
        SendSerializedMessage(JsonUtility.ToJson(message));
    }

    /// <summary>
    /// 发送不包含恢复实例的常规命令结果。
    /// 即使场景、事务或错误码为空，也不声明 sceneActivationId，确保前端只在确有恢复实例时处理该字段。
    /// </summary>
    private void SendCommandResultWithoutRecovery(
        string requestId,
        bool success,
        string errorCode,
        string resultMessage,
        string sceneId,
        string transitionId,
        string sceneState)
    {
        long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        CommandResultBridgeMessage message = new CommandResultBridgeMessage
        {
            channel = WebGlProtocolContract.Channel,
            version = WebGlProtocolContract.ProtocolVersion,
            instanceId = _instanceId,
            messageId = $"{timestamp}-{Guid.NewGuid():N}",
            type = "commandResult",
            payload = new CommandResultBridgePayload
            {
                requestId = requestId,
                success = success,
                message = resultMessage,
                errorCode = errorCode,
                sceneId = sceneId,
                transitionId = transitionId,
                sceneState = sceneState
            },
            timestamp = timestamp
        };
        SendSerializedMessage(JsonUtility.ToJson(message));
    }

    /// <summary>
    /// 发送场景失败后已经恢复旧场景的专用命令结果。
    /// 调用方只在协调器提供非空恢复实例标识时进入本方法，因此该字段出现即代表真实可用的新物理场景实例。
    /// </summary>
    private void SendRecoveredCommandResult(
        string requestId,
        bool success,
        string errorCode,
        string resultMessage,
        string sceneId,
        string transitionId,
        string sceneActivationId,
        string sceneState)
    {
        long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        RecoveredCommandResultBridgeMessage message = new RecoveredCommandResultBridgeMessage
        {
            channel = WebGlProtocolContract.Channel,
            version = WebGlProtocolContract.ProtocolVersion,
            instanceId = _instanceId,
            messageId = $"{timestamp}-{Guid.NewGuid():N}",
            type = "commandResult",
            payload = new RecoveredCommandResultBridgePayload
            {
                requestId = requestId,
                success = success,
                message = resultMessage,
                errorCode = errorCode,
                sceneId = sceneId,
                transitionId = transitionId,
                sceneState = sceneState,
                sceneActivationId = sceneActivationId
            },
            timestamp = timestamp
        };
        SendSerializedMessage(JsonUtility.ToJson(message));
    }

    private void HandleTestCommand(BridgePayload payload)
    {
        string text = payload?.text ?? string.Empty;
        StatusText = $"收到平台消息：{text}";
        LogStatusToBrowserConsole();

        // 改变测试立方体颜色，以便在 WebGL 页面中直观看到消息被 Unity 成功处理。
        if (_testObjectRenderer != null)
        {
            _testObjectRenderer.material.color = new Color(0.15f, 0.75f, 0.95f, 1f);
        }

        SendToParent("test-result", new BridgePayload { message = $"Unity 已执行测试指令：{text}" });
    }

    private void SendToParent(string type, BridgePayload payload)
    {
        long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        BridgeMessage message = new BridgeMessage
        {
            channel = WebGlProtocolContract.Channel,
            version = WebGlProtocolContract.ProtocolVersion,
            instanceId = _instanceId,
            messageId = $"{timestamp}-{Guid.NewGuid():N}",
            type = type,
            payload = payload,
            timestamp = timestamp
        };

        SendSerializedMessage(JsonUtility.ToJson(message));
    }

    /// <summary>统一把已经由受控模型序列化的信封交给浏览器桥；编辑器测试保留同一日志前缀用于断言。</summary>
    private static void SendSerializedMessage(string messageJson)
    {
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
            BindSceneController(_sceneCoordinator.ActiveController);
            return;
        }
        if (_sceneController == null)
        {
            BusinessSceneControllerRegistry.TryResolveLegacyLoadedScene(
                SceneManager.GetActiveScene(),
                out IBusinessSceneController legacyController,
                out _);
            BindSceneController(legacyController);
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
        BindSceneController(controller);
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
            LogStatusToBrowserConsole();
            SceneChangedPayload changedPayload = new SceneChangedPayload
            {
                requestId = requestId,
                sceneId = result.SceneId,
                transitionId = result.TransitionId,
                // 只接受协调器当前真实提交的实例标识；不以请求事务或对象名称推导，避免同场景 ABA 误选。
                sceneActivationId = _sceneCoordinator?.ActiveSceneActivationId,
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
                sceneActivationId = changedPayload.sceneActivationId,
                success = changedPayload.success,
                sceneState = changedPayload.sceneState
            });
            return;
        }

        StatusText = result.Message;
        LogStatusToBrowserConsole(true);
        SendCommandResult(
            requestId,
            false,
            string.IsNullOrWhiteSpace(result.ErrorCode) ? "scene-switch-failed" : result.ErrorCode,
            result.Message,
            result.SceneId,
            result.TransitionId,
            // 只有协调器确认恢复提交成功时才透传激活标识；普通失败不得伪造可用物理场景。
            result.Recovered ? result.RestoredSceneActivationId : null);
    }

    /// <summary>
    /// 将原先显示在 Unity 画面上的状态摘要写入引擎日志。
    /// WebGL 会把 Debug 日志转发到浏览器开发者工具控制台；警告仅用于失败状态，便于线上筛选。
    /// </summary>
    private void LogStatusToBrowserConsole(bool warning = false)
    {
        if (string.IsNullOrWhiteSpace(StatusText))
        {
            return;
        }

        if (warning)
        {
            Debug.LogWarning($"[UnityIframeBridge] {StatusText}", this);
            return;
        }

        Debug.Log($"[UnityIframeBridge] {StatusText}", this);
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
        ClearFocusSelectionIds();
        ClearNodeVisualStateWatermarks();
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
}

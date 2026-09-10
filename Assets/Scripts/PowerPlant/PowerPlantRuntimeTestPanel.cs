using System;
using System.Collections;
using UnityEngine;
using UnityEngine.InputSystem;
using WebDLPro.Unity.SceneRuntime;

[DisallowMultipleComponent]
public sealed class PowerPlantRuntimeTestPanel : MonoBehaviour
{
    private const string ProcessId = "gas-power-generation";
    private const string GasPowerSceneId = "gas-power";
    private const string GasTurbineStepId = "gas-turbine";
    private const string GasTurbineProcessDetailId = "process-detail.gas-power.gas-turbine";
    private const string DefaultBridgeInstanceId = "local-demo-001";

    private static readonly string[] StepIds =
    {
        "overview",
        "grid-output",
        "gas-network",
        "inlet-duct",
        "gas-turbine",
        "hrsg",
        "steam-turbine",
        "generator"
    };

    private static readonly string[] VisualStateNodeIds =
    {
        "gas-turbine",
        "hrsg",
        "steam-turbine"
    };

    private readonly GUIContent[] _visualStateNodeLabels =
    {
        new GUIContent("燃气轮机"),
        new GUIContent("余热锅炉"),
        new GUIContent("汽轮机")
    };

    private static readonly BusinessSceneNodeVisualState[] VisualStates =
    {
        BusinessSceneNodeVisualState.Normal,
        BusinessSceneNodeVisualState.Alarm,
        BusinessSceneNodeVisualState.Fault,
        BusinessSceneNodeVisualState.Offline
    };

    private static readonly GUIContent[] VisualStateLabels =
    {
        new GUIContent("正常"),
        new GUIContent("告警"),
        new GUIContent("故障"),
        new GUIContent("离线")
    };

    [SerializeField] private PowerPlantProcessController _processController;
    [SerializeField] private UnityIframeBridgeManager _bridgeManager;
    // 与场景内正式第三层协调器共用，面板只调用其公开状态与加载接口，不直接创建模型或修改场景对象。
    [SerializeField] private ProcessDetailCoordinator _processDetailCoordinator;

    [Header("测试设置")]
    [SerializeField] private bool _showPanel = true;
    [SerializeField, Min(0.5f)] private float _autoTestInterval = 2.5f;
    [SerializeField] private string _bridgeInstanceId = DefaultBridgeInstanceId;

    private readonly GUIContent[] _stepLabels =
    {
        new GUIContent("总览"),
        new GUIContent("电网送出"),
        new GUIContent("燃气网络"),
        new GUIContent("进气系统"),
        new GUIContent("燃气轮机"),
        new GUIContent("余热锅炉"),
        new GUIContent("汽轮机"),
        new GUIContent("发电机")
    };

    private bool _isolate = true;
    private string _unitId = "all";
    // 默认使用场景已登记的稳定节点标识，避免打开面板后节点测试立即落入无效节点错误路径。
    private string _nodeId = "gas-turbine";
    private int _visualStateNodeIndex;
    // 保存最近一次桥接聚焦使用的选择标识，供“重复聚焦”按钮原样重发以验证幂等处理。
    private string _lastFocusSelectionId;
    private int _focusSelectionSequence;
    private bool _bridgeSessionInitialized;
    private string _lastResult = "尚未执行测试。";
    private Vector2 _scrollPosition;
    private Coroutine _autoTestRoutine;
    private Coroutine _visualStateTestRoutine;
    // 关键环节进入需要异步加载资源；单独保存协程句柄，防止测试面板重复启动并发加载。
    private Coroutine _processDetailTestRoutine;
    private GUIStyle _titleStyle;
    private GUIStyle _sectionStyle;
    private int _messageSequence;
    // 测试事务使用唯一标识，复用正式协调器的事务去重与迟到回调隔离逻辑。
    private int _processDetailTransitionSequence;
    // 进入与退出必须复用同一事务标识，才能覆盖协调器对迟到退出和重复请求的正式保护路径。
    private string _processDetailTransitionId = string.Empty;

    [Serializable]
    private sealed class TestBridgeMessage
    {
        public string channel;
        public int version;
        public string instanceId;
        public string messageId;
        public string type;
        public TestBridgePayload payload;
        public long timestamp;
    }

    [Serializable]
    private sealed class TestBridgePayload
    {
        public string text;
        public string processId;
        public string stepId;
        public string unitId;
        public string nodeId;
        // 正式桥接动作只接受 sceneNodeId（三维节点标识）；保留 nodeId 字段仅供旧测试命令的数据模型兼容。
        public string sceneNodeId;
        // 每次测试聚焦生成唯一 selectionId（选择标识），用于验证 Unity 端幂等协议。
        public string selectionId;
        public bool isolate;
        public bool enabled;
        public float width;
        public float height;
    }

    private void Awake()
    {
        BindRuntimeReferences();
    }

    private void OnDisable()
    {
        StopAutoTest();
        StopVisualStateTest();
        StopProcessDetailTest();
    }

    /// <summary>
    /// 运行时测试面板仅供 Unity 编辑器内调试。
    /// 所有 WebGL 构建（含开发构建）都不会编译 OnGUI，避免测试文字覆盖正式三维画面；运行状态改由浏览器控制台查看。
    /// </summary>
#if UNITY_EDITOR
    private void Update()
    {
        if (Keyboard.current != null && Keyboard.current.f8Key.wasPressedThisFrame)
        {
            _showPanel = !_showPanel;
        }
    }

    private void OnGUI()
    {
        if (!_showPanel)
        {
            if (GUI.Button(new Rect(12f, 84f, 108f, 30f), "显示测试面板"))
            {
                _showPanel = true;
            }

            return;
        }

        EnsureStyles();
        float width = Mathf.Min(520f, Screen.width - 24f);
        float height = Mathf.Min(690f, Screen.height - 96f);
        Rect area = new Rect(12f, 84f, width, height);
        GUI.Box(area, GUIContent.none);

        GUILayout.BeginArea(new Rect(area.x + 10f, area.y + 8f, area.width - 20f, area.height - 16f));
        GUILayout.BeginHorizontal();
        GUILayout.Label("燃气电厂运行时测试", _titleStyle);
        if (GUILayout.Button("隐藏 (F8)", GUILayout.Width(96f)))
        {
            _showPanel = false;
        }
        GUILayout.EndHorizontal();

        _scrollPosition = GUILayout.BeginScrollView(_scrollPosition);
        GUILayout.Label($"当前流程：{GetProcessState()}");
        GUILayout.Label($"桥接状态：{GetBridgeState()}");
        GUILayout.Label($"最近结果：{_lastResult}", GUILayout.MinHeight(32f));

        DrawProcessControls();
        DrawNodeControls();
        DrawVisualStateControls();
        DrawProcessDetailControls();
        DrawBridgeControls();

        GUILayout.Space(4f);
        GUILayout.Label("交互验证", _sectionStyle);
        GUILayout.Label("拓扑和 Unity 鼠标左键选中都会描边并回传二维拓扑；自动聚焦由节点测试区的统一开关控制。重复聚焦应被幂等忽略；清除选择只停止未完成的聚焦，不复位镜头。手动拖拽、右键旋转、滚轮和 WASD/QE 可验证相机接管。 ");
        GUILayout.EndScrollView();
        GUILayout.EndArea();
    }
#endif

    private void DrawProcessControls()
    {
        GUILayout.Space(4f);
        GUILayout.Label("流程、显隐与描边", _sectionStyle);
        GUILayout.BeginHorizontal();
        GUILayout.Label("机组", GUILayout.Width(38f));
        DrawUnitButton("全部", "all");
        DrawUnitButton("1 号", "1");
        DrawUnitButton("2 号", "2");
        _isolate = GUILayout.Toggle(_isolate, "隔离上下文", GUILayout.Width(110f));
        GUILayout.EndHorizontal();

        for (int row = 0; row < 4; row++)
        {
            GUILayout.BeginHorizontal();
            DrawStepButton(row * 2);
            DrawStepButton(row * 2 + 1);
            GUILayout.EndHorizontal();
        }

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("重置场景"))
        {
            ResetScene();
        }

        if (GUILayout.Button(_autoTestRoutine == null ? "自动巡检（全部机组）" : "停止自动巡检"))
        {
            if (_autoTestRoutine == null)
            {
                _autoTestRoutine = StartCoroutine(RunAutoTest());
            }
            else
            {
                StopAutoTest();
                Report("已停止自动巡检。");
            }
        }
        GUILayout.EndHorizontal();
    }

    private void DrawNodeControls()
    {
        GUILayout.Space(4f);
        GUILayout.Label("节点测试", _sectionStyle);
        GUILayout.BeginHorizontal();
        GUILayout.Label("节点 ID", GUILayout.Width(52f));
        _nodeId = GUILayout.TextField(_nodeId);
        GUILayout.EndHorizontal();

        if (_processController != null)
        {
            bool focusOnSelection = GUILayout.Toggle(
                _processController.FocusOnSelection,
                "选中后自动聚焦（拓扑与Unity鼠标共用）");
            if (focusOnSelection != _processController.FocusOnSelection)
            {
                _processController.SetFocusOnSelection(focusOnSelection);
                Report(focusOnSelection ? "已开启统一选中聚焦。" : "已关闭统一选中聚焦，仍保留描边与拓扑联动。");
            }
        }

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("描边"))
        {
            RunNodeAction("描边", () => _processController.TryFocusNode(_nodeId, _isolate, out string message), out string result);
            Report(result);
        }

        if (GUILayout.Button("显示"))
        {
            RunNodeAction("显示", () => _processController.TrySetNodeVisibility(_nodeId, true, out string message), out string result);
            Report(result);
        }

        if (GUILayout.Button("半透明"))
        {
            RunNodeAction("半透明", () => _processController.TrySetNodeVisibility(_nodeId, false, out string message), out string result);
            Report(result);
        }
        GUILayout.EndHorizontal();

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("开启告警高亮"))
        {
            RunNodeAction("开启告警", () => _processController.TrySetNodeAlarm(_nodeId, true, out string message), out string result);
            Report(result);
        }

        if (GUILayout.Button("关闭告警高亮"))
        {
            RunNodeAction("关闭告警", () => _processController.TrySetNodeAlarm(_nodeId, false, out string message), out string result);
            Report(result);
        }
        GUILayout.EndHorizontal();
    }

    /// <summary>
    /// 只测试场景属性面板中明确登记的三个燃气设备四态，不允许输入任意层级名称。
    /// 每次按钮点击都直接调用正式控制器接口，确保面板看到的结果与网页桥接收到的结果一致。
    /// </summary>
    private void DrawVisualStateControls()
    {
        GUILayout.Space(4f);
        GUILayout.Label("关键设备四态视觉", _sectionStyle);
        GUILayout.Label("选择已绑定模型后，分别测试正常、告警、故障、离线效果。离线视觉是否显示由共享配置开关控制。", GUILayout.MinHeight(22f));

        GUILayout.BeginHorizontal();
        for (int nodeIndex = 0; nodeIndex < VisualStateNodeIds.Length; nodeIndex++)
        {
            bool selected = _visualStateNodeIndex == nodeIndex;
            if (GUILayout.Toggle(selected, _visualStateNodeLabels[nodeIndex], "Button") && !selected)
            {
                _visualStateNodeIndex = nodeIndex;
                // 同步通用节点测试输入，使描边、显隐和四态始终指向同一个稳定节点。
                _nodeId = VisualStateNodeIds[nodeIndex];
            }
        }
        GUILayout.EndHorizontal();

        GUILayout.BeginHorizontal();
        for (int stateIndex = 0; stateIndex < VisualStates.Length; stateIndex++)
        {
            BusinessSceneNodeVisualState visualState = VisualStates[stateIndex];
            if (GUILayout.Button(VisualStateLabels[stateIndex]))
            {
                ApplyVisualState(visualState);
            }
        }
        GUILayout.EndHorizontal();

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("清除动态状态"))
        {
            ClearVisualState();
        }

        string cycleButtonLabel = _visualStateTestRoutine == null ? "轮巡当前模型三态" : "停止三态轮巡";
        if (GUILayout.Button(cycleButtonLabel))
        {
            if (_visualStateTestRoutine == null)
            {
                _visualStateTestRoutine = StartCoroutine(RunVisualStateTest());
            }
            else
            {
                StopVisualStateTest();
                Report("已停止当前模型四态轮巡。");
            }
        }
        GUILayout.EndHorizontal();
    }

    /// <summary>
    /// 复用正式第三层协调器验证燃气轮机资源加载、退出和状态驱动播放。
    /// 状态按钮固定写入燃气轮机稳定节点，未加载时写入协调器缓存，加载后立即投影到实例。
    /// </summary>
    private void DrawProcessDetailControls()
    {
        GUILayout.Space(4f);
        GUILayout.Label("燃气轮机关键环节测试", _sectionStyle);
        GUILayout.Label(GetProcessDetailState(), GUILayout.MinHeight(20f));

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("加载燃气轮机关键环节"))
        {
            EnterGasTurbineProcessDetail();
        }

        if (GUILayout.Button("退出关键环节"))
        {
            ExitGasTurbineProcessDetail();
        }
        GUILayout.EndHorizontal();

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("关键环节正常"))
        {
            ApplyVisualState(GasTurbineStepId, "燃气轮机关键环节", BusinessSceneNodeVisualState.Normal);
        }
        if (GUILayout.Button("关键环节告警"))
        {
            ApplyVisualState(GasTurbineStepId, "燃气轮机关键环节", BusinessSceneNodeVisualState.Alarm);
        }
        if (GUILayout.Button("关键环节故障"))
        {
            ApplyVisualState(GasTurbineStepId, "燃气轮机关键环节", BusinessSceneNodeVisualState.Fault);
        }
        if (GUILayout.Button("关键环节离线"))
        {
            ApplyVisualState(GasTurbineStepId, "燃气轮机关键环节", BusinessSceneNodeVisualState.Offline);
        }
        GUILayout.EndHorizontal();

        if (GUILayout.Button("清除关键环节状态"))
        {
            ClearVisualState(GasTurbineStepId, "燃气轮机关键环节");
        }
    }

    private void DrawBridgeControls()
    {
        GUILayout.Space(4f);
        GUILayout.Label("iframe 桥接模拟", _sectionStyle);
        GUILayout.BeginHorizontal();
        GUILayout.Label("实例 ID", GUILayout.Width(52f));
        _bridgeInstanceId = GUILayout.TextField(_bridgeInstanceId);
        GUILayout.EndHorizontal();

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("初始化"))
        {
            InitializeBridgeSession();
        }

        if (GUILayout.Button("当前步骤"))
        {
            SendBridgeCommand("enterProcessStep", new TestBridgePayload
            {
                processId = ProcessId,
                stepId = GetSelectedStepId(),
                unitId = _unitId,
                isolate = _isolate
            });
        }

        if (GUILayout.Button("重置"))
        {
            SendBridgeCommand("resetScene", new TestBridgePayload());
        }
        GUILayout.EndHorizontal();

        GUILayout.Label($"当前聚焦选择：{(_lastFocusSelectionId ?? "无")}");
        GUILayout.BeginHorizontal();
        if (GUILayout.Button("聚焦节点"))
        {
            SendFocusNode(false);
        }

        if (GUILayout.Button("重复聚焦"))
        {
            SendFocusNode(true);
        }

        if (GUILayout.Button("清除选择"))
        {
            SendBridgeCommand("clearSelection", new TestBridgePayload());
        }
        GUILayout.EndHorizontal();

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("节点显示"))
        {
            SendBridgeCommand("setNodeVisibility", new TestBridgePayload { sceneNodeId = _nodeId, enabled = true });
        }

        if (GUILayout.Button("节点半透明"))
        {
            SendBridgeCommand("setNodeVisibility", new TestBridgePayload { sceneNodeId = _nodeId, enabled = false });
        }
        GUILayout.EndHorizontal();

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("尺寸消息"))
        {
            SendBridgeCommand("resize", new TestBridgePayload { width = Screen.width, height = Screen.height });
        }
        GUILayout.EndHorizontal();

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("旧测试指令"))
        {
            SendBridgeCommand("test-command", new TestBridgePayload { text = "runtime-test-panel" });
        }

        if (GUILayout.Button("无效步骤（错误路径）"))
        {
            SendBridgeCommand("enterProcessStep", new TestBridgePayload
            {
                processId = ProcessId,
                stepId = "invalid-step",
                unitId = _unitId,
                isolate = _isolate
            });
        }
        GUILayout.EndHorizontal();
    }

    private void DrawUnitButton(string label, string unitId)
    {
        bool selected = _unitId == unitId;
        if (GUILayout.Toggle(selected, label, "Button", GUILayout.Width(54f)) && !selected)
        {
            _unitId = unitId;
        }
    }

    private void DrawStepButton(int index)
    {
        if (GUILayout.Button(_stepLabels[index], GUILayout.ExpandWidth(true)))
        {
            EnterStep(StepIds[index], _unitId, _isolate);
        }
    }

    private void EnterStep(string stepId, string unitId, bool isolate)
    {
        if (!EnsureProcessController())
        {
            return;
        }

        bool success = _processController.TryEnterProcessStep(ProcessId, stepId, unitId, isolate, out string message);
        Report(success ? $"流程测试通过：{message}" : $"流程测试失败：{message}");
    }

    private void ResetScene()
    {
        if (!EnsureProcessController())
        {
            return;
        }

        bool success = _processController.TryResetScene(out string message);
        Report(success ? $"重置通过：{message}" : $"重置失败：{message}");
    }

    /// <summary>
    /// 发起燃气轮机第三层的正式加载流程。协程内只转发固定目录标识，
    /// 实际资源、展示位置、相机位与状态重放均由协调器和目录校验。
    /// </summary>
    private void EnterGasTurbineProcessDetail()
    {
        if (!EnsureProcessDetailCoordinator())
        {
            return;
        }
        if (_processDetailTestRoutine != null)
        {
            Report("燃气轮机关键环节正在加载，请等待当前请求完成。");
            return;
        }
        if (_processDetailCoordinator.IsActive &&
            string.Equals(_processDetailCoordinator.ActiveProcessDetailId, GasTurbineProcessDetailId, StringComparison.Ordinal))
        {
            Report("燃气轮机关键环节已经加载。");
            return;
        }
        if (_processDetailCoordinator.IsActive)
        {
            Report($"当前已加载 {_processDetailCoordinator.ActiveProcessDetailId}，请先退出后再加载燃气轮机关键环节。");
            return;
        }

        _processDetailTransitionId = $"runtime-test-process-detail.{++_processDetailTransitionSequence}";
        _processDetailTestRoutine = StartCoroutine(EnterGasTurbineProcessDetailAsync(_processDetailTransitionId));
    }

    /// <summary>
    /// 将回调结果保存到协程结束后再输出，避免加载器在同一帧完成时留下悬空测试状态。
    /// finally 向下释放枚举器，使测试面板被禁用时仍可执行加载器的取消清理。
    /// </summary>
    private IEnumerator EnterGasTurbineProcessDetailAsync(string transitionId)
    {
        BusinessSceneCommandResult result = default;
        IEnumerator entering = _processDetailCoordinator.EnterAsync(
            GasPowerSceneId,
            ProcessId,
            GasTurbineStepId,
            GasTurbineProcessDetailId,
            transitionId,
            commandResult => result = commandResult);
        try
        {
            while (entering.MoveNext())
            {
                yield return entering.Current;
            }
        }
        finally
        {
            (entering as IDisposable)?.Dispose();
        }

        _processDetailTestRoutine = null;
        if (!result.Success)
        {
            _processDetailTransitionId = string.Empty;
        }
        Report(result.Success
            ? $"燃气轮机关键环节加载通过：{result.Message}"
            : $"燃气轮机关键环节加载失败：{result.Message}");
    }

    /// <summary>
    /// 使用进入时生成的同一事务标识退出当前关键环节，不调用重置场景，
    /// 从而验证协调器恢复二层相机、交互门与资源租约的正式路径。
    /// </summary>
    private void ExitGasTurbineProcessDetail()
    {
        if (!EnsureProcessDetailCoordinator())
        {
            return;
        }
        if (_processDetailTestRoutine != null)
        {
            StopProcessDetailTest();
            Report("已取消正在加载的燃气轮机关键环节。");
            return;
        }
        if (!_processDetailCoordinator.IsActive)
        {
            Report("当前没有已加载的关键环节。");
            return;
        }
        if (!string.Equals(_processDetailCoordinator.ActiveProcessDetailId, GasTurbineProcessDetailId, StringComparison.Ordinal) ||
            string.IsNullOrEmpty(_processDetailTransitionId))
        {
            Report("当前活动关键环节不是本测试会话加载，未执行退出。");
            return;
        }

        BusinessSceneCommandResult result = _processDetailCoordinator.Exit(
            GasPowerSceneId,
            GasTurbineProcessDetailId,
            _processDetailTransitionId);
        if (result.Success)
        {
            _processDetailTransitionId = string.Empty;
        }
        Report(result.Success
            ? $"燃气轮机关键环节退出通过：{result.Message}"
            : $"燃气轮机关键环节退出失败：{result.Message}");
    }

    /// <summary>
    /// 仅取消本面板尚未提交的加载候选，不主动退出已经提交的关键环节。
    /// 面板隐藏或禁用不应改变用户当前稳定的第三层视图。
    /// </summary>
    private void StopProcessDetailTest()
    {
        if (_processDetailTestRoutine == null)
        {
            return;
        }

        StopCoroutine(_processDetailTestRoutine);
        _processDetailTestRoutine = null;
        if (_processDetailCoordinator != null && !_processDetailCoordinator.IsActive &&
            !string.IsNullOrEmpty(_processDetailTransitionId))
        {
            _processDetailCoordinator.AbortPrepared(
                GasPowerSceneId,
                GasTurbineProcessDetailId,
                _processDetailTransitionId);
            _processDetailTransitionId = string.Empty;
        }
    }

    /// <summary>
    /// 将选中的稳定节点切换到一个固定四态。Normal（正常态）也必须经过正式接口，
    /// 这样才能同时验证状态登记器的基础材质恢复和其它三种状态高亮路径。
    /// </summary>
    private void ApplyVisualState(BusinessSceneNodeVisualState visualState)
    {
        ApplyVisualState(
            VisualStateNodeIds[_visualStateNodeIndex],
            _visualStateNodeLabels[_visualStateNodeIndex].text,
            visualState);
    }

    /// <summary>
    /// 状态测试同时经过第二层正式控制器和第三层协调器。
    /// 协调器会缓存未加载关键环节的状态，并在加载完成后重放；已加载实例则立即更新视觉和播放许可。
    /// </summary>
    private void ApplyVisualState(string nodeId, string nodeLabel, BusinessSceneNodeVisualState visualState)
    {
        if (!EnsureProcessController() || !EnsureProcessDetailCoordinator())
        {
            return;
        }

        BusinessSceneCommandResult result = _processController.UpdateNodeVisualState(nodeId, visualState);
        if (result.Success)
        {
            result = _processDetailCoordinator.UpdateNodeVisualState(nodeId, visualState);
        }

        Report(result.Success
            ? $"{nodeLabel}：{GetVisualStateLabel(visualState)}测试通过。"
            : $"{nodeLabel}：{GetVisualStateLabel(visualState)}测试失败：{result.Message}");
    }

    /// <summary>
    /// 清除选中设备的动态状态。它与“正常”按钮有意区分：正常是平台下发的四态，
    /// 清除是撤销覆盖，用来验证设备状态从快照中消失后的恢复路径。
    /// </summary>
    private void ClearVisualState()
    {
        ClearVisualState(VisualStateNodeIds[_visualStateNodeIndex], _visualStateNodeLabels[_visualStateNodeIndex].text);
    }

    /// <summary>
    /// 清除第二层和第三层的状态覆盖。第三层状态缺失会恢复播放，符合燃气关键环节的状态驱动规则。
    /// </summary>
    private void ClearVisualState(string nodeId, string nodeLabel)
    {
        if (!EnsureProcessController() || !EnsureProcessDetailCoordinator())
        {
            return;
        }

        BusinessSceneCommandResult result = _processController.ClearNodeVisualState(nodeId);
        if (result.Success)
        {
            result = _processDetailCoordinator.ClearNodeVisualState(nodeId);
        }

        Report(result.Success
            ? $"{nodeLabel}：已清除动态状态。"
            : $"{nodeLabel}：清除失败：{result.Message}");
    }

    /// <summary>
    /// 按正常、告警、故障、离线顺序轮巡当前模型。离线状态会始终写入正式状态接口，
    /// 其视觉是否显示由共享配置开关决定，从而同时覆盖状态缓存与展示开关两条路径。
    /// </summary>
    private IEnumerator RunVisualStateTest()
    {
        for (int stateIndex = 0; stateIndex < VisualStates.Length; stateIndex++)
        {
            ApplyVisualState(VisualStates[stateIndex]);
            yield return new WaitForSecondsRealtime(_autoTestInterval);
        }

        _visualStateTestRoutine = null;
        Report($"{_visualStateNodeLabels[_visualStateNodeIndex].text}四态轮巡完成。");
    }

    private void StopVisualStateTest()
    {
        if (_visualStateTestRoutine == null)
        {
            return;
        }

        StopCoroutine(_visualStateTestRoutine);
        _visualStateTestRoutine = null;
    }

    private static string GetVisualStateLabel(BusinessSceneNodeVisualState visualState)
    {
        switch (visualState)
        {
            case BusinessSceneNodeVisualState.Alarm:
                return "告警（半透明覆盖 + 同色描边）";
            case BusinessSceneNodeVisualState.Fault:
                return "故障（半透明覆盖 + 同色描边）";
            case BusinessSceneNodeVisualState.Offline:
                return "离线（由共享配置决定是否显示覆盖）";
            default:
                return "正常（基础视觉）";
        }
    }

    private IEnumerator RunAutoTest()
    {
        _unitId = "all";
        ResetScene();
        yield return new WaitForSecondsRealtime(_autoTestInterval);

        for (int index = 0; index < StepIds.Length; index++)
        {
            EnterStep(StepIds[index], "all", true);
            yield return new WaitForSecondsRealtime(_autoTestInterval);
        }

        ResetScene();
        _autoTestRoutine = null;
        Report("自动巡检完成，场景已重置。");
    }

    private void StopAutoTest()
    {
        if (_autoTestRoutine == null)
        {
            return;
        }

        StopCoroutine(_autoTestRoutine);
        _autoTestRoutine = null;
    }

    /// <summary>
    /// 发送一次新的拓扑节点聚焦命令。每次新聚焦都会生成新的选择标识，
    /// 这样连续选择同一个节点仍会触发一次新的镜头聚焦，而不是被幂等缓存拦截。
    /// </summary>
    private void SendFocusNode(bool reuseSelectionId)
    {
        if (!reuseSelectionId || string.IsNullOrWhiteSpace(_lastFocusSelectionId))
        {
            _lastFocusSelectionId = $"selection.runtime-test.{++_focusSelectionSequence}";
        }

        SendBridgeCommand("focusNode", new TestBridgePayload
        {
            sceneNodeId = _nodeId,
            selectionId = _lastFocusSelectionId,
            isolate = _isolate
        });
    }

    private void SendBridgeCommand(string type, TestBridgePayload payload)
    {
        if (!EnsureBridgeManager())
        {
            return;
        }

        // 编辑器测试面板不经过网页握手；业务命令首次发送前自动补发一次 init，
        // 让 UnityIframeBridgeManager 先绑定当前场景控制器，避免测试必须依赖手动点击顺序。
        if (type != "init" && !_bridgeSessionInitialized)
        {
            InitializeBridgeSession();
        }

        TestBridgeMessage message = new TestBridgeMessage
        {
            channel = "power3d-unity",
            version = 1,
            instanceId = _bridgeInstanceId,
            messageId = $"runtime-test-{++_messageSequence}",
            type = type,
            payload = payload,
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };

        _bridgeManager.ReceiveFromParent(JsonUtility.ToJson(message));
        Report($"桥接 {type}：{_bridgeManager.StatusText}");
    }

    private void InitializeBridgeSession()
    {
        if (_bridgeSessionInitialized || !EnsureBridgeManager())
        {
            return;
        }

        _bridgeSessionInitialized = true;
        SendBridgeCommand("init", new TestBridgePayload());
    }

    private void RunNodeAction(string actionName, Func<bool> action, out string result)
    {
        if (!EnsureProcessController())
        {
            result = "未找到流程控制器。";
            return;
        }

        bool success = action();
        result = success ? $"{actionName}测试通过。" : $"{actionName}测试失败。";
    }

    private bool EnsureProcessController()
    {
        if (_processController == null)
        {
            BindRuntimeReferences();
        }

        if (_processController != null)
        {
            return true;
        }

        Report("未找到 PowerPlantProcessController。\n");
        return false;
    }

    /// <summary>
    /// 仅绑定当前场景已装配的第三层协调器。面板不自行创建协调器，避免测试绕过目录、资源加载器和相机依赖校验。
    /// </summary>
    private bool EnsureProcessDetailCoordinator()
    {
        if (_processDetailCoordinator == null)
        {
            BindRuntimeReferences();
        }

        if (_processDetailCoordinator != null)
        {
            return true;
        }

        Report("未找到 ProcessDetailCoordinator。");
        return false;
    }

    private bool EnsureBridgeManager()
    {
        if (_bridgeManager == null)
        {
            BindRuntimeReferences();
        }

        if (_bridgeManager != null)
        {
            return true;
        }

        Report("未找到 UnityIframeBridgeManager。");
        return false;
    }

    private void BindRuntimeReferences()
    {
        if (_processController == null)
        {
            _processController = GetComponent<PowerPlantProcessController>();
        }

        if (_bridgeManager == null)
        {
            _bridgeManager = GetComponent<UnityIframeBridgeManager>();
        }

        if (_processDetailCoordinator == null)
        {
            _processDetailCoordinator = GetComponent<ProcessDetailCoordinator>();
        }

        if (_processController == null)
        {
            _processController = FindFirstObjectByType<PowerPlantProcessController>();
        }

        if (_bridgeManager == null)
        {
            _bridgeManager = FindFirstObjectByType<UnityIframeBridgeManager>();
        }

        if (_processDetailCoordinator == null)
        {
            _processDetailCoordinator = FindFirstObjectByType<ProcessDetailCoordinator>();
        }
    }

    /// <summary>
    /// 通过协调器公开状态显示当前第三层生命周期；不读取或依赖其私有运行时对象。
    /// </summary>
    private string GetProcessDetailState()
    {
        if (_processDetailCoordinator == null)
        {
            return "关键环节协调器未绑定";
        }

        if (_processDetailCoordinator.IsActive)
        {
            return $"已加载：{_processDetailCoordinator.ActiveProcessDetailId}";
        }

        if (_processDetailCoordinator.HasPreparedProcessDetail)
        {
            return $"已准备待提交：{_processDetailCoordinator.PreparedProcessDetailId}";
        }

        switch (_processDetailCoordinator.ResourceState)
        {
            case ProcessDetailResourceRuntimeState.Loading:
                return "关键环节正在加载。";
            case ProcessDetailResourceRuntimeState.Failed:
                return "关键环节上次加载失败，请查看最近结果。";
            default:
                return "当前未加载关键环节。";
        }
    }

    private string GetProcessState()
    {
        return _processController != null ? _processController.GetStateDescription() : "流程控制器未绑定";
    }

    private string GetBridgeState()
    {
        return _bridgeManager != null ? _bridgeManager.StatusText : "桥接器未绑定";
    }

    private string GetSelectedStepId()
    {
        return _processController != null ? _processController.CurrentStepId : StepIds[0];
    }

    private void Report(string message)
    {
        _lastResult = message;
        Debug.Log($"[{nameof(PowerPlantRuntimeTestPanel)}] {message}", this);
    }

    private void EnsureStyles()
    {
        if (_titleStyle == null)
        {
            _titleStyle = new GUIStyle(GUI.skin.label)
            {
                fontStyle = FontStyle.Bold,
                fontSize = 16
            };
        }

        if (_sectionStyle == null)
        {
            _sectionStyle = new GUIStyle(GUI.skin.label)
            {
                fontStyle = FontStyle.Bold,
                margin = new RectOffset(0, 0, 6, 2)
            };
        }
    }
}

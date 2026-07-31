using System;
using System.Collections;
using UnityEngine;
using UnityEngine.InputSystem;

[DisallowMultipleComponent]
public sealed class PowerPlantRuntimeTestPanel : MonoBehaviour
{
    private const string ProcessId = "gas-power-generation";
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

    private static readonly string[] RouteIds =
    {
        "route.steam-to-turbine.1",
        "route.turbine-to-condenser.1",
        "route.steam-to-turbine.2",
        "route.turbine-to-condenser.2",
        "route.inlet-to-gas-turbine.1",
        "route.exhaust-to-hrsg.1",
        "route.inlet-to-gas-turbine.2",
        "route.exhaust-to-hrsg.2"
    };

    private static readonly string[] RouteLabels =
    {
        "管道 1：蒸汽→汽轮机（1）",
        "管道 2：汽轮机→冷凝器（1）",
        "管道 3：蒸汽→汽轮机（2）",
        "管道 4：汽轮机→冷凝器（2）",
        "管道 5：进气→燃机（1）",
        "管道 6：燃机→余热锅炉（1）",
        "管道 7：进气→燃机（2）",
        "管道 9：燃机→余热锅炉（2）"
    };

    [SerializeField] private PowerPlantProcessController _processController;
    [SerializeField] private UnityIframeBridgeManager _bridgeManager;

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
    private string _nodeId = "node.gas-turbine.1";
    private string _routeId = "route.exhaust-to-hrsg.1";
    private float _flowSpeed = 1f;
    private string _lastResult = "尚未执行测试。";
    private Vector2 _scrollPosition;
    private Coroutine _autoTestRoutine;
    private Coroutine _routeTestRoutine;
    private GUIStyle _titleStyle;
    private GUIStyle _sectionStyle;
    private int _messageSequence;

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
        public string routeId;
        public bool isolate;
        public bool enabled;
        public float speed;
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
        StopRouteTest();
    }

#if UNITY_EDITOR || DEVELOPMENT_BUILD
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
        DrawRouteControls();
        DrawBridgeControls();

        GUILayout.Space(4f);
        GUILayout.Label("交互验证", _sectionStyle);
        GUILayout.Label("隐藏面板后，左键点击设备应更新桥接状态为“已选择对象”；WASD/QE、Shift、右键拖动可验证自由相机并取消镜头转场。");
        GUILayout.EndScrollView();
        GUILayout.EndArea();
    }
#endif

    private void DrawProcessControls()
    {
        GUILayout.Space(4f);
        GUILayout.Label("流程、显隐与镜头", _sectionStyle);
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

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("聚焦"))
        {
            RunNodeAction("聚焦", () => _processController.TryFocusNode(_nodeId, _isolate, out string message), out string result);
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

    private void DrawRouteControls()
    {
        GUILayout.Space(4f);
        GUILayout.Label("管道路由测试", _sectionStyle);
        GUILayout.BeginHorizontal();
        GUILayout.Label("路由", GUILayout.Width(52f));
        for (int index = 0; index < RouteIds.Length; index++)
        {
            if (GUILayout.Toggle(_routeId == RouteIds[index], $"管{(index < 7 ? index + 1 : 9)}", "Button", GUILayout.Width(42f)) && _routeId != RouteIds[index])
            {
                _routeId = RouteIds[index];
            }
        }
        GUILayout.EndHorizontal();
        GUILayout.Label(GetRouteLabel(_routeId));

        GUILayout.BeginHorizontal();
        GUILayout.Label("路由 ID", GUILayout.Width(52f));
        _routeId = GUILayout.TextField(_routeId);
        GUILayout.EndHorizontal();

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("全部开启"))
        {
            SetAllRouteFlows(true);
        }

        if (GUILayout.Button("全部停止"))
        {
            SetAllRouteFlows(false);
        }

        if (GUILayout.Button("自动轮巡"))
        {
            if (_routeTestRoutine == null)
            {
                _routeTestRoutine = StartCoroutine(RunRouteTest());
            }
            else
            {
                StopRouteTest();
                Report("已停止管道路由轮巡。");
            }
        }
        GUILayout.EndHorizontal();

        GUILayout.BeginHorizontal();
        GUILayout.Label("速度", GUILayout.Width(52f));
        string speedText = GUILayout.TextField(_flowSpeed.ToString("0.##"), GUILayout.Width(72f));
        if (float.TryParse(speedText, out float speed) && speed > 0f)
        {
            _flowSpeed = speed;
        }

        if (GUILayout.Button("开启流动"))
        {
            RunNodeAction("开启路由", () => _processController.TrySetRouteFlow(_routeId, true, _flowSpeed, out string message), out string result);
            Report(result);
        }

        if (GUILayout.Button("停止流动"))
        {
            RunNodeAction("停止路由", () => _processController.TrySetRouteFlow(_routeId, false, _flowSpeed, out string message), out string result);
            Report(result);
        }
        GUILayout.EndHorizontal();
    }

    private void SetAllRouteFlows(bool enabled)
    {
        if (!EnsureProcessController())
        {
            return;
        }

        int successCount = 0;
        for (int index = 0; index < RouteIds.Length; index++)
        {
            if (_processController.TrySetRouteFlow(RouteIds[index], enabled, _flowSpeed, out _))
            {
                successCount++;
            }
        }

        Report(enabled
            ? $"已开启 {successCount}/{RouteIds.Length} 条管道路由。"
            : $"已停止 {successCount}/{RouteIds.Length} 条管道路由。");
    }

    private static string GetRouteLabel(string routeId)
    {
        for (int index = 0; index < RouteIds.Length; index++)
        {
            if (RouteIds[index] == routeId)
            {
                return RouteLabels[index];
            }
        }

        return "自定义路由 ID";
    }

    private IEnumerator RunRouteTest()
    {
        if (!EnsureProcessController())
        {
            _routeTestRoutine = null;
            yield break;
        }

        SetAllRouteFlows(false);
        for (int index = 0; index < RouteIds.Length; index++)
        {
            _routeId = RouteIds[index];
            bool success = _processController.TrySetRouteFlow(_routeId, true, _flowSpeed, out string message);
            Report(success ? $"轮巡 {GetRouteLabel(_routeId)}：{message}" : $"轮巡失败 {GetRouteLabel(_routeId)}：{message}");
            yield return new WaitForSecondsRealtime(_autoTestInterval);
            _processController.TrySetRouteFlow(_routeId, false, _flowSpeed, out _);
        }

        _routeTestRoutine = null;
        Report("管道路由轮巡完成，已停止全部流动效果。");
    }

    private void StopRouteTest()
    {
        if (_routeTestRoutine == null)
        {
            return;
        }

        StopCoroutine(_routeTestRoutine);
        _routeTestRoutine = null;
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
            SendBridgeCommand("init", new TestBridgePayload());
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

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("聚焦节点"))
        {
            SendBridgeCommand("focusNode", new TestBridgePayload { nodeId = _nodeId, isolate = _isolate });
        }

        if (GUILayout.Button("节点显示"))
        {
            SendBridgeCommand("setNodeVisibility", new TestBridgePayload { nodeId = _nodeId, enabled = true });
        }

        if (GUILayout.Button("节点半透明"))
        {
            SendBridgeCommand("setNodeVisibility", new TestBridgePayload { nodeId = _nodeId, enabled = false });
        }
        GUILayout.EndHorizontal();

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("路由流动"))
        {
            SendBridgeCommand("setRouteFlow", new TestBridgePayload { routeId = _routeId, enabled = true, speed = _flowSpeed });
        }

        if (GUILayout.Button("路由停止"))
        {
            SendBridgeCommand("setRouteFlow", new TestBridgePayload { routeId = _routeId, enabled = false, speed = _flowSpeed });
        }

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

    private void SendBridgeCommand(string type, TestBridgePayload payload)
    {
        if (!EnsureBridgeManager())
        {
            return;
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

        if (_processController == null)
        {
            _processController = FindFirstObjectByType<PowerPlantProcessController>();
        }

        if (_bridgeManager == null)
        {
            _bridgeManager = FindFirstObjectByType<UnityIframeBridgeManager>();
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

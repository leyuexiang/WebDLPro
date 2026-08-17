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
    private string _lastResult = "尚未执行测试。";
    private Vector2 _scrollPosition;
    private Coroutine _autoTestRoutine;
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
        DrawBridgeControls();

        GUILayout.Space(4f);
        GUILayout.Label("交互验证", _sectionStyle);
        GUILayout.Label("隐藏面板后，左键点击设备应更新桥接状态为“已选择对象”；流程、总览和节点描边均应保持当前视角；WASD/QE、Shift、右键拖动可验证自由相机。 ");
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
            SendBridgeCommand("focusNode", new TestBridgePayload
            {
                sceneNodeId = _nodeId,
                selectionId = $"selection.runtime-test.{_messageSequence + 1}",
                isolate = _isolate
            });
        }

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

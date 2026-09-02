using UnityEngine;
using UnityEngine.InputSystem;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 燃煤场景三态视觉的编辑器播放测试面板。
/// 面板只在 Unity 编辑器内编译显示，不进入正式 WebGL 界面；按钮直接调用场景控制器的公开受控接口，
/// 因此验证的是告警、故障、离线半透明覆盖与同色描边的真实运行路径，而不是测试专用替代效果。
/// </summary>
[DisallowMultipleComponent]
public sealed class CoalPowerVisualStateTestPanel : MonoBehaviour
{
    private const string CoalPowerGenerationProcessId = "coal-power-generation";
    private const string AllUnitsId = "all";

    // 顺序与 CoalPower 场景中已序列化的流程步骤映射保持一致；测试面板只使用这些稳定标识，
    // 不通过模型名称或层级路径推断关键环节，从而与网页桥接进入流程的实际路径完全相同。
    private static readonly string[] ProcessStepIds =
    {
        "overview",
        "combustion",
        "water-steam-cycle",
        "power-output"
    };

    private static readonly string[] ProcessStepLabels =
    {
        "总览",
        "燃烧系统",
        "水汽循环",
        "电力送出"
    };

    // 顺序与 CoalPower 场景属性面板中的一图元一模型绑定保持一致；测试面板只使用稳定节点标识，
    // 不通过模型名称或层级路径推断设备，从而与网页拓扑和 Unity 反向选择使用同一份映射语义。
    private static readonly string[] NodeIds =
    {
        "node.coal-feeder",
        "node.coal-boiler",
        "node.coal-steam-turbine",
        "node.coal-generator",
        "node.coal-precipitator"
    };

    private static readonly string[] NodeLabels =
    {
        "给煤机",
        "锅炉",
        "汽轮机",
        "发电机",
        "除尘器"
    };

    [SerializeField] private PowerPlantProcessController _processController;
    [SerializeField] private bool _showPanel = true;

    private int _selectedNodeIndex;
    private string _lastResult = "请选择设备与状态。";
    private GUIStyle _titleStyle;
    private GUIStyle _resultStyle;

    private void Awake()
    {
        if (_processController == null)
        {
            _processController = GetComponent<PowerPlantProcessController>();
        }
    }

#if UNITY_EDITOR
    private void Update()
    {
        if (Keyboard.current != null && Keyboard.current.f9Key.wasPressedThisFrame)
        {
            _showPanel = !_showPanel;
        }
    }

    private void OnGUI()
    {
        EnsureStyles();
        if (!_showPanel)
        {
            if (GUI.Button(new Rect(12f, 12f, 150f, 32f), "显示三态测试 (F9)"))
            {
                _showPanel = true;
            }
            return;
        }

        const float width = 430f;
        const float height = 342f;
        Rect panelRect = new Rect(12f, 12f, Mathf.Min(width, Screen.width - 24f), height);
        GUI.Box(panelRect, GUIContent.none);
        GUILayout.BeginArea(new Rect(panelRect.x + 12f, panelRect.y + 10f, panelRect.width - 24f, panelRect.height - 20f));

        GUILayout.BeginHorizontal();
        GUILayout.Label("燃煤设备三态视觉测试", _titleStyle);
        if (GUILayout.Button("隐藏 (F9)", GUILayout.Width(90f)))
        {
            _showPanel = false;
        }
        GUILayout.EndHorizontal();

        GUILayout.Space(6f);
        GUILayout.Label("流程直接切换：");
        GUILayout.BeginHorizontal();
        DrawProcessStepButton(0);
        DrawProcessStepButton(1);
        GUILayout.EndHorizontal();
        GUILayout.BeginHorizontal();
        DrawProcessStepButton(2);
        DrawProcessStepButton(3);
        GUILayout.EndHorizontal();

        GUILayout.Label("选择设备：");
        GUILayout.BeginHorizontal();
        for (int nodeIndex = 0; nodeIndex < NodeLabels.Length; nodeIndex++)
        {
            bool selected = _selectedNodeIndex == nodeIndex;
            if (GUILayout.Toggle(selected, NodeLabels[nodeIndex], "Button") && !selected)
            {
                _selectedNodeIndex = nodeIndex;
            }
        }
        GUILayout.EndHorizontal();

        GUILayout.Space(6f);
        GUILayout.Label("切换状态：");
        GUILayout.BeginHorizontal();
        if (GUILayout.Button("正常"))
        {
            ApplyState(BusinessSceneNodeVisualState.Normal);
        }
        if (GUILayout.Button("告警"))
        {
            ApplyState(BusinessSceneNodeVisualState.Alarm);
        }
        if (GUILayout.Button("故障"))
        {
            ApplyState(BusinessSceneNodeVisualState.Fault);
        }
        GUILayout.EndHorizontal();

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("三设备同时展示"))
        {
            ApplyThreeStatePreview();
        }
        if (GUILayout.Button("清除当前设备"))
        {
            ClearSelectedNode();
        }
        if (GUILayout.Button("全部清除"))
        {
            ClearAllNodes();
        }
        GUILayout.EndHorizontal();

        GUILayout.Space(6f);
        GUILayout.Label(_lastResult, _resultStyle, GUILayout.MinHeight(38f));
        GUILayout.EndArea();
    }
#endif

    /// <summary>
    /// 直接进入燃煤场景属性面板已配置的流程步骤。总览恢复全厂层级，三个关键环节则由
    /// PowerPlantProcessController（发电厂流程控制器）统一处理无关模型的原色半透明与焦点描边。
    /// 测试入口不直接修改物体激活状态或材质，避免与网页桥接的正式行为出现差异。
    /// </summary>
    private void DrawProcessStepButton(int stepIndex)
    {
        if (GUILayout.Button(ProcessStepLabels[stepIndex], GUILayout.ExpandWidth(true)))
        {
            EnterProcessStep(ProcessStepIds[stepIndex]);
        }
    }

    private void EnterProcessStep(string stepId)
    {
        if (!TryGetController())
        {
            return;
        }

        // 关键环节明确使用 isolate（隔离）模式，确保按钮验证的是当前流程定义的核心模型
        // 与无关模型半透明上下文；overview（总览）由控制器内部忽略该参数并恢复全场展示。
        bool success = _processController.TryEnterProcessStep(
            CoalPowerGenerationProcessId,
            stepId,
            AllUnitsId,
            true,
            out string message);
        Report(success ? $"已切换至{GetProcessStepLabel(stepId)}：{message}" : $"流程切换失败：{message}");
    }

    private static string GetProcessStepLabel(string stepId)
    {
        for (int stepIndex = 0; stepIndex < ProcessStepIds.Length; stepIndex++)
        {
            if (ProcessStepIds[stepIndex] == stepId)
            {
                return ProcessStepLabels[stepIndex];
            }
        }

        return stepId;
    }

    private void ApplyState(BusinessSceneNodeVisualState visualState)
    {
        if (!TryGetController())
        {
            return;
        }

        string nodeId = NodeIds[_selectedNodeIndex];
        BusinessSceneCommandResult result = _processController.UpdateNodeVisualState(nodeId, visualState);
        Report(result.Success
            ? $"{NodeLabels[_selectedNodeIndex]}：{GetStateLabel(visualState)}"
            : $"失败：{result.Message}");
    }

    private void ApplyThreeStatePreview()
    {
        if (!TryGetController())
        {
            return;
        }

        BusinessSceneNodeVisualState[] states =
        {
            BusinessSceneNodeVisualState.Alarm,
            BusinessSceneNodeVisualState.Fault,
            BusinessSceneNodeVisualState.Normal
        };
        for (int nodeIndex = 0; nodeIndex < NodeIds.Length; nodeIndex++)
        {
            BusinessSceneCommandResult result = _processController.UpdateNodeVisualState(NodeIds[nodeIndex], states[nodeIndex]);
            if (!result.Success)
            {
                Report($"三设备展示失败：{result.Message}");
                return;
            }
        }

        Report("锅炉=告警，汽轮机=故障，发电机=正常。离线视觉由共享配置开关控制。");
    }

    private void ClearSelectedNode()
    {
        if (!TryGetController())
        {
            return;
        }

        BusinessSceneCommandResult result = _processController.ClearNodeVisualState(NodeIds[_selectedNodeIndex]);
        Report(result.Success ? $"已清除：{NodeLabels[_selectedNodeIndex]}" : $"失败：{result.Message}");
    }

    private void ClearAllNodes()
    {
        if (!TryGetController())
        {
            return;
        }

        for (int nodeIndex = 0; nodeIndex < NodeIds.Length; nodeIndex++)
        {
            BusinessSceneCommandResult result = _processController.ClearNodeVisualState(NodeIds[nodeIndex]);
            if (!result.Success)
            {
                Report($"全部清除失败：{result.Message}");
                return;
            }
        }

        Report("已恢复三个设备的基础视觉。");
    }

    private bool TryGetController()
    {
        if (_processController == null)
        {
            _processController = GetComponent<PowerPlantProcessController>();
        }
        if (_processController != null)
        {
            return true;
        }

        Report("未绑定燃煤场景控制器。");
        return false;
    }

    private void Report(string message)
    {
        _lastResult = message;
        Debug.Log($"[{nameof(CoalPowerVisualStateTestPanel)}] {message}", this);
    }

    private static string GetStateLabel(BusinessSceneNodeVisualState visualState)
    {
        switch (visualState)
        {
            case BusinessSceneNodeVisualState.Alarm:
                return "告警半透明覆盖 + 同色描边";
            case BusinessSceneNodeVisualState.Fault:
                return "故障半透明覆盖 + 同色描边";
            default:
                return "正常基础视觉";
        }
    }

    private void EnsureStyles()
    {
        if (_titleStyle == null)
        {
            _titleStyle = new GUIStyle(GUI.skin.label)
            {
                fontSize = 16,
                fontStyle = FontStyle.Bold
            };
        }
        if (_resultStyle == null)
        {
            _resultStyle = new GUIStyle(GUI.skin.box)
            {
                alignment = TextAnchor.MiddleLeft,
                wordWrap = true
            };
        }
    }
}

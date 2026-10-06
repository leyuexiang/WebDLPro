#if UNITY_EDITOR
using System.Collections.Generic;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 编辑器播放模式下的总览区域高亮验证面板：模拟外层六按钮（调度中心/发电/输变电/配电/用电/微电网），
/// 逐区域触发区域高亮与飞线动画，验证切换时上一区域的共享材质回滚、光晕显隐恢复与飞线播完自动隐藏；
/// 提供轮询开关按钮验证循环播放、关闭恢复与手动接管终止；提供配置静态校验入口，围栏结构或材质属性漂移在播放前即可定位。
/// 仅编辑器运行态可见；整类编译期从一切 player 构建剥离。
/// </summary>
[DisallowMultipleComponent]
public sealed class OverviewAreaHighlightVerifyPanel : MonoBehaviour
{
    [SerializeField] private OverviewAreaHighlightController _controller;
    [Header("面板设置")]
    [SerializeField] private bool _showPanel = true;
    [SerializeField] private KeyCode _toggleKey = KeyCode.F10;

    private string _lastResult = "尚未执行验证。";
    private Vector2 _scrollPosition;
    private readonly List<string> _validationProblems = new List<string>();
    private GUIStyle _titleLabelStyle;
    private GUIStyle _resultLabelStyle;
    private GUIStyle _areaButtonStyle;
    private GUIStyle _actionButtonStyle;
    private bool _stylesInitialized;

    private void OnEnable()
    {
        if (_controller == null)
        {
            _controller = FindFirstObjectByType<OverviewAreaHighlightController>();
        }
    }

    private void Update()
    {
        if (Input.GetKeyDown(_toggleKey))
        {
            _showPanel = !_showPanel;
        }
    }

    private void OnGUI()
    {
        if (!_showPanel || !Application.isPlaying)
        {
            return;
        }

        InitializeStyles();
        var panelRect = new Rect(16f, 16f, 340f, Mathf.Min(Screen.height - 32f, 560f));
        GUI.Box(panelRect, GUIContent.none);
        GUILayout.BeginArea(new Rect(panelRect.x + 10f, panelRect.y + 10f, panelRect.width - 20f, panelRect.height - 20f));

        GUILayout.Label("总览区域高亮验证面板", _titleLabelStyle);
        if (_controller == null)
        {
            GUILayout.Label("未找到 OverviewAreaHighlightController，请先在场景中挂接控制器。", _resultLabelStyle);
            GUILayout.EndArea();
            return;
        }

        GUILayout.Label(
            $"活动区域：{(_controller.ActiveAreaId.Length > 0 ? OverviewAreaHighlightController.GetAreaDisplayName(_controller.ActiveAreaId) : "无")}（围栏 {_controller.ActiveFenceCount} 座）",
            _resultLabelStyle);
        GUILayout.Label($"飞线播放中：{(_controller.IsDispatchFlightPlaying ? "是" : "否")}", _resultLabelStyle);
        string pollState = _controller.IsPollingActive
            ? $"轮询：开（当前 {OverviewAreaHighlightController.GetAreaDisplayName(_controller.PollingCurrentAreaId)}，{Mathf.Ceil(_controller.PollingSecondsUntilNextSwitch)} 秒后切换）"
            : "轮询：关";
        GUILayout.Label(pollState, _resultLabelStyle);
        GUILayout.Space(6f);

        string[] areaIds = OverviewAreaHighlightController.AllAreaIds;
        for (int areaIndex = 0; areaIndex < areaIds.Length; areaIndex++)
        {
            string areaId = areaIds[areaIndex];
            bool isActive =
                string.Equals(_controller.ActiveAreaId, areaId, System.StringComparison.Ordinal) ||
                (areaIndex == 0 && _controller.IsDispatchFlightPlaying);
            string buttonContent = (isActive ? "● " : string.Empty) + (areaIndex + 1) + ". " +
                OverviewAreaHighlightController.GetAreaDisplayName(areaId);
            if (GUILayout.Button(buttonContent, _areaButtonStyle))
            {
                BusinessSceneCommandResult result = _controller.ActivateArea(areaId);
                _lastResult = result.Success
                    ? $"[{OverviewAreaHighlightController.GetAreaDisplayName(areaId)}] 激活通过：{result.Message}"
                    : $"[{OverviewAreaHighlightController.GetAreaDisplayName(areaId)}] 激活失败：{result.Message}";
            }
        }

        GUILayout.Space(8f);
        string pollButtonLabel = _controller.IsPollingActive
            ? "轮询开关：停止循环播放"
            : "轮询开关：开始循环播放";
        if (GUILayout.Button(pollButtonLabel, _actionButtonStyle))
        {
            BusinessSceneCommandResult result = _controller.SetPolling(!_controller.IsPollingActive);
            _lastResult = result.Success
                ? $"[轮询] 通过：{result.Message}"
                : $"[轮询] 失败：{result.Message}";
        }
        if (GUILayout.Button("恢复默认（回滚材质并停止飞线）", _actionButtonStyle))
        {
            BusinessSceneCommandResult result = _controller.Deactivate();
            _lastResult = result.Success
                ? $"[恢复默认] 通过：{result.Message}"
                : $"[恢复默认] 失败：{result.Message}";
        }
        if (GUILayout.Button("校验配置（播放前静态检查）", _actionButtonStyle))
        {
            _validationProblems.Clear();
            _validationProblems.AddRange(_controller.CollectConfigurationProblems());
            _lastResult = _validationProblems.Count == 0
                ? "[校验配置] 通过：围栏结构、材质属性与飞线绑定全部合法。"
                : $"[校验配置] 发现 {_validationProblems.Count} 项问题：";
        }

        if (_validationProblems.Count > 0)
        {
            _scrollPosition = GUILayout.BeginScrollView(_scrollPosition, false, true, GUILayout.MaxHeight(160f));
            for (int problemIndex = 0; problemIndex < _validationProblems.Count; problemIndex++)
            {
                GUILayout.Label($"{problemIndex + 1}. {_validationProblems[problemIndex]}", _resultLabelStyle);
            }
            GUILayout.EndScrollView();
        }

        GUILayout.Space(4f);
        GUILayout.Label(_lastResult, _resultLabelStyle);
        GUILayout.EndArea();
    }

    private void InitializeStyles()
    {
        if (_stylesInitialized)
        {
            return;
        }
        _titleLabelStyle = new GUIStyle(GUI.skin.label) { fontSize = 15, fontStyle = FontStyle.Bold };
        _resultLabelStyle = new GUIStyle(GUI.skin.label) { fontSize = 12, wordWrap = true };
        _areaButtonStyle = new GUIStyle(GUI.skin.button) { fontSize = 13, alignment = TextAnchor.MiddleLeft };
        _actionButtonStyle = new GUIStyle(GUI.skin.button) { fontSize = 13 };
        _stylesInitialized = true;
    }
}
#endif // UNITY_EDITOR —— 编辑器验证面板不进入任何 player 构建

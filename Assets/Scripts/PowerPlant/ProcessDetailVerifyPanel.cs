#if UNITY_EDITOR
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 编辑器播放模式下的关键环节验证面板：按场景目录为当前场景的每个关键环节生成按钮，
/// 点击后复用正式协调器的 EnterAsync 加载与相机切换进入对应第三层；
/// 提供统一退出按钮，验证协调器的资源租约与交互门恢复路径。
/// 仅运行时可见；目录资产缺省时在编辑器运行态按固定路径加载。
/// </summary>
[DisallowMultipleComponent]
public sealed class ProcessDetailVerifyPanel : MonoBehaviour
{
    private const string EditorCatalogPath = "Assets/Configuration/ProcessDetailCatalog.asset";

    [SerializeField] private ProcessDetailCoordinator _processDetailCoordinator;
    [Tooltip("关键环节目录资产；留空且在编辑器中运行时按固定路径自动加载。")]
    [SerializeField] private ProcessDetailCatalog _catalog;
    [Header("面板设置")]
    [SerializeField] private bool _showPanel = true;
    [SerializeField] private KeyCode _toggleKey = KeyCode.F9;

    private readonly List<ProcessDetailCatalogEntry> _entries = new List<ProcessDetailCatalogEntry>();
    private string _sceneId = string.Empty;
    private Coroutine _enterRoutine;
    private string _enterTransitionId = string.Empty;
    private string _lastResult = "尚未执行验证。";
    private Vector2 _scrollPosition;
    private GUIStyle _titleLabelStyle;
    private GUIStyle _resultLabelStyle;
    private GUIStyle _entryButtonStyle;
    private GUIStyle _exitButtonStyle;
    private GUIStyle _actionButtonStyle;
    private bool _stylesInitialized;
    // 状态模拟经它把四态同步到二层业务模型；纯浏览场景缺失时只更新第三层实例。
    private PowerPlantProcessController _processController;

    private void OnEnable()
    {
        ResolveBindings();
        RefreshEntries();
    }

    private void Update()
    {
        if (Input.GetKeyDown(_toggleKey))
        {
            _showPanel = !_showPanel;
        }
        RefreshEntries();
    }

    /// <summary>引用缺失时在唤醒阶段自动解析；场景标识优先取自协调器序列化值，桥接器常驻化后场景名推断不可靠。</summary>
    private void ResolveBindings()
    {
        if (_processDetailCoordinator == null)
        {
            _processDetailCoordinator = FindFirstObjectByType<ProcessDetailCoordinator>();
        }
        // 协调器的场景标识是唯一权威来源：编辑器直连 Play 时桥接器会把根对象搬入 DontDestroyOnLoad，
        // 若仍从场景名推断会得到 dont-destroy-on-load 并过滤出空关键环节清单。
        if (string.IsNullOrEmpty(_sceneId) && _processDetailCoordinator != null)
        {
            _sceneId = _processDetailCoordinator.SceneId;
        }
        if (_catalog == null)
        {
#if UNITY_EDITOR
            _catalog = UnityEditor.AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(EditorCatalogPath);
#endif
        }
        if (string.IsNullOrEmpty(_sceneId))
        {
            // 业务场景遵循 PascalCase 文件名与 kebab-case 场景标识一一对应的命名规范。
            string sceneName = gameObject.scene.name;
            if (!string.IsNullOrEmpty(sceneName) &&
                !string.Equals(sceneName, "BusinessSceneRuntime", StringComparison.Ordinal) &&
                !string.Equals(sceneName, "DontDestroyOnLoad", StringComparison.Ordinal))
            {
                _sceneId = ToKebabSceneId(sceneName);
            }
        }
    }

    /// <summary>按当前场景从目录刷新关键环节按钮清单；每次全量重建跟随目录调整。</summary>
    private void RefreshEntries()
    {
        if (_catalog == null) return;
        _entries.Clear();
        foreach (var entry in _catalog.Entries)
        {
            if (string.Equals(entry.SceneId, _sceneId, StringComparison.Ordinal))
            {
                _entries.Add(entry);
            }
        }
    }

    /// <summary>场景节点遵循 PascalCase 文件名与 kebab-case 场景标识的固定映射，不做模糊匹配。</summary>
    private static string ToKebabSceneId(string pascalName)
    {
        if (string.IsNullOrEmpty(pascalName)) return string.Empty;
        var builder = new System.Text.StringBuilder();
        for (int index = 0; index < pascalName.Length; index++)
        {
            char character = pascalName[index];
            if (char.IsUpper(character) && index > 0)
            {
                builder.Append('-');
            }
            builder.Append(char.ToLowerInvariant(character));
        }
        return builder.ToString();
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

        GUILayout.Label("关键环节验证面板", _titleLabelStyle);
        GUILayout.Label($"场景：{_sceneId}", _resultLabelStyle);
        GUILayout.Label($"已加载环节：{(_processDetailCoordinator != null && _processDetailCoordinator.IsActive ? _processDetailCoordinator.ActiveProcessDetailId : "无")}", _resultLabelStyle);
        GUILayout.Space(6f);

        if (_entries.Count == 0)
        {
            GUILayout.Label("当前场景没有登记的关键环节。", _resultLabelStyle);
        }
        else
        {
            _scrollPosition = GUILayout.BeginScrollView(_scrollPosition, false, true, GUILayout.MaxHeight(360f));
            for (int entryIndex = 0; entryIndex < _entries.Count; entryIndex++)
            {
                var entry = _entries[entryIndex];
                bool isCurrent = _processDetailCoordinator != null && _processDetailCoordinator.IsActive &&
                    string.Equals(_processDetailCoordinator.ActiveProcessDetailId, entry.ProcessDetailId, StringComparison.Ordinal);
                var buttonContent = new GUIContent((isCurrent ? "● " : string.Empty) + (entryIndex + 1) + ". " + entry.StepId);
                if (GUILayout.Button(buttonContent, _entryButtonStyle))
                {
                    StartEnter(entry);
                }
            }
            GUILayout.EndScrollView();
        }

        GUILayout.Space(8f);
        if (GUILayout.Button("退出当前关键环节", _exitButtonStyle))
        {
            ExitCurrent();
        }
        DrawActiveDetailStateControls();
        GUILayout.Space(4f);
        GUILayout.Label(_lastResult, _resultLabelStyle);
        GUILayout.EndArea();
    }

    /// <summary>
    /// 活动环节的状态模拟：把四态写入当前环节登记的状态节点，与生产路径同构——
    /// 先经流程控制器更新二层模型，再经协调器投影到第三层实例（故障会下发 faultStop 停播，
    /// 如燃煤汽轮机箭头停流、轴延迟减速；正常恢复播放）。
    /// </summary>
    private void DrawActiveDetailStateControls()
    {
        if (_processDetailCoordinator == null || !_processDetailCoordinator.IsActive)
        {
            return;
        }
        string activeStateNode = FindActiveStateNode();
        if (string.IsNullOrEmpty(activeStateNode))
        {
            GUILayout.Label("当前活动环节没有登记状态节点，无法模拟状态。", _resultLabelStyle);
            return;
        }

        GUILayout.Space(4f);
        GUILayout.Label($"状态模拟（写入节点 {activeStateNode}）", _resultLabelStyle);
        GUILayout.BeginHorizontal();
        if (GUILayout.Button("正常", _actionButtonStyle)) ApplyActiveState(activeStateNode, BusinessSceneNodeVisualState.Normal);
        if (GUILayout.Button("告警", _actionButtonStyle)) ApplyActiveState(activeStateNode, BusinessSceneNodeVisualState.Alarm);
        if (GUILayout.Button("故障", _actionButtonStyle)) ApplyActiveState(activeStateNode, BusinessSceneNodeVisualState.Fault);
        if (GUILayout.Button("离线", _actionButtonStyle)) ApplyActiveState(activeStateNode, BusinessSceneNodeVisualState.Offline);
        GUILayout.EndHorizontal();
        if (GUILayout.Button("清除关键环节状态（恢复默认视觉）", _actionButtonStyle))
        {
            ClearActiveState(activeStateNode);
        }
    }

    /// <summary>从目录反查当前活动环节登记的第一个状态节点；多节点环节取主节点即可驱动整体故障行为。</summary>
    private string FindActiveStateNode()
    {
        if (_catalog == null || _processDetailCoordinator == null)
        {
            return null;
        }
        string activeId = _processDetailCoordinator.ActiveProcessDetailId;
        if (string.IsNullOrEmpty(activeId))
        {
            return null;
        }
        foreach (var entry in _catalog.Entries)
        {
            if (entry != null &&
                string.Equals(entry.ProcessDetailId, activeId, StringComparison.Ordinal) &&
                entry.StateNodeIds.Count > 0)
            {
                return entry.StateNodeIds[0];
            }
        }
        return null;
    }

    /// <summary>与运行时测试面板同构的两步下发：流程控制器（二层模型染色）→ 协调器（三层实例状态与播放许可）。</summary>
    private void ApplyActiveState(string stateNodeId, BusinessSceneNodeVisualState visualState)
    {
        if (_processController == null)
        {
            _processController = FindFirstObjectByType<PowerPlantProcessController>();
        }
        BusinessSceneCommandResult controllerResult = _processController != null
            ? _processController.UpdateNodeVisualState(stateNodeId, visualState)
            : BusinessSceneCommandResult.Completed("流程控制器不在场景中，仅更新第三层实例。");
        if (!controllerResult.Success)
        {
            _lastResult = $"[{GetVisualStateLabel(visualState)}] 二层更新失败：{controllerResult.Message}";
            return;
        }
        BusinessSceneCommandResult result = _processDetailCoordinator.UpdateNodeVisualState(stateNodeId, visualState);
        _lastResult = result.Success
            ? $"[{GetVisualStateLabel(visualState)}] 已作用于 {stateNodeId}。"
            : $"[{GetVisualStateLabel(visualState)}] 三层更新失败：{result.Message}";
    }

    private void ClearActiveState(string stateNodeId)
    {
        if (_processController == null)
        {
            _processController = FindFirstObjectByType<PowerPlantProcessController>();
        }
        _processController?.ClearNodeVisualState(stateNodeId);
        BusinessSceneCommandResult result = _processDetailCoordinator.ClearNodeVisualState(stateNodeId);
        _lastResult = result.Success
            ? $"[清除状态] {stateNodeId} 已恢复默认视觉。"
            : $"[清除状态] 失败：{result.Message}";
    }

    private static string GetVisualStateLabel(BusinessSceneNodeVisualState visualState)
    {
        switch (visualState)
        {
            case BusinessSceneNodeVisualState.Normal: return "正常";
            case BusinessSceneNodeVisualState.Alarm: return "告警";
            case BusinessSceneNodeVisualState.Fault: return "故障";
            case BusinessSceneNodeVisualState.Offline: return "离线";
            default: return visualState.ToString();
        }
    }

    /// <summary>点击按钮进入对应关键环节：使用唯一事务标识并缓存协程句柄便于取消。</summary>
    private void StartEnter(ProcessDetailCatalogEntry entry)
    {
        if (_processDetailCoordinator == null)
        {
            _lastResult = "协调器未找到，验证面板缺少必要引用。";
            return;
        }
        if (_enterRoutine != null)
        {
            StopCoroutine(_enterRoutine);
            _enterRoutine = null;
        }

        _enterTransitionId = $"verify-panel.{entry.ProcessDetailId}.{Time.frameCount}";
        _lastResult = $"正在进入 {entry.StepId} …";
        _enterRoutine = StartCoroutine(EnterDetailAsync(entry, _enterTransitionId));
    }

    /// <summary>与现有测试面板一致的进入协程：回调结果在协程结束后统一输出。</summary>
    private IEnumerator EnterDetailAsync(ProcessDetailCatalogEntry entry, string transitionId)
    {
        BusinessSceneCommandResult result = default;
        IEnumerator entering = _processDetailCoordinator.EnterAsync(
            entry.SceneId,
            entry.ProcessId,
            entry.StepId,
            entry.ProcessDetailId,
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
        _enterRoutine = null;
        if (!result.Success)
        {
            _enterTransitionId = string.Empty;
        }
        _lastResult = result.Success
            ? $"[{entry.StepId}] 进入通过：{result.Message}"
            : $"[{entry.StepId}] 进入失败：{result.Message}";
    }

    /// <summary>使用进入时生成的同一事务标识退出，验证协调器的资源租约恢复路径。</summary>
    private void ExitCurrent()
    {
        if (_processDetailCoordinator == null)
        {
            return;
        }
        if (_enterRoutine != null)
        {
            StopCoroutine(_enterRoutine);
            _enterRoutine = null;
        }
        if (!_processDetailCoordinator.IsActive || string.IsNullOrEmpty(_enterTransitionId))
        {
            _lastResult = "当前没有已加载的关键环节。";
            return;
        }

        BusinessSceneCommandResult result = _processDetailCoordinator.Exit(
            entrySceneId(),
            _processDetailCoordinator.ActiveProcessDetailId,
            _enterTransitionId);
        if (result.Success)
        {
            _enterTransitionId = string.Empty;
        }
        _lastResult = result.Success
            ? $"退出通过：{result.Message}"
            : $"退出失败：{result.Message}";
    }

    /// <summary>退出场景标识必须与进入时使用的一致，从目录反查当前活动环节所属场景。</summary>
    private string entrySceneId()
    {
        if (_processDetailCoordinator != null && !string.IsNullOrEmpty(_processDetailCoordinator.ActiveProcessDetailId))
        {
            foreach (var entry in _catalog.Entries)
            {
                if (string.Equals(entry.ProcessDetailId, _processDetailCoordinator.ActiveProcessDetailId, StringComparison.Ordinal))
                {
                    return entry.SceneId;
                }
            }
        }
        return _sceneId;
    }

    private void InitializeStyles()
    {
        if (_stylesInitialized)
        {
            return;
        }
        _titleLabelStyle = new GUIStyle(GUI.skin.label) { fontSize = 15, fontStyle = FontStyle.Bold };
        _resultLabelStyle = new GUIStyle(GUI.skin.label) { fontSize = 12, wordWrap = true };
        _entryButtonStyle = new GUIStyle(GUI.skin.button) { fontSize = 13, alignment = TextAnchor.MiddleLeft };
        _exitButtonStyle = new GUIStyle(GUI.skin.button) { fontSize = 13 };
        _actionButtonStyle = new GUIStyle(GUI.skin.button) { fontSize = 13 };
        _stylesInitialized = true;
    }
}
#endif // UNITY_EDITOR —— 编辑器验证面板不进入任何 player 构建

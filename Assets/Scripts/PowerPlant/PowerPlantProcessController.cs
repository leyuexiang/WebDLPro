using System;
using System.Collections.Generic;
using HighlightPlus;
using UnityEngine;
using UnityEngine.InputSystem;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 发电厂业务场景的状态控制器。
/// 外部平台只传递流程、步骤、机组和路由标识；模型名称、显隐集合、材质与描边策略全部保留在 Unity 内。
/// </summary>
[DisallowMultipleComponent]
public sealed class PowerPlantProcessController : MonoBehaviour
{
    private const string GasPowerGenerationProcessId = "gas-power-generation";
    private const string OverviewStepId = "overview";
    private const string AllUnitsId = "all";
    [Serializable]
    private sealed class SceneNodeBinding
    {
        [SerializeField] private string _id;
        [SerializeField] private GameObject[] _targets;

        public string Id => _id;
        public GameObject[] Targets => _targets;

        public SceneNodeBinding(string id, GameObject[] targets)
        {
            _id = id;
            _targets = targets ?? Array.Empty<GameObject>();
        }
    }

    /// <summary>
    /// 燃气真实模型的动态四态登记项。
    /// 三维节点标识与目标对象均由场景序列化显式提供，初始化阶段只从这些目标收集渲染器；
    /// 禁止按模型名称、层级路径或二维拓扑节点推断绑定，避免设备状态误着色到相邻模型。
    /// </summary>
    [Serializable]
    private sealed class SceneNodeVisualStateBinding
    {
        [SerializeField] private string _sceneNodeId;
        [SerializeField] private GameObject[] _targets = Array.Empty<GameObject>();

        public string SceneNodeId => _sceneNodeId;
        public GameObject[] Targets => _targets;

        public SceneNodeVisualStateBinding(string sceneNodeId, GameObject[] targets)
        {
            _sceneNodeId = sceneNodeId;
            _targets = targets ?? Array.Empty<GameObject>();
        }
    }

    /// <summary>
    /// 单个流程步骤的场景映射。
    /// stepId、unitId、可见节点和描边节点全部由场景属性面板显式保存；运行时不再按流程名称、模型名称或
    /// 数组顺序猜测目标。unitId 使用归一化后的 all、1、2，允许同一个步骤为总览和不同机组分别登记。
    /// </summary>
    [Serializable]
    private sealed class SceneProcessStepBinding
    {
        [SerializeField] private string _stepId;
        [SerializeField] private string _unitId = AllUnitsId;
        [SerializeField] private string[] _visibleNodeIds = Array.Empty<string>();
        [SerializeField] private string _focusNodeId;

        public string StepId => _stepId;
        public string UnitId => string.IsNullOrWhiteSpace(_unitId) ? AllUnitsId : _unitId;
        public string[] VisibleNodeIds => _visibleNodeIds ?? Array.Empty<string>();
        public string FocusNodeId => _focusNodeId;

        public SceneProcessStepBinding(
            string stepId,
            string unitId,
            string[] visibleNodeIds,
            string focusNodeId)
        {
            _stepId = stepId;
            _unitId = string.IsNullOrWhiteSpace(unitId) ? AllUnitsId : unitId;
            _visibleNodeIds = visibleNodeIds ?? Array.Empty<string>();
            _focusNodeId = focusNodeId;
        }
    }

    /// <summary>
    /// 场景允许接收的机组标识别名。
    /// canonicalUnitId（规范机组标识）与 aliases（别名）均由属性面板保存；运行时不按流程名称拼接或猜测机组。
    /// </summary>
    [Serializable]
    private sealed class SceneUnitIdBinding
    {
        [SerializeField] private string _canonicalUnitId;
        [SerializeField] private string[] _aliases = Array.Empty<string>();

        public string CanonicalUnitId => _canonicalUnitId;
        public string[] Aliases => _aliases ?? Array.Empty<string>();

        public SceneUnitIdBinding(string canonicalUnitId, string[] aliases)
        {
            _canonicalUnitId = canonicalUnitId;
            _aliases = aliases ?? Array.Empty<string>();
        }
    }

    private sealed class ActiveContextFadeMaterials
    {
        public Material[] OriginalMaterials;
        public Material[] RuntimeMaterials;
    }

    [Header("场景引用")]
    // 场景控制器通过该序列化标识区分燃气与燃煤流程，避免把燃气步骤误发到燃煤场景。
    // 该值属于场景属性，不由运行时代码根据对象名称推断；旧燃气场景缺省时仍兼容燃气默认值。
    [SerializeField] private string _configuredProcessId = GasPowerGenerationProcessId;
    [SerializeField] private Transform _sceneRoot;
    [Tooltip("相机由 PowerPlantFreeCameraController 直接控制；流程、总览和拓扑选择均不会改变当前视角。")]
    [SerializeField] private Camera _interactionCamera;
    [SerializeField] private Material _contextFadeMaterial;
    [SerializeField, Range(0.05f, 0.95f)] private float _contextOpacity = 0.22f;
    [SerializeField] private GameObject[] _groundObjects = Array.Empty<GameObject>();
    [SerializeField] private GameObject[] _persistentFlowObjects = Array.Empty<GameObject>();

    [Header("高亮描边")]
    [Tooltip("流程聚焦对象的轮廓颜色。使用高饱和青色，确保在深色与浅色设备表面均有明显区分。")]
    [SerializeField, ColorUsage(true, true)] private Color _processOutlineColor = new Color(0f, 1f, 0.921f, 1f);
    [Tooltip("流程聚焦对象的恒定屏幕空间轮廓宽度。按当前视觉反馈从 0.8 减半到 0.4，保留清晰边界并避免遮挡模型细节。")]
    [SerializeField, Min(0f)] private float _processOutlineWidth = 0.4f;
    [Tooltip("告警对象的轮廓颜色。")]
    [SerializeField, ColorUsage(true, true)] private Color _alarmOutlineColor = new Color(1f, 0.018f, 0f, 1f);
    [Tooltip("告警轮廓宽度。按当前视觉反馈从 1.0 减半到 0.5，仍略宽于流程轮廓以保留告警优先级。")]
    [SerializeField, Min(0f)] private float _alarmOutlineWidth = 0.5f;

    [Header("场景节点绑定（属性面板）")]
    [Tooltip("每个元素由稳定 sceneNodeId 和一个或多个场景对象组成。燃煤绑定请直接在属性面板（Inspector）拖拽对象，不要依赖模型名称查找。")]
    [SerializeField] private SceneNodeBinding[] _nodes = Array.Empty<SceneNodeBinding>();

    [Header("设备动态四态视觉（属性面板）")]
    [Tooltip("按材质实际暴露的属性名填写候选列表，例如 _BaseColor、_BASE_COLOR；注册时只在初始化阶段按该列表为每个材质槽建立索引。")]
    [SerializeField] private string[] _visualStateColorPropertyNames = { "_BaseColor" };
    [Tooltip("正常态颜色。Normal（正常态）只在平台明确下发时使用。")]
    [SerializeField, ColorUsage(true, true)] private Color _normalStateColor = new Color(46f / 255f, 189f / 255f, 107f / 255f, 1f);
    [Tooltip("告警态颜色。Alarm（告警态）只由平台状态驱动。")]
    [SerializeField, ColorUsage(true, true)] private Color _alarmStateColor = new Color(242f / 255f, 176f / 255f, 30f / 255f, 1f);
    [Tooltip("故障态颜色。Fault（故障态）只由平台状态驱动。")]
    [SerializeField, ColorUsage(true, true)] private Color _faultStateColor = new Color(229f / 255f, 72f / 255f, 77f / 255f, 1f);
    [Tooltip("离线态颜色。Offline（离线态）只由平台状态驱动。")]
    [SerializeField, ColorUsage(true, true)] private Color _offlineStateColor = new Color(154f / 255f, 164f / 255f, 178f / 255f, 1f);
    [Tooltip("仅登记资料明确为红色且允许聚焦描边的目标；黑色模型和无模型节点必须留空。")]
    [SerializeField] private SceneNodeVisualStateBinding[] _visualStateBindings = Array.Empty<SceneNodeVisualStateBinding>();

    [Header("流程步骤映射（属性面板）")]
    [Tooltip("每个步骤由 stepId、机组、可见 sceneNodeId 列表和描边 sceneNodeId 组成。请直接在属性面板配置，不要在代码中按模型名称补齐。")]
    [SerializeField] private SceneProcessStepBinding[] _processStepBindings = Array.Empty<SceneProcessStepBinding>();

    [Header("机组标识映射（属性面板）")]
    [Tooltip("平台传入的机组标识在这里登记为规范 unitId；燃气和燃煤的别名差异只保存在当前场景资产，不写入运行时分支。")]
    [SerializeField] private SceneUnitIdBinding[] _unitIdBindings = Array.Empty<SceneUnitIdBinding>();

    public void ConfigureForCurrentSampleScene(
        Transform sceneRoot,
        Camera interactionCamera,
        Material contextFadeMaterial,
        GameObject[] groundObjects,
        GameObject[] persistentFlowObjects,
        GameObject[] overview,
        GameObject[] hrsgSystem,
        GameObject inletDuct,
        GameObject gasTurbine,
        GameObject hrsg,
        GameObject steamTurbine,
        GameObject generator,
        GameObject gridOutput)
    {
        _configuredProcessId = GasPowerGenerationProcessId;
        _sceneRoot = sceneRoot;
        _interactionCamera = interactionCamera;
        _contextFadeMaterial = contextFadeMaterial;
        _groundObjects = groundObjects;
        _persistentFlowObjects = persistentFlowObjects;
        _nodes = new[]
        {
            CreateNode("plant.overview", overview),
            CreateNode("unit.ccgt.1.gas-train", hrsgSystem),
            CreateNode("unit.ccgt.2.gas-train", hrsgSystem),
            CreateNode("node.hrsg.1", hrsgSystem),
            CreateNode("node.hrsg.2", hrsgSystem),
            CreateNode("inlet-duct", new[] { inletDuct }),
            CreateNode("gas-turbine", new[] { gasTurbine }),
            CreateNode("hrsg", new[] { hrsg }),
            CreateNode("steam-turbine", new[] { steamTurbine }),
            CreateNode("generator", new[] { generator }),
            CreateNode("grid-output", new[] { gridOutput })
        };

        // 配置工具只写入已经确认映射到二维拓扑的三个真实模型；
        // 不把重叠的 node.hrsg.1、node.hrsg.2 或未映射流程节点注册为独立四态目标。
        _visualStateBindings = new[]
        {
            new SceneNodeVisualStateBinding("gas-turbine", new[] { gasTurbine }),
            new SceneNodeVisualStateBinding("hrsg", new[] { hrsg }),
            new SceneNodeVisualStateBinding("steam-turbine", new[] { steamTurbine })
        };

        // 燃气样例使用通用渲染管线属性；这只是编辑器迁移入口写入场景资产的默认值，
        // 运行时仍只读取控制器序列化的 _visualStateColorPropertyNames 和四态颜色。
        _visualStateColorPropertyNames = new[] { "_BaseColor" };

        _unitIdBindings = CreateGasUnitIdBindings();

        // 燃气菜单仍可重新生成样例场景，但步骤目标同样写入序列化数组；运行时不再依赖 switch 分支。
        _processStepBindings = CreateGasProcessStepBindings();

        CacheSceneBindings();
    }

    private readonly Dictionary<string, SceneNodeBinding> _nodesById = new Dictionary<string, SceneNodeBinding>(StringComparer.Ordinal);
    private readonly Dictionary<GameObject, bool> _initialRootActiveStates = new Dictionary<GameObject, bool>();
    private readonly Dictionary<GameObject, string> _selectionNodeByObject = new Dictionary<GameObject, string>();
    private readonly Dictionary<Renderer, ActiveContextFadeMaterials> _activeContextFades = new Dictionary<Renderer, ActiveContextFadeMaterials>();
    private readonly HashSet<GameObject> _groundObjectSet = new HashSet<GameObject>();
    private readonly HashSet<GameObject> _persistentFlowObjectSet = new HashSet<GameObject>();
    private readonly HashSet<Renderer> _highlightRendererSet = new HashSet<Renderer>();
    // 仅在场景初始化时建立的四态渲染器临时集合；状态变化时只由注册表直达目标渲染器，
    // 不重复扫描模型层级，也不分配新的集合。
    private readonly HashSet<Renderer> _visualStateRendererSet = new HashSet<Renderer>();
    private readonly List<string> _registeredVisualStateNodeIds = new List<string>();
    // 步骤映射在场景初始化时建立常数时间索引；enterProcessStep 高频调用不会重复扫描序列化数组。
    private readonly Dictionary<string, SceneProcessStepBinding> _processStepsByKey =
        new Dictionary<string, SceneProcessStepBinding>(StringComparer.Ordinal);
    // 机组别名在场景初始化时建立不区分大小写索引；enterProcessStep 高频路径只做一次字典查询。
    private readonly Dictionary<string, string> _unitIdsByAlias =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    private bool _processStepBindingsValid;
    private bool _unitIdBindingsValid;

    private HighlightEffect _processHighlightEffect;
    private HighlightEffect _alarmHighlightEffect;
    private BusinessSceneVisualStateRegistry _visualStateRegistry;

    private bool _runtimeResourcesReleased;
    private string _currentProcessId = GasPowerGenerationProcessId;
    private string _currentStepId = OverviewStepId;
    private string _currentUnitId = AllUnitsId;

    public string CurrentProcessId => _currentProcessId;
    public string CurrentStepId => _currentStepId;
    public string CurrentUnitId => _currentUnitId;
    /// <summary>返回场景配置时写入的流程标识，适配器据此阻止跨场景复用错误的控制器。</summary>
    public string ConfiguredProcessId => _configuredProcessId;

    /// <summary>
    /// 适配器仅在当前场景的真实模型全部完成四态登记时声明状态能力。
    /// 任一配置目标、渲染器或材质属性不合法都会使能力整体不可用，防止部分节点带色、部分节点静默失败。
    /// </summary>
    public bool SupportsNodeVisualState => _visualStateRegistry != null && !_runtimeResourcesReleased;

    private void Awake()
    {
        // 初始运行状态必须与当前场景属性面板配置一致。字段声明保留燃气默认值只用于旧场景反序列化兼容，
        // 燃煤场景若不在唤醒时同步，会在 sceneChanged（场景完成事件）中短暂上报错误的燃气流程。
        _currentProcessId = _configuredProcessId;
        _currentStepId = OverviewStepId;
        _currentUnitId = AllUnitsId;
        CacheSceneBindings();
        InitializeVisualStateRegistry();
        EnsureHighlightEffects();
    }

    private void Update()
    {
        if (_runtimeResourcesReleased)
        {
            return;
        }

        HandlePointerSelection();
    }

    private void OnDestroy()
    {
        // 正常切换会由适配器在卸载前调用；直接销毁场景对象时仍由此处幂等兜底。
        ReleaseOwnedRuntimeResources();
    }

    /// <summary>
    /// 释放燃气场景控制器明确拥有的运行时资源。该方法不执行全局资源扫描，也不销毁用户场景资产；
    /// 只停止镜头动画、停用运行时高亮效果、还原并销毁临时半透明材质，再清空对象引用。
    /// </summary>
    public void ReleaseOwnedRuntimeResources()
    {
        if (_runtimeResourcesReleased)
        {
            return;
        }

        _runtimeResourcesReleased = true;
        RestoreAndReleaseVisualStateRegistry();
        ClearProcessHighlight();
        ClearAlarmHighlight();
        if (_processHighlightEffect != null)
        {
            _processHighlightEffect.enabled = false;
        }
        if (_alarmHighlightEffect != null)
        {
            _alarmHighlightEffect.enabled = false;
        }

        RestoreAllContextFades();
        _highlightRendererSet.Clear();
        _nodesById.Clear();
        _selectionNodeByObject.Clear();
        _initialRootActiveStates.Clear();
        _groundObjectSet.Clear();
        _persistentFlowObjectSet.Clear();
    }

    /// <summary>
    /// 进入已配置流程步骤并更新场景显隐与描边；管道流动由场景静态材质持续播放，不参与步骤切换。
    /// </summary>
    public bool TryEnterProcessStep(string processId, string stepId, string unitId, bool isolate, out string message)
    {
        if (!string.Equals(processId, _configuredProcessId, StringComparison.Ordinal))
        {
            message = $"不支持流程：{processId}";
            return false;
        }

        if (!TryNormalizeUnit(unitId, out string normalizedUnitId))
        {
            message = $"不支持机组标识：{unitId}";
            return false;
        }

        if (!TryResolveStep(stepId, normalizedUnitId, out List<string> visibleNodeIds, out string focusNodeId))
        {
            message = $"不支持或尚未配置的流程步骤：{stepId}";
            return false;
        }

        // 流程步骤只能引用已由场景序列化配置登记的稳定三维节点标识。
        // 在修改可见性或描边前先完整校验，避免未知节点被描边方法静默忽略后仍向网页返回“成功”。
        if (!TryValidateResolvedSceneNodes(visibleNodeIds, focusNodeId, out string missingSceneNodeId))
        {
            message = $"流程步骤 {stepId} 引用了未登记的场景节点：{missingSceneNodeId}";
            return false;
        }

        // 视觉联动不得劫持用户当前视角：流程、总览和拓扑选择均只更新显隐与描边。
        // 总览始终恢复全厂模型且明确不描边。
        bool isOverviewStep = string.Equals(stepId, OverviewStepId, StringComparison.Ordinal);
        ClearProcessHighlight();
        if (isOverviewStep)
        {
            // 总览用于恢复完整厂区视图：清除告警描边并强制显示所有场景根模型，
            // 不受调用方 isolate 参数或模型初始显隐状态影响，且不移动当前镜头。
            ClearAlarmHighlight();
            ShowAllSceneModels();
        }
        else if (isolate)
        {
            SetIsolatedVisibility(visibleNodeIds);
        }
        else
        {
            RestoreInitialVisibility();
        }

        if (!isOverviewStep)
        {
            // 关键流程只描边唯一业务节点，不移动镜头，也不把关联管线错误纳入描边。
            ApplyProcessHighlightForNode(focusNodeId);
        }

        _currentProcessId = processId;
        _currentStepId = stepId;
        _currentUnitId = normalizedUnitId;
        message = $"已进入 {stepId}（机组：{normalizedUnitId}），已更新描边且保持当前视角。";
        return true;
    }

    public bool TryResetScene(out string message)
    {
        ClearProcessHighlight();
        ClearAlarmHighlight();
        RestoreInitialVisibility();
        _currentProcessId = _configuredProcessId;
        _currentStepId = OverviewStepId;
        _currentUnitId = AllUnitsId;
        message = "已恢复全景场景并保持当前视角。";
        return true;
    }

    public bool TryFocusNode(string nodeId, bool isolate, out string message)
    {
        if (!_nodesById.ContainsKey(nodeId))
        {
            message = $"未知场景节点：{nodeId}";
            return false;
        }

        // 二维节点选中只能更新交互描边，绝不能改变用户当前观察视角。
        ClearProcessHighlight();
        if (isolate)
        {
            SetIsolatedVisibility(new List<string> { nodeId });
        }
        else
        {
            RestoreInitialVisibility();
        }

        // 节点测试和网页 focusNode 指令统一经过该方法，运行时缺少组件时会自动补建，
        // 防止资源释放或延迟初始化后出现“选择已提交但没有描边”的不一致状态。
        ApplyProcessHighlightForNode(nodeId);
        message = $"已描边节点：{nodeId}，当前视角保持不变。";
        return true;
    }

    /// <summary>
    /// 取消当前拓扑节点驱动的三维交互描边。
    /// 该操作故意不清除告警描边、不改变显隐，也不修改当前流程上下文；
    /// 它只撤销由 ApplyProcessHighlightForNode 产生的交互选择视觉效果。
    /// </summary>
    public bool TryClearSelection(out string message)
    {
        if (_runtimeResourcesReleased)
        {
            message = "当前发电场景控制器已经释放，不能清除三维选择。";
            return false;
        }

        ClearProcessHighlight();
        message = "已清除三维交互选择描边。";
        return true;
    }

    /// <summary>
    /// 将平台已标准化的四态应用到场景中已显式登记的真实模型。
    /// 状态只写入注册表预先校验的渲染器和基础颜色属性；它不改变流程描边、交互选择、显隐或镜头，
    /// 因而可与二维选中和 Highlight Plus（高亮组件）的描边独立叠加。
    /// </summary>
    public BusinessSceneCommandResult UpdateNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState)
    {
        if (_runtimeResourcesReleased)
        {
            return BusinessSceneCommandResult.Failed("scene-controller-released", "燃气场景控制器已经释放，不能更新节点四态。");
        }
        if (_visualStateRegistry == null)
        {
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.UpdateNodeVisualState);
        }

        return _visualStateRegistry.UpdateNodeVisualState(sceneNodeId, visualState);
    }

    /// <summary>
    /// 清除平台状态覆盖并恢复模型登记时的基础颜色。
    /// 这不是将模型设置为 Normal（正常态）；Normal 仍只表示平台明确下发的状态，
    /// 该操作用于完整快照中设备消失或当前物理场景卸载前的视觉恢复。
    /// </summary>
    public BusinessSceneCommandResult ClearNodeVisualState(string sceneNodeId)
    {
        if (_runtimeResourcesReleased)
        {
            return BusinessSceneCommandResult.Failed("scene-controller-released", "燃气场景控制器已经释放，不能清除节点四态。");
        }
        if (_visualStateRegistry == null)
        {
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ClearNodeVisualState);
        }

        return _visualStateRegistry.ClearNodeVisualState(sceneNodeId);
    }

    /// <summary>
    /// 仅允许平台控制已登记的业务节点，不暴露 Unity 层级路径或任意对象名称。
    /// </summary>
    public bool TrySetNodeVisibility(string nodeId, bool visible, out string message)
    {
        if (!_nodesById.TryGetValue(nodeId, out SceneNodeBinding node))
        {
            message = $"未知场景节点：{nodeId}";
            return false;
        }

        GameObject[] targets = node.Targets;
        for (int targetIndex = 0; targetIndex < targets.Length; targetIndex++)
        {
            GameObject target = targets[targetIndex];
            if (target == null)
            {
                continue;
            }

            target.SetActive(true);
            if (visible || IsGroundObject(target))
            {
                RestoreContextFade(target);
            }
            else
            {
                ApplyContextFade(target);
            }
        }

        message = visible ? $"已显示节点：{nodeId}" : $"已将节点调整为半透明上下文：{nodeId}";
        return true;
    }

    /// <summary>
    /// 为后续平台告警指令预留的内部入口。当前 iframe 协议不调用此方法。
    /// </summary>
    public bool TrySetNodeAlarm(string nodeId, bool enabled, out string message)
    {
        if (!_nodesById.ContainsKey(nodeId))
        {
            message = $"未知场景节点：{nodeId}";
            return false;
        }

        EnsureHighlightEffects();
        if (!enabled)
        {
            ClearAlarmHighlight();
            message = $"已关闭节点告警效果：{nodeId}";
            return true;
        }

        _highlightRendererSet.Clear();
        CollectNodeRenderers(nodeId, _highlightRendererSet);
        ApplyHighlight(_alarmHighlightEffect, _highlightRendererSet);
        message = _highlightRendererSet.Count > 0 ? $"已启用节点告警效果：{nodeId}" : $"节点没有可高亮的渲染器：{nodeId}";
        return _highlightRendererSet.Count > 0;
    }

    public string GetStateDescription()
    {
        return $"process={_currentProcessId};step={_currentStepId};unit={_currentUnitId}";
    }

    private void EnsureHighlightEffects()
    {
        // 仅在运行时创建效果组件：场景配置工具不应把 HighlightEffect 序列化到 SampleScene，
        // 否则每次进入 Play Mode 都会额外保留一组组件和渲染资源。
        if (!Application.isPlaying)
        {
            return;
        }

        if (_processHighlightEffect == null)
        {
            _processHighlightEffect = gameObject.AddComponent<HighlightEffect>();
            _processHighlightEffect.hideFlags = HideFlags.DontSave;
            ConfigureHighlightEffect(
                _processHighlightEffect,
                _processOutlineColor,
                _processOutlineWidth);
        }

        if (_alarmHighlightEffect == null)
        {
            _alarmHighlightEffect = gameObject.AddComponent<HighlightEffect>();
            _alarmHighlightEffect.hideFlags = HideFlags.DontSave;
            ConfigureHighlightEffect(
                _alarmHighlightEffect,
                _alarmOutlineColor,
                _alarmOutlineWidth);
        }
    }

    private static void ConfigureHighlightEffect(HighlightEffect effect, Color outlineColor, float outlineWidth)
    {
        effect.profile = null;
        effect.profileSync = false;
        effect.previewInEditor = false;
        effect.camerasLayerMask = -1;
        effect.cullBackFaces = true;
        effect.constantWidth = true;
        effect.fadeInDuration = 0f;
        effect.fadeOutDuration = 0f;
        effect.outline = 1f;
        effect.outlineColor = outlineColor;
        effect.outlineWidth = outlineWidth;
        effect.outlineQuality = HighlightPlus.QualityLevel.High;
        effect.outlineDownsampling = 1;
        effect.outlineVisibility = HighlightPlus.Visibility.Normal;
        effect.outlineIndependent = false;
        effect.glow = 0f;
        effect.innerGlow = 0f;
        effect.overlay = 0f;
        effect.seeThrough = SeeThroughMode.Never;
        effect.ignore = false;
        effect.SetHighlighted(false);
        effect.Refresh();
    }

    private void CollectNodeRenderers(string nodeId, ISet<Renderer> destination)
    {
        if (!_nodesById.TryGetValue(nodeId, out SceneNodeBinding node))
        {
            return;
        }

        GameObject[] targets = node.Targets;
        for (int targetIndex = 0; targetIndex < targets.Length; targetIndex++)
        {
            GameObject target = targets[targetIndex];
            if (target == null)
            {
                continue;
            }

            Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
            for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
            {
                if (renderers[rendererIndex] != null)
                {
                    destination.Add(renderers[rendererIndex]);
                }
            }
        }
    }

    private void ApplyHighlight(HighlightEffect effect, ISet<Renderer> renderers)
    {
        if (effect == null)
        {
            return;
        }

        if (renderers == null || renderers.Count == 0)
        {
            effect.SetHighlighted(false);
            return;
        }

        Renderer[] targets = new Renderer[renderers.Count];
        renderers.CopyTo(targets, 0);
        effect.SetTargets(transform, targets);
        effect.SetHighlighted(true);
    }

    /// <summary>
    /// 为当前流程或节点的唯一描边模型刷新视觉效果。
    /// 该方法集中处理运行时组件创建、渲染器收集和目标替换，避免不同调用入口遗漏高亮步骤。
    /// </summary>
    private void ApplyProcessHighlightForNode(string nodeId)
    {
        EnsureHighlightEffects();
        _highlightRendererSet.Clear();
        CollectNodeRenderers(nodeId, _highlightRendererSet);
        ApplyHighlight(_processHighlightEffect, _highlightRendererSet);
    }

    private void ClearProcessHighlight()
    {
        if (_processHighlightEffect != null)
        {
            _processHighlightEffect.SetHighlighted(false);
        }
    }

    private void ClearAlarmHighlight()
    {
        if (_alarmHighlightEffect != null)
        {
            _alarmHighlightEffect.SetHighlighted(false);
        }
    }

    /// <summary>
    /// 一次性建立当前场景真实模型的四态索引。
    /// 仅接受场景序列化的稳定节点和目标对象；每个目标的子渲染器只在这里收集一次，
    /// 后续状态更新由注册表按节点直接访问，不在设备状态高频路径扫描场景层级。
    /// 任一登记项不完整时整套能力都不对外声明，避免同一完整快照只给部分模型着色。
    /// </summary>
    private void InitializeVisualStateRegistry()
    {
        RestoreAndReleaseVisualStateRegistry();
        if (_visualStateBindings == null || _visualStateBindings.Length == 0 ||
            _visualStateColorPropertyNames == null || _visualStateColorPropertyNames.Length == 0)
        {
            return;
        }

        // 四态颜色和材质属性均来自当前场景属性面板；这里仅把序列化值转换为运行时不可变调色板。
        BusinessSceneVisualStatePalette visualStatePalette = new BusinessSceneVisualStatePalette(
            _normalStateColor,
            _alarmStateColor,
            _faultStateColor,
            _offlineStateColor);
        BusinessSceneVisualStateRegistry registry = new BusinessSceneVisualStateRegistry();
        for (int bindingIndex = 0; bindingIndex < _visualStateBindings.Length; bindingIndex++)
        {
            SceneNodeVisualStateBinding visualBinding = _visualStateBindings[bindingIndex];
            if (visualBinding == null || !_nodesById.ContainsKey(visualBinding.SceneNodeId))
            {
                registry.Release();
                return;
            }

            _visualStateRendererSet.Clear();
            GameObject[] targets = visualBinding.Targets;
            for (int targetIndex = 0; targetIndex < targets.Length; targetIndex++)
            {
                GameObject target = targets[targetIndex];
                if (target == null)
                {
                    continue;
                }

                Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
                for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
                {
                    Renderer renderer = renderers[rendererIndex];
                    if (renderer != null)
                    {
                        _visualStateRendererSet.Add(renderer);
                    }
                }
            }

            // 注册表需长期持有稳定数组，因此初始化时以当前集合创建一次数组；
            // 该分配不位于状态更新、镜头动画或输入循环内。
            Renderer[] registeredRenderers = new List<Renderer>(_visualStateRendererSet).ToArray();
            BusinessSceneCommandResult registerResult = registry.Register(new BusinessSceneVisualStateBinding(
                visualBinding.SceneNodeId,
                registeredRenderers,
                _visualStateColorPropertyNames,
                visualStatePalette));
            if (!registerResult.Success)
            {
                registry.Release();
                return;
            }

            _registeredVisualStateNodeIds.Add(visualBinding.SceneNodeId);
        }

        _visualStateRegistry = registry;
    }

    /// <summary>
    /// 场景卸载前撤销仍存在的动态颜色，再释放登记引用和复用属性块。
    /// 清除失败不阻断其余资源释放：物理场景即将卸载，失败只可能来自已销毁的渲染器，
    /// 但剩余有效模型仍必须恢复基础颜色，避免编辑器内重复加载遗留视觉覆盖。
    /// </summary>
    private void RestoreAndReleaseVisualStateRegistry()
    {
        if (_visualStateRegistry == null)
        {
            _registeredVisualStateNodeIds.Clear();
            _visualStateRendererSet.Clear();
            return;
        }

        for (int nodeIndex = 0; nodeIndex < _registeredVisualStateNodeIds.Count; nodeIndex++)
        {
            _visualStateRegistry.ClearNodeVisualState(_registeredVisualStateNodeIds[nodeIndex]);
        }

        _visualStateRegistry.Release();
        _visualStateRegistry = null;
        _registeredVisualStateNodeIds.Clear();
        _visualStateRendererSet.Clear();
    }

    private void CacheSceneBindings()
    {
        _nodesById.Clear();
        _processStepsByKey.Clear();
        _processStepBindingsValid = true;
        _unitIdsByAlias.Clear();
        _unitIdBindingsValid = true;
        _selectionNodeByObject.Clear();
        _initialRootActiveStates.Clear();
        _groundObjectSet.Clear();
        _persistentFlowObjectSet.Clear();

        if (_sceneRoot == null)
        {
            Debug.LogError(
                $"[{nameof(PowerPlantProcessController)}] 未配置场景根节点。请在 PowerPlantProcessController 的属性面板（Inspector）中填写场景引用。",
                this);
            return;
        }

        if (_interactionCamera == null)
        {
            _interactionCamera = Camera.main;
        }

        for (int childIndex = 0; childIndex < _sceneRoot.childCount; childIndex++)
        {
            GameObject child = _sceneRoot.GetChild(childIndex).gameObject;
            _initialRootActiveStates[child] = child.activeSelf;
        }

        for (int groundIndex = 0; groundIndex < _groundObjects.Length; groundIndex++)
        {
            if (_groundObjects[groundIndex] != null)
            {
                _groundObjectSet.Add(_groundObjects[groundIndex]);
            }
        }

        for (int flowIndex = 0; flowIndex < _persistentFlowObjects.Length; flowIndex++)
        {
            if (_persistentFlowObjects[flowIndex] != null)
            {
                _persistentFlowObjectSet.Add(_persistentFlowObjects[flowIndex]);
            }
        }

        for (int nodeIndex = 0; nodeIndex < _nodes.Length; nodeIndex++)
        {
            SceneNodeBinding node = _nodes[nodeIndex];
            if (node == null || string.IsNullOrWhiteSpace(node.Id))
            {
                continue;
            }

            _nodesById[node.Id] = node;
            if (node.Id == "plant.overview" || node.Id.StartsWith("unit.", StringComparison.Ordinal))
            {
                continue;
            }

            GameObject[] targets = node.Targets;
            for (int targetIndex = 0; targetIndex < targets.Length; targetIndex++)
            {
                GameObject target = targets[targetIndex];
                if (target == null)
                {
                    continue;
                }

                _selectionNodeByObject[target] = node.Id;
                EnsureClickCollider(target);
            }
        }

        CacheProcessStepBindings();
        CacheUnitIdBindings();
    }

    /// <summary>
    /// 将属性面板中的步骤数组转换为运行时索引，并拒绝空标识或重复的 stepId + unitId。
    /// 配置错误只会使流程步骤不可用，不会覆盖或猜测其他节点绑定。
    /// </summary>
    private void CacheProcessStepBindings()
    {
        if (_processStepBindings == null || _processStepBindings.Length == 0)
        {
            _processStepBindingsValid = false;
            return;
        }

        for (int bindingIndex = 0; bindingIndex < _processStepBindings.Length; bindingIndex++)
        {
            SceneProcessStepBinding binding = _processStepBindings[bindingIndex];
            if (binding == null || string.IsNullOrWhiteSpace(binding.StepId) ||
                string.IsNullOrWhiteSpace(binding.FocusNodeId))
            {
                _processStepBindingsValid = false;
                continue;
            }

            string key = BuildProcessStepKey(binding.StepId, binding.UnitId);
            if (_processStepsByKey.ContainsKey(key))
            {
                _processStepBindingsValid = false;
                continue;
            }

            _processStepsByKey.Add(key, binding);
        }
    }

    /// <summary>
    /// 将属性面板中的机组别名数组转换为常数时间索引。
    /// 步骤中出现的规范 unitId 会自动登记自身，但别名必须由场景作者明确填写；重复别名会使机组映射整体失效。
    /// </summary>
    private void CacheUnitIdBindings()
    {
        if (_unitIdBindings != null)
        {
            for (int bindingIndex = 0; bindingIndex < _unitIdBindings.Length; bindingIndex++)
            {
                SceneUnitIdBinding binding = _unitIdBindings[bindingIndex];
                if (binding == null || string.IsNullOrWhiteSpace(binding.CanonicalUnitId))
                {
                    _unitIdBindingsValid = false;
                    continue;
                }

                string canonicalUnitId = binding.CanonicalUnitId.Trim();
                string[] aliases = binding.Aliases;
                for (int aliasIndex = 0; aliasIndex < aliases.Length; aliasIndex++)
                {
                    string alias = aliases[aliasIndex];
                    if (string.IsNullOrWhiteSpace(alias) ||
                        !TryRegisterUnitAlias(alias.Trim(), canonicalUnitId))
                    {
                        _unitIdBindingsValid = false;
                    }
                }

                if (!TryRegisterUnitAlias(canonicalUnitId, canonicalUnitId))
                {
                    _unitIdBindingsValid = false;
                }
            }
        }

        // 步骤数组中的规范机组即使没有重复填写到别名列表，也必须能直接作为请求值使用。
        if (_processStepBindings == null)
        {
            return;
        }

        foreach (SceneProcessStepBinding binding in _processStepBindings)
        {
            if (binding == null || string.Equals(binding.UnitId, AllUnitsId, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!TryRegisterUnitAlias(binding.UnitId, binding.UnitId))
            {
                _unitIdBindingsValid = false;
            }
        }
    }

    private bool TryRegisterUnitAlias(string alias, string canonicalUnitId)
    {
        if (_unitIdsByAlias.TryGetValue(alias, out string existingCanonicalUnitId))
        {
            return string.Equals(existingCanonicalUnitId, canonicalUnitId, StringComparison.OrdinalIgnoreCase);
        }

        _unitIdsByAlias.Add(alias, canonicalUnitId);
        return true;
    }

    private static string BuildProcessStepKey(string stepId, string unitId)
    {
        return $"{stepId}\u001f{unitId}";
    }

    /// <summary>
    /// 校验流程分支解析出的可见节点与描边节点均来自当前场景的显式登记。
    /// 该校验只比较稳定场景节点标识，不读取模型名称、层级路径或二维拓扑节点，防止流程配置错误被静默吞掉。
    /// </summary>
    private bool TryValidateResolvedSceneNodes(IReadOnlyList<string> visibleNodeIds, string focusNodeId, out string missingSceneNodeId)
    {
        for (int nodeIndex = 0; nodeIndex < visibleNodeIds.Count; nodeIndex++)
        {
            string sceneNodeId = visibleNodeIds[nodeIndex];
            if (string.IsNullOrWhiteSpace(sceneNodeId) || !_nodesById.ContainsKey(sceneNodeId))
            {
                missingSceneNodeId = sceneNodeId;
                return false;
            }
        }

        if (string.IsNullOrWhiteSpace(focusNodeId) || !_nodesById.ContainsKey(focusNodeId))
        {
            missingSceneNodeId = focusNodeId;
            return false;
        }

        missingSceneNodeId = string.Empty;
        return true;
    }

    /// <summary>
    /// 将流程步骤解析为当前场景中已经登记的可见节点和描边节点。
    /// 机组分组继续决定隔离时的可见范围；描边固定落在已序列化的步骤节点，不能按机组号拼接未登记标识。
    /// </summary>
    private bool TryResolveStep(string stepId, string unitId, out List<string> visibleNodeIds, out string focusNodeId)
    {
        visibleNodeIds = new List<string>();
        focusNodeId = string.Empty;
        if (!_processStepBindingsValid || string.IsNullOrWhiteSpace(stepId))
        {
            return false;
        }

        string normalizedUnitId = string.IsNullOrWhiteSpace(unitId) ? AllUnitsId : unitId;
        if (!_processStepsByKey.TryGetValue(BuildProcessStepKey(stepId, normalizedUnitId), out SceneProcessStepBinding binding) &&
            !string.Equals(normalizedUnitId, AllUnitsId, StringComparison.Ordinal))
        {
            // 未登记机组沿用 all 条目；具体场景仍必须在属性面板显式登记该条目。
            _processStepsByKey.TryGetValue(BuildProcessStepKey(stepId, AllUnitsId), out binding);
        }

        if (binding == null)
        {
            return false;
        }

        string[] configuredVisibleNodeIds = binding.VisibleNodeIds;
        visibleNodeIds = new List<string>(configuredVisibleNodeIds.Length);
        for (int nodeIndex = 0; nodeIndex < configuredVisibleNodeIds.Length; nodeIndex++)
        {
            if (!string.IsNullOrWhiteSpace(configuredVisibleNodeIds[nodeIndex]))
            {
                visibleNodeIds.Add(configuredVisibleNodeIds[nodeIndex]);
            }
        }

        focusNodeId = binding.FocusNodeId;
        return visibleNodeIds.Count > 0 && !string.IsNullOrWhiteSpace(focusNodeId);
    }

    private void SetIsolatedVisibility(List<string> visibleNodeIds)
    {
        HashSet<GameObject> visibleObjects = new HashSet<GameObject>();
        for (int nodeIndex = 0; nodeIndex < visibleNodeIds.Count; nodeIndex++)
        {
            if (!_nodesById.TryGetValue(visibleNodeIds[nodeIndex], out SceneNodeBinding node))
            {
                continue;
            }

            GameObject[] targets = node.Targets;
            for (int targetIndex = 0; targetIndex < targets.Length; targetIndex++)
            {
                if (targets[targetIndex] != null)
                {
                    visibleObjects.Add(targets[targetIndex]);
                }
            }
        }

        foreach (KeyValuePair<GameObject, bool> entry in _initialRootActiveStates)
        {
            GameObject target = entry.Key;
            if (target == null)
            {
                continue;
            }

            if (!entry.Value)
            {
                target.SetActive(false);
                continue;
            }

            target.SetActive(true);
            if (visibleObjects.Contains(target) || IsGroundObject(target) || IsPersistentFlowObject(target))
            {
                RestoreContextFade(target);
            }
            else
            {
                ApplyContextFade(target);
            }
        }
    }

    /// <summary>
    /// 总览时恢复被上下文材质替换的渲染器，并显示场景根节点下的全部模型。
    /// 该行为独立于初始显隐缓存，确保此前隐藏或启动时关闭的模型也能进入总览与包围盒计算。
    /// </summary>
    private void ShowAllSceneModels()
    {
        RestoreAllContextFades();
        foreach (GameObject target in _initialRootActiveStates.Keys)
        {
            if (target != null)
            {
                target.SetActive(true);
            }
        }
    }

    private void RestoreInitialVisibility()
    {
        RestoreAllContextFades();
        foreach (KeyValuePair<GameObject, bool> entry in _initialRootActiveStates)
        {
            if (entry.Key != null)
            {
                entry.Key.SetActive(entry.Value);
            }
        }
    }

    private void HandlePointerSelection()
    {
        if (_interactionCamera == null || Mouse.current == null || !Mouse.current.leftButton.wasPressedThisFrame)
        {
            return;
        }

        Ray ray = _interactionCamera.ScreenPointToRay(Mouse.current.position.ReadValue());
        if (!Physics.Raycast(ray, out RaycastHit hit))
        {
            return;
        }

        GameObject rootObject = FindDirectSceneChild(hit.collider.transform);
        if (rootObject != null && _selectionNodeByObject.TryGetValue(rootObject, out string sceneNodeId))
        {
            // 映射表由场景配置工具以明确三维节点标识登记；点击回传不借助模型名称或二维拓扑节点猜测。
            UnityIframeBridgeManager.Instance?.ReportObjectSelected(sceneNodeId, rootObject.name);
        }
    }

    private GameObject FindDirectSceneChild(Transform transform)
    {
        if (_sceneRoot == null)
        {
            return null;
        }

        Transform current = transform;
        while (current != null && current.parent != _sceneRoot)
        {
            current = current.parent;
        }

        return current != null && current.parent == _sceneRoot ? current.gameObject : null;
    }

    private void EnsureClickCollider(GameObject target)
    {
        if (target == null)
        {
            return;
        }

        if (target.GetComponent<Collider>() != null)
        {
            return;
        }

        // FBX 根对象不一定直接持有 Renderer；燃煤模型的部分根对象把网格放在子节点中。
        // 只在初始化阶段合并一次子渲染器包围盒，避免点击时重复遍历层级或产生运行时分配。
        Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
        if (renderers.Length == 0)
        {
            return;
        }

        Bounds worldBounds = renderers[0].bounds;
        for (int rendererIndex = 1; rendererIndex < renderers.Length; rendererIndex++)
        {
            if (renderers[rendererIndex] != null)
            {
                worldBounds.Encapsulate(renderers[rendererIndex].bounds);
            }
        }

        BoxCollider collider = target.AddComponent<BoxCollider>();
        collider.center = target.transform.InverseTransformPoint(worldBounds.center);
        Vector3 scale = target.transform.lossyScale;
        collider.size = new Vector3(
            Mathf.Abs(scale.x) > Mathf.Epsilon ? worldBounds.size.x / Mathf.Abs(scale.x) : worldBounds.size.x,
            Mathf.Abs(scale.y) > Mathf.Epsilon ? worldBounds.size.y / Mathf.Abs(scale.y) : worldBounds.size.y,
            Mathf.Abs(scale.z) > Mathf.Epsilon ? worldBounds.size.z / Mathf.Abs(scale.z) : worldBounds.size.z);
    }

    private void ApplyContextFade(GameObject target)
    {
        if (target == null || IsGroundObject(target) || _contextFadeMaterial == null)
        {
            return;
        }

        Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
        for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
        {
            Renderer renderer = renderers[rendererIndex];
            if (renderer == null || _activeContextFades.ContainsKey(renderer))
            {
                continue;
            }

            Material[] originalMaterials = renderer.sharedMaterials;
            Material[] runtimeMaterials = new Material[originalMaterials.Length];
            for (int materialIndex = 0; materialIndex < originalMaterials.Length; materialIndex++)
            {
                Material originalMaterial = originalMaterials[materialIndex];
                if (originalMaterial == null)
                {
                    continue;
                }

                Material runtimeMaterial = new Material(_contextFadeMaterial)
                {
                    name = $"{_contextFadeMaterial.name} (Runtime Context)"
                };
                CopyOriginalAppearance(originalMaterial, runtimeMaterial);
                if (runtimeMaterial.HasProperty("_Opacity"))
                {
                    runtimeMaterial.SetFloat("_Opacity", _contextOpacity);
                }

                runtimeMaterials[materialIndex] = runtimeMaterial;
            }

            renderer.sharedMaterials = runtimeMaterials;
            _activeContextFades.Add(renderer, new ActiveContextFadeMaterials
            {
                OriginalMaterials = originalMaterials,
                RuntimeMaterials = runtimeMaterials
            });
        }
    }

    private void RestoreContextFade(GameObject target)
    {
        if (target == null)
        {
            return;
        }

        Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
        for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
        {
            RestoreContextFade(renderers[rendererIndex]);
        }
    }

    private void RestoreContextFade(Renderer renderer)
    {
        if (renderer == null || !_activeContextFades.TryGetValue(renderer, out ActiveContextFadeMaterials activeMaterials))
        {
            return;
        }

        renderer.sharedMaterials = activeMaterials.OriginalMaterials;
        for (int materialIndex = 0; materialIndex < activeMaterials.RuntimeMaterials.Length; materialIndex++)
        {
            if (activeMaterials.RuntimeMaterials[materialIndex] != null)
            {
                DestroyRuntimeMaterial(activeMaterials.RuntimeMaterials[materialIndex]);
            }
        }

        _activeContextFades.Remove(renderer);
    }

    private void RestoreAllContextFades()
    {
        // 释放阶段只遍历一次且不在遍历中修改字典，避免额外复制键列表；最后统一清空强引用。
        foreach (KeyValuePair<Renderer, ActiveContextFadeMaterials> pair in _activeContextFades)
        {
            Renderer renderer = pair.Key;
            ActiveContextFadeMaterials activeMaterials = pair.Value;
            if (renderer != null)
            {
                renderer.sharedMaterials = activeMaterials.OriginalMaterials;
            }

            for (int materialIndex = 0; materialIndex < activeMaterials.RuntimeMaterials.Length; materialIndex++)
            {
                if (activeMaterials.RuntimeMaterials[materialIndex] != null)
                {
                    DestroyRuntimeMaterial(activeMaterials.RuntimeMaterials[materialIndex]);
                }
            }
        }

        _activeContextFades.Clear();
    }

    /// <summary>
    /// 释放仅由本控制器创建的上下文半透明材质。
    /// 运行模式使用延迟销毁以适配当前帧渲染；编辑器配置和自动验证则必须立即销毁，
    /// 否则 Unity 会拒绝延迟销毁并留下错误日志。
    /// </summary>
    private static void DestroyRuntimeMaterial(Material material)
    {
        if (material == null)
        {
            return;
        }

        if (Application.isPlaying)
        {
            Destroy(material);
            return;
        }

        DestroyImmediate(material);
    }

    private bool IsGroundObject(GameObject target)
    {
        return target != null && _groundObjectSet.Contains(target);
    }

    private bool IsPersistentFlowObject(GameObject target)
    {
        return target != null && _persistentFlowObjectSet.Contains(target);
    }

    private static void CopyOriginalAppearance(Material original, Material target)
    {
        if (original == null || target == null)
        {
            return;
        }

        CopyTexture(original, target, "_BaseMap", "_BaseMap");
        CopyTexture(original, target, "_MainTex", "_BaseMap");
        CopyTexture(original, target, "_BumpMap", "_BumpMap");
        CopyTexture(original, target, "_MetallicGlossMap", "_MetallicGlossMap");

        if (target.HasProperty("_BaseColor"))
        {
            if (original.HasProperty("_BaseColor"))
            {
                target.SetColor("_BaseColor", original.GetColor("_BaseColor"));
            }
            else if (original.HasProperty("_Color"))
            {
                target.SetColor("_BaseColor", original.GetColor("_Color"));
            }
        }

        CopyFloat(original, target, "_Metallic");
        CopyFloat(original, target, "_Smoothness");
        CopyFloat(original, target, "_BumpScale");
    }

    private static void CopyTexture(Material source, Material target, string sourceProperty, string targetProperty)
    {
        if (!source.HasProperty(sourceProperty) || !target.HasProperty(targetProperty))
        {
            return;
        }

        Texture texture = source.GetTexture(sourceProperty);
        if (texture == null)
        {
            return;
        }

        target.SetTexture(targetProperty, texture);
        target.SetTextureScale(targetProperty, source.GetTextureScale(sourceProperty));
        target.SetTextureOffset(targetProperty, source.GetTextureOffset(sourceProperty));
    }

    private static void CopyFloat(Material source, Material target, string property)
    {
        if (source.HasProperty(property) && target.HasProperty(property))
        {
            target.SetFloat(property, source.GetFloat(property));
        }
    }

    private bool TryNormalizeUnit(string unitId, out string normalizedUnitId)
    {
        if (string.IsNullOrWhiteSpace(unitId) || string.Equals(unitId, AllUnitsId, StringComparison.OrdinalIgnoreCase))
        {
            normalizedUnitId = AllUnitsId;
            return true;
        }

        if (_unitIdBindingsValid && _unitIdsByAlias.TryGetValue(unitId.Trim(), out normalizedUnitId))
        {
            return true;
        }

        normalizedUnitId = string.Empty;
        return false;
    }

    private bool TryCalculateBounds(IReadOnlyList<string> nodeIds, out Bounds bounds)
    {
        bounds = new Bounds();
        bool hasBounds = false;
        for (int nodeIndex = 0; nodeIndex < nodeIds.Count; nodeIndex++)
        {
            if (!_nodesById.TryGetValue(nodeIds[nodeIndex], out SceneNodeBinding node) || !TryCalculateBounds(node.Targets, out Bounds nodeBounds))
            {
                continue;
            }

            if (!hasBounds)
            {
                bounds = nodeBounds;
                hasBounds = true;
            }
            else
            {
                bounds.Encapsulate(nodeBounds);
            }
        }

        return hasBounds;
    }

    private static bool TryCalculateBounds(GameObject[] targets, out Bounds bounds)
    {
        bounds = new Bounds();
        bool hasBounds = false;
        for (int targetIndex = 0; targetIndex < targets.Length; targetIndex++)
        {
            GameObject target = targets[targetIndex];
            if (target == null)
            {
                continue;
            }

            Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
            for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
            {
                Renderer renderer = renderers[rendererIndex];
                if (!hasBounds)
                {
                    bounds = renderer.bounds;
                    hasBounds = true;
                }
                else
                {
                    bounds.Encapsulate(renderer.bounds);
                }
            }
        }

        return hasBounds;
    }

    private static SceneNodeBinding CreateNode(string id, GameObject[] targets)
    {
        return new SceneNodeBinding(id, targets);
    }

    private static SceneProcessStepBinding CreateProcessStep(
        string stepId,
        string unitId,
        string[] visibleNodeIds,
        string focusNodeId)
    {
        return new SceneProcessStepBinding(stepId, unitId, visibleNodeIds, focusNodeId);
    }

    /// <summary>
    /// 仅供燃气历史配置菜单迁移样例场景使用的默认步骤数组。
    /// 该数组会写回 GasPower.unity；运行时读取的仍是场景序列化结果，燃煤场景不会调用此方法。
    /// </summary>
    private static SceneProcessStepBinding[] CreateGasProcessStepBindings()
    {
        return new[]
        {
            CreateProcessStep("overview", AllUnitsId, new[] { "plant.overview" }, "plant.overview"),
            CreateProcessStep("grid-output", AllUnitsId, new[] { "grid-output" }, "grid-output"),
            CreateProcessStep(
                "inlet-duct",
                AllUnitsId,
                new[] { "unit.ccgt.1.gas-train", "unit.ccgt.2.gas-train" },
                "plant.overview"),
            CreateProcessStep("inlet-duct", "1", new[] { "unit.ccgt.1.gas-train" }, "inlet-duct"),
            CreateProcessStep("inlet-duct", "2", new[] { "unit.ccgt.2.gas-train" }, "inlet-duct"),
            CreateProcessStep("gas-turbine", AllUnitsId, new[] { "gas-turbine" }, "gas-turbine"),
            CreateProcessStep("hrsg", AllUnitsId, new[] { "hrsg" }, "hrsg"),
            CreateProcessStep("steam-turbine", AllUnitsId, new[] { "steam-turbine" }, "steam-turbine"),
            CreateProcessStep(
                "generator",
                AllUnitsId,
                new[] { "unit.ccgt.1.gas-train", "unit.ccgt.2.gas-train", "steam-turbine", "grid-output" },
                "grid-output"),
            CreateProcessStep(
                "generator",
                "1",
                new[] { "unit.ccgt.1.gas-train", "steam-turbine", "grid-output" },
                "generator"),
            CreateProcessStep(
                "generator",
                "2",
                new[] { "unit.ccgt.2.gas-train", "steam-turbine", "grid-output" },
                "generator")
        };
    }

    /// <summary>
    /// 燃气历史配置菜单使用的机组别名默认值。
    /// 菜单执行后会把数组写入 GasPower.unity；运行时不会调用本方法，也不会覆盖属性面板修改。
    /// </summary>
    private static SceneUnitIdBinding[] CreateGasUnitIdBindings()
    {
        return new[]
        {
            new SceneUnitIdBinding("1", new[] { "1", "unit-1", "unit.ccgt.1" }),
            new SceneUnitIdBinding("2", new[] { "2", "unit-2", "unit.ccgt.2" })
        };
    }

}

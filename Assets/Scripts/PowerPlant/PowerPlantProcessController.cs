using System;
using System.Collections.Generic;
using HighlightPlus;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.UI;
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
    // 管道流动由专用 Shader（着色器）读取材质速度属性驱动；运行时只覆盖渲染器属性块，不修改共享材质资产。
    private const string PipelineFlowShaderName = "自定义/URP/管道流动";
    private static readonly int PipelineFlowSpeedPropertyId = Shader.PropertyToID("_FlowSpeed");
    private static readonly int PipelineFlowOpacityPropertyId = Shader.PropertyToID("_Opacity");
    // 告警、故障运行时材质复用场景上下文透明着色器；其颜色和透明度始终写入这两个确定属性。
    private static readonly int VisualStateBaseColorPropertyId = Shader.PropertyToID("_BaseColor");
    private static readonly int VisualStateOpacityPropertyId = Shader.PropertyToID("_Opacity");
    // 左键拖拽与设备单击共用同一输入通道；超过该屏幕位移阈值后只视为相机平移，不再触发设备选择。
    private const float PointerSelectionDragThreshold = 6f;
    // 填充与描边共用 0 到 1 的正弦脉冲曲线；故障使用相位差，让首次显示就处于高可见段。
    private const float PulseAngularFrequencyMultiplier = Mathf.PI * 2f;
    private const float FaultFillPulsePhaseOffset = Mathf.PI * 0.5f;
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

    /// <summary>
    /// 告警、故障状态覆盖前的材质数组、材质属性块与可复用状态材质数组。
    /// 状态材质模板由控制器共享；原始属性块按槽位精确保留，使状态结束后能够清除覆盖颜色并恢复
    /// 流动速度等其它实例参数。该缓存只在渲染器首次进入状态时创建，避免高频状态切换重复分配。
    /// </summary>
    private sealed class ActiveVisualStateMaterials
    {
        public Material[] OriginalMaterials;
        public MaterialPropertyBlock[] OriginalPropertyBlocks;
        public Material[] RuntimeMaterials;
    }

    /// <summary>
    /// 单个流动材质槽的运行时控制信息。原始速度只在初始化时读取一次，故障恢复时无需查询场景或材质资源。
    /// </summary>
    private sealed class PipelineFlowMaterialBinding
    {
        public Renderer Renderer;
        public int MaterialIndex;
        public float OriginalSpeed;
    }

    [Header("场景引用")]
    // 场景控制器通过该序列化标识区分燃气与燃煤流程，避免把燃气步骤误发到燃煤场景。
    // 该值属于场景属性，不由运行时代码根据对象名称推断；旧燃气场景缺省时仍兼容燃气默认值。
    [SerializeField] private string _configuredProcessId = GasPowerGenerationProcessId;
    [SerializeField] private Transform _sceneRoot;
    [Tooltip("相机由 PowerPlantFreeCameraController 直接控制；流程和总览保持当前视角，节点选中是否聚焦由下方统一开关控制。")]
    [SerializeField] private Camera _interactionCamera;
    [Tooltip("统一控制拓扑节点选中和 Unity 鼠标选中的镜头行为。关闭时仍保留青色描边与二维拓扑联动，但不移动相机。")]
    [SerializeField] private bool _focusOnSelection = true;
    [SerializeField] private Material _contextFadeMaterial;
    [SerializeField, Range(0.05f, 0.95f)] private float _contextOpacity = 0.22f;
    [SerializeField] private GameObject[] _groundObjects = Array.Empty<GameObject>();
    [SerializeField] private GameObject[] _persistentFlowObjects = Array.Empty<GameObject>();
    // 总览中需要保持原材质的普通管道对象；使用流动 Shader（着色器）的管道由运行时自动识别。
    [SerializeField] private GameObject[] _overviewOpaqueObjects = Array.Empty<GameObject>();
    // 设备根节点之外的总览辅助模型，例如燃煤场景的建筑群和水池群；地面不放入此数组。
    [SerializeField] private GameObject[] _overviewContextObjects = Array.Empty<GameObject>();

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

    [Header("设备状态视觉配置")]
    [Tooltip("所有发电场景共用的状态颜色、覆盖强度、描边宽度和离线显示开关。")]
    [SerializeField] private PowerPlantVisualStateConfig _visualStateConfig;

    [Header("设备动态四态视觉（属性面板）")]
    [Tooltip("按材质实际暴露的属性名填写候选列表，例如 _BaseColor、_BASE_COLOR；注册时只在初始化阶段按该列表为每个材质槽建立索引。")]
    [SerializeField] private string[] _visualStateColorPropertyNames = { "_BaseColor" };
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
        // 场景节点只保留总表中的正式绑定；关键环节的展示范围由流程步骤引用这些节点，
        // 不再为机组或 HRSG 子拓扑复制相同的模型数组，避免一个模型被多个伪节点重复选中。
        _nodes = new[]
        {
            CreateNode("plant.overview", overview),
            CreateNode("inlet-duct", new[] { inletDuct }),
            CreateNode("gas-turbine", new[] { gasTurbine }),
            CreateNode("hrsg", new[] { hrsg }),
            CreateNode("steam-turbine", new[] { steamTurbine }),
            CreateNode("generator", new[] { generator }),
            CreateNode("grid-output", new[] { gridOutput })
        };

        // 配置工具只写入已经确认映射到二维拓扑的三个真实模型；
        // 重复的流程分组不注册为独立四态目标，避免同一模型被重复维护。
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
    // 燃煤场景的部分总览模型位于流程根节点之外，例如 Environment/组件支撑；
    // 单独缓存这些对象的初始状态，使关键环节隐藏后仍能在总览或重置时准确恢复。
    private readonly Dictionary<GameObject, bool> _overviewOnlyInitialActiveStates =
        new Dictionary<GameObject, bool>();
    // 三维节点目标由属性面板显式登记。带碰撞体的模型继续走物理射线；无碰撞体模型只在鼠标单击时
    // 扫描此初始化缓存，避免为大模型运行时创建高成本 MeshCollider（网格碰撞体）或逐帧遍历层级。
    private readonly Dictionary<GameObject, string> _selectionNodeByObject = new Dictionary<GameObject, string>();
    private readonly List<SceneNodeRendererPickTarget> _selectionRendererTargets = new List<SceneNodeRendererPickTarget>();
    // 当前流程步骤允许鼠标命中的渲染器缓存。进入关键环节时只保留 visibleNodeIds（可见节点标识）对应目标，
    // 避免每次点击重新遍历全场景；总览时恢复全部显式登记节点。
    private readonly List<SceneNodeRendererPickTarget> _activeSelectionRendererTargets =
        new List<SceneNodeRendererPickTarget>();
    private readonly HashSet<string> _selectableSceneNodeIds = new HashSet<string>(StringComparer.Ordinal);
    private readonly Dictionary<Renderer, ActiveContextFadeMaterials> _activeContextFades = new Dictionary<Renderer, ActiveContextFadeMaterials>();
    // 广告牌文字使用 TextMeshProUGUI（文本组件），底层由 CanvasRenderer（画布渲染器）绘制，
    // 不属于 Renderer（模型渲染器）层级。这里缓存每个图形组件进入上下文透明前的颜色，
    // 使文字能与父模型同进同退，并避免重复切换时在原始透明度上连续相乘。
    private readonly Dictionary<Graphic, Color> _activeContextFadeGraphics = new Dictionary<Graphic, Color>();
    // 告警、故障材质位于上下文半透明之上；状态期间收到上下文请求时只登记延迟处理，
    // 等状态清除后再应用上下文半透明，避免两个运行时材质层互相覆盖。
    private readonly Dictionary<Renderer, ActiveVisualStateMaterials> _activeVisualStateMaterials =
        new Dictionary<Renderer, ActiveVisualStateMaterials>();
    private readonly HashSet<Renderer> _deferredContextFadeRenderers = new HashSet<Renderer>();
    private readonly HashSet<GameObject> _groundObjectSet = new HashSet<GameObject>();
    private readonly HashSet<GameObject> _persistentFlowObjectSet = new HashSet<GameObject>();
    private readonly HashSet<GameObject> _overviewOpaqueObjectSet = new HashSet<GameObject>();
    // 当前交互聚焦的显式目标集合；聚焦时只保留这些模型实体，其余对象统一使用上下文半透明。
    private readonly HashSet<GameObject> _selectionFocusObjects = new HashSet<GameObject>();
    // 由流动 Shader 身份缓存的对象集合，补足序列化管道列表遗漏的电线等流动模型，不按名称推断业务节点。
    private readonly HashSet<GameObject> _pipelineFlowObjectSet = new HashSet<GameObject>();
    // 所有流动材质槽只在初始化阶段登记；故障切换时按缓存索引写入属性块，避免重复扫描层级和材质。
    private readonly List<PipelineFlowMaterialBinding> _pipelineFlowMaterials = new List<PipelineFlowMaterialBinding>();
    private MaterialPropertyBlock _pipelineFlowPropertyBlock;
    // 状态材质写入纯色前先保留已有属性块的其它属性，避免擦除流动速度等由其它系统维护的实例参数。
    private MaterialPropertyBlock _visualStatePropertyBlock;
    private Material _alarmVisualStateMaterial;
    private Material _faultVisualStateMaterial;
    private readonly HashSet<Renderer> _highlightRendererSet = new HashSet<Renderer>();
    // 仅在场景初始化时建立的四态渲染器临时集合；状态变化时只由注册表直达目标渲染器，
    // 不重复扫描模型层级，也不分配新的集合。
    private readonly HashSet<Renderer> _visualStateRendererSet = new HashSet<Renderer>();
    // 状态节点在初始化阶段缓存渲染器；平台状态变化时只更新字典并重建受影响的三组目标，
    // 不扫描场景层级、不访问 Renderer.material，也不在每帧路径产生临时对象。
    private readonly Dictionary<string, Renderer[]> _visualStateRenderersByNodeId =
        new Dictionary<string, Renderer[]>(StringComparer.Ordinal);
    private readonly Dictionary<string, BusinessSceneNodeVisualState> _activeVisualStatesByNodeId =
        new Dictionary<string, BusinessSceneNodeVisualState>(StringComparer.Ordinal);
    private readonly List<Renderer> _alarmStateRenderers = new List<Renderer>();
    private readonly List<Renderer> _faultStateRenderers = new List<Renderer>();
    private readonly List<Renderer> _offlineStateRenderers = new List<Renderer>();
    private readonly List<string> _registeredVisualStateNodeIds = new List<string>();
    // 步骤映射在场景初始化时建立常数时间索引；enterProcessStep 高频调用不会重复扫描序列化数组。
    private readonly Dictionary<string, SceneProcessStepBinding> _processStepsByKey =
        new Dictionary<string, SceneProcessStepBinding>(StringComparer.Ordinal);
    // 机组别名在场景初始化时建立不区分大小写索引；enterProcessStep 高频路径只做一次字典查询。
    private readonly Dictionary<string, string> _unitIdsByAlias =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    private bool _processStepBindingsValid;
    private bool _unitIdBindingsValid;
    private Vector2 _pointerPressPosition;
    private bool _pointerWasDragged;

    private HighlightEffect _processHighlightEffect;
    private HighlightEffect _alarmHighlightEffect;
    private HighlightEffect _alarmStateHighlightEffect;
    private HighlightEffect _faultStateHighlightEffect;
    private HighlightEffect _offlineStateHighlightEffect;
    // 交互相机上的自由相机控制器只在场景绑定缓存阶段查询一次；拓扑选择高频发生时直接复用引用。
    private PowerPlantFreeCameraController _freeCameraController;
    private BusinessSceneVisualStateRegistry _visualStateRegistry;

    private bool _runtimeResourcesReleased;
    private bool _pipelineFlowsStopped;
    // 只记录由拓扑或三维鼠标选择建立的交互节点；空白点击据此避免清除纯流程步骤的描边。
    private string _activeInteractionNodeId;
    private string _currentProcessId = GasPowerGenerationProcessId;
    private string _currentStepId = OverviewStepId;
    private string _currentUnitId = AllUnitsId;

    public string CurrentProcessId => _currentProcessId;
    public string CurrentStepId => _currentStepId;
    public string CurrentUnitId => _currentUnitId;
    /// <summary>读取节点选中后的统一镜头开关，拓扑选择和 Unity 鼠标选择共用该值。</summary>
    public bool FocusOnSelection => _focusOnSelection;

    /// <summary>
    /// 修改节点选中后的统一镜头开关。描边和二维拓扑联动不受此开关影响，只有自动取景会被启用或关闭。
    /// </summary>
    public void SetFocusOnSelection(bool enabled)
    {
        _focusOnSelection = enabled;
        if (!enabled && _freeCameraController != null)
        {
            _freeCameraController.CancelFocus();
        }
    }
    /// <summary>返回场景配置时写入的流程标识，适配器据此阻止跨场景复用错误的控制器。</summary>
    public string ConfiguredProcessId => _configuredProcessId;

    /// <summary>
    /// 适配器仅在当前场景的真实模型全部完成四态登记时声明状态能力。
    /// 任一配置目标、渲染器或材质属性不合法都会使能力整体不可用，防止部分节点带色、部分节点静默失败。
    /// </summary>
    public bool SupportsNodeVisualState => _visualStateRegistry != null && !_runtimeResourcesReleased;
    /// <summary>返回当前是否因至少一个设备故障而将全部管道流动速度设为 0。</summary>
    public bool ArePipelineFlowsStopped => _pipelineFlowsStopped;

    private void Awake()
    {
        // Unity 禁止在 MonoBehaviour 构造阶段创建原生对象；材质属性块必须在 Awake 后初始化。
        _pipelineFlowPropertyBlock = new MaterialPropertyBlock();
        _visualStatePropertyBlock = new MaterialPropertyBlock();
        // 初始运行状态必须与当前场景属性面板配置一致。字段声明保留燃气默认值只用于旧场景反序列化兼容，
        // 燃煤场景若不在唤醒时同步，会在 sceneChanged（场景完成事件）中短暂上报错误的燃气流程。
        _currentProcessId = _configuredProcessId;
        _currentStepId = OverviewStepId;
        _currentUnitId = AllUnitsId;
        CacheSceneBindings();
        InitializeVisualStateRegistry();
        EnsureHighlightEffects();

        // 场景首次加载即按总览步骤应用视觉层级，避免模型在等待网页重复发送 overview 前全部保持不透明。
        if (TryResolveStep(OverviewStepId, AllUnitsId, out List<string> overviewVisibleNodeIds, out _))
        {
            ShowAllSceneModels(overviewVisibleNodeIds);
        }
    }

    private void Update()
    {
        if (_runtimeResourcesReleased)
        {
            return;
        }

        HandlePointerSelection();
        UpdateVisualStateFillPulse();
        UpdateHighlightOutlinePulse();
    }

    private void OnDestroy()
    {
        // 正常切换会由适配器在卸载前调用；直接销毁场景对象时仍由此处幂等兜底。
        ReleaseOwnedRuntimeResources();
    }

    /// <summary>
    /// 每帧只更新告警、故障各一份共享状态材质的透明度，以及五类运行时描边组件的强度；
    /// 不扫描场景渲染器、不创建临时数组。填充与对应描边使用相同频率和相位，保持视觉同步。
    /// </summary>
    private void UpdateVisualStateFillPulse()
    {
        if (_visualStateConfig == null)
        {
            return;
        }

        float time = Time.unscaledTime;
        UpdateVisualStateMaterialOpacity(
            _alarmVisualStateMaterial,
            _visualStateConfig.AlarmFillPulseFrequency,
            time,
            0f);
        UpdateVisualStateMaterialOpacity(
            _faultVisualStateMaterial,
            _visualStateConfig.FaultFillPulseFrequency,
            time,
            FaultFillPulsePhaseOffset);
    }

    /// <summary>
    /// 复用告警、故障填充的闪烁频率更新所有运行时描边强度。
    /// Highlight Plus（高亮插件）的 outline（描边强度）字段会直接参与当前帧绘制，
    /// 因此不需要反复刷新材质或重新设置目标，既能实现脉冲又避免运行时分配。
    /// </summary>
    private void UpdateHighlightOutlinePulse()
    {
        if (_visualStateConfig == null)
        {
            return;
        }

        float time = Time.unscaledTime;
        float minimumIntensity = _visualStateConfig.FillPulseMinimumOpacity;
        float alarmFrequency = _visualStateConfig.AlarmFillPulseFrequency;
        float faultFrequency = _visualStateConfig.FaultFillPulseFrequency;

        UpdateHighlightOutlineIntensity(_processHighlightEffect, alarmFrequency, time, 0f, minimumIntensity);
        UpdateHighlightOutlineIntensity(_alarmHighlightEffect, alarmFrequency, time, 0f, minimumIntensity);
        UpdateHighlightOutlineIntensity(_alarmStateHighlightEffect, alarmFrequency, time, 0f, minimumIntensity);
        UpdateHighlightOutlineIntensity(
            _faultStateHighlightEffect,
            faultFrequency,
            time,
            FaultFillPulsePhaseOffset,
            minimumIntensity);
        UpdateHighlightOutlineIntensity(_offlineStateHighlightEffect, alarmFrequency, time, 0f, minimumIntensity);
    }

    private static void UpdateHighlightOutlineIntensity(
        HighlightEffect effect,
        float frequency,
        float time,
        float phaseOffset,
        float minimumIntensity)
    {
        if (effect == null)
        {
            return;
        }

        float pulse = Mathf.Sin(time * frequency * PulseAngularFrequencyMultiplier + phaseOffset) * 0.5f + 0.5f;
        effect.outline = Mathf.Lerp(minimumIntensity, 1f, pulse);
    }

    private void UpdateVisualStateMaterialOpacity(Material material, float frequency, float time, float phaseOffset)
    {
        if (material == null)
        {
            return;
        }

        float pulse = Mathf.Sin(time * frequency * PulseAngularFrequencyMultiplier + phaseOffset) * 0.5f + 0.5f;
        float opacity = Mathf.Lerp(_visualStateConfig.FillPulseMinimumOpacity, _visualStateConfig.OverlayOpacity, pulse);
        material.SetFloat(VisualStateOpacityPropertyId, opacity);
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
        _activeInteractionNodeId = null;
        _selectionFocusObjects.Clear();
        // 场景控制器卸载后不再保留由最后一次拓扑选择触发的镜头补间。
        if (_freeCameraController != null)
        {
            _freeCameraController.CancelFocus();
        }
        SetPipelineFlowStopped(false);
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
        DisableVisualStateHighlights();

        RestoreAllContextFades();
        ReleaseVisualStateMaterialTemplates();
        _highlightRendererSet.Clear();
        _nodesById.Clear();
        _pipelineFlowObjectSet.Clear();
        _pipelineFlowMaterials.Clear();
        _selectionNodeByObject.Clear();
        _activeSelectionRendererTargets.Clear();
        _selectableSceneNodeIds.Clear();
        _initialRootActiveStates.Clear();
        _overviewOnlyInitialActiveStates.Clear();
        _groundObjectSet.Clear();
        _persistentFlowObjectSet.Clear();
        _overviewOpaqueObjectSet.Clear();
    }

    /// <summary>
    /// 进入已配置流程步骤并更新场景显隐与描边；关键环节中的全部流动管道保持流动材质，但以半透明运行时副本显示。
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

        // 每次总览或关键环节切换都回到当前场景资产定义的初始视角，避免继承上一个环节的镜头位置和旋转。
        // 先完成流程参数与节点校验，再执行相机恢复，确保非法命令不会改变当前交互状态。
        if (_freeCameraController != null)
        {
            _freeCameraController.ResetToInitialTransform();
        }

        // 流程步骤替换交互选择后的描边；后续三维空白点击不能再把该流程描边误认作交互选择。
        // 总览始终恢复全厂模型且明确不描边。
        bool isOverviewStep = string.Equals(stepId, OverviewStepId, StringComparison.Ordinal);
        _activeInteractionNodeId = null;
        _selectionFocusObjects.Clear();
        ClearProcessHighlight();
        if (isOverviewStep)
        {
            // 总览显示全部模型，但只将流程配置中的核心设备保持原材质；其余模型作为半透明上下文保留，
            // 这样既能交代完整厂区关系，又能避免辅助设备抢占首屏视觉重点。
            ClearAlarmHighlight();
            ShowAllSceneModels(visibleNodeIds);
        }
        else if (isolate)
        {
            SetIsolatedVisibility(visibleNodeIds);
            SetActiveSelectionTargetsForProcess(visibleNodeIds);
        }
        else
        {
            RestoreInitialVisibility();
            SetActiveSelectionTargetsForProcess(visibleNodeIds);
        }

        if (!isOverviewStep)
        {
            // 关键环节的全部流动管道都是上下文，不论 isolate 参数如何设置都保持半透明。
            ApplyPipelineFlowContextFade();

            ApplyProcessHighlightForNode(focusNodeId);
        }

        _currentProcessId = processId;
        _currentStepId = stepId;
        _currentUnitId = normalizedUnitId;
        message = $"已进入 {stepId}（机组：{normalizedUnitId}），已更新描边并恢复初始视角。";
        return true;
    }

    public bool TryResetScene(out string message)
    {
        // 重置场景会替换交互描边；清除标记后，后续空白点击不会向二维拓扑发送过期取消事件。
        _activeInteractionNodeId = null;
        _selectionFocusObjects.Clear();
        ClearProcessHighlight();
        ClearAlarmHighlight();
        if (TryResolveStep(OverviewStepId, AllUnitsId, out List<string> overviewVisibleNodeIds, out _))
        {
            ShowAllSceneModels(overviewVisibleNodeIds);
        }
        else
        {
            RestoreInitialVisibility();
        }
        if (_freeCameraController != null)
        {
            // resetScene（场景重置）与流程切换使用同一初始视角，避免重置后仍停留在关键设备近景。
            _freeCameraController.ResetToInitialTransform();
        }
        _currentProcessId = _configuredProcessId;
        _currentStepId = OverviewStepId;
        _currentUnitId = AllUnitsId;
        message = "已恢复总览场景：核心设备正常显示、其余模型半透明，地面始终显示并恢复初始视角。";
        return true;
    }

    public bool TryFocusNode(string nodeId, bool isolate, out string message)
    {
        if (!_nodesById.ContainsKey(nodeId))
        {
            message = $"未知场景节点：{nodeId}";
            return false;
        }

        // 关键环节的组态图只展示 visibleNodeIds（可见节点标识）；三维聚焦也必须复用同一白名单，
        // 防止外部迟到或错误命令选中当前流程之外的模型。
        if (!IsSceneNodeSelectable(nodeId))
        {
            message = $"当前流程步骤不允许选择场景节点：{nodeId}";
            return false;
        }

        // 二维节点选中先替换旧描边，再基于同一批目标渲染器计算镜头取景；
        // 流程步骤仍不调用此入口，因此不会改变既有的“保持当前视角”行为。
        ClearProcessHighlight();
        _activeInteractionNodeId = nodeId;
        // isolate 参数继续保留协议兼容性；交互聚焦统一使用“选中模型实体、其余模型半透明”的上下文表现。
        ApplySelectionFocusContext(nodeId);

        // 节点测试和网页 focusNode 指令统一经过该方法，运行时缺少组件时会自动补建，
        // 防止资源释放或延迟初始化后出现“选择已提交但没有描边”的不一致状态。
        ApplyProcessHighlightForNode(nodeId);
        if (_focusOnSelection)
        {
            FocusCameraOnHighlightedNode();
        }
        message = _focusOnSelection
            ? $"已描边并聚焦节点：{nodeId}。"
            : $"已描边节点：{nodeId}，自动聚焦已关闭。";
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
        _activeInteractionNodeId = null;
        _selectionFocusObjects.Clear();
        // 取消选择不会复位镜头；只停止尚未完成的自动补间，让当前画面停留在用户已看到的位置。
        if (_freeCameraController != null)
        {
            _freeCameraController.CancelFocus();
        }
        message = "已清除三维交互选择描边。";
        return true;
    }

    /// <summary>
    /// 将平台状态应用到显式登记的真实模型。告警、故障使用纯色半透明运行时材质并叠加同色描边；
    /// 正常态和清除恢复原材质，离线继续沿用既有高亮显示开关，不替换模型材质。
    /// </summary>
    public BusinessSceneCommandResult UpdateNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState)
    {
        if (_runtimeResourcesReleased)
        {
            return BusinessSceneCommandResult.Failed("scene-controller-released", "发电场景控制器已经释放，不能更新节点四态。");
        }
        if (_visualStateRegistry == null)
        {
            return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.UpdateNodeVisualState);
        }

        BusinessSceneCommandResult result = _visualStateRegistry.UpdateNodeVisualState(sceneNodeId, visualState);
        if (!result.Success)
        {
            return result;
        }

        if (visualState == BusinessSceneNodeVisualState.Normal)
        {
            _activeVisualStatesByNodeId.Remove(sceneNodeId);
        }
        else
        {
            _activeVisualStatesByNodeId[sceneNodeId] = visualState;
        }

        ApplyVisualStateMaterials(sceneNodeId, visualState);
        RefreshVisualStateHighlights();
        // 正常态会恢复该节点原属性块；若其它节点仍故障，需强制重写管道速度，防止恢复时误解除全局冻结。
        SetPipelineFlowStopped(HasActiveFaultState(), visualState == BusinessSceneNodeVisualState.Normal);
        return BusinessSceneCommandResult.Completed(
            visualState == BusinessSceneNodeVisualState.Normal
                ? $"三维节点 {sceneNodeId} 已恢复正常基础视觉。"
                : $"三维节点 {sceneNodeId} 已更新为 {visualState} 半透明覆盖与同色描边。");
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

        BusinessSceneCommandResult result = _visualStateRegistry.ClearNodeVisualState(sceneNodeId);
        if (!result.Success)
        {
            return result;
        }

        _activeVisualStatesByNodeId.Remove(sceneNodeId);
        RestoreVisualStateMaterials(sceneNodeId);
        RefreshVisualStateHighlights();
        // 清除属性块后必须重新应用当前冻结结果，即使其它故障使目标状态仍为 stopped（已停止）。
        SetPipelineFlowStopped(HasActiveFaultState(), true);
        return result;
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

        EnsureVisualStateHighlightEffect(ref _alarmStateHighlightEffect, _visualStateConfig.AlarmColor, true);
        EnsureVisualStateHighlightEffect(ref _faultStateHighlightEffect, _visualStateConfig.FaultColor, true);
        if (_visualStateConfig.ShowOfflineState)
        {
            // 离线状态不替换模型材质，也不启用遮挡透视，保持既有的可选覆盖显示行为。
            EnsureVisualStateHighlightEffect(ref _offlineStateHighlightEffect, _visualStateConfig.OfflineColor, false);
        }
    }

    /// <summary>
    /// 各状态持有独立高亮组件，使多个设备可同时处于不同状态；组件仅首次使用时创建。
    /// 告警、故障的模型本体已由运行时材质着色，因此插件只绘制描边和被遮挡时的透视状态色；
    /// 离线保留原有覆盖策略，不启用透视和材质替换。
    /// </summary>
    private void EnsureVisualStateHighlightEffect(ref HighlightEffect effect, Color stateColor, bool useStateMaterial)
    {
        if (effect != null)
        {
            return;
        }

        effect = gameObject.AddComponent<HighlightEffect>();
        effect.hideFlags = HideFlags.DontSave;
        ConfigureHighlightEffect(effect, stateColor, _visualStateConfig.OutlineWidth);
        effect.overlay = useStateMaterial ? 0f : _visualStateConfig.OverlayOpacity;
        effect.overlayColor = stateColor;
        effect.overlayAnimationSpeed = 0f;
        effect.overlayMinIntensity = 1f;
        effect.overlayBlending = 1f;
        if (useStateMaterial)
        {
            // 当前先关闭状态设备的插件透视，只保留模型本体的纯色半透明材质和同色描边；
            // 后续如需恢复透视，可将该模式改回 WhenHighlighted（高亮时透视）。
            effect.seeThrough = SeeThroughMode.Never;
            effect.seeThroughIntensity = 0f;
        }
        effect.Refresh();
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

    /// <summary>
    /// 判断渲染器是否属于广告牌子树。广告牌根节点挂有 HorizontalCameraBillboard（水平相机广告牌）组件，
    /// 其下的文字和图形渲染器也一并排除，避免模型描边把说明牌边缘染亮。
    /// </summary>
    private static bool IsBillboardRenderer(Renderer renderer)
    {
        return renderer != null && renderer.GetComponentInParent<HorizontalCameraBillboard>() != null;
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
                if (renderers[rendererIndex] != null && !IsBillboardRenderer(renderers[rendererIndex]))
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

    /// <summary>
    /// 复用刚用于描边的渲染器集合合并世界空间包围盒，并请求自由相机执行轻微俯视取景。
    /// 此处不重新遍历节点层级，避免一次拓扑选择因描边和镜头计算发生两次 Renderer 查询。
    /// </summary>
    private void FocusCameraOnHighlightedNode()
    {
        if (_freeCameraController == null || _highlightRendererSet.Count == 0)
        {
            return;
        }

        bool hasBounds = false;
        Bounds combinedBounds = default;
        foreach (Renderer renderer in _highlightRendererSet)
        {
            if (renderer == null || !renderer.gameObject.activeInHierarchy)
            {
                continue;
            }

            if (!hasBounds)
            {
                combinedBounds = renderer.bounds;
                hasBounds = true;
            }
            else
            {
                combinedBounds.Encapsulate(renderer.bounds);
            }
        }

        if (hasBounds)
        {
            _freeCameraController.FocusBounds(combinedBounds);
        }
    }

    private void ClearAlarmHighlight()
    {
        if (_alarmHighlightEffect != null)
        {
            _alarmHighlightEffect.SetHighlighted(false);
        }
    }

    private bool HasActiveFaultState()
    {
        foreach (KeyValuePair<string, BusinessSceneNodeVisualState> entry in _activeVisualStatesByNodeId)
        {
            if (entry.Value == BusinessSceneNodeVisualState.Fault)
            {
                return true;
            }
        }

        return false;
    }

    /// Highlight Plus（高亮插件）要求数组输入，因此只在状态集合实际变化时产生三个短生命周期数组。
    /// </summary>
    private void RefreshVisualStateHighlights()
    {
        EnsureHighlightEffects();
        _alarmStateRenderers.Clear();
        _faultStateRenderers.Clear();
        _offlineStateRenderers.Clear();

        foreach (KeyValuePair<string, BusinessSceneNodeVisualState> entry in _activeVisualStatesByNodeId)
        {
            if (!_visualStateRenderersByNodeId.TryGetValue(entry.Key, out Renderer[] renderers))
            {
                continue;
            }

            List<Renderer> destination;
            if (entry.Value == BusinessSceneNodeVisualState.Alarm)
            {
                destination = _alarmStateRenderers;
            }
            else if (entry.Value == BusinessSceneNodeVisualState.Fault)
            {
                destination = _faultStateRenderers;
            }
            else if (entry.Value == BusinessSceneNodeVisualState.Offline && _visualStateConfig.ShowOfflineState)
            {
                destination = _offlineStateRenderers;
            }
            else
            {
                // Unity 离线显示开关关闭时，离线状态仍保留在状态表中，但不产生任何三维视觉效果。
                continue;
            }

            for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
            {
                if (renderers[rendererIndex] != null && !IsBillboardRenderer(renderers[rendererIndex]))
                {
                    destination.Add(renderers[rendererIndex]);
                }
            }
        }

        ApplyVisualStateHighlight(_alarmStateHighlightEffect, _alarmStateRenderers);
        ApplyVisualStateHighlight(_faultStateHighlightEffect, _faultStateRenderers);
        ApplyVisualStateHighlight(_offlineStateHighlightEffect, _offlineStateRenderers);
    }

    private static void ApplyVisualStateHighlight(HighlightEffect effect, List<Renderer> renderers)
    {
        if (effect == null)
        {
            return;
        }
        if (renderers.Count == 0)
        {
            effect.SetHighlighted(false);
            return;
        }

        effect.SetTargets(effect.transform, renderers.ToArray());
        effect.SetHighlighted(true);
    }

    private void DisableVisualStateHighlights()
    {
        _activeVisualStatesByNodeId.Clear();
        _visualStateRenderersByNodeId.Clear();
        _alarmStateRenderers.Clear();
        _faultStateRenderers.Clear();
        _offlineStateRenderers.Clear();
        DisableHighlightEffect(_alarmStateHighlightEffect);
        DisableHighlightEffect(_faultStateHighlightEffect);
        DisableHighlightEffect(_offlineStateHighlightEffect);
    }

    private static void DisableHighlightEffect(HighlightEffect effect)
    {
        if (effect == null)
        {
            return;
        }

        effect.SetHighlighted(false);
        effect.enabled = false;
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
            _visualStateColorPropertyNames == null || _visualStateColorPropertyNames.Length == 0 ||
            _visualStateConfig == null)
        {
            return;
        }

        // 正常态不再配置颜色：Normal（正常态）始终恢复模型登记时的基础材质。
        // 注册表保留 Normal 颜色参数只是为了兼容公共运行时接口，此处使用无效占位色。
        BusinessSceneVisualStatePalette visualStatePalette = new BusinessSceneVisualStatePalette(
            Color.clear,
            _visualStateConfig.AlarmColor,
            _visualStateConfig.FaultColor,
            _visualStateConfig.OfflineColor);
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
            _visualStateRenderersByNodeId.Add(visualBinding.SceneNodeId, registeredRenderers);
        }

        _visualStateRegistry = registry;
    }

    /// <summary>
    /// 场景卸载前先撤销告警、故障的运行时材质，再恢复登记的基础颜色并释放索引。
    /// 释放路径不重新应用延迟的上下文半透明，因为物理场景随后会整体卸载；这避免卸载阶段额外创建材质。
    /// </summary>
    private void RestoreAndReleaseVisualStateRegistry()
    {
        RestoreAllVisualStateMaterials();
        if (_visualStateRegistry == null)
        {
            _registeredVisualStateNodeIds.Clear();
            _visualStateRendererSet.Clear();
            _visualStateRenderersByNodeId.Clear();
            _activeVisualStatesByNodeId.Clear();
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
        _visualStateRenderersByNodeId.Clear();
        _activeVisualStatesByNodeId.Clear();
        if (_alarmStateHighlightEffect != null)
        {
            _alarmStateHighlightEffect.SetHighlighted(false);
        }
        if (_faultStateHighlightEffect != null)
        {
            _faultStateHighlightEffect.SetHighlighted(false);
        }
        if (_offlineStateHighlightEffect != null)
        {
            _offlineStateHighlightEffect.SetHighlighted(false);
        }
    }

    private void CacheSceneBindings()
    {
        _nodesById.Clear();
        _processStepsByKey.Clear();
        _processStepBindingsValid = true;
        _unitIdsByAlias.Clear();
        _unitIdBindingsValid = true;
        _selectionNodeByObject.Clear();
        _selectionRendererTargets.Clear();
        _activeSelectionRendererTargets.Clear();
        _selectableSceneNodeIds.Clear();
        _initialRootActiveStates.Clear();
        _groundObjectSet.Clear();
        _persistentFlowObjectSet.Clear();
        _overviewOpaqueObjectSet.Clear();
        _pipelineFlowObjectSet.Clear();
        _pipelineFlowMaterials.Clear();

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

        // 相机引用由场景属性面板显式提供；自由相机组件缺失时仍允许描边，只跳过自动聚焦。
        _freeCameraController = _interactionCamera != null
            ? _interactionCamera.GetComponent<PowerPlantFreeCameraController>()
            : null;

        for (int childIndex = 0; childIndex < _sceneRoot.childCount; childIndex++)
        {
            GameObject child = _sceneRoot.GetChild(childIndex).gameObject;
            _initialRootActiveStates[child] = child.activeSelf;
        }

        // 只记录总览专属且位于流程根节点之外的对象。Equipment 下的设备仍由关键环节的
        // visibleObjects（可见对象集合）统一决定显隐，避免这里提前覆盖设备流程状态。
        for (int opaqueIndex = 0; opaqueIndex < _overviewOpaqueObjects.Length; opaqueIndex++)
        {
            GameObject overviewObject = _overviewOpaqueObjects[opaqueIndex];
            if (overviewObject != null && !overviewObject.transform.IsChildOf(_sceneRoot))
            {
                _overviewOnlyInitialActiveStates[overviewObject] = overviewObject.activeSelf;
            }
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

        for (int opaqueIndex = 0; opaqueIndex < _overviewOpaqueObjects.Length; opaqueIndex++)
        {
            if (_overviewOpaqueObjects[opaqueIndex] != null)
            {
                _overviewOpaqueObjectSet.Add(_overviewOpaqueObjects[opaqueIndex]);
            }
        }

        CachePipelineFlowMaterials();

        // 同一渲染器若被两个业务节点重复配置，则该目标存在歧义，不能依数组顺序猜测归属。
        // 字典仅在初始化阶段使用；值为缓存列表下标，冲突时把原项清空并永久标记为歧义。
        Dictionary<Renderer, int> rendererTargetIndex = new Dictionary<Renderer, int>();
        HashSet<Renderer> ambiguousSelectionRenderers = new HashSet<Renderer>();
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

                // 所有交互目标都登记到显式对象索引：已有碰撞体时可从命中子层级向上精确解析；
                // 没有碰撞体时则由下方缓存的可见渲染器包围盒提供低成本后备命中。
                _selectionNodeByObject[target] = node.Id;
                Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
                for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
                {
                    Renderer renderer = renderers[rendererIndex];
                    if (renderer == null || ambiguousSelectionRenderers.Contains(renderer))
                    {
                        continue;
                    }

                    if (rendererTargetIndex.TryGetValue(renderer, out int existingIndex))
                    {
                        SceneNodeRendererPickTarget existingTarget = _selectionRendererTargets[existingIndex];
                        if (string.Equals(existingTarget.SceneNodeId, node.Id, StringComparison.Ordinal))
                        {
                            continue;
                        }

                        // default（默认空项）会被命中工具直接跳过；保留下标可避免删除导致后续索引整体移动。
                        _selectionRendererTargets[existingIndex] = default;
                        rendererTargetIndex.Remove(renderer);
                        ambiguousSelectionRenderers.Add(renderer);
                        continue;
                    }

                    rendererTargetIndex.Add(renderer, _selectionRendererTargets.Count);
                    _selectionRendererTargets.Add(new SceneNodeRendererPickTarget(node.Id, target, renderer));
                }
            }
        }

        CacheProcessStepBindings();
        CacheUnitIdBindings();
        // 初始场景状态对应总览，鼠标选择也必须从全量显式登记节点开始。
        SetActiveSelectionTargetsForOverview();
    }

    /// <summary>
    /// 总览允许选择所有已由场景绑定登记的节点；列表引用初始化缓存，不重新扫描场景层级。
    /// </summary>
    private void SetActiveSelectionTargetsForOverview()
    {
        _selectableSceneNodeIds.Clear();
        _activeSelectionRendererTargets.Clear();
        for (int targetIndex = 0; targetIndex < _selectionRendererTargets.Count; targetIndex++)
        {
            SceneNodeRendererPickTarget target = _selectionRendererTargets[targetIndex];
            if (string.IsNullOrWhiteSpace(target.SceneNodeId) || target.RootObject == null || target.Renderer == null)
            {
                continue;
            }

            _selectableSceneNodeIds.Add(target.SceneNodeId);
            _activeSelectionRendererTargets.Add(target);
        }
    }

    /// <summary>
    /// 关键环节只允许选择当前组态图可见节点对应的模型。
    /// 渲染器目标已在场景初始化时缓存，此处只按节点标识过滤，避免切换步骤时重复遍历模型层级。
    /// </summary>
    private void SetActiveSelectionTargetsForProcess(IReadOnlyList<string> visibleNodeIds)
    {
        _selectableSceneNodeIds.Clear();
        _activeSelectionRendererTargets.Clear();
        for (int nodeIndex = 0; nodeIndex < visibleNodeIds.Count; nodeIndex++)
        {
            string sceneNodeId = visibleNodeIds[nodeIndex];
            if (!string.IsNullOrWhiteSpace(sceneNodeId))
            {
                _selectableSceneNodeIds.Add(sceneNodeId);
            }
        }

        for (int targetIndex = 0; targetIndex < _selectionRendererTargets.Count; targetIndex++)
        {
            SceneNodeRendererPickTarget target = _selectionRendererTargets[targetIndex];
            if (target.RootObject == null || target.Renderer == null ||
                !_selectableSceneNodeIds.Contains(target.SceneNodeId))
            {
                continue;
            }

            _activeSelectionRendererTargets.Add(target);
        }
    }

    private bool IsSceneNodeSelectable(string sceneNodeId)
    {
        return !string.IsNullOrWhiteSpace(sceneNodeId) && _selectableSceneNodeIds.Contains(sceneNodeId);
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
            // 关键环节中管道始终作为上下文显示：即使它属于当前步骤的可见节点，也不能恢复为不透明正常材质。
            // 普通设备仍按流程显式绑定决定正常显示或上下文半透明，地面保持正常材质。
            if ((!IsPipelineFlowObject(target) && (visibleObjects.Contains(target) || IsPersistentFlowObject(target))) || IsGroundObject(target))
            {
                RestoreContextFade(target);
            }
            else
            {
                ApplyContextFade(target);
            }
        }

        // 总览专属且位于 Equipment 流程根之外的对象不属于任何关键环节，必须直接隐藏，
        // 不能像普通上下文模型一样继续保持半透明显示。
        HideOverviewOnlyObjectsForProcess();

        // 关键环节中的管道和地面都作为上下文显示：即使它们属于当前步骤可见范围，也不恢复为不透明材质。
        EnsureGroundObjectsVisible(false);
    }

    /// <summary>
    /// 为交互聚焦建立全场上下文：所有模型保持激活，当前节点保持原材质，其余模型及其广告牌底板、广告牌文字统一半透明。
    /// 该方法只在点击或拓扑聚焦时调用，不进入每帧更新路径；复用现有上下文材质和 Graphic（图形组件）透明度缓存。
    /// </summary>
    private void ApplySelectionFocusContext(string nodeId)
    {
        if (!_nodesById.TryGetValue(nodeId, out SceneNodeBinding node))
        {
            return;
        }

        _selectionFocusObjects.Clear();
        GameObject[] selectedTargets = node.Targets;
        for (int targetIndex = 0; targetIndex < selectedTargets.Length; targetIndex++)
        {
            GameObject selectedTarget = selectedTargets[targetIndex];
            if (selectedTarget != null)
            {
                _selectionFocusObjects.Add(selectedTarget);
            }
        }

        // 先恢复上一次聚焦的运行时材质，再按当前选中节点重建上下文，避免透明度叠加或残留。
        RestoreAllContextFades();
        RestoreOverviewOnlyObjectsForOverview();

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
            if (IsSelectionFocusObject(target))
            {
                RestoreContextFade(target);
            }
            else
            {
                ApplyContextFade(target);
            }
        }

        // 燃煤场景的组件支撑等对象位于 Equipment 根节点之外，也必须参与聚焦上下文。
        foreach (KeyValuePair<GameObject, bool> entry in _overviewOnlyInitialActiveStates)
        {
            GameObject target = entry.Key;
            if (target == null)
            {
                continue;
            }

            target.SetActive(entry.Value);
            if (entry.Value && !IsSelectionFocusObject(target))
            {
                ApplyContextFade(target);
            }
        }

        // 建筑群、水池群和外壳遮罩等总览辅助模型不属于选中节点，保持激活并降为半透明。
        for (int contextIndex = 0; contextIndex < _overviewContextObjects.Length; contextIndex++)
        {
            GameObject contextObject = _overviewContextObjects[contextIndex];
            if (contextObject == null || IsSelectionFocusObject(contextObject))
            {
                continue;
            }

            contextObject.SetActive(true);
            ApplyContextFade(contextObject);
        }

        EnsureGroundObjectsVisible(false);
    }

    private bool IsSelectionFocusObject(GameObject target)
    {
        if (target == null)
        {
            return false;
        }

        Transform targetTransform = target.transform;
        foreach (GameObject selectedTarget in _selectionFocusObjects)
        {
            if (selectedTarget == null)
            {
                continue;
            }

            Transform selectedTransform = selectedTarget.transform;
            if (targetTransform == selectedTransform ||
                targetTransform.IsChildOf(selectedTransform) ||
                selectedTransform.IsChildOf(targetTransform))
            {
                return true;
            }
        }

        return false;
    }

    private void HideOverviewOnlyObjectsForProcess()
    {
        foreach (KeyValuePair<GameObject, bool> entry in _overviewOnlyInitialActiveStates)
        {
            if (entry.Key != null)
            {
                entry.Key.SetActive(false);
            }
        }
    }

    /// <summary>
    /// 总览时显示场景根节点下的全部模型，但只恢复总览步骤登记的核心设备材质；
    /// 地面始终保持激活和不透明，其他模型使用上下文半透明材质且不改变当前镜头。
    /// </summary>
    private void ShowAllSceneModels(IReadOnlyList<string> visibleNodeIds)
    {
        SetActiveSelectionTargetsForOverview();
        RestoreAllContextFades();
        // 从关键环节回到总览时，恢复位于流程根节点之外的总览专属对象，例如燃煤场景的组件支撑。
        // 这些对象不参与 Equipment 内部的遍历，必须在此处显式回到进入场景时的激活状态。
        RestoreOverviewOnlyObjectsForOverview();
        HashSet<GameObject> overviewVisibleObjects = new HashSet<GameObject>();
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
                    overviewVisibleObjects.Add(targets[targetIndex]);
                }
            }
        }

        foreach (GameObject target in _initialRootActiveStates.Keys)
        {
            ApplyOverviewObjectVisibility(target, overviewVisibleObjects);
        }

        for (int contextIndex = 0; contextIndex < _overviewContextObjects.Length; contextIndex++)
        {
            ApplyOverviewObjectVisibility(_overviewContextObjects[contextIndex], overviewVisibleObjects);
        }

        EnsureGroundObjectsVisible(true);
    }

    private void RestoreOverviewOnlyObjectsForOverview()
    {
        foreach (KeyValuePair<GameObject, bool> entry in _overviewOnlyInitialActiveStates)
        {
            if (entry.Key != null)
            {
                entry.Key.SetActive(entry.Value);
            }
        }
    }

    private void ApplyOverviewObjectVisibility(GameObject target, HashSet<GameObject> overviewVisibleObjects)
    {
        if (target == null)
        {
            return;
        }

        // 总览不隐藏非核心模型，只降低其视觉权重；地面、管道和核心设备恢复原始材质。
        target.SetActive(true);
        if (IsGroundObject(target) || IsPipelineFlowObject(target) ||
            _overviewOpaqueObjectSet.Contains(target) || overviewVisibleObjects.Contains(target))
        {
            RestoreContextFade(target);
        }
        else
        {
            ApplyContextFade(target);
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

        // 关键环节隐藏的总览专属对象也要按进入场景时的状态恢复，保证重置不会留下隐藏状态。
        foreach (KeyValuePair<GameObject, bool> entry in _overviewOnlyInitialActiveStates)
        {
            if (entry.Key != null)
            {
                entry.Key.SetActive(entry.Value);
            }
        }

        // 地面是场景的永久背景；总览和复位时保持可见且不透明。
        EnsureGroundObjectsVisible(true);
    }

    private void EnsureGroundObjectsVisible(bool opaque)
    {
        for (int groundIndex = 0; groundIndex < _groundObjects.Length; groundIndex++)
        {
            GameObject groundObject = _groundObjects[groundIndex];
            if (groundObject == null)
            {
                continue;
            }

            groundObject.SetActive(true);
            if (opaque)
            {
                RestoreContextFade(groundObject);
            }
            else
            {
                // 关键流程用与其他上下文模型相同的运行时材质降低地面视觉权重。
                ApplyContextFade(groundObject);
            }
        }
    }

    private void HandlePointerSelection()
    {
        Mouse mouse = Mouse.current;
        if (_interactionCamera == null || mouse == null)
        {
            return;
        }

        if (mouse.leftButton.wasPressedThisFrame)
        {
            // 左键首帧只记录起点；必须等释放后确认没有拖拽，才能报告设备单击。
            _pointerPressPosition = mouse.position.ReadValue();
            _pointerWasDragged = false;
            return;
        }

        if (mouse.leftButton.isPressed)
        {
            if (!_pointerWasDragged)
            {
                Vector2 totalPointerDelta = mouse.position.ReadValue() - _pointerPressPosition;
                _pointerWasDragged = totalPointerDelta.sqrMagnitude >=
                    PointerSelectionDragThreshold * PointerSelectionDragThreshold;
            }

            return;
        }

        if (!mouse.leftButton.wasReleasedThisFrame)
        {
            // 鼠标在窗口外释放时可能没有释放事件；下一次有效按下应重新开始一次单击判定。
            _pointerWasDragged = false;
            return;
        }

        Vector2 releaseDelta = mouse.position.ReadValue() - _pointerPressPosition;
        bool wasDragged = _pointerWasDragged ||
            releaseDelta.sqrMagnitude >= PointerSelectionDragThreshold * PointerSelectionDragThreshold;
        _pointerWasDragged = false;
        if (wasDragged)
        {
            return;
        }

        // 测试面板或其他 Unity UI 的点击不属于三维空白点击，避免操作面板时误清除场景选择。
        if (EventSystem.current != null && EventSystem.current.IsPointerOverGameObject())
        {
            return;
        }

        Ray ray = _interactionCamera.ScreenPointToRay(mouse.position.ReadValue());
        if (TryResolvePointerSelection(ray, out string sceneNodeId, out GameObject rootObject))
        {
            // Unity 鼠标选中与拓扑选中共用同一套交互描边、镜头和全场半透明上下文。
            // 当前节点保持实体显示，其余模型及附着的广告牌底板、文字统一由上下文层降权。
            ApplySelectionFocusContext(sceneNodeId);
            ApplyProcessHighlightForNode(sceneNodeId);
            _activeInteractionNodeId = sceneNodeId;
            if (_focusOnSelection)
            {
                FocusCameraOnHighlightedNode();
            }

            // 映射表由场景配置工具以明确三维节点标识登记；点击回传不借助模型名称或二维拓扑节点猜测。
            // 前端收到 objectSelected 后按 sceneId + sceneNodeId 反查并选中对应二维拓扑节点。
            UnityIframeBridgeManager.Instance?.ReportObjectSelected(sceneNodeId, rootObject.name);
            return;
        }

        ClearInteractionSelectionFromScenePointer();
    }

    /// <summary>
    /// 三维场景空白或未映射对象点击时，清除当前交互选择并通知二维拓扑。
    /// 仅当交互选择实际存在时才执行，避免点击地面误清除流程步骤自身的描边或产生重复跨端事件。
    /// </summary>
    private void ClearInteractionSelectionFromScenePointer()
    {
        if (string.IsNullOrEmpty(_activeInteractionNodeId))
        {
            return;
        }

        ClearProcessHighlight();
        _activeInteractionNodeId = null;
        _selectionFocusObjects.Clear();
        if (_freeCameraController != null)
        {
            _freeCameraController.CancelFocus();
        }

        UnityIframeBridgeManager.Instance?.ReportSelectionCleared();
    }

    /// <summary>
    /// 先使用 Unity 物理射线保持现有燃气场景的精确碰撞体验；若首个碰撞对象没有业务映射，
    /// 其距离会成为渲染器后备命中的遮挡上限。只有属性面板已登记的节点渲染器才参与后备检测。
    /// </summary>
    private bool TryResolvePointerSelection(Ray ray, out string sceneNodeId, out GameObject rootObject)
    {
        sceneNodeId = null;
        rootObject = null;
        float rendererMaximumDistance = float.PositiveInfinity;
        if (Physics.Raycast(ray, out RaycastHit hit))
        {
            GameObject configuredTarget = FindConfiguredSelectionTarget(hit.collider.transform);
            if (configuredTarget != null && _selectionNodeByObject.TryGetValue(configuredTarget, out string hitSceneNodeId))
            {
                if (IsSceneNodeSelectable(hitSceneNodeId))
                {
                    sceneNodeId = hitSceneNodeId;
                    rootObject = configuredTarget;
                    return true;
                }

                // 当前步骤之外的已登记模型仍属于真实遮挡物，但不能作为可选目标。
                rendererMaximumDistance = hit.distance;
            }
            else
            {
                // 未映射碰撞体仍是真实遮挡物，后备包围盒不能穿过它选择后方设备。
                rendererMaximumDistance = hit.distance;
            }
        }

        return SceneNodeRendererPicker.TryPick(
            ray,
            _activeSelectionRendererTargets,
            rendererMaximumDistance,
            out sceneNodeId,
            out rootObject,
            out _);
    }

    /// <summary>
    /// 从物理命中的子对象逐级向上查找属性面板已登记目标。
    /// 查询到场景根即停止，禁止跨出当前业务场景或按根对象名称回退匹配。
    /// </summary>
    private GameObject FindConfiguredSelectionTarget(Transform transform)
    {
        if (_sceneRoot == null)
        {
            return null;
        }

        Transform current = transform;
        while (current != null && current != _sceneRoot)
        {
            if (_selectionNodeByObject.ContainsKey(current.gameObject))
            {
                return current.gameObject;
            }

            current = current.parent;
        }

        return null;
    }

    /// <summary>
    /// 返回目标在当前业务场景根下的第一层对象。
    /// 该方法只用于把子渲染器归并到场景级管道对象；交互选择必须使用
    /// FindConfiguredSelectionTarget，避免把未显式配置的同级模型误识别为可选节点。
    /// </summary>
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

    /// <summary>
    /// 为告警、故障节点应用纯色半透明状态材质。每个状态只创建一份共享模板材质；
    /// 每个渲染器仅缓存原始数组与同长度引用数组，因此重复的状态切换不会重复克隆材质。
    /// </summary>
    private void ApplyVisualStateMaterials(string sceneNodeId, BusinessSceneNodeVisualState visualState)
    {
        if (!_visualStateRenderersByNodeId.TryGetValue(sceneNodeId, out Renderer[] renderers))
        {
            return;
        }

        Material stateMaterial = GetVisualStateMaterial(visualState);
        if (stateMaterial == null)
        {
            RestoreVisualStateMaterials(sceneNodeId);
            return;
        }

        for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
        {
            Renderer renderer = renderers[rendererIndex];
            if (renderer == null)
            {
                continue;
            }

            if (!_activeVisualStateMaterials.TryGetValue(renderer, out ActiveVisualStateMaterials activeMaterials))
            {
                // 状态层优先于上下文层。已有上下文材质先回退到模型原材质，并在状态结束后再延迟恢复。
                SuspendContextFadeForVisualState(renderer);
                Material[] originalMaterials = renderer.sharedMaterials;
                Material[] runtimeMaterials = new Material[originalMaterials.Length];
                _activeVisualStateMaterials.Add(renderer, new ActiveVisualStateMaterials
                {
                    OriginalMaterials = originalMaterials,
                    // 材质属性块属于渲染器槽位实例，设置 sharedMaterials 不会自动清除；必须在写入状态色前保存。
                    OriginalPropertyBlocks = CaptureMaterialPropertyBlocks(renderer, originalMaterials.Length),
                    RuntimeMaterials = runtimeMaterials
                });
                activeMaterials = _activeVisualStateMaterials[renderer];
            }

            for (int materialIndex = 0; materialIndex < activeMaterials.RuntimeMaterials.Length; materialIndex++)
            {
                activeMaterials.RuntimeMaterials[materialIndex] = activeMaterials.OriginalMaterials[materialIndex] != null
                    ? stateMaterial
                    : null;
                _visualStatePropertyBlock.Clear();
                renderer.GetPropertyBlock(_visualStatePropertyBlock, materialIndex);
                _visualStatePropertyBlock.SetColor(VisualStateBaseColorPropertyId, stateMaterial.GetColor(VisualStateBaseColorPropertyId));
                renderer.SetPropertyBlock(_visualStatePropertyBlock, materialIndex);
            }

            renderer.sharedMaterials = activeMaterials.RuntimeMaterials;
        }
    }

    /// <summary>
    /// 按材质槽位复制状态覆盖前的材质属性块。空属性块以 null（空引用）保存，恢复时传回 null 可真正清除
    /// 告警、故障写入的覆盖，而不是留下一个空实例覆盖并额外影响渲染批处理（render batching）。
    /// 此方法仅在渲染器首次进入告警或故障状态时调用，不处于高频状态切换路径。
    /// </summary>
    private static MaterialPropertyBlock[] CaptureMaterialPropertyBlocks(Renderer renderer, int materialSlotCount)
    {
        MaterialPropertyBlock[] originalPropertyBlocks = new MaterialPropertyBlock[materialSlotCount];
        for (int materialIndex = 0; materialIndex < materialSlotCount; materialIndex++)
        {
            MaterialPropertyBlock propertyBlock = new MaterialPropertyBlock();
            renderer.GetPropertyBlock(propertyBlock, materialIndex);
            // Unity 2022.3 的 isEmpty（是否为空）可区分未配置属性块与仅含默认值的属性块。
            originalPropertyBlocks[materialIndex] = propertyBlock.isEmpty ? null : propertyBlock;
        }

        return originalPropertyBlocks;
    }

    /// <summary>
    /// 恢复单个渲染器的原材质及状态前属性块。顺序不能颠倒：先恢复材质槽位，再恢复对应属性块，
    /// 以免状态材质残留的 _BaseColor（基础颜色）继续覆盖模型的基础颜色或其它系统维护的实例参数。
    /// </summary>
    private static void RestoreRendererVisualStateMaterials(Renderer renderer, ActiveVisualStateMaterials activeMaterials)
    {
        renderer.sharedMaterials = activeMaterials.OriginalMaterials;
        for (int materialIndex = 0; materialIndex < activeMaterials.OriginalMaterials.Length; materialIndex++)
        {
            MaterialPropertyBlock originalPropertyBlock = activeMaterials.OriginalPropertyBlocks != null
                && materialIndex < activeMaterials.OriginalPropertyBlocks.Length
                ? activeMaterials.OriginalPropertyBlocks[materialIndex]
                : null;
            renderer.SetPropertyBlock(originalPropertyBlock, materialIndex);
        }
    }

    /// <summary>
    /// 创建并缓存告警或故障的纯色透明模板材质。模板使用已登记的 URP 透明着色器，
    /// 不复制设备原贴图、金属度或颜色，因此模型本体稳定呈现单一状态色。
    /// </summary>
    private Material GetVisualStateMaterial(BusinessSceneNodeVisualState visualState)
    {
        if (_contextFadeMaterial == null || _visualStateConfig == null)
        {
            return null;
        }

        if (visualState == BusinessSceneNodeVisualState.Alarm)
        {
            if (_alarmVisualStateMaterial == null)
            {
                _alarmVisualStateMaterial = CreateVisualStateMaterial("Alarm", _visualStateConfig.AlarmColor);
            }
            return _alarmVisualStateMaterial;
        }

        if (visualState == BusinessSceneNodeVisualState.Fault)
        {
            if (_faultVisualStateMaterial == null)
            {
                _faultVisualStateMaterial = CreateVisualStateMaterial("Fault", _visualStateConfig.FaultColor);
            }
            return _faultVisualStateMaterial;
        }

        return null;
    }

    private Material CreateVisualStateMaterial(string stateName, Color stateColor)
    {
        Material material = new Material(_contextFadeMaterial)
        {
            name = $"{_contextFadeMaterial.name} (Runtime State {stateName})"
        };
        material.SetColor(VisualStateBaseColorPropertyId, stateColor);
        material.SetFloat(VisualStateOpacityPropertyId, _visualStateConfig.OverlayOpacity);
        return material;
    }

    /// <summary>
    /// 状态开始前撤销已有上下文材质。恢复时以延迟标记重新应用上下文，
    /// 保证状态材质始终位于最上层且不会引用已销毁的上下文材质。
    /// </summary>
    private void SuspendContextFadeForVisualState(Renderer renderer)
    {
        if (!_activeContextFades.TryGetValue(renderer, out ActiveContextFadeMaterials activeMaterials))
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
        _deferredContextFadeRenderers.Add(renderer);
    }

    /// <summary>
    /// 清除单个节点的告警、故障运行时材质。清除后恢复原材质；若状态期间收到半透明上下文请求，
    /// 则只在此时创建上下文材质，避免状态和上下文两个材质层同时占用同一渲染器。
    /// </summary>
    private void RestoreVisualStateMaterials(string sceneNodeId)
    {
        if (!_visualStateRenderersByNodeId.TryGetValue(sceneNodeId, out Renderer[] renderers))
        {
            return;
        }

        for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
        {
            Renderer renderer = renderers[rendererIndex];
            if (renderer == null || !_activeVisualStateMaterials.TryGetValue(renderer, out ActiveVisualStateMaterials activeMaterials))
            {
                continue;
            }

            RestoreRendererVisualStateMaterials(renderer, activeMaterials);
            _activeVisualStateMaterials.Remove(renderer);
            if (_deferredContextFadeRenderers.Remove(renderer))
            {
                ApplyContextFadeToRenderer(renderer);
            }
        }
    }

    /// <summary>
    /// 场景卸载与注册表重建时恢复所有仍受状态材质控制的渲染器。
    /// 此路径只回退原材质并释放引用，不创建延迟的上下文半透明材质。
    /// </summary>
    private void RestoreAllVisualStateMaterials()
    {
        foreach (KeyValuePair<Renderer, ActiveVisualStateMaterials> pair in _activeVisualStateMaterials)
        {
            if (pair.Key != null)
            {
                RestoreRendererVisualStateMaterials(pair.Key, pair.Value);
            }
        }

        _activeVisualStateMaterials.Clear();
        _deferredContextFadeRenderers.Clear();
    }

    private void ReleaseVisualStateMaterialTemplates()
    {
        DestroyRuntimeMaterial(_alarmVisualStateMaterial);
        DestroyRuntimeMaterial(_faultVisualStateMaterial);
        _alarmVisualStateMaterial = null;
        _faultVisualStateMaterial = null;
    }

    private void ApplyContextFade(GameObject target)
    {
        if (target == null)
        {
            return;
        }

        // 模型广告牌使用 MeshRenderer（网格渲染器），广告牌文字使用 TextMeshProUGUI（文本组件）。
        // 两者都从父模型向下收集，保证父模型进入上下文半透明时广告牌底板和文字同步变化。
        Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
        for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
        {
            ApplyContextFadeToRenderer(renderers[rendererIndex]);
        }

        Graphic[] graphics = target.GetComponentsInChildren<Graphic>(true);
        for (int graphicIndex = 0; graphicIndex < graphics.Length; graphicIndex++)
        {
            ApplyContextFadeToGraphic(graphics[graphicIndex]);
        }
    }

    /// <summary>
    /// 对单个渲染器创建上下文半透明材质。若告警、故障状态已占用该渲染器，只记录待处理标记，
    /// 等状态清除后统一回到上下文层，避免显隐更新意外覆盖状态纯色材质。
    /// </summary>
    private void ApplyContextFadeToRenderer(Renderer renderer)
    {
        if (renderer == null)
        {
            return;
        }
        if (_activeVisualStateMaterials.ContainsKey(renderer))
        {
            _deferredContextFadeRenderers.Add(renderer);
            return;
        }
        if (_activeContextFades.ContainsKey(renderer))
        {
            return;
        }
        if (_contextFadeMaterial == null)
        {
            if (HasPipelineFlowMaterial(renderer))
            {
                ApplyContextFadeToPipelineRenderer(renderer);
            }
            return;
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

            Material runtimeMaterial = IsPipelineFlowMaterial(originalMaterial)
                ? new Material(originalMaterial)
                : new Material(_contextFadeMaterial);
            runtimeMaterial.name = $"{(_contextFadeMaterial != null ? _contextFadeMaterial.name : originalMaterial.name)} (Runtime Context)";
            if (IsPipelineFlowMaterial(originalMaterial))
            {
                // 管道上下文材质沿用原流动 Shader 和速度，只降低透明度，确保半透明时仍能观察流向。
                runtimeMaterial.SetFloat(PipelineFlowOpacityPropertyId, _contextOpacity);
            }
            else
            {
                CopyOriginalAppearance(originalMaterial, runtimeMaterial);
                if (runtimeMaterial.HasProperty(VisualStateOpacityPropertyId))
                {
                    runtimeMaterial.SetFloat(VisualStateOpacityPropertyId, _contextOpacity);
                }
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

    private static bool HasPipelineFlowMaterial(Renderer renderer)
    {
        Material[] materials = renderer.sharedMaterials;
        for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
        {
            if (IsPipelineFlowMaterial(materials[materialIndex]))
            {
                return true;
            }
        }

        return false;
    }

    private void ApplyContextFadeToPipelineRenderer(Renderer renderer)
    {
        if (renderer == null)
        {
            return;
        }
        if (_activeVisualStateMaterials.ContainsKey(renderer))
        {
            _deferredContextFadeRenderers.Add(renderer);
            return;
        }
        if (_activeContextFades.ContainsKey(renderer))
        {
            return;
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

            Material runtimeMaterial = IsPipelineFlowMaterial(originalMaterial)
                ? new Material(originalMaterial)
                : new Material(_contextFadeMaterial);
            runtimeMaterial.name = $"{(_contextFadeMaterial != null ? _contextFadeMaterial.name : originalMaterial.name)} (Runtime Context)";
            if (IsPipelineFlowMaterial(originalMaterial))
            {
                runtimeMaterial.SetFloat(PipelineFlowOpacityPropertyId, _contextOpacity);
            }
            else
            {
                CopyOriginalAppearance(originalMaterial, runtimeMaterial);
                if (runtimeMaterial.HasProperty("_Opacity"))
                {
                    runtimeMaterial.SetFloat("_Opacity", _contextOpacity);
                }
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

        Graphic[] graphics = target.GetComponentsInChildren<Graphic>(true);
        for (int graphicIndex = 0; graphicIndex < graphics.Length; graphicIndex++)
        {
            RestoreContextFade(graphics[graphicIndex]);
        }
    }

    private void RestoreContextFade(Renderer renderer)
    {
        if (renderer == null)
        {
            return;
        }
        if (_activeVisualStateMaterials.ContainsKey(renderer))
        {
            // 节点恢复显示时取消待处理上下文；状态清除后必须回到原材质，而不是重新半透明。
            _deferredContextFadeRenderers.Remove(renderer);
            return;
        }
        if (!_activeContextFades.TryGetValue(renderer, out ActiveContextFadeMaterials activeMaterials))
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

    private void ApplyContextFadeToGraphic(Graphic graphic)
    {
        if (graphic == null || _activeContextFadeGraphics.ContainsKey(graphic))
        {
            return;
        }

        // 只缩放颜色的 alpha（透明度）通道，保留文字原本的颜色、渐变和其它 TMP 显示设置。
        // 缓存当前颜色而非预设颜色，兼容运行时动态修改的广告牌文字颜色。
        Color originalColor = graphic.color;
        Color fadedColor = originalColor;
        fadedColor.a *= _contextOpacity;
        graphic.color = fadedColor;
        _activeContextFadeGraphics.Add(graphic, originalColor);
    }

    private void RestoreContextFade(Graphic graphic)
    {
        if (graphic == null || !_activeContextFadeGraphics.TryGetValue(graphic, out Color originalColor))
        {
            return;
        }

        graphic.color = originalColor;
        _activeContextFadeGraphics.Remove(graphic);
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

        // CanvasRenderer（画布渲染器）不使用模型材质副本，恢复时直接还原文字进入半透明前的颜色。
        foreach (KeyValuePair<Graphic, Color> pair in _activeContextFadeGraphics)
        {
            if (pair.Key != null)
            {
                pair.Key.color = pair.Value;
            }
        }

        _activeContextFades.Clear();
        _activeContextFadeGraphics.Clear();
        _deferredContextFadeRenderers.Clear();
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

    private bool IsPipelineFlowObject(GameObject target)
    {
        return target != null && _pipelineFlowObjectSet.Contains(target);
    }

    /// <summary>
    /// 关键环节统一将全部流动管道切换为上下文半透明。
    /// 管道仍保留原流动 Shader 和速度，不会因半透明而停止流动；故障停流由 SetPipelineFlowStopped 单独控制。
    /// </summary>
    private void ApplyPipelineFlowContextFade()
    {
        foreach (GameObject pipelineObject in _pipelineFlowObjectSet)
        {
            ApplyContextFade(pipelineObject);
        }
    }

    private static bool IsPipelineFlowMaterial(Material material)
    {
        return material != null && material.shader != null &&
            string.Equals(material.shader.name, PipelineFlowShaderName, StringComparison.Ordinal);
    }

    /// <summary>
    /// 缓存场景内所有使用管道流动 Shader 的渲染器和材质槽。
    /// 通过 Shader 身份识别管道与电线，避免遗漏未加入 _persistentFlowObjects 的流动模型，也不依赖对象名称。
    /// </summary>
    private void CachePipelineFlowMaterials()
    {
        if (_sceneRoot == null)
        {
            return;
        }

        Renderer[] renderers = _sceneRoot.GetComponentsInChildren<Renderer>(true);
        for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
        {
            Renderer renderer = renderers[rendererIndex];
            if (renderer == null)
            {
                continue;
            }

            Material[] materials = renderer.sharedMaterials;
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                Material material = materials[materialIndex];
                if (!IsPipelineFlowMaterial(material) || !material.HasProperty(PipelineFlowSpeedPropertyId))
                {
                    continue;
                }

                _pipelineFlowObjectSet.Add(FindDirectSceneChild(renderer.transform) ?? renderer.gameObject);
                _pipelineFlowMaterials.Add(new PipelineFlowMaterialBinding
                {
                    Renderer = renderer,
                    MaterialIndex = materialIndex,
                    OriginalSpeed = material.GetFloat(PipelineFlowSpeedPropertyId)
                });
            }
        }
    }

    /// <summary>
    /// 将全部流动材质的 _FlowSpeed 统一切换为 0 或恢复初始化时的原始速度。
    /// MaterialPropertyBlock（材质属性块）只覆盖当前渲染器实例，不污染共享材质球和其它场景；
    /// forceReapply（强制重写）只在状态恢复会还原属性块时使用，以保留其它故障造成的全局冻结结果。
    /// </summary>
    private void SetPipelineFlowStopped(bool stopped, bool forceReapply = false)
    {
        if (!forceReapply && _pipelineFlowsStopped == stopped)
        {
            return;
        }

        for (int bindingIndex = 0; bindingIndex < _pipelineFlowMaterials.Count; bindingIndex++)
        {
            PipelineFlowMaterialBinding binding = _pipelineFlowMaterials[bindingIndex];
            if (binding.Renderer == null)
            {
                continue;
            }

            _pipelineFlowPropertyBlock.Clear();
            binding.Renderer.GetPropertyBlock(_pipelineFlowPropertyBlock, binding.MaterialIndex);
            _pipelineFlowPropertyBlock.SetFloat(
                PipelineFlowSpeedPropertyId,
                stopped ? 0f : binding.OriginalSpeed);
            binding.Renderer.SetPropertyBlock(_pipelineFlowPropertyBlock, binding.MaterialIndex);
        }

        _pipelineFlowsStopped = stopped;
    }

    private static void CopyOriginalAppearance(Material original, Material target)
    {
        if (original == null || target == null)
        {
            return;
        }

        CopyTexture(original, target, "_BaseMap", "_BaseMap");
        CopyTexture(original, target, "_MainTex", "_BaseMap");
        // 燃煤 FBX 使用 PhysicalMaterial3DsMax（物理材质）导入，主贴图和底色分别存于
        // _BASE_COLOR_MAP、_BASE_COLOR；显式映射到上下文材质后，半透明效果才能保留原模型纹理与配色。
        CopyTexture(original, target, "_BASE_COLOR_MAP", "_BaseMap");
        CopyTexture(original, target, "_BumpMap", "_BumpMap");
        CopyTexture(original, target, "_MetallicGlossMap", "_MetallicGlossMap");

        if (target.HasProperty("_BaseColor"))
        {
            // 优先使用燃煤 PhysicalMaterial3DsMax 的实际底色属性；燃气使用的 URP 材质继续按
            // _BaseColor、_Color 的原有顺序回退，从而让两个场景复用同一套半透明处理逻辑。
            if (original.HasProperty("_BASE_COLOR"))
            {
                target.SetColor("_BaseColor", original.GetColor("_BASE_COLOR"));
            }
            else if (original.HasProperty("_BaseColor"))
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
                new[] { "inlet-duct", "gas-turbine" },
                "inlet-duct"),
            CreateProcessStep("inlet-duct", "1", new[] { "inlet-duct", "gas-turbine" }, "inlet-duct"),
            CreateProcessStep("inlet-duct", "2", new[] { "inlet-duct", "gas-turbine" }, "inlet-duct"),
            CreateProcessStep("gas-turbine", AllUnitsId, new[] { "gas-turbine" }, "gas-turbine"),
            CreateProcessStep("hrsg", AllUnitsId, new[] { "hrsg" }, "hrsg"),
            CreateProcessStep("steam-turbine", AllUnitsId, new[] { "steam-turbine" }, "steam-turbine"),
            CreateProcessStep(
                "generator",
                AllUnitsId,
                new[] { "generator" },
                "generator"),
            CreateProcessStep(
                "generator",
                "1",
                new[] { "generator" },
                "generator"),
            CreateProcessStep(
                "generator",
                "2",
                new[] { "generator" },
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

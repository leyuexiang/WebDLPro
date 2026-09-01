using System;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// 一组飞线的端点数据。
/// 每个元素只描述起点和终点，所有组共享父组件的弧线与渲染参数。
/// </summary>
[Serializable]
public sealed class FlyLineEndpointGroup
{
    [Tooltip("该组飞线起点的跟随变换。启用端点变换模式后读取其世界坐标。")]
    [SerializeField] private Transform _startPoint;
    [Tooltip("该组飞线终点的跟随变换。启用端点变换模式后读取其世界坐标。")]
    [SerializeField] private Transform _endPoint;
    [Tooltip("未绑定变换时使用的起点世界坐标。")]
    [SerializeField] private Vector3 _startPosition = Vector3.zero;
    [Tooltip("未绑定变换时使用的终点世界坐标。")]
    [SerializeField] private Vector3 _endPosition = Vector3.forward;
    [Tooltip("是否使用该组绑定的 Transform（变换）作为端点来源。关闭后使用显式坐标。")]
    [SerializeField] private bool _useEndpointTransforms = true;
    [Tooltip("该组是否曾经通过显式坐标配置。用于在端点变换暂时失效时保留最后一组有效坐标。")]
    [SerializeField] private bool _hasExplicitEndpoints;

    public Transform StartPoint => _startPoint;
    public Transform EndPoint => _endPoint;
    public bool UseEndpointTransforms => _useEndpointTransforms;

    /// <summary>根据该组的端点模式解析当前世界坐标。</summary>
    internal bool TryResolve(bool followEndpointTransforms, out Vector3 start, out Vector3 end)
    {
        if (!_useEndpointTransforms || (!followEndpointTransforms && _hasExplicitEndpoints))
        {
            start = _startPosition;
            end = _endPosition;
            return true;
        }

        if (_startPoint != null && _endPoint != null)
        {
            start = _startPoint.position;
            end = _endPoint.position;
            return true;
        }

        if (_hasExplicitEndpoints)
        {
            start = _startPosition;
            end = _endPosition;
            return true;
        }

        start = default;
        end = default;
        return false;
    }

    internal void SetPositions(Vector3 startPosition, Vector3 endPosition)
    {
        _startPosition = startPosition;
        _endPosition = endPosition;
        _useEndpointTransforms = false;
        _hasExplicitEndpoints = true;
    }

    internal void Bind(Transform startPoint, Transform endPoint)
    {
        _startPoint = startPoint;
        _endPoint = endPoint;
        _useEndpointTransforms = true;
        _hasExplicitEndpoints = false;
    }
}

/// <summary>
/// 飞线特效控制器。
/// 组件为每组端点使用独立的 LineRenderer（线渲染器），避免多组路径被错误连接；
/// 第 0 组继续复用根物体上的原有 LineRenderer，其余组使用缓存的子物体渲染器。
/// 可选信号增强层只显示一条细线和一个沿路径移动的亮点，不在每帧创建数组或材质。
/// </summary>
[DisallowMultipleComponent]
[RequireComponent(typeof(LineRenderer))]
public sealed class FlyLineEffectController : MonoBehaviour
{
    private static readonly int BaseColorPropertyId = Shader.PropertyToID("_BaseColor");
    private static readonly int FlowColorPropertyId = Shader.PropertyToID("_FlowColor");
    private static readonly int FlowSpeedPropertyId = Shader.PropertyToID("_FlowSpeed");
    private static readonly int FlowIntensityPropertyId = Shader.PropertyToID("_FlowIntensity");
    private static readonly int FlowTilingPropertyId = Shader.PropertyToID("_FlowTiling");
    private static readonly int FlowWidthPropertyId = Shader.PropertyToID("_FlowWidth");
    private static readonly int FlowContrastPropertyId = Shader.PropertyToID("_FlowContrast");
    private static readonly int OpacityPropertyId = Shader.PropertyToID("_Opacity");
    private static readonly int GlowColorPropertyId = Shader.PropertyToID("_GlowColor");
    private static readonly int GlowSpeedPropertyId = Shader.PropertyToID("_GlowSpeed");
    private static readonly int GlowTilingPropertyId = Shader.PropertyToID("_GlowTiling");
    private static readonly int GlowWidthPropertyId = Shader.PropertyToID("_GlowWidth");
    private static readonly int GlowIntensityPropertyId = Shader.PropertyToID("_GlowIntensity");
    private static readonly int GlowOpacityPropertyId = Shader.PropertyToID("_GlowOpacity");
    private static readonly int GlowPhasePropertyId = Shader.PropertyToID("_GlowPhase");
    private static readonly int GlowBasePropertyId = Shader.PropertyToID("_GlowBase");

    [Header("第 0 组端点")]
    [Tooltip("飞线第 0 组起点的跟随变换。启用后，起点会在刷新时直接读取该变换的位置。")]
    [SerializeField] private Transform _startPoint;
    [Tooltip("飞线第 0 组终点的跟随变换。启用后，终点会在刷新时直接读取该变换的位置。")]
    [SerializeField] private Transform _endPoint;
    [Tooltip("未绑定变换时使用的第 0 组起点世界坐标。")]
    [SerializeField] private Vector3 _startPosition = Vector3.zero;
    [Tooltip("未绑定变换时使用的第 0 组终点世界坐标。")]
    [SerializeField] private Vector3 _endPosition = Vector3.forward;
    [Tooltip("是否优先使用 Transform（变换）作为第 0 组端点来源。关闭后只使用显式坐标。")]
    [SerializeField] private bool _useEndpointTransforms = true;
    [Tooltip("播放时是否持续跟随所有端点变换的位置变化。")]
    [SerializeField] private bool _followEndpointTransforms = true;

    [Header("额外飞线组")]
    [Tooltip("第 1 组及之后的飞线端点。每个元素只配置一对起点和终点，所有组共享下方弧线与渲染参数。")]
    [SerializeField] private FlyLineEndpointGroup[] _additionalEndpointGroups = new FlyLineEndpointGroup[0];

    [Header("弧线")]
    [Tooltip("弧线抬升方向。默认向上，适合地图、总览和拓扑面板中的飞线效果。")]
    [SerializeField] private Vector3 _curveDirection = Vector3.up;
    [Tooltip("弧线控制点相对中点的抬升高度。数值越大，飞线弧度越明显。")]
    [SerializeField, Min(0f)] private float _curveHeight = 2f;
    [Tooltip("弧线采样点数量。数值越大越平滑，但每次刷新会多写入更多顶点。")]
    [SerializeField, Range(2, 256)] private int _segmentCount = 32;

    [Header("渲染")]
    [Tooltip("所有飞线共用的共享材质。建议使用支持流动 UV 的 PipelineFlowURP 材质。")]
    [SerializeField] private Material _sharedMaterial;
    [Tooltip("所有飞线的基础颜色。若材质支持 _FlowColor 或 _BaseColor，则会同时写入材质属性块。")]
    [SerializeField, ColorUsage(true, true)] private Color _lineColor = new Color(0f, 0.85f, 1.4f, 1f);
    [Tooltip("线条基础透明度。")]
    [SerializeField, Range(0f, 1f)] private float _opacity = 1f;
    [Tooltip("线条起点宽度。")]
    [SerializeField, Min(0f)] private float _startWidth = 0.018f;
    [Tooltip("线条终点宽度。")]
    [SerializeField, Min(0f)] private float _endWidth = 0.018f;
    [Tooltip("飞线材质中的流动速度参数。正值表示沿材质 UV 的正向流动。")]
    [SerializeField, Range(-10f, 10f)] private float _flowSpeed = 1.5f;
    [Tooltip("飞线材质中的流动亮度参数。")]
    [SerializeField, Range(0f, 8f)] private float _flowIntensity = 1.5f;
    [Tooltip("飞线材质中的流动条带密度。")]
    [SerializeField, Range(0.05f, 8f)] private float _flowTiling = 1f;
    [Tooltip("飞线材质中的条带宽度。")]
    [SerializeField, Range(0.01f, 0.95f)] private float _flowWidth = 0.2f;
    [Tooltip("飞线材质中的流动对比度。")]
    [SerializeField, Range(0.1f, 4f)] private float _flowContrast = 1.1f;
    [Tooltip("组件启用后是否立即显示飞线。")]
    [SerializeField] private bool _playOnEnable = true;
    [Tooltip("未手动指定材质时，是否允许在运行时自动创建一个可用的默认材质。")]
    [SerializeField] private bool _autoCreateFallbackMaterial = true;

    [Header("信号增强")]
    [Tooltip("信号增强层使用的加法混合材质，用于绘制基础细线和单个移动亮点。")]
    [SerializeField] private Material _glowMaterial;
    [Tooltip("是否启用信号增强层。开启后每条飞线只保留一个循环移动的亮点。")]
    [SerializeField] private bool _enableGlowLayers = true;
    [Tooltip("信号增强线相对主线的宽度倍数，建议接近 1，避免形成粗带。")]
    [SerializeField, Min(1f)] private float _glowWidthMultiplier = 1.3f;
    [Tooltip("移动亮点的透明度。")]
    [SerializeField, Range(0f, 1f)] private float _glowOpacity = 0.75f;
    [Tooltip("保留的核心线宽度配置；当前信号样式不启用第二条核心叠加线。")]
    [SerializeField, Min(0.001f)] private float _coreWidth = 0.018f;
    [Tooltip("沿飞线移动的亮点颜色。")]
    [SerializeField, ColorUsage(true, true)] private Color _glowColor = new Color(0.1f, 0.75f, 2.2f, 1f);
    [Tooltip("保留的核心颜色配置；当前信号样式只使用 _glowColor。")]
    [SerializeField, ColorUsage(true, true)] private Color _coreColor = new Color(0.65f, 1.8f, 3.2f, 1f);
    [Tooltip("移动亮点沿飞线循环移动的速度。")]
    [SerializeField, Range(-10f, 10f)] private float _glowSpeed = 2.4f;
    [Tooltip("移动亮点宽度控制，值越大亮点越细。")]
    [SerializeField, Range(0.1f, 20f)] private float _glowTiling = 3.8f;
    [Tooltip("移动亮点的发光强度。")]
    [SerializeField, Range(0f, 10f)] private float _glowIntensity = 3.5f;

    private const string AdditionalRendererNamePrefix = "FlyLineRenderer_";
    private const string GlowRendererNamePrefix = "FlyLineGlow_";
    private const string CoreRendererNamePrefix = "FlyLineCore_";
    private LineRenderer _lineRenderer;
    private LineRenderer[] _groupRenderers;
    private LineRenderer[] _glowRenderers;
    private LineRenderer[] _coreRenderers;
    private MaterialPropertyBlock _materialPropertyBlock;
    private Vector3[] _positions;
    private Vector3[] _lastStartPositions;
    private Vector3[] _lastEndPositions;
    private bool[] _lastEndpointValidity;
    private Material _runtimeMaterial;
    private bool _isPlaying;
    private bool _hasExplicitEndpoints;
    private bool _isInitialized;
    private bool _visualSettingsDirty = true;
#if UNITY_EDITOR
    private bool _editorRefreshQueued;
#endif

    /// <summary>当前飞线是否处于播放状态。</summary>
    public bool IsPlaying => _isPlaying;

    /// <summary>当前已经缓存并用于第 0 组渲染的 LineRenderer（线渲染器）。</summary>
    public LineRenderer LineRendererComponent => _lineRenderer;

    /// <summary>当前配置的飞线组数量，包含第 0 组。</summary>
    public int EndpointGroupCount => 1 + (_additionalEndpointGroups == null ? 0 : _additionalEndpointGroups.Length);

    private void Reset()
    {
        // Reset 只负责把组件拉回一个可直接预览的默认状态，不会创建多余端点组。
        _lineRenderer = GetComponent<LineRenderer>();
        if (_lineRenderer == null)
        {
            _lineRenderer = gameObject.AddComponent<LineRenderer>();
        }

        ApplyRendererDefaults(_lineRenderer);
        _visualSettingsDirty = true;
        RefreshGeometry();
    }

    private void Awake()
    {
        InitializeRenderer();
    }

    private void OnEnable()
    {
        InitializeRenderer();
        SetEffectEnabled(_playOnEnable);
    }

    private void LateUpdate()
    {
        // 只有存在变换端点时才进入刷新逻辑；显式坐标组不会产生每帧 SetPositions 调用。
        if (_isPlaying && _followEndpointTransforms && HasTransformEndpointGroup())
        {
            RefreshGeometryInternal(false);
        }
    }

    private void OnDestroy()
    {
#if UNITY_EDITOR
        if (_editorRefreshQueued)
        {
            UnityEditor.EditorApplication.delayCall -= ExecuteQueuedEditorRefresh;
            _editorRefreshQueued = false;
        }
#endif

        // 运行时材质只能由本组件自己销毁，避免长期占用内存。
        if (_runtimeMaterial == null)
        {
            return;
        }

        if (Application.isPlaying)
        {
            Destroy(_runtimeMaterial);
        }
        else
        {
            DestroyImmediate(_runtimeMaterial);
        }
    }

#if UNITY_EDITOR
    /// <summary>
    /// 编辑器里修改弧线、组数量或渲染参数后立即重建，便于在检视面板中直接预览。
    /// 这里不强制创建运行时材质副本，避免把场景实例污染成未保存资源。
    /// </summary>
    private void OnValidate()
    {
        _segmentCount = Mathf.Clamp(_segmentCount, 2, 256);
        _curveHeight = Mathf.Max(0f, _curveHeight);
        _startWidth = Mathf.Max(0f, _startWidth);
        _endWidth = Mathf.Max(0f, _endWidth);
        _visualSettingsDirty = true;

        // 磁盘上的预制体资源不能在 OnValidate 中直接新增子 Transform；预制体资产只保留已有配置，运行时或预制体内容编辑阶段再允许补建渲染层。
        if (UnityEditor.PrefabUtility.IsPartOfPrefabAsset(gameObject)
            && UnityEditor.SceneManagement.PrefabStageUtility.GetPrefabStage(gameObject) == null)
        {
            return;
        }

        ApplyRendererDefaults(_lineRenderer);
        if (_isInitialized)
        {
            QueueEditorRefresh();
        }
    }

    private void QueueEditorRefresh()
    {
        if (_editorRefreshQueued)
        {
            return;
        }

        _editorRefreshQueued = true;
        UnityEditor.EditorApplication.delayCall += ExecuteQueuedEditorRefresh;
    }

    private void ExecuteQueuedEditorRefresh()
    {
        _editorRefreshQueued = false;
        if (this == null)
        {
            return;
        }

        // 延迟回调执行时仍需再次确认资源类型，避免用户在回调前切换了预制体编辑上下文。
        if (UnityEditor.PrefabUtility.IsPartOfPrefabAsset(gameObject)
            && UnityEditor.SceneManagement.PrefabStageUtility.GetPrefabStage(gameObject) == null)
        {
            return;
        }

        EnsureGroupRenderers(EndpointGroupCount);
        EnsureGlowRenderers(EndpointGroupCount);
        ApplyMaterialAndVisualSettings();
        RefreshGeometry();
    }
#endif

    /// <summary>
    /// 设置飞线组数量。数量包含第 0 组；减少数量时不会销毁已创建的渲染器，后续增加可直接复用。
    /// </summary>
    public void SetEndpointGroupCount(int groupCount)
    {
        int additionalCount = Mathf.Max(0, groupCount - 1);
        if (_additionalEndpointGroups == null || _additionalEndpointGroups.Length != additionalCount)
        {
            FlyLineEndpointGroup[] groups = new FlyLineEndpointGroup[additionalCount];
            if (_additionalEndpointGroups != null)
            {
                Array.Copy(_additionalEndpointGroups, groups, Mathf.Min(_additionalEndpointGroups.Length, groups.Length));
            }

            for (int index = 0; index < groups.Length; index++)
            {
                if (groups[index] == null)
                {
                    groups[index] = new FlyLineEndpointGroup();
                }
            }

            _additionalEndpointGroups = groups;
        }

        InitializeRenderer();
        EnsureGroupRenderers(EndpointGroupCount);
        EnsureGlowRenderers(EndpointGroupCount);
        InvalidateEndpointCache();
        ApplyMaterialAndVisualSettings();
        RefreshGeometry();
    }

    /// <summary>
    /// 返回指定组的独立 LineRenderer（线渲染器），便于外部统一切换显示或做调试定位。
    /// </summary>
    public LineRenderer GetLineRenderer(int groupIndex)
    {
        if (groupIndex < 0 || groupIndex >= EndpointGroupCount)
        {
            return null;
        }

        InitializeRenderer();
        EnsureGroupRenderers(EndpointGroupCount);
        return _groupRenderers[groupIndex];
    }

    /// <summary>
    /// 使用显式世界坐标配置指定组。第 0 组继续兼容原有 SetEndpoints 调用方式。
    /// </summary>
    public void SetEndpointGroup(int groupIndex, Vector3 startPosition, Vector3 endPosition, bool refreshImmediately = true)
    {
        if (groupIndex == 0)
        {
            _startPosition = startPosition;
            _endPosition = endPosition;
            _useEndpointTransforms = false;
            _hasExplicitEndpoints = true;
        }
        else
        {
            EnsureEndpointGroupExists(groupIndex);
            _additionalEndpointGroups[groupIndex - 1].SetPositions(startPosition, endPosition);
        }

        InvalidateEndpointCache();
        if (refreshImmediately)
        {
            RefreshGeometry();
        }
    }

    /// <summary>
    /// 绑定指定组的动态端点。第 0 组继续兼容原有 BindEndpoints 调用方式。
    /// </summary>
    public void BindEndpointGroup(int groupIndex, Transform startPoint, Transform endPoint, bool refreshImmediately = true)
    {
        if (groupIndex == 0)
        {
            _startPoint = startPoint;
            _endPoint = endPoint;
            _useEndpointTransforms = true;
            _hasExplicitEndpoints = false;
        }
        else
        {
            EnsureEndpointGroupExists(groupIndex);
            _additionalEndpointGroups[groupIndex - 1].Bind(startPoint, endPoint);
        }

        InvalidateEndpointCache();
        if (refreshImmediately)
        {
            RefreshGeometry();
        }
    }

    /// <summary>
    /// 绑定第 0 组动态端点。后续刷新会直接读取这两个 Transform（变换）的世界坐标。
    /// </summary>
    public void BindEndpoints(Transform startPoint, Transform endPoint)
    {
        BindEndpointGroup(0, startPoint, endPoint);
    }

    /// <summary>
    /// 使用显式世界坐标定义第 0 组端点。适合地图总览、路径预览和静态特效。
    /// </summary>
    public void SetEndpoints(Vector3 startPosition, Vector3 endPosition)
    {
        SetEndpointGroup(0, startPosition, endPosition);
    }

    /// <summary>
    /// 一次性调整所有飞线组共用的弧线方向、弧高和采样数量。
    /// 采样数量过低会让弧线显得折线化，因此会强制保底到 2。
    /// </summary>
    public void ConfigureCurve(Vector3 curveDirection, float curveHeight, int segmentCount)
    {
        _curveDirection = curveDirection;
        _curveHeight = Mathf.Max(0f, curveHeight);
        _segmentCount = Mathf.Clamp(segmentCount, 2, 256);
        InvalidateEndpointCache();
        RefreshGeometry();
    }

    /// <summary>
    /// 切换全部飞线组显隐。关闭时只隐藏渲染器，不清空已经计算好的顶点缓存。
    /// </summary>
    public void SetEffectEnabled(bool enabled)
    {
        InitializeRenderer();
        EnsureGroupRenderers(EndpointGroupCount);
        EnsureGlowRenderers(EndpointGroupCount);
        _isPlaying = enabled;

        if (enabled)
        {
            ApplyMaterialAndVisualSettings();
            RefreshGeometry();
        }

        for (int index = 0; index < _groupRenderers.Length; index++)
        {
            bool active = enabled && index < EndpointGroupCount;
            if (_groupRenderers[index] != null)
            {
                _groupRenderers[index].enabled = active;
            }
            if (_glowRenderers != null && index < _glowRenderers.Length && _glowRenderers[index] != null)
            {
                _glowRenderers[index].enabled = active && _enableGlowLayers;
            }
            if (_coreRenderers != null && index < _coreRenderers.Length && _coreRenderers[index] != null)
            {
                // 当前信号样式只保留基础细线和单个移动亮点，核心叠加线必须关闭以避免再次变成粗带。
                _coreRenderers[index].enabled = false;
            }
        }
    }

    /// <summary>便于按钮直接绑定的播放入口。</summary>
    public void Play()
    {
        SetEffectEnabled(true);
    }

    /// <summary>便于按钮直接绑定的停止入口。</summary>
    public void Stop()
    {
        SetEffectEnabled(false);
    }

    /// <summary>
    /// 立即重建全部飞线组的弧线几何。
    /// 所有组依次复用同一个顶点数组，避免为每条线创建独立临时数组。
    /// </summary>
    public void RefreshGeometry()
    {
        RefreshGeometryInternal(true);
    }

    private void RefreshGeometryInternal(bool forceRefresh)
    {
        InitializeRenderer();
        if (_lineRenderer == null)
        {
            return;
        }

        int groupCount = EndpointGroupCount;
        EnsureGroupRenderers(groupCount);
        EnsureGlowRenderers(groupCount);
        EnsureEndpointStateBuffer(groupCount);

        Vector3 curveAxis = _curveDirection.sqrMagnitude > 0.0001f
            ? _curveDirection.normalized
            : Vector3.up;

        for (int groupIndex = 0; groupIndex < groupCount; groupIndex++)
        {
            LineRenderer renderer = _groupRenderers[groupIndex];
            LineRenderer glowRenderer = _glowRenderers != null && groupIndex < _glowRenderers.Length
                ? _glowRenderers[groupIndex]
                : null;
            LineRenderer coreRenderer = _coreRenderers != null && groupIndex < _coreRenderers.Length
                ? _coreRenderers[groupIndex]
                : null;
            if (!TryResolveEndpoints(groupIndex, out Vector3 start, out Vector3 end))
            {
                if (renderer != null)
                {
                    renderer.positionCount = 0;
                }
                if (glowRenderer != null)
                {
                    glowRenderer.positionCount = 0;
                }
                if (coreRenderer != null)
                {
                    coreRenderer.positionCount = 0;
                }
                _lastEndpointValidity[groupIndex] = false;
                continue;
            }

            bool changed = forceRefresh
                         || !_lastEndpointValidity[groupIndex]
                         || _lastStartPositions[groupIndex] != start
                         || _lastEndPositions[groupIndex] != end;
            if (changed)
            {
                EnsurePositionBuffer(_segmentCount);
                BuildArc(start, end, _positions, _segmentCount, curveAxis);
                if (renderer != null)
                {
                    renderer.positionCount = _segmentCount;
                    renderer.SetPositions(_positions);
                }
                if (glowRenderer != null)
                {
                    glowRenderer.positionCount = _segmentCount;
                    glowRenderer.SetPositions(_positions);
                }
                if (coreRenderer != null)
                {
                    coreRenderer.positionCount = _segmentCount;
                    coreRenderer.SetPositions(_positions);
                }
                _lastStartPositions[groupIndex] = start;
                _lastEndPositions[groupIndex] = end;
                _lastEndpointValidity[groupIndex] = true;
            }
        }

        for (int groupIndex = groupCount; groupIndex < _groupRenderers.Length; groupIndex++)
        {
            if (_groupRenderers[groupIndex] != null)
            {
                _groupRenderers[groupIndex].enabled = false;
            }
            if (_glowRenderers != null && groupIndex < _glowRenderers.Length && _glowRenderers[groupIndex] != null)
            {
                _glowRenderers[groupIndex].enabled = false;
            }
            if (_coreRenderers != null && groupIndex < _coreRenderers.Length && _coreRenderers[groupIndex] != null)
            {
                _coreRenderers[groupIndex].enabled = false;
            }
        }
    }

    private void InitializeRenderer()
    {
        if (_isInitialized)
        {
            return;
        }

        _isInitialized = true;
        _lineRenderer = GetComponent<LineRenderer>();
        if (_lineRenderer == null)
        {
            _lineRenderer = gameObject.AddComponent<LineRenderer>();
        }

        ApplyRendererDefaults(_lineRenderer);
    }

    private void EnsureEndpointGroupExists(int groupIndex)
    {
        if (groupIndex <= 0)
        {
            return;
        }

        if (groupIndex >= EndpointGroupCount)
        {
            SetEndpointGroupCount(groupIndex + 1);
        }
    }

    private void EnsureGroupRenderers(int groupCount)
    {
        if (_groupRenderers == null || _groupRenderers.Length < groupCount)
        {
            Array.Resize(ref _groupRenderers, groupCount);
        }

        _groupRenderers[0] = _lineRenderer;
        for (int groupIndex = 1; groupIndex < groupCount; groupIndex++)
        {
            if (_groupRenderers[groupIndex] == null)
            {
                string rendererName = AdditionalRendererNamePrefix + groupIndex.ToString("00");
                Transform rendererTransform = transform.Find(rendererName);
                GameObject rendererObject;
                if (rendererTransform != null)
                {
                    rendererObject = rendererTransform.gameObject;
                }
                else
                {
#if UNITY_EDITOR
                    // 磁盘上的预制体资源禁止直接新增子物体；缺少配置时交给预制体内容编辑或运行时补建。
                    if (!Application.isPlaying
                        && UnityEditor.PrefabUtility.IsPartOfPrefabAsset(gameObject)
                        && UnityEditor.SceneManagement.PrefabStageUtility.GetPrefabStage(gameObject) == null)
                    {
                        continue;
                    }
#endif
                    rendererObject = new GameObject(rendererName);
                    rendererObject.transform.SetParent(transform, false);
                }

                _groupRenderers[groupIndex] = rendererObject.GetComponent<LineRenderer>();
                if (_groupRenderers[groupIndex] == null)
                {
                    _groupRenderers[groupIndex] = rendererObject.AddComponent<LineRenderer>();
                }
            }

            ApplyRendererDefaults(_groupRenderers[groupIndex]);
        }
    }

    private void ApplyRendererDefaults(LineRenderer renderer)
    {
        if (renderer == null)
        {
            return;
        }

        renderer.useWorldSpace = true;
        renderer.loop = false;
        renderer.alignment = LineAlignment.View;
        renderer.textureMode = LineTextureMode.Stretch;
        renderer.numCapVertices = 4;
        renderer.numCornerVertices = 4;
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        renderer.lightProbeUsage = LightProbeUsage.Off;
        renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
        renderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
        renderer.allowOcclusionWhenDynamic = false;
        renderer.startWidth = _startWidth;
        renderer.endWidth = _endWidth;
        renderer.startColor = _lineColor;
        renderer.endColor = _lineColor;
    }

    private void EnsureGlowRenderers(int groupCount)
    {
        if (_glowRenderers == null || _glowRenderers.Length < groupCount)
        {
            Array.Resize(ref _glowRenderers, groupCount);
        }
        if (_coreRenderers == null || _coreRenderers.Length < groupCount)
        {
            Array.Resize(ref _coreRenderers, groupCount);
        }

        for (int groupIndex = 0; groupIndex < groupCount; groupIndex++)
        {
            if (_glowRenderers[groupIndex] == null)
            {
                _glowRenderers[groupIndex] = CreateOverlayRenderer(GlowRendererNamePrefix + groupIndex.ToString("00"));
            }
            if (_coreRenderers[groupIndex] == null)
            {
                _coreRenderers[groupIndex] = CreateOverlayRenderer(CoreRendererNamePrefix + groupIndex.ToString("00"));
            }

            ApplyRendererDefaults(_glowRenderers[groupIndex]);
            ApplyRendererDefaults(_coreRenderers[groupIndex]);
            if (_glowRenderers[groupIndex] != null)
            {
                _glowRenderers[groupIndex].startWidth = _startWidth * _glowWidthMultiplier;
                _glowRenderers[groupIndex].endWidth = _endWidth * _glowWidthMultiplier;
            }
            if (_coreRenderers[groupIndex] != null)
            {
                _coreRenderers[groupIndex].startWidth = _coreWidth;
                _coreRenderers[groupIndex].endWidth = _coreWidth;
                // 信号样式只使用一条增强线；核心线保留对象以兼容旧预制体，但默认不参与渲染。
                _coreRenderers[groupIndex].enabled = false;
            }
        }
    }

    private LineRenderer CreateOverlayRenderer(string rendererName)
    {
        Transform existingTransform = transform.Find(rendererName);
        GameObject rendererObject;
        if (existingTransform != null)
        {
            rendererObject = existingTransform.gameObject;
        }
        else
        {
#if UNITY_EDITOR
            // 运行时可动态补建子渲染器，但磁盘预制体资源必须避免直接改层级或遗留临时对象。
            if (!Application.isPlaying
                && UnityEditor.PrefabUtility.IsPartOfPrefabAsset(gameObject)
                && UnityEditor.SceneManagement.PrefabStageUtility.GetPrefabStage(gameObject) == null)
            {
                return null;
            }
#endif
            rendererObject = new GameObject(rendererName);
            rendererObject.transform.SetParent(transform, false);
        }

        LineRenderer renderer = rendererObject.GetComponent<LineRenderer>();
        if (renderer == null)
        {
            renderer = rendererObject.AddComponent<LineRenderer>();
        }
        return renderer;
    }

    private void ApplyMaterialAndVisualSettings()
    {
        if (_lineRenderer == null)
        {
            return;
        }

        EnsureGroupRenderers(EndpointGroupCount);
        EnsureGlowRenderers(EndpointGroupCount);
        Material desiredMaterial = _sharedMaterial;
        if (desiredMaterial == null && Application.isPlaying && _autoCreateFallbackMaterial)
        {
            desiredMaterial = EnsureRuntimeMaterial();
        }

        if (_materialPropertyBlock == null)
        {
            _materialPropertyBlock = new MaterialPropertyBlock();
        }

        // 所有渲染器逐个写入同一个属性块，保证多组飞线视觉一致且不复制材质资产。
        _materialPropertyBlock.Clear();
        _materialPropertyBlock.SetColor(FlowColorPropertyId, _lineColor);
        _materialPropertyBlock.SetColor(BaseColorPropertyId, _lineColor);
        _materialPropertyBlock.SetFloat(FlowSpeedPropertyId, _flowSpeed);
        _materialPropertyBlock.SetFloat(FlowIntensityPropertyId, _flowIntensity);
        _materialPropertyBlock.SetFloat(FlowTilingPropertyId, _flowTiling);
        _materialPropertyBlock.SetFloat(FlowWidthPropertyId, _flowWidth);
        _materialPropertyBlock.SetFloat(FlowContrastPropertyId, _flowContrast);
        _materialPropertyBlock.SetFloat(OpacityPropertyId, _opacity);

        for (int groupIndex = 0; groupIndex < EndpointGroupCount; groupIndex++)
        {
            LineRenderer renderer = _groupRenderers[groupIndex];
            if (renderer != null)
            {
                if (desiredMaterial != null)
                {
                    renderer.sharedMaterial = desiredMaterial;
                }

                renderer.SetPropertyBlock(_materialPropertyBlock);
            }

            LineRenderer glowRenderer = _glowRenderers != null && groupIndex < _glowRenderers.Length
                ? _glowRenderers[groupIndex]
                : null;
            LineRenderer coreRenderer = _coreRenderers != null && groupIndex < _coreRenderers.Length
                ? _coreRenderers[groupIndex]
                : null;
            if (glowRenderer != null)
            {
                glowRenderer.sharedMaterial = _glowMaterial != null ? _glowMaterial : desiredMaterial;
            }
            if (coreRenderer != null)
            {
                coreRenderer.sharedMaterial = _glowMaterial != null ? _glowMaterial : desiredMaterial;
            }

            _materialPropertyBlock.Clear();
            _materialPropertyBlock.SetColor(GlowColorPropertyId, _glowColor);
            _materialPropertyBlock.SetFloat(GlowSpeedPropertyId, _glowSpeed);
            _materialPropertyBlock.SetFloat(GlowTilingPropertyId, _glowTiling);
            _materialPropertyBlock.SetFloat(GlowWidthPropertyId, 0.025f);
            _materialPropertyBlock.SetFloat(GlowIntensityPropertyId, _glowIntensity);
            _materialPropertyBlock.SetFloat(GlowOpacityPropertyId, _glowOpacity);
            _materialPropertyBlock.SetFloat(GlowPhasePropertyId, groupIndex * 0.17f);
            _materialPropertyBlock.SetFloat(GlowBasePropertyId, 0.045f);
            if (glowRenderer != null)
            {
                glowRenderer.SetPropertyBlock(_materialPropertyBlock);
            }

            // 核心叠加线不再写入高亮属性，避免旧预制体中的第二层继续显示为粗线。
            if (coreRenderer != null)
            {
                coreRenderer.enabled = false;
            }
        }

        _visualSettingsDirty = false;
    }

    private Material EnsureRuntimeMaterial()
    {
        if (_runtimeMaterial != null)
        {
            return _runtimeMaterial;
        }

        // 优先复用项目里的管线流动 Shader（着色器）；找不到时再退回通用 Unlit（不受光照）Shader。
        Shader shader = Shader.Find("自定义/URP/管线流动");
        if (shader == null)
        {
            shader = Shader.Find("Universal Render Pipeline/Unlit");
        }
        if (shader == null)
        {
            return null;
        }

        _runtimeMaterial = new Material(shader)
        {
            name = $"{shader.name} (Runtime FlyLine)",
            hideFlags = HideFlags.DontSave
        };
        return _runtimeMaterial;
    }

    private bool TryResolveEndpoints(int groupIndex, out Vector3 start, out Vector3 end)
    {
        if (groupIndex == 0)
        {
            // 显式坐标模式用于静态路径；Transform 模式用于第 0 组跟随移动对象。
            if (!_useEndpointTransforms || (!_followEndpointTransforms && _hasExplicitEndpoints))
            {
                start = _startPosition;
                end = _endPosition;
                return true;
            }

            if (_startPoint != null && _endPoint != null)
            {
                start = _startPoint.position;
                end = _endPoint.position;
                return true;
            }

            if (_hasExplicitEndpoints)
            {
                start = _startPosition;
                end = _endPosition;
                return true;
            }

            start = default;
            end = default;
            return false;
        }

        return _additionalEndpointGroups[groupIndex - 1].TryResolve(_followEndpointTransforms, out start, out end);
    }

    private bool HasTransformEndpointGroup()
    {
        if (_useEndpointTransforms)
        {
            return true;
        }

        if (_additionalEndpointGroups == null)
        {
            return false;
        }

        for (int groupIndex = 0; groupIndex < _additionalEndpointGroups.Length; groupIndex++)
        {
            if (_additionalEndpointGroups[groupIndex] != null
                && _additionalEndpointGroups[groupIndex].UseEndpointTransforms)
            {
                return true;
            }
        }

        return false;
    }

    private void EnsureEndpointStateBuffer(int groupCount)
    {
        if (_lastStartPositions != null && _lastStartPositions.Length == groupCount)
        {
            return;
        }

        _lastStartPositions = new Vector3[groupCount];
        _lastEndPositions = new Vector3[groupCount];
        _lastEndpointValidity = new bool[groupCount];
    }

    private void EnsurePositionBuffer(int segmentCount)
    {
        if (_positions != null && _positions.Length == segmentCount)
        {
            return;
        }

        _positions = new Vector3[segmentCount];
    }

    private void InvalidateEndpointCache()
    {
        if (_lastEndpointValidity == null)
        {
            return;
        }

        Array.Clear(_lastEndpointValidity, 0, _lastEndpointValidity.Length);
    }

    private void BuildArc(Vector3 start, Vector3 end, Vector3[] buffer, int segmentCount, Vector3 curveAxis)
    {
        Vector3 controlPoint = Vector3.Lerp(start, end, 0.5f) + curveAxis * _curveHeight;
        int lastIndex = segmentCount - 1;
        for (int index = 0; index < segmentCount; index++)
        {
            float t = lastIndex <= 0 ? 0f : (float)index / lastIndex;
            buffer[index] = EvaluateQuadraticBezier(start, controlPoint, end, t);
        }
    }

    /// <summary>
    /// 二次贝塞尔（Quadratic Bezier）采样。
    /// 控制点只负责抬高弧线中段，不参与端点偏移，因此起点和终点会保持精确对齐。
    /// </summary>
    private static Vector3 EvaluateQuadraticBezier(Vector3 start, Vector3 control, Vector3 end, float t)
    {
        float oneMinusT = 1f - t;
        return oneMinusT * oneMinusT * start
             + 2f * oneMinusT * t * control
             + t * t * end;
    }
}

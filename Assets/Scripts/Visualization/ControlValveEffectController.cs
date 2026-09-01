using UnityEngine;

/// <summary>
/// 控制阀剖视动画与气体填充特效控制器。
/// 外壳透明度、阀芯升降、气体体积和进气粒子由同一组件协调；运行时只更新变换、
/// 材质属性块和粒子模块，不创建临时材质或逐帧查找对象，适合网页端构建持续运行。
/// </summary>
[DisallowMultipleComponent]
public sealed class ControlValveEffectController : MonoBehaviour
{
    private static readonly int BaseColorPropertyId = Shader.PropertyToID("_BaseColor");
    private static readonly int GasColorPropertyId = Shader.PropertyToID("_GasColor");
    private static readonly int GasOpacityPropertyId = Shader.PropertyToID("_Opacity");
    private static readonly int GasFlowSpeedPropertyId = Shader.PropertyToID("_FlowSpeed");
    private static readonly int GasFillAmountPropertyId = Shader.PropertyToID("_FillAmount");
    private static readonly int GasFillLengthPropertyId = Shader.PropertyToID("_FillLength");
    private static readonly int GasFillBottomPropertyId = Shader.PropertyToID("_FillBottom");

    private enum PlaybackState
    {
        Idle,
        Opening,
        HoldOpen,
        Closing,
        HoldClosed
    }

    [Header("对象绑定")]
    [Tooltip("沿本地 Y 轴升降的阀芯。")]
    [SerializeField] private Transform _valveCore;
    [Tooltip("使用独立半透明材质的控制阀外壳。")]
    [SerializeField] private Renderer _shellRenderer;
    [Tooltip("气体体积网格与外壳使用相同的中心位置和旋转；填充动画由材质按本地 Z 轴裁切，不改变贴壁截面形状。")]
    [SerializeField] private Transform _gasVolume;
    [Tooltip("气体体积渲染器，使用专用流动气体材质。")]
    [SerializeField] private Renderer _gasVolumeRenderer;
    [Tooltip("从阀体下方进入腔体的气体粒子。")]
    [SerializeField] private ParticleSystem _inletParticles;

    [Header("可视状态")]
    [Tooltip("当前阀门开度：0 为关闭，1 为完全开启。运行时可通过 SetOpenAmount 精确设置。")]
    [SerializeField, Range(0f, 1f)] private float _openAmount = 0.55f;
    [Tooltip("当前腔体气体填充度：0 为空，1 为充满。运行时可通过 SetGasFillAmount 精确设置。")]
    [SerializeField, Range(0f, 1f)] private float _gasFillAmount = 0.65f;
    [Tooltip("外壳透明度。较低数值更容易观察阀芯和气体，但不建议低于 0.1。")]
    [SerializeField, Range(0.05f, 0.95f)] private float _shellOpacity = 0.28f;
    [Tooltip("气体颜色和高动态范围亮度。")]
    [SerializeField, ColorUsage(true, true)] private Color _gasColor = new Color(0.05f, 0.65f, 1.6f, 1f);
    [Tooltip("气体体积基础透明度。")]
    [SerializeField, Range(0f, 1f)] private float _gasOpacity = 0.34f;

    [Header("阀芯动画")]
    [Tooltip("阀门完全关闭时的阀芯本地坐标，由配置过程从当前模型记录。")]
    [SerializeField] private Vector3 _closedCoreLocalPosition;
    [Tooltip("阀芯完全开启时沿本地 Y 轴抬升的距离。")]
    [SerializeField, Min(0f)] private float _valveLiftDistance = 0.38f;
    [Tooltip("阀芯从关闭移动到开启所需时间。")]
    [SerializeField, Min(0.05f)] private float _valveMoveDuration = 0.9f;
    [Tooltip("阀芯和气体的平滑运动曲线。")]
    [SerializeField] private AnimationCurve _motionCurve = AnimationCurve.EaseInOut(0f, 0f, 1f, 1f);

    [Header("气体动画")]
    [Tooltip("气体体积对象的本地位置，使用外壳中心位置；液面底部由 _gasLocalBottom 控制。")]
    [SerializeField] private Vector3 _gasBottomLocalPosition;
    [Tooltip("气体网格完整状态的本地缩放；填充动画由材质裁切控制，避免改变贴壁截面形状。")]
    [SerializeField] private Vector3 _gasFullLocalScale = Vector3.one;
    [Tooltip("气体网格沿控制阀本地 Z 轴的长度，只覆盖中段腔室，不包含上下法兰。")]
    [SerializeField, Min(0.1f)] private float _gasLocalLength = 0.76f;
    [Tooltip("气体网格底部的本地 Z 坐标，液面从这里开始向上增长。")]
    [SerializeField] private float _gasLocalBottom = -0.38f;
    [Tooltip("阀芯开始上移后，气体开始进入腔体的延迟。")]
    [SerializeField, Min(0f)] private float _gasStartDelay = 0.18f;
    [Tooltip("气体从空腔增长到充满所需时间。")]
    [SerializeField, Min(0.05f)] private float _gasFillDuration = 1.45f;
    [Tooltip("气体内部亮纹的流动速度。")]
    [SerializeField] private float _gasFlowSpeed = 1.2f;
    [Tooltip("完全开启时每秒产生的进气粒子数量。")]
    [SerializeField, Min(0f)] private float _inletEmissionRate = 34f;

    [Header("自动演示")]
    [Tooltip("启用组件时是否自动开始演示。关闭后仍可通过公共方法控制。")]
    [SerializeField] private bool _playOnEnable = true;
    [Tooltip("自动演示是否在开启和关闭之间循环。公共控制方法会自动退出循环。")]
    [SerializeField] private bool _loopDemo = true;
    [Tooltip("腔体充满后保持开启状态的时间。")]
    [SerializeField, Min(0f)] private float _holdOpenDuration = 1.4f;
    [Tooltip("气体排空且阀芯关闭后保持的时间。")]
    [SerializeField, Min(0f)] private float _holdClosedDuration = 0.8f;

    private PlaybackState _playbackState;
    private float _stateElapsed;
    private float _stateDuration;
    private float _stateStartOpenAmount;
    private float _stateStartFillAmount;
    private bool _continueLoop;
    private bool _effectPlaying;
    private MaterialPropertyBlock _propertyBlock;

    /// <summary>当前阀门开度，只读查询不会创建临时对象。</summary>
    public float OpenAmount => _openAmount;

    /// <summary>当前腔体气体填充度。</summary>
    public float GasFillAmount => _gasFillAmount;

    /// <summary>
    /// 编辑器配置入口。所有对象引用和模型空间参数一次写入场景，运行时不依赖名称查找。
    /// </summary>
    public void Configure(
        Transform valveCore,
        Renderer shellRenderer,
        Transform gasVolume,
        Renderer gasVolumeRenderer,
        ParticleSystem inletParticles,
        Vector3 closedCoreLocalPosition,
        Vector3 gasBottomLocalPosition,
        Vector3 gasFullLocalScale)
    {
        _valveCore = valveCore;
        _shellRenderer = shellRenderer;
        _gasVolume = gasVolume;
        _gasVolumeRenderer = gasVolumeRenderer;
        _inletParticles = inletParticles;
        _closedCoreLocalPosition = closedCoreLocalPosition;
        _gasBottomLocalPosition = gasBottomLocalPosition;
        _gasFullLocalScale = gasFullLocalScale;
        ApplyVisualState(false);
    }

    /// <summary>播放“阀芯先上移、气体随后充满腔体”的开启动画。</summary>
    public void PlayOpen()
    {
        _continueLoop = false;
        _effectPlaying = true;
        BeginOpening();
    }

    /// <summary>播放“气体先排空、阀芯随后下降”的关闭动画。</summary>
    public void PlayClose()
    {
        _continueLoop = false;
        _effectPlaying = true;
        BeginClosing();
    }

    /// <summary>从当前状态开始循环演示开启、充满、排空和关闭过程。</summary>
    public void PlayDemo()
    {
        _continueLoop = true;
        _effectPlaying = true;

        if (_openAmount >= 0.99f && _gasFillAmount >= 0.99f)
            BeginClosing();
        else
            BeginOpening();
    }

    /// <summary>暂停动画和流动特效，保留当前阀芯位置与气体填充状态。</summary>
    public void Pause()
    {
        _continueLoop = false;
        _playbackState = PlaybackState.Idle;
        _effectPlaying = false;
        ApplyVisualState(true);
    }

    /// <summary>立即设置阀门开度，不改变当前气体填充度。</summary>
    public void SetOpenAmount(float normalizedAmount)
    {
        StopAutomaticPlayback();
        _effectPlaying = true;
        _openAmount = Mathf.Clamp01(normalizedAmount);
        ApplyVisualState(true);
    }

    /// <summary>立即设置气体填充度，不改变当前阀门开度。</summary>
    public void SetGasFillAmount(float normalizedAmount)
    {
        StopAutomaticPlayback();
        _effectPlaying = true;
        _gasFillAmount = Mathf.Clamp01(normalizedAmount);
        ApplyVisualState(true);
    }

    /// <summary>同时设置阀门开度和气体填充度，适合滑杆或流程进度直接驱动。</summary>
    public void SetNormalizedState(float normalizedAmount)
    {
        StopAutomaticPlayback();
        _effectPlaying = true;
        _openAmount = Mathf.Clamp01(normalizedAmount);
        _gasFillAmount = _openAmount;
        ApplyVisualState(true);
    }

    /// <summary>立即更新外壳透明度，不修改共享材质资产。</summary>
    public void SetShellOpacity(float opacity)
    {
        _shellOpacity = Mathf.Clamp(opacity, 0.05f, 0.95f);
        ApplyShellOpacity();
    }

    private void OnEnable()
    {
        ApplyVisualState(false);
        ApplyShellOpacity();

        if (_playOnEnable)
        {
            if (_loopDemo)
                PlayDemo();
            else
                PlayOpen();
        }
    }

    private void OnDisable()
    {
        if (_inletParticles != null)
            _inletParticles.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
    }

    private void OnValidate()
    {
        _openAmount = Mathf.Clamp01(_openAmount);
        _gasFillAmount = Mathf.Clamp01(_gasFillAmount);
        _shellOpacity = Mathf.Clamp(_shellOpacity, 0.05f, 0.95f);
        _gasOpacity = Mathf.Clamp01(_gasOpacity);

        // 编辑状态只刷新静态预览，不启动粒子系统，避免保存场景时写入粒子模拟状态。
        if (!Application.isPlaying)
        {
            ApplyVisualState(false);
            ApplyShellOpacity();
        }
    }

    private void Update()
    {
        if (_playbackState == PlaybackState.Idle)
            return;

        _stateElapsed += Time.deltaTime;
        switch (_playbackState)
        {
            case PlaybackState.Opening:
                UpdateOpening();
                break;
            case PlaybackState.Closing:
                UpdateClosing();
                break;
            case PlaybackState.HoldOpen:
                if (_stateElapsed >= _stateDuration)
                    BeginClosing();
                break;
            case PlaybackState.HoldClosed:
                if (_stateElapsed >= _stateDuration)
                    BeginOpening();
                break;
        }
    }

    private void BeginOpening()
    {
        _playbackState = PlaybackState.Opening;
        _stateElapsed = 0f;
        _stateStartOpenAmount = _openAmount;
        _stateStartFillAmount = _gasFillAmount;
        _stateDuration = Mathf.Max(_valveMoveDuration, _gasStartDelay + _gasFillDuration);
        ApplyVisualState(true);
    }

    private void BeginClosing()
    {
        _playbackState = PlaybackState.Closing;
        _stateElapsed = 0f;
        _stateStartOpenAmount = _openAmount;
        _stateStartFillAmount = _gasFillAmount;
        _stateDuration = Mathf.Max(_gasFillDuration, _gasStartDelay + _valveMoveDuration);
        ApplyVisualState(true);
    }

    /// <summary>
    /// 开启阶段先驱动阀芯，延迟后再增长气体体积，避免气体在阀芯尚未让出通道时提前进入。
    /// </summary>
    private void UpdateOpening()
    {
        var openProgress = EvaluateMotion(_stateElapsed / Mathf.Max(0.05f, _valveMoveDuration));
        var fillProgress = EvaluateMotion(
            (_stateElapsed - _gasStartDelay) / Mathf.Max(0.05f, _gasFillDuration));
        _openAmount = Mathf.LerpUnclamped(_stateStartOpenAmount, 1f, openProgress);
        _gasFillAmount = Mathf.LerpUnclamped(_stateStartFillAmount, 1f, fillProgress);
        ApplyVisualState(true);

        if (_stateElapsed < _stateDuration)
            return;

        _openAmount = 1f;
        _gasFillAmount = 1f;
        ApplyVisualState(true);
        if (_continueLoop)
            BeginHold(PlaybackState.HoldOpen, _holdOpenDuration);
        else
            _playbackState = PlaybackState.Idle;
    }

    /// <summary>
    /// 关闭阶段先排空腔体，再延迟下降阀芯；该顺序让动画语义与开启阶段保持物理一致。
    /// </summary>
    private void UpdateClosing()
    {
        var fillProgress = EvaluateMotion(_stateElapsed / Mathf.Max(0.05f, _gasFillDuration));
        var openProgress = EvaluateMotion(
            (_stateElapsed - _gasStartDelay) / Mathf.Max(0.05f, _valveMoveDuration));
        _gasFillAmount = Mathf.LerpUnclamped(_stateStartFillAmount, 0f, fillProgress);
        _openAmount = Mathf.LerpUnclamped(_stateStartOpenAmount, 0f, openProgress);
        ApplyVisualState(true);

        if (_stateElapsed < _stateDuration)
            return;

        _openAmount = 0f;
        _gasFillAmount = 0f;
        ApplyVisualState(true);
        if (_continueLoop)
            BeginHold(PlaybackState.HoldClosed, _holdClosedDuration);
        else
            _playbackState = PlaybackState.Idle;
    }

    private void BeginHold(PlaybackState holdState, float duration)
    {
        _playbackState = holdState;
        _stateElapsed = 0f;
        _stateDuration = Mathf.Max(0f, duration);
    }

    private float EvaluateMotion(float normalizedTime)
    {
        var clampedTime = Mathf.Clamp01(normalizedTime);
        return _motionCurve == null ? clampedTime : _motionCurve.Evaluate(clampedTime);
    }

    private void StopAutomaticPlayback()
    {
        _continueLoop = false;
        _playbackState = PlaybackState.Idle;
    }

    /// <summary>
    /// 阀芯位置在模型本地空间更新；气体网格使用与外壳一致的局部位置、旋转和真实分段截面，
    /// 填充度交给气体着色器沿本地 Z 轴裁切，因此填充过程中不会把圆形腔体压成方形或变窄。
    /// </summary>
    private void ApplyVisualState(bool updateParticles)
    {
        if (_valveCore != null)
            _valveCore.localPosition = _closedCoreLocalPosition + Vector3.up * (_valveLiftDistance * _openAmount);

        if (_gasVolume != null)
        {
            _gasVolume.localPosition = _gasBottomLocalPosition;
            _gasVolume.localScale = _gasFullLocalScale;
        }

        ApplyGasMaterialProperties();
        if (updateParticles)
            ApplyParticleState();
    }

    /// <summary>
    /// 材质属性块只覆盖当前气体渲染器，不实例化材质；动画期间复用同一个属性块，避免垃圾回收。
    /// </summary>
    private void ApplyGasMaterialProperties()
    {
        if (_gasVolumeRenderer == null)
            return;

        var visible = _gasFillAmount > 0.002f;
        _gasVolumeRenderer.enabled = visible;
        if (!visible)
            return;

        _propertyBlock ??= new MaterialPropertyBlock();
        _propertyBlock.Clear();
        _gasVolumeRenderer.GetPropertyBlock(_propertyBlock);
        _propertyBlock.SetColor(GasColorPropertyId, _gasColor);
        _propertyBlock.SetFloat(GasOpacityPropertyId, _gasOpacity);
        _propertyBlock.SetFloat(GasFlowSpeedPropertyId, _effectPlaying ? _gasFlowSpeed : 0f);
        _propertyBlock.SetFloat(GasFillAmountPropertyId, _gasFillAmount);
        _propertyBlock.SetFloat(GasFillLengthPropertyId, Mathf.Max(0.1f, _gasLocalLength));
        _propertyBlock.SetFloat(GasFillBottomPropertyId, _gasLocalBottom);
        _gasVolumeRenderer.SetPropertyBlock(_propertyBlock);
    }

    /// <summary>
    /// 外壳的两个材质槽逐槽写入相同透明度，保留原模型贴图、金属度和光滑度。
    /// 该方法只在透明度变化时调用，不进入逐帧动画路径。
    /// </summary>
    private void ApplyShellOpacity()
    {
        if (_shellRenderer == null)
            return;

        _propertyBlock ??= new MaterialPropertyBlock();
        var materials = _shellRenderer.sharedMaterials;
        for (var i = 0; i < materials.Length; i++)
        {
            var material = materials[i];
            if (material == null || !material.HasProperty(BaseColorPropertyId))
                continue;

            _propertyBlock.Clear();
            _shellRenderer.GetPropertyBlock(_propertyBlock, i);
            var color = material.GetColor(BaseColorPropertyId);
            color.a = _shellOpacity;
            _propertyBlock.SetColor(BaseColorPropertyId, color);
            _shellRenderer.SetPropertyBlock(_propertyBlock, i);
        }
    }

    /// <summary>
    /// 粒子发射率随开度降低，并在排空阶段停止新增粒子；模块结构体直接写回粒子系统，不产生托管分配。
    /// </summary>
    private void ApplyParticleState()
    {
        if (_inletParticles == null)
            return;

        var isDraining = _playbackState == PlaybackState.Closing || _playbackState == PlaybackState.HoldClosed;
        var emissionRate = _effectPlaying && !isDraining
            ? _inletEmissionRate * _openAmount * Mathf.Lerp(1f, 0.65f, _gasFillAmount)
            : 0f;
        var emission = _inletParticles.emission;
        emission.rateOverTime = emissionRate;

        var shouldSimulate = _effectPlaying && (emissionRate > 0.01f || _gasFillAmount > 0.01f);
        if (shouldSimulate)
        {
            if (!_inletParticles.isPlaying)
                _inletParticles.Play(true);
        }
        else if (_inletParticles.isPlaying)
        {
            _inletParticles.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
        }
    }
}

using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// 建筑扩散光圈与半球能量罩的集中管理器。
/// 管理器挂在运行时根节点，通过目标对象组批量创建并复用特效实例；播放循环中只更新变换和材质属性块，
/// 不重复扫描模型、不实例化材质，也不会为每轮动画产生托管内存分配。
/// </summary>
[DisallowMultipleComponent]
public sealed class BuildingSphericalPulseEffect : MonoBehaviour
{
    private const string PulseObjectNamePrefix = "__SphericalPulse_";
    private const string ShieldObjectNamePrefix = "__EnergyDome_";
    private static readonly int PulseColorPropertyId = Shader.PropertyToID("_PulseColor");
    private static readonly int ShieldColorPropertyId = Shader.PropertyToID("_ShieldColor");
    private static readonly int OpacityPropertyId = Shader.PropertyToID("_Opacity");
    private static readonly int RimPowerPropertyId = Shader.PropertyToID("_RimPower");
    private static readonly int RimIntensityPropertyId = Shader.PropertyToID("_RimIntensity");
    private static readonly int RingWidthPropertyId = Shader.PropertyToID("_RingWidth");
    private static readonly int UpperHemisphereColorPropertyId = Shader.PropertyToID("_UpperHemisphereColor");

    private sealed class TargetVisual
    {
        public MeshRenderer PulseRenderer;
        public MeshRenderer ShieldRenderer;
        public MeshRenderer UpperHemisphereRenderer;
        public Vector3 PulseCenter;
        public float PulseDiameter;
        public Vector3 ShieldCenter;
        public float ShieldDiameter;
        public Vector3 UpperHemisphereCenter;
        public float UpperHemisphereDiameter;
    }

    [Header("目标对象组")]
    [Tooltip("需要显示扩散光圈和半球能量罩的建筑对象。所有目标由本管理器统一创建、播放和回收特效。")]
    [SerializeField] private GameObject[] _targets = Array.Empty<GameObject>();
    [Tooltip("进入播放模式时自动开始播放全部目标的特效。")]
    [SerializeField] private bool _playOnStart = true;
    [Tooltip("运行时总开关。关闭后立即隐藏所有目标的光圈和能量罩，可通过 SetEffectEnabled 或 SetActive 调用重新开启。")]
    [SerializeField] private bool _effectEnabled = true;
    [Tooltip("开启后每轮光圈结束会从起点继续播放；能量罩在整个循环会话中持续显示。")]
    [SerializeField] private bool _loop = true;

    [Header("扩散光圈")]
    [Tooltip("扩散光圈使用的共享材质；每个目标的颜色和透明度通过材质属性块覆盖，不会改写材质资产。")]
    [SerializeField] private Material _pulseMaterial;
    [SerializeField, ColorUsage(true, true)] private Color _pulseColor = new Color(0f, 1.2f, 2.4f, 1f);
    [SerializeField, Range(0f, 1f)] private float _pulsePeakOpacity = 0.52f;
    [SerializeField, Range(0.5f, 8f)] private float _pulseRimPower = 2.4f;
    [SerializeField, Range(0f, 6f)] private float _pulseRimIntensity = 2.2f;
    [Tooltip("光圈开始时相对目标包围球直径的比例。")]
    [SerializeField, Min(0.01f)] private float _pulseStartScale = 0.18f;
    [Tooltip("光圈结束时相对目标包围球直径的比例。")]
    [SerializeField, Min(0.01f)] private float _pulseEndScale = 2.4f;
    [Tooltip("贴地雷达波在 X/Z 平面的宽度倍率；1 表示初始波环与能量罩底径一致。")]
    [SerializeField, Min(0.05f)] private float _pulseHorizontalScale = 1f;
    [Tooltip("贴地雷达波在 Y 轴的高度倍率；数值越小，波环越贴地。")]
    [SerializeField, Range(0.05f, 1f)] private float _pulseVerticalScale = 0.12f;
    [Tooltip("雷达波环带宽度；数值越小，扩散边缘越细。")]
    [SerializeField, Range(0.01f, 0.25f)] private float _pulseRingWidth = 0.08f;

    [Header("上半球光圈")]
    [Tooltip("原始完整球形光圈的上半部分材质。")]
    [SerializeField] private Material _upperHemisphereMaterial;
    [SerializeField, ColorUsage(true, true)] private Color _upperHemisphereColor = new Color(0f, 0.85f, 2.2f, 1f);
    [SerializeField, Range(0f, 1f)] private float _upperHemisphereOpacity = 0.12f;
    [SerializeField, Range(0.5f, 8f)] private float _upperHemisphereRimPower = 2.6f;
    [SerializeField, Range(0f, 6f)] private float _upperHemisphereRimIntensity = 1.6f;
    [Tooltip("上半球相对目标包围球的放大倍率；1 表示使用目标原始包围球尺寸。")]
    [SerializeField, Min(0.05f)] private float _upperHemisphereScalePadding = 1f;
    [Tooltip("上半球扩散结束时相对初始尺寸的倍率。")]
    [SerializeField, Min(1f)] private float _upperHemisphereEndScale = 1.35f;

    [Header("半球能量罩")]
    [Tooltip("半球能量罩使用的共享材质；着色器会裁掉球体下半部分，只保留覆盖建筑的穹顶。")]
    [SerializeField] private Material _shieldMaterial;
    [SerializeField, ColorUsage(true, true)] private Color _shieldColor = new Color(0f, 0.9f, 2.6f, 1f);
    [SerializeField, Range(0f, 1f)] private float _shieldOpacity = 0.34f;
    [SerializeField, Range(0.5f, 8f)] private float _shieldRimPower = 2.1f;
    [SerializeField, Range(0f, 6f)] private float _shieldRimIntensity = 1.8f;
    [Tooltip("相对目标水平包围半径的护罩放大倍率，确保穹顶完整覆盖建筑。")]
    [SerializeField, Min(1f)] private float _shieldScalePadding = 1.2f;

    [Header("播放")]
    [Tooltip("单次扩散时长，使用非缩放时间，暂停业务时间缩放时仍可完整播放。")]
    [SerializeField, Min(0.05f)] private float _duration = 1.8f;

    private readonly List<TargetVisual> _visuals = new List<TargetVisual>();
    private MaterialPropertyBlock _propertyBlock;
    private float _elapsed;
    private bool _isPlaying;
    private bool _isInitialized;

    /// <summary>当前是否正在播放；循环模式会一直保持 true，直到外部调用 Stop。</summary>
    public bool IsPlaying => _isPlaying;

    /// <summary>当前管理器总开关状态；关闭时所有目标的特效对象都会隐藏。</summary>
    public bool IsEffectEnabled => _effectEnabled;

#if UNITY_EDITOR
    /// <summary>
    /// 播放模式下修改检视面板总开关时立即同步显示状态；编辑模式只保存配置，不创建运行时对象。
    /// </summary>
    private void OnValidate()
    {
        if (Application.isPlaying && _isInitialized)
        {
            SetEffectEnabled(_effectEnabled);
        }
    }
#endif

    private void Start()
    {
        if (_playOnStart && _effectEnabled)
        {
            Play();
        }
        else
        {
            SetVisualsEnabled(false);
        }
    }

    private void OnDisable()
    {
        // 禁用管理器或场景卸载时统一隐藏所有运行时特效，避免停用后仍保留透明绘制。
        Stop();
    }

    private void Update()
    {
        if (!_isPlaying)
        {
            return;
        }

        _elapsed += Time.unscaledDeltaTime;
        float normalizedTime = Mathf.Clamp01(_elapsed / _duration);
        ApplyFrame(normalizedTime);
        if (normalizedTime < 1f)
        {
            return;
        }

        if (_loop)
        {
            // 循环阶段仅重置计时并重用已缓存的目标包围盒和渲染器，不触发对象查询或资源创建。
            _elapsed = 0f;
            ApplyFrame(0f);
        }
        else
        {
            Stop();
        }
    }

    /// <summary>
    /// 动态切换管理器总开关。关闭时停止播放并隐藏光圈、能量罩；开启时从当前目标包围盒重新开始播放。
    /// </summary>
    public void SetEffectEnabled(bool enabled)
    {
        _effectEnabled = enabled;
        if (enabled)
        {
            Play();
        }
        else
        {
            Stop();
        }
    }

    /// <summary>无参数开关入口，适合直接绑定 UnityEvent（Unity 事件）按钮。</summary>
    public void SetActive(bool enabled)
    {
        SetEffectEnabled(enabled);
    }

    /// <summary>无参数切换入口，适合直接绑定按钮的 onClick 事件。</summary>
    public void ToggleEffect()
    {
        SetEffectEnabled(!_effectEnabled);
    }

    /// <summary>
    /// 重新读取对象组当前包围盒并开始播放。适用于建筑移动、缩放或对象组变更后的重新激活。
    /// </summary>
    public void Play()
    {
        if (!_effectEnabled || !TryInitializeVisuals())
        {
            return;
        }

        _elapsed = 0f;
        _isPlaying = true;
        SetVisualsEnabled(true);
        ApplyFrame(0f);
    }

    /// <summary>停止全部目标的光圈和能量罩，并保留已创建的对象以供下一次播放复用。</summary>
    public void Stop()
    {
        _isPlaying = false;
        SetVisualsEnabled(false);
    }

    private bool TryInitializeVisuals()
    {
        if (_isInitialized)
        {
            return _visuals.Count > 0;
        }

        _isInitialized = true;
        if (_pulseMaterial == null || _shieldMaterial == null)
        {
            Debug.LogWarning($"[{nameof(BuildingSphericalPulseEffect)}] 缺少扩散光圈或能量罩材质，无法播放特效。", this);
            return false;
        }

        _propertyBlock = new MaterialPropertyBlock();
        if (_targets == null || _targets.Length == 0)
        {
            Debug.LogWarning($"[{nameof(BuildingSphericalPulseEffect)}] 目标对象组为空，无法播放特效。", this);
            return false;
        }

        for (int targetIndex = 0; targetIndex < _targets.Length; targetIndex++)
        {
            GameObject target = _targets[targetIndex];
            if (target == null || !TryCalculateTargetBounds(target, out Bounds bounds))
            {
                continue;
            }

            _visuals.Add(CreateTargetVisual(target, targetIndex, bounds));
        }

        if (_visuals.Count == 0)
        {
            Debug.LogWarning($"[{nameof(BuildingSphericalPulseEffect)}] 目标对象组内没有可用于计算包围盒的模型渲染器。", this);
        }

        return _visuals.Count > 0;
    }

    private TargetVisual CreateTargetVisual(GameObject target, int targetIndex, Bounds bounds)
    {
        // 光圈与能量罩共用同一基础直径，初始倍率为 1 时，雷达波正好贴近护罩底部。
        // 半球底面位于模型最低点；要完整覆盖矩形建筑，护罩半径按三维包围盒计算。
        float shieldRadius = Mathf.Sqrt(
            bounds.extents.x * bounds.extents.x
            + bounds.extents.z * bounds.extents.z
            + bounds.size.y * bounds.size.y) * _shieldScalePadding;
        float shieldDiameter = Mathf.Max(shieldRadius * 2f, 0.01f);
        float upperHemisphereDiameter = Mathf.Max(bounds.extents.magnitude * 2f * _upperHemisphereScalePadding, 0.01f);
        TargetVisual visual = new TargetVisual
        {
            PulseRenderer = CreateEffectRenderer(PulseObjectNamePrefix + targetIndex, target.layer, _pulseMaterial),
            ShieldRenderer = CreateEffectRenderer(ShieldObjectNamePrefix + targetIndex, target.layer, _shieldMaterial),
            UpperHemisphereRenderer = _upperHemisphereMaterial != null
                ? CreateEffectRenderer(ShieldObjectNamePrefix + "Upper_" + targetIndex, target.layer, _upperHemisphereMaterial)
                : null,
            // 三种效果共享同一个建筑最低点：雷达波沿地面，另外两层向上形成半球视觉。
            PulseCenter = new Vector3(bounds.center.x, bounds.min.y, bounds.center.z),
            PulseDiameter = shieldDiameter,
            ShieldCenter = new Vector3(bounds.center.x, bounds.min.y, bounds.center.z),
            ShieldDiameter = shieldDiameter,
            UpperHemisphereCenter = new Vector3(bounds.center.x, bounds.min.y, bounds.center.z),
            UpperHemisphereDiameter = upperHemisphereDiameter
        };
        return visual;
    }

    /// <summary>
    /// 创建单个无碰撞体特效球。对象作为管理器子节点而非建筑子节点，避免把自身纳入建筑渲染包围盒。
    /// </summary>
    private MeshRenderer CreateEffectRenderer(string objectName, int layer, Material material)
    {
        GameObject effectObject = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        effectObject.name = objectName;
        effectObject.layer = layer;
        effectObject.transform.SetParent(transform, false);
        effectObject.hideFlags = HideFlags.DontSave;

        Collider effectCollider = effectObject.GetComponent<Collider>();
        if (effectCollider != null)
        {
            Destroy(effectCollider);
        }

        MeshRenderer renderer = effectObject.GetComponent<MeshRenderer>();
        renderer.sharedMaterial = material;
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        renderer.lightProbeUsage = LightProbeUsage.Off;
        renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
        renderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
        renderer.allowOcclusionWhenDynamic = false;
        renderer.enabled = false;
        return renderer;
    }

    /// <summary>
    /// 只在首次播放前收集每个目标的模型渲染器。循环播放不会再扫描层级，避免目标数量增加时产生帧峰值。
    /// </summary>
    private static bool TryCalculateTargetBounds(GameObject target, out Bounds bounds)
    {
        Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
        bool hasBounds = false;
        bounds = new Bounds(target.transform.position, Vector3.zero);
        for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
        {
            Renderer targetRenderer = renderers[rendererIndex];
            if (targetRenderer == null || targetRenderer is ParticleSystemRenderer || targetRenderer is TrailRenderer || targetRenderer is LineRenderer)
            {
                continue;
            }

            if (!hasBounds)
            {
                bounds = targetRenderer.bounds;
                hasBounds = true;
            }
            else
            {
                bounds.Encapsulate(targetRenderer.bounds);
            }
        }

        return hasBounds;
    }

    private void ApplyFrame(float normalizedTime)
    {
        // 光圈快速显现后平滑扩散淡出；护罩使用相同的显现阶段，并在循环会话内保持较低基础亮度。
        float easedTime = normalizedTime * normalizedTime * (3f - 2f * normalizedTime);
        float pulseFadeIn = Mathf.Clamp01(normalizedTime * 8f);
        float pulseOpacity = _pulsePeakOpacity * pulseFadeIn * (1f - easedTime);
        float shieldOpacity = _shieldOpacity * Mathf.Max(pulseFadeIn, 0.62f);
        float upperHemisphereOpacity = _upperHemisphereOpacity * Mathf.Max(pulseFadeIn, 0.62f);

        for (int visualIndex = 0; visualIndex < _visuals.Count; visualIndex++)
        {
            TargetVisual visual = _visuals[visualIndex];
            ApplyPulse(visual, easedTime, pulseOpacity);
            ApplyShield(visual, shieldOpacity);
            if (visual.UpperHemisphereRenderer != null)
            {
                ApplyUpperHemisphere(visual, upperHemisphereOpacity);
            }
        }
    }

    private void ApplyPulse(TargetVisual visual, float easedTime, float opacity)
    {
        float diameter = Mathf.LerpUnclamped(_pulseStartScale, _pulseEndScale, easedTime) * visual.PulseDiameter;
        Transform pulseTransform = visual.PulseRenderer.transform;
        pulseTransform.SetPositionAndRotation(visual.PulseCenter, Quaternion.identity);
        // 球体基础网格直径为 1；分别缩放水平和垂直方向，形成贴地扁半椭圆雷达波。
        pulseTransform.localScale = new Vector3(
            diameter * _pulseHorizontalScale,
            diameter * _pulseVerticalScale,
            diameter * _pulseHorizontalScale);

        _propertyBlock.SetColor(PulseColorPropertyId, _pulseColor);
        _propertyBlock.SetFloat(OpacityPropertyId, opacity);
        _propertyBlock.SetFloat(RimPowerPropertyId, _pulseRimPower);
        _propertyBlock.SetFloat(RimIntensityPropertyId, _pulseRimIntensity);
        _propertyBlock.SetFloat(RingWidthPropertyId, _pulseRingWidth);
        visual.PulseRenderer.SetPropertyBlock(_propertyBlock);
    }

    private void ApplyShield(TargetVisual visual, float opacity)
    {
        Transform shieldTransform = visual.ShieldRenderer.transform;
        shieldTransform.SetPositionAndRotation(visual.ShieldCenter, Quaternion.identity);
        shieldTransform.localScale = new Vector3(visual.ShieldDiameter, visual.ShieldDiameter, visual.ShieldDiameter);

        _propertyBlock.SetColor(ShieldColorPropertyId, _shieldColor);
        _propertyBlock.SetFloat(OpacityPropertyId, opacity);
        _propertyBlock.SetFloat(RimPowerPropertyId, _shieldRimPower);
        _propertyBlock.SetFloat(RimIntensityPropertyId, _shieldRimIntensity);
        visual.ShieldRenderer.SetPropertyBlock(_propertyBlock);
    }

    private void ApplyUpperHemisphere(TargetVisual visual, float opacity)
    {
        Transform upperHemisphereTransform = visual.UpperHemisphereRenderer.transform;
        upperHemisphereTransform.SetPositionAndRotation(visual.UpperHemisphereCenter, Quaternion.identity);
        float normalizedTime = Mathf.Clamp01(_elapsed / _duration);
        float easedTime = normalizedTime * normalizedTime * (3f - 2f * normalizedTime);
        float diameter = visual.UpperHemisphereDiameter * Mathf.LerpUnclamped(1f, _upperHemisphereEndScale, easedTime);
        upperHemisphereTransform.localScale = new Vector3(diameter, diameter, diameter);

        _propertyBlock.SetColor(UpperHemisphereColorPropertyId, _upperHemisphereColor);
        _propertyBlock.SetFloat(OpacityPropertyId, opacity);
        _propertyBlock.SetFloat(RimPowerPropertyId, _upperHemisphereRimPower);
        _propertyBlock.SetFloat(RimIntensityPropertyId, _upperHemisphereRimIntensity);
        visual.UpperHemisphereRenderer.SetPropertyBlock(_propertyBlock);
    }

    private void SetVisualsEnabled(bool enabled)
    {
        for (int visualIndex = 0; visualIndex < _visuals.Count; visualIndex++)
        {
            TargetVisual visual = _visuals[visualIndex];
            visual.PulseRenderer.enabled = enabled;
            visual.ShieldRenderer.enabled = enabled;
            if (visual.UpperHemisphereRenderer != null)
            {
                visual.UpperHemisphereRenderer.enabled = enabled;
            }
        }
    }
}

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Serialization;

/// <summary>
/// 线框半透明特效控制器。
/// 可通过检视面板“特效开关”或 SetActive(bool) 在运行时动态切换；
/// 开启时把目标的本体材质整体替换为全息半透明材质，并额外绘制一份预烘焙的特征边线框；
/// 关闭时恢复原始材质并隐藏线框，不改动模型资产。
/// 透明度呼吸由全息着色器使用内置时间在顶点阶段计算，脚本只在状态或参数变化时写入一次参数。
/// 线框网格由 Tools/Power Plant/Bake Wireframe Overlay 预先生成，运行时不做任何拓扑计算。
/// </summary>
[DisallowMultipleComponent]
public sealed class WireframeHologramEffect : MonoBehaviour
{
    private const string WireframeChildName = "__WireframeOverlay";
    private static readonly int BreathingParamsPropertyId = Shader.PropertyToID("_BreathingParams");

    [Header("材质")]
    [Tooltip("本体使用的全息半透明材质。留空则只显示线框。")]
    [SerializeField] private Material hologramMaterial;
    [Tooltip("线框使用的材质，需搭配线段拓扑网格。")]
    [SerializeField] private Material wireframeMaterial;

    [Header("线框网格")]
    [Tooltip("与本组件所在网格对应的预烘焙线框网格。为空时自动跳过线框绘制。")]
    [SerializeField] private Mesh wireframeMesh;

    [Header("运行时开关")]
    [Tooltip("控制特效状态。播放模式下可直接在检视面板勾选或取消，修改后立即生效。")]
    [FormerlySerializedAs("activeOnStart")]
    [SerializeField] private bool effectEnabled;

    [Header("透明度呼吸")]
    [Tooltip("开启后，全息本体的基础透明度会周期性平滑变化。")]
    [SerializeField] private bool opacityBreathing = true;
    [Tooltip("透明度呼吸速度，单位为每秒周期数。")]
    [Min(0f)]
    [SerializeField] private float breathingSpeed = 0.8f;
    [Tooltip("相对基础透明度的变化幅度。0.2 表示基础透明度上下变化 20%。")]
    [Range(0f, 1f)]
    [SerializeField] private float breathingAmplitude = 0.35f;

    // 缓存原始材质数组与本组件专用的全息材质数组，关闭特效时逐个还原，避免重复分配。
    private readonly List<Renderer> _bodyRenderers = new List<Renderer>();
    private readonly List<Material[]> _originalMaterials = new List<Material[]>();
    private readonly List<Material[]> _hologramMaterials = new List<Material[]>();

    private GameObject _wireframeObject;
    private Material _runtimeHologramMaterial;
    private bool _hologramSupportsBreathing;
    private bool _breathingSettingsApplied;
    private Vector4 _appliedBreathingParams;
    private bool _isActive;
    private bool _isInitialized;

    /// <summary>
    /// 当前是否处于线框半透明状态。
    /// </summary>
    public bool IsActive => _isActive;

    private void Start()
    {
        Initialize();
        SetActive(effectEnabled);
    }

#if UNITY_EDITOR
    /// <summary>
    /// 播放模式下响应检视面板开关的变化。
    /// 仅在初始化完成后应用，避免资源加载阶段通过 OnValidate 创建运行时对象。
    /// </summary>
    private void OnValidate()
    {
        if (!Application.isPlaying || !_isInitialized)
        {
            return;
        }

        SetActive(effectEnabled);
    }
#endif

    private void OnDestroy()
    {
        // 运行时材质副本必须显式销毁，否则会随场景切换持续占用内存。
        if (_runtimeHologramMaterial != null)
        {
            Destroy(_runtimeHologramMaterial);
        }
    }

    /// <summary>
    /// 切换特效开关。重复设置同一状态不会产生任何渲染改动。
    /// </summary>
    public void SetActive(bool isActive)
    {
        // 同步序列化开关，确保代码调用后检视面板显示状态与实际渲染状态一致。
        effectEnabled = isActive;

        Initialize();
        if (_isActive == isActive)
        {
            ApplyBreathingSettings();
            return;
        }

        _isActive = isActive;
        for (int rendererIndex = 0; rendererIndex < _bodyRenderers.Count; rendererIndex++)
        {
            Renderer renderer = _bodyRenderers[rendererIndex];
            if (renderer == null)
            {
                continue;
            }

            renderer.sharedMaterials = isActive && _runtimeHologramMaterial != null
                ? _hologramMaterials[rendererIndex]
                : _originalMaterials[rendererIndex];
        }

        if (_wireframeObject != null)
        {
            _wireframeObject.SetActive(isActive);
        }

        // 切换状态时立即应用一次呼吸参数，避免等待后续操作才刷新材质配置。
        ApplyBreathingSettings();
    }

    /// <summary>
    /// 将透明度呼吸参数一次性写入运行时材质。时间计算交给着色器完成，因此本组件不需要逐帧执行 Update，
    /// 多个特效实例同时运行时也不会产生随实例数量增长的 CPU 材质更新开销。
    /// </summary>
    private void ApplyBreathingSettings()
    {
        if (_runtimeHologramMaterial == null || !_hologramSupportsBreathing)
        {
            return;
        }

        bool breathingEnabled = _isActive && opacityBreathing;
        float effectiveSpeed = breathingEnabled ? Mathf.Max(0f, breathingSpeed) : 0f;
        float effectiveAmplitude = breathingEnabled ? Mathf.Clamp01(breathingAmplitude) : 0f;
        Vector4 breathingParams = new Vector4(effectiveSpeed, effectiveAmplitude, 0f, 0f);
        if (_breathingSettingsApplied && _appliedBreathingParams == breathingParams)
        {
            return;
        }

        // x 保存每秒周期数，y 保存相对基础透明度的变化幅度；关闭时写入零值，
        // 让着色器直接跳过正弦计算，同时保留材质副本以隔离共享材质资产。
        _runtimeHologramMaterial.SetVector(BreathingParamsPropertyId, breathingParams);
        _appliedBreathingParams = breathingParams;
        _breathingSettingsApplied = true;
    }

    /// <summary>
    /// 缓存本体渲染器与全息材质数组，并按需创建线框子对象。只执行一次。
    /// </summary>
    private void Initialize()
    {
        if (_isInitialized)
        {
            return;
        }

        _isInitialized = true;

        // 使用运行时材质副本承载呼吸透明度，绝不直接改写检视面板引用的共享材质。
        if (hologramMaterial != null)
        {
            _runtimeHologramMaterial = new Material(hologramMaterial)
            {
                name = $"{hologramMaterial.name} (Runtime Hologram)",
                hideFlags = HideFlags.DontSave
            };
            _hologramSupportsBreathing = _runtimeHologramMaterial.HasProperty(BreathingParamsPropertyId);
        }

        Renderer[] renderers = GetComponentsInChildren<Renderer>(true);
        for (int index = 0; index < renderers.Length; index++)
        {
            Renderer renderer = renderers[index];
            Material[] originals = renderer.sharedMaterials;
            _bodyRenderers.Add(renderer);
            _originalMaterials.Add(originals);

            // 全息材质按槽位数量铺满，保证多材质模型的每个子网格都被替换。
            Material[] hologramSlots = new Material[originals.Length];
            for (int slot = 0; slot < hologramSlots.Length; slot++)
            {
                hologramSlots[slot] = _runtimeHologramMaterial;
            }

            _hologramMaterials.Add(hologramSlots);
        }

        CreateWireframeObject();
    }

    /// <summary>
    /// 用独立子对象绘制线框，使其与本体共享变换但可单独控制显隐和材质。
    /// </summary>
    private void CreateWireframeObject()
    {
        if (wireframeMesh == null || wireframeMaterial == null)
        {
            return;
        }

        MeshFilter sourceFilter = GetComponentInChildren<MeshFilter>(true);
        Transform parent = sourceFilter != null ? sourceFilter.transform : transform;

        _wireframeObject = new GameObject(WireframeChildName);
        _wireframeObject.transform.SetParent(parent, false);

        MeshFilter filter = _wireframeObject.AddComponent<MeshFilter>();
        filter.sharedMesh = wireframeMesh;

        MeshRenderer renderer = _wireframeObject.AddComponent<MeshRenderer>();
        renderer.sharedMaterial = wireframeMaterial;
        renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        renderer.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
        renderer.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;

        _wireframeObject.SetActive(false);
    }
}

using System;
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
    [Serializable]
    private sealed class WireframeBinding
    {
        [SerializeField] private MeshFilter sourceFilter;
        [SerializeField] private Mesh wireframeMesh;

        public MeshFilter SourceFilter => sourceFilter;
        public Mesh WireframeMesh => wireframeMesh;
    }

    private const string WireframeChildName = "__WireframeOverlay";
    private static readonly int BreathingParamsPropertyId = Shader.PropertyToID("_BreathingParams");
    private static readonly int OpacityPropertyId = Shader.PropertyToID("_Opacity");

    [Header("材质")]
    [Tooltip("运行时叠加在本体上的玻璃材质；留空则使用全息材质。")]
    [SerializeField] private Material glassMaterial;
    [Tooltip("仅这些本体渲染器在运行时使用玻璃，不包含子级线框。")]
    [SerializeField] private Renderer[] glassTargets = Array.Empty<Renderer>();
    [Tooltip("玻璃基础透明度。")]
    [Range(0.05f, 0.8f)]
    [SerializeField] private float glassOpacity = 0.28f;
    [Tooltip("本体使用的全息半透明材质。留空则只显示线框。")]
    [SerializeField] private Material hologramMaterial;
    [Tooltip("线框使用的材质，需搭配线段拓扑网格。")]
    [SerializeField] private Material wireframeMaterial;

    [Header("线框网格")]
    [Tooltip("兼容旧配置：与本组件所在网格对应的预烘焙线框网格。")]
    [SerializeField] private Mesh wireframeMesh;
    [Tooltip("多网格模型的线框映射。每个源网格使用对应的预烘焙线框网格。")]
    [SerializeField] private WireframeBinding[] wireframeBindings = Array.Empty<WireframeBinding>();

    [Header("外观 / 内部层级")]
    [Tooltip("只将这些外壳节点替换为半透明全息本体；未列入的内部零部件保留原始材质，仅显示线框提示。")]
    [SerializeField] private Transform[] exteriorTargets = Array.Empty<Transform>();
    [Tooltip("外观壳体的全息透明度。值越低越容易看到内部零部件。")]
    [Range(0.01f, 0.5f)]
    [SerializeField] private float exteriorOpacity = 0.14f;
    [Tooltip("需要比普通外壳更通透的运行时目标。")]
    [SerializeField] private Transform[] extraTransparentTargets = Array.Empty<Transform>();
    [Tooltip("更通透目标的全息透明度。")]
    [Range(0.01f, 0.5f)]
    [SerializeField] private float extraTransparentOpacity = 0.05f;
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
    private readonly List<Material[]> _extraTransparentHologramMaterials = new List<Material[]>();
    private readonly List<Material[]> _glassMaterials = new List<Material[]>();
    private readonly List<Material[]> _extraTransparentGlassMaterials = new List<Material[]>();
    private readonly List<bool> _isExteriorRenderer = new List<bool>();
    private readonly List<bool> _isExtraTransparentRenderer = new List<bool>();

    private readonly List<GameObject> _wireframeObjects = new List<GameObject>();
    private Material _runtimeHologramMaterial;
    private Material _runtimeExtraTransparentHologramMaterial;
    private Material _runtimeGlassMaterial;
    private Material _runtimeExtraTransparentGlassMaterial;
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
        for (int index = 0; index < _wireframeObjects.Count; index++)
        {
            if (_wireframeObjects[index] != null)
            {
                Destroy(_wireframeObjects[index]);
            }
        }

        _wireframeObjects.Clear();
        _isExteriorRenderer.Clear();
        _isExtraTransparentRenderer.Clear();
        DestroyRuntimeMaterial(_runtimeHologramMaterial);
        DestroyRuntimeMaterial(_runtimeExtraTransparentHologramMaterial);
        DestroyRuntimeMaterial(_runtimeGlassMaterial);
        DestroyRuntimeMaterial(_runtimeExtraTransparentGlassMaterial);
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

            if (isActive && _runtimeGlassMaterial != null && Array.IndexOf(glassTargets, renderer) >= 0)
            {
                renderer.sharedMaterials = _isExtraTransparentRenderer[rendererIndex]
                    ? _extraTransparentGlassMaterials[rendererIndex]
                    : _glassMaterials[rendererIndex];
            }
            else if (!isActive || _runtimeHologramMaterial == null || !_isExteriorRenderer[rendererIndex])
            {
                renderer.sharedMaterials = _originalMaterials[rendererIndex];
            }
            else
            {
                renderer.sharedMaterials = _isExtraTransparentRenderer[rendererIndex]
                    ? _extraTransparentHologramMaterials[rendererIndex]
                    : _hologramMaterials[rendererIndex];
            }
        }

        for (int index = 0; index < _wireframeObjects.Count; index++)
        {
            GameObject wireframeObject = _wireframeObjects[index];
            if (wireframeObject != null)
            {
                wireframeObject.SetActive(isActive);
            }
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
        if (_runtimeExtraTransparentHologramMaterial != null)
        {
            _runtimeExtraTransparentHologramMaterial.SetVector(BreathingParamsPropertyId, breathingParams);
        }
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

        if (hologramMaterial != null)
        {
            _runtimeHologramMaterial = CreateRuntimeHologramMaterial(exteriorOpacity, "Runtime Exterior Hologram");
            _runtimeExtraTransparentHologramMaterial = CreateRuntimeHologramMaterial(extraTransparentOpacity, "Runtime Extra Transparent Hologram");
            _hologramSupportsBreathing = _runtimeHologramMaterial != null && _runtimeHologramMaterial.HasProperty(BreathingParamsPropertyId);
        }

        if (glassMaterial != null)
        {
            _runtimeGlassMaterial = CreateRuntimeMaterial(glassMaterial, glassOpacity, "Runtime Glass");
            _runtimeExtraTransparentGlassMaterial = CreateRuntimeMaterial(glassMaterial, extraTransparentOpacity, "Runtime Extra Transparent Glass");
        }

        Renderer[] renderers = GetComponentsInChildren<Renderer>(true);
        for (int index = 0; index < renderers.Length; index++)
        {
            Renderer renderer = renderers[index];
            // 已有线框是独立绘制层，不能套用本体材质，也不能被玻璃替换。
            Mesh mesh = renderer.GetComponent<MeshFilter>()?.sharedMesh;
            if (mesh != null && mesh.subMeshCount > 0 && mesh.GetTopology(0) != MeshTopology.Triangles)
            {
                continue;
            }
            Material[] originals = renderer.sharedMaterials;
            _bodyRenderers.Add(renderer);
            _originalMaterials.Add(originals);
            _isExteriorRenderer.Add(IsTargetRenderer(renderer.transform, exteriorTargets));
            _isExtraTransparentRenderer.Add(IsTargetRenderer(renderer.transform, extraTransparentTargets));

            // 全息材质按槽位数量铺满，保证多材质模型的每个子网格都被替换。
            Material[] hologramSlots = new Material[originals.Length];
            Material[] extraTransparentHologramSlots = new Material[originals.Length];
            for (int slot = 0; slot < hologramSlots.Length; slot++)
            {
                hologramSlots[slot] = _runtimeHologramMaterial;
                extraTransparentHologramSlots[slot] = _runtimeExtraTransparentHologramMaterial;
            }

            _hologramMaterials.Add(hologramSlots);
            _extraTransparentHologramMaterials.Add(extraTransparentHologramSlots);
            Material[] glassSlots = new Material[originals.Length];
            Material[] extraTransparentGlassSlots = new Material[originals.Length];
            for (int slot = 0; slot < glassSlots.Length; slot++)
            {
                glassSlots[slot] = _runtimeGlassMaterial;
                extraTransparentGlassSlots[slot] = _runtimeExtraTransparentGlassMaterial;
            }
            _glassMaterials.Add(glassSlots);
            _extraTransparentGlassMaterials.Add(extraTransparentGlassSlots);
        }

        CreateWireframeObjects();
    }

    private Material CreateRuntimeHologramMaterial(float opacity, string runtimeName)
    {
        if (hologramMaterial == null)
        {
            return null;
        }

        Material runtimeMaterial = new Material(hologramMaterial)
        {
            name = $"{hologramMaterial.name} ({runtimeName})",
            hideFlags = HideFlags.DontSave
        };
        if (runtimeMaterial.HasProperty(OpacityPropertyId))
        {
            runtimeMaterial.SetFloat(OpacityPropertyId, Mathf.Clamp(opacity, 0.01f, 0.5f));
        }
        else
        {
            int baseColorId = Shader.PropertyToID("_BaseColor");
            if (runtimeMaterial.HasProperty(baseColorId))
            {
                Color color = runtimeMaterial.GetColor(baseColorId);
                color.a = Mathf.Clamp01(opacity);
                runtimeMaterial.SetColor(baseColorId, color);
            }
        }

        return runtimeMaterial;
    }

    private Material CreateRuntimeMaterial(Material source, float opacity, string runtimeName)
    {
        Material runtimeMaterial = new Material(source)
        {
            name = $"{source.name} ({runtimeName})",
            hideFlags = HideFlags.DontSave
        };
        int baseColorId = Shader.PropertyToID("_BaseColor");
        if (runtimeMaterial.HasProperty(baseColorId))
        {
            Color color = runtimeMaterial.GetColor(baseColorId);
            color.a = Mathf.Clamp01(opacity);
            runtimeMaterial.SetColor(baseColorId, color);
        }
        return runtimeMaterial;
    }
    private static void DestroyRuntimeMaterial(Material material)
    {
        if (material != null)
        {
            Destroy(material);
        }
    }

    private static bool IsTargetRenderer(Transform rendererTransform, Transform[] targets)
    {
        if (targets == null || targets.Length == 0 || rendererTransform == null)
        {
            return false;
        }

        for (int index = 0; index < targets.Length; index++)
        {
            Transform exteriorTarget = targets[index];
            if (exteriorTarget == null)
            {
                continue;
            }

            if (rendererTransform == exteriorTarget || rendererTransform.IsChildOf(exteriorTarget))
            {
                return true;
            }
        }

        return false;
    }


    private void CreateWireframeObjects()
    {
        if (wireframeMaterial == null)
        {
            return;
        }

        WireframeBinding[] bindings = wireframeBindings;
        if (bindings == null || bindings.Length == 0)
        {
            MeshFilter legacySourceFilter = GetComponentInChildren<MeshFilter>(true);
            if (wireframeMesh == null || legacySourceFilter == null)
            {
                return;
            }

            CreateWireframeObject(legacySourceFilter.transform, wireframeMesh, 0);
            return;
        }

        for (int index = 0; index < bindings.Length; index++)
        {
            WireframeBinding binding = bindings[index];
            if (binding == null || binding.SourceFilter == null || binding.WireframeMesh == null)
            {
                continue;
            }

            CreateWireframeObject(binding.SourceFilter.transform, binding.WireframeMesh, index);
        }
    }

    private void CreateWireframeObject(Transform parent, Mesh mesh, int index)
    {
        GameObject wireframeObject = new GameObject($"{WireframeChildName}_{index}");
        wireframeObject.transform.SetParent(parent, false);

        MeshFilter filter = wireframeObject.AddComponent<MeshFilter>();
        filter.sharedMesh = mesh;

        MeshRenderer renderer = wireframeObject.AddComponent<MeshRenderer>();
        renderer.sharedMaterial = wireframeMaterial;
        renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        renderer.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
        renderer.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;

        wireframeObject.SetActive(false);
        _wireframeObjects.Add(wireframeObject);
    }
}

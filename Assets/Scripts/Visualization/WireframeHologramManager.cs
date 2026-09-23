using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Serialization;

/// <summary>
/// 场景级线框全息效果管理器。
///
/// 目标对象统一保存在一个数组中，模型本身不需要挂载任何脚本。管理器在运行时只初始化一次：
/// 缓存目标渲染器的原始材质、创建一份共享的运行时全息材质，并为已配置的网格创建线框覆盖对象。
/// 透明度呼吸参数写入共享材质一次，实际时间计算由着色器完成，因此管理器没有逐帧 Update 开销。
/// 数组中的 Enabled（启用）是目标的当前运行时状态，播放模式下修改检视面板即可即时切换。
/// </summary>
[DisallowMultipleComponent]
public sealed class WireframeHologramManager : MonoBehaviour
{
    private const string WireframeChildName = "__WireframeOverlay";
    private static readonly int BreathingParamsPropertyId = Shader.PropertyToID("_BreathingParams");

    [Serializable]
    private sealed class MeshBinding
    {
        [Tooltip("需要绘制线框的源网格过滤器。")]
        [SerializeField] private MeshFilter _sourceFilter;
        [Tooltip("与源网格对应的编辑器预烘焙线框网格。")]
        [SerializeField] private Mesh _wireframeMesh;

        public MeshFilter SourceFilter => _sourceFilter;
        public Mesh WireframeMesh => _wireframeMesh;
    }

    [Serializable]
    private sealed class TargetBinding
    {
        [Tooltip("供代码或外部事件使用的稳定标识。")]
        [SerializeField] private string _id;
        [Tooltip("需要应用全息效果的模型根对象。")]
        [SerializeField] private GameObject _target;
        [Tooltip("该目标当前是否启用。播放模式下勾选或取消会立即生效，不是仅用于启动初始状态。")]
        [FormerlySerializedAs("_activeOnStart")]
        [SerializeField] private bool _enabled;
        [Tooltip("由编辑器工具按源网格自动生成的线框映射。")]
        [SerializeField] private MeshBinding[] _meshBindings = Array.Empty<MeshBinding>();

        public string Id => _id;
        public GameObject Target => _target;
        public bool Enabled => _enabled;
        public MeshBinding[] MeshBindings => _meshBindings;

        /// <summary>
        /// 更新目标的运行时启用状态，同时同步检视面板字段，方便播放模式下观察当前状态。
        /// </summary>
        public void SetEnabled(bool value)
        {
            _enabled = value;
        }
    }

    private sealed class RuntimeRendererState
    {
        public Renderer Renderer;
        public Material[] OriginalMaterials;
        public Material[] HologramMaterials;
    }

    private sealed class RuntimeOverlayState
    {
        public MeshFilter SourceFilter;
        public Mesh WireframeMesh;
        public GameObject OverlayObject;
    }

    private sealed class RuntimeTargetState
    {
        public GameObject Target;
        public bool IsActive;
        public RuntimeRendererState[] Renderers;
        public RuntimeOverlayState[] Overlays;
    }

    [Header("材质")]
    [Tooltip("全息本体材质。管理器运行时会创建一份副本，不会修改该共享材质资产。")]
    [SerializeField] private Material _hologramMaterial;
    [Tooltip("线框材质。所有目标的线框覆盖对象共用该材质。")]
    [SerializeField] private Material _wireframeMaterial;

    [Header("全息开关")]
    [Tooltip("管理器总开关。播放模式下勾选或取消会立即显示或隐藏所有目标；再次开启时恢复各目标的 Enabled 状态。")]
    [SerializeField] private bool _enabled = true;

    [Header("透明度呼吸")]
    [Tooltip("是否启用全息本体的透明度呼吸。")]
    [SerializeField] private bool _opacityBreathing = true;
    [Tooltip("透明度呼吸速度，单位为每秒周期数。")]
    [Min(0f)]
    [SerializeField] private float _breathingSpeed = 0.8f;
    [Tooltip("相对基础透明度的变化幅度。0.35 表示透明度上下变化 35%。")]
    [Range(0f, 1f)]
    [SerializeField] private float _breathingAmplitude = 0.35f;

    [Header("全息目标数组")]
    [Tooltip("需要全息效果的对象。使用编辑器工具可批量填充，不需要在模型上挂载脚本。")]
    [SerializeField] private TargetBinding[] _targets = Array.Empty<TargetBinding>();

    private readonly Dictionary<GameObject, int> _targetIndexByObject = new Dictionary<GameObject, int>();
    private readonly Dictionary<string, int> _targetIndexById = new Dictionary<string, int>(StringComparer.Ordinal);

    private RuntimeTargetState[] _runtimeTargets;
    private Material _runtimeHologramMaterial;
    private Vector4 _appliedBreathingParams;
    private bool _breathingSettingsApplied;
    private bool _hologramSupportsBreathing;
    private bool _isInitialized;

    /// <summary>
    /// 当前管理器登记的目标数量。数组索引在配置后保持稳定，适合外部事件调用。
    /// </summary>
    public int TargetCount => _targets != null ? _targets.Length : 0;

    /// <summary>
    /// 管理器总开关状态。关闭时所有目标都不显示，但不会清除各目标自己的 Enabled 状态。
    /// </summary>
    public bool IsEnabled => _enabled;

    /// <summary>
    /// 按索引读取目标对象，找不到时返回 null。
    /// </summary>
    public GameObject GetTarget(int index)
    {
        if (_targets == null || index < 0 || index >= _targets.Length || _targets[index] == null)
        {
            return null;
        }

        return _targets[index].Target;
    }

    /// <summary>
    /// 查询目标当前是否启用。
    /// </summary>
    public bool IsTargetActive(int index)
    {
        Initialize();
        return _runtimeTargets != null && index >= 0 && index < _runtimeTargets.Length &&
               _runtimeTargets[index] != null && _runtimeTargets[index].IsActive;
    }

    private void Awake()
    {
        Initialize();
    }

    private void OnEnable()
    {
        if (_isInitialized)
        {
            ApplyConfiguredStates();
        }
    }

    private void OnDisable()
    {
        if (!_isInitialized)
        {
            return;
        }

        // 禁用管理器时恢复本体材质并隐藏覆盖线框，避免组件状态与画面状态不一致。
        for (int index = 0; index < _runtimeTargets.Length; index++)
        {
            ApplyTargetState(index, false);
        }
    }

#if UNITY_EDITOR
    /// <summary>
    /// 播放模式下修改检视面板参数时立即同步运行时材质和目标状态。
    /// 配置结构变化会重建一次运行时缓存；该回调只在编辑器改值时触发，不属于帧循环。
    /// </summary>
    private void OnValidate()
    {
        if (!Application.isPlaying || !_isInitialized)
        {
            return;
        }

        if (HasRuntimeConfigurationChanged())
        {
            ReleaseRuntimeResources();
            Initialize();
            return;
        }

        ApplyBreathingSettings();
        ApplyConfiguredStates();
    }
#endif

    private void OnDestroy()
    {
        ReleaseRuntimeResources();
    }

    /// <summary>
    /// 设置管理器总开关。关闭时隐藏全部目标；再次开启时恢复各目标自己的 Enabled 状态。
    /// </summary>
    public void SetEnabled(bool enabled)
    {
        Initialize();
        if (_enabled == enabled)
        {
            return;
        }

        _enabled = enabled;
        ApplyConfiguredStates();
    }

    /// <summary>
    /// 设置指定数组索引目标的当前启用状态。该方法可直接绑定到界面按钮或外部事件。
    /// </summary>
    public void SetActive(int index, bool isActive)
    {
        Initialize();
        if (_targets == null || index < 0 || index >= _targets.Length || _targets[index] == null)
        {
            return;
        }

        _targets[index].SetEnabled(isActive);
        ApplyTargetState(index, _enabled && isActive);
    }

    /// <summary>
    /// 按目标标识设置单个对象的启用状态。
    /// </summary>
    public void SetActiveById(string targetId, bool isActive)
    {
        Initialize();
        if (string.IsNullOrEmpty(targetId) || !_targetIndexById.TryGetValue(targetId, out int index))
        {
            return;
        }

        SetActive(index, isActive);
    }

    /// <summary>
    /// 按目标名称设置单个对象的启用状态。名称重复时不会猜测，调用会被忽略。
    /// </summary>
    public bool TrySetActiveByName(string targetName, bool isActive)
    {
        Initialize();
        if (string.IsNullOrEmpty(targetName))
        {
            return false;
        }

        int matchedIndex = -1;
        for (int index = 0; index < _targets.Length; index++)
        {
            if (_targets[index] == null || _targets[index].Target == null || _targets[index].Target.name != targetName)
            {
                continue;
            }

            if (matchedIndex >= 0)
            {
                return false;
            }

            matchedIndex = index;
        }

        if (matchedIndex < 0)
        {
            return false;
        }

        SetActive(matchedIndex, isActive);
        return true;
    }

    /// <summary>
    /// 按对象引用设置单个对象的启用状态。适合代码直接控制，不依赖数组索引。
    /// </summary>
    public bool TrySetActive(GameObject target, bool isActive)
    {
        Initialize();
        if (target == null || !_targetIndexByObject.TryGetValue(target, out int index))
        {
            return false;
        }

        SetActive(index, isActive);
        return true;
    }

    /// <summary>
    /// 一次性设置所有目标。只在调用时遍历数组，不在每帧执行。
    /// </summary>
    public void SetAllActive(bool isActive)
    {
        Initialize();
        if (_targets == null)
        {
            return;
        }

        for (int index = 0; index < _targets.Length; index++)
        {
            if (_targets[index] == null)
            {
                continue;
            }

            _targets[index].SetEnabled(isActive);
            ApplyTargetState(index, _enabled && isActive);
        }
    }

    /// <summary>
    /// 初始化运行时材质、渲染器缓存和线框覆盖对象。该过程每个管理器实例只执行一次。
    /// </summary>
    private void Initialize()
    {
        if (_isInitialized)
        {
            return;
        }

        _isInitialized = true;
        CreateRuntimeHologramMaterial();

        int targetCount = _targets != null ? _targets.Length : 0;
        _runtimeTargets = new RuntimeTargetState[targetCount];
        _targetIndexByObject.Clear();
        _targetIndexById.Clear();

        // 用集合避免错误配置中同一个 MeshFilter 被多个目标重复创建线框覆盖对象。
        HashSet<MeshFilter> createdSourceFilters = new HashSet<MeshFilter>();
        for (int index = 0; index < targetCount; index++)
        {
            TargetBinding binding = _targets[index];
            if (binding == null || binding.Target == null)
            {
                continue;
            }

            RuntimeTargetState runtimeTarget = BuildRuntimeTarget(binding, createdSourceFilters);
            _runtimeTargets[index] = runtimeTarget;

            if (!_targetIndexByObject.ContainsKey(binding.Target))
            {
                _targetIndexByObject.Add(binding.Target, index);
            }

            if (!string.IsNullOrEmpty(binding.Id) && !_targetIndexById.ContainsKey(binding.Id))
            {
                _targetIndexById.Add(binding.Id, index);
            }
        }

        ApplyBreathingSettings();
        ApplyConfiguredStates();
    }

    /// <summary>
    /// 为一个目标缓存所有渲染器的原始材质，并创建该目标登记的线框覆盖对象。
    /// 渲染器扫描只发生在初始化阶段，运行时切换只访问已经缓存的数组。
    /// </summary>
    private RuntimeTargetState BuildRuntimeTarget(TargetBinding binding, HashSet<MeshFilter> createdSourceFilters)
    {
        if (binding.Target == null)
        {
            return null;
        }

        Renderer[] renderers = binding.Target.GetComponentsInChildren<Renderer>(true);
        RuntimeRendererState[] rendererStates = new RuntimeRendererState[renderers.Length];
        for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
        {
            Renderer renderer = renderers[rendererIndex];
            Material[] originalMaterials = renderer.sharedMaterials;
            Material[] hologramMaterials = new Material[originalMaterials.Length];
            for (int materialIndex = 0; materialIndex < originalMaterials.Length; materialIndex++)
            {
                // 保留原始空材质槽，避免启用全息时意外改变子网格数量和渲染语义。
                hologramMaterials[materialIndex] = originalMaterials[materialIndex] == null
                    ? null
                    : _runtimeHologramMaterial;
            }

            rendererStates[rendererIndex] = new RuntimeRendererState
            {
                Renderer = renderer,
                OriginalMaterials = originalMaterials,
                HologramMaterials = hologramMaterials
            };
        }

        MeshBinding[] meshBindings = binding.MeshBindings ?? Array.Empty<MeshBinding>();
        RuntimeOverlayState[] overlayStates = new RuntimeOverlayState[meshBindings.Length];
        for (int bindingIndex = 0; bindingIndex < meshBindings.Length; bindingIndex++)
        {
            MeshBinding meshBinding = meshBindings[bindingIndex];
            if (meshBinding == null)
            {
                continue;
            }

            RuntimeOverlayState overlayState = new RuntimeOverlayState
            {
                SourceFilter = meshBinding.SourceFilter,
                WireframeMesh = meshBinding.WireframeMesh
            };
            overlayStates[bindingIndex] = overlayState;

            if (meshBinding.SourceFilter == null || meshBinding.WireframeMesh == null || _wireframeMaterial == null)
            {
                continue;
            }

            if (!createdSourceFilters.Add(meshBinding.SourceFilter))
            {
                continue;
            }

            GameObject overlayObject = new GameObject(
                $"{WireframeChildName}_{binding.Target.name}_{bindingIndex}");
            overlayObject.hideFlags = HideFlags.DontSave;
            overlayObject.transform.SetParent(meshBinding.SourceFilter.transform, false);

            MeshFilter overlayFilter = overlayObject.AddComponent<MeshFilter>();
            overlayFilter.sharedMesh = meshBinding.WireframeMesh;

            MeshRenderer overlayRenderer = overlayObject.AddComponent<MeshRenderer>();
            overlayRenderer.sharedMaterial = _wireframeMaterial;
            overlayRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            overlayRenderer.receiveShadows = false;
            overlayRenderer.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
            overlayRenderer.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;

            overlayObject.SetActive(false);
            overlayState.OverlayObject = overlayObject;
        }

        return new RuntimeTargetState
        {
            Target = binding.Target,
            IsActive = false,
            Renderers = rendererStates,
            Overlays = overlayStates
        };
    }

    /// <summary>
    /// 为当前管理器创建唯一一份运行时全息材质副本。
    /// 所有目标共用该副本，既避免每个模型各自复制材质，也保证共享呼吸参数只需写入一次。
    /// </summary>
    private void CreateRuntimeHologramMaterial()
    {
        if (_hologramMaterial == null)
        {
            return;
        }

        _runtimeHologramMaterial = new Material(_hologramMaterial)
        {
            name = $"{_hologramMaterial.name} (Runtime Manager)",
            hideFlags = HideFlags.DontSave
        };
        _hologramSupportsBreathing = _runtimeHologramMaterial.HasProperty(BreathingParamsPropertyId);
    }

    /// <summary>
    /// 只在管理器状态或呼吸参数变化时写入材质参数。
    /// 关闭呼吸时写入零值，让着色器直接跳过正弦计算。
    /// </summary>
    private void ApplyBreathingSettings()
    {
        if (_runtimeHologramMaterial == null || !_hologramSupportsBreathing)
        {
            return;
        }

        float effectiveSpeed = _opacityBreathing ? Mathf.Max(0f, _breathingSpeed) : 0f;
        float effectiveAmplitude = _opacityBreathing ? Mathf.Clamp01(_breathingAmplitude) : 0f;
        Vector4 breathingParams = new Vector4(effectiveSpeed, effectiveAmplitude, 0f, 0f);
        if (_breathingSettingsApplied && _appliedBreathingParams == breathingParams)
        {
            return;
        }

        _runtimeHologramMaterial.SetVector(BreathingParamsPropertyId, breathingParams);
        _appliedBreathingParams = breathingParams;
        _breathingSettingsApplied = true;
    }

    /// <summary>
    /// 将数组中保存的 Enabled（启用）状态同步到运行时缓存。该方法只在初始化、重新启用管理器或
    /// 播放模式下修改检视面板时调用，不属于帧循环。
    /// </summary>
    private void ApplyConfiguredStates()
    {
        if (_targets == null || _runtimeTargets == null)
        {
            return;
        }

        int count = Mathf.Min(_targets.Length, _runtimeTargets.Length);
        for (int index = 0; index < count; index++)
        {
            if (_targets[index] == null || _runtimeTargets[index] == null)
            {
                continue;
            }

            ApplyTargetState(index, _enabled && _targets[index].Enabled);
        }
    }

    /// <summary>
    /// 切换单个目标的本体材质和线框覆盖对象。重复设置同一状态不会重复写入渲染器。
    /// </summary>
    private void ApplyTargetState(int index, bool isActive)
    {
        if (_runtimeTargets == null || index < 0 || index >= _runtimeTargets.Length)
        {
            return;
        }

        RuntimeTargetState targetState = _runtimeTargets[index];
        if (targetState == null || targetState.IsActive == isActive)
        {
            return;
        }

        targetState.IsActive = isActive;
        RuntimeRendererState[] rendererStates = targetState.Renderers;
        for (int rendererIndex = 0; rendererIndex < rendererStates.Length; rendererIndex++)
        {
            RuntimeRendererState rendererState = rendererStates[rendererIndex];
            if (rendererState == null || rendererState.Renderer == null)
            {
                continue;
            }

            rendererState.Renderer.sharedMaterials = isActive && _runtimeHologramMaterial != null
                ? rendererState.HologramMaterials
                : rendererState.OriginalMaterials;
        }

        RuntimeOverlayState[] overlayStates = targetState.Overlays;
        for (int overlayIndex = 0; overlayIndex < overlayStates.Length; overlayIndex++)
        {
            GameObject overlayObject = overlayStates[overlayIndex]?.OverlayObject;
            if (overlayObject != null)
            {
                overlayObject.SetActive(isActive);
            }
        }
    }

#if UNITY_EDITOR
    /// <summary>
    /// 判断检视面板是否修改了需要重建运行时对象的结构字段。
    /// 参数变化不进入该分支，只会更新一次材质向量。
    /// </summary>
    private bool HasRuntimeConfigurationChanged()
    {
        if (_targets == null || _runtimeTargets == null || _targets.Length != _runtimeTargets.Length)
        {
            return true;
        }

        for (int index = 0; index < _targets.Length; index++)
        {
            TargetBinding binding = _targets[index];
            RuntimeTargetState runtimeTarget = _runtimeTargets[index];
            if (binding == null || binding.Target == null)
            {
                if (runtimeTarget != null)
                {
                    return true;
                }

                continue;
            }

            if (runtimeTarget == null || runtimeTarget.Target != binding.Target)
            {
                return true;
            }

            MeshBinding[] meshBindings = binding.MeshBindings ?? Array.Empty<MeshBinding>();
            if (runtimeTarget.Overlays == null || runtimeTarget.Overlays.Length != meshBindings.Length)
            {
                return true;
            }

            for (int bindingIndex = 0; bindingIndex < meshBindings.Length; bindingIndex++)
            {
                MeshBinding meshBinding = meshBindings[bindingIndex];
                RuntimeOverlayState overlayState = runtimeTarget.Overlays[bindingIndex];
                if (meshBinding == null)
                {
                    if (overlayState != null)
                    {
                        return true;
                    }

                    continue;
                }

                if (overlayState == null || overlayState.SourceFilter != meshBinding.SourceFilter ||
                    overlayState.WireframeMesh != meshBinding.WireframeMesh)
                {
                    return true;
                }
            }
        }

        return false;
    }
#endif

    /// <summary>
    /// 释放运行时材质和线框对象，并在释放前恢复目标的原始材质。
    /// </summary>
    private void ReleaseRuntimeResources()
    {
        if (!_isInitialized)
        {
            return;
        }

        if (_runtimeTargets != null)
        {
            for (int targetIndex = 0; targetIndex < _runtimeTargets.Length; targetIndex++)
            {
                RuntimeTargetState targetState = _runtimeTargets[targetIndex];
                if (targetState == null)
                {
                    continue;
                }

                RuntimeRendererState[] rendererStates = targetState.Renderers;
                for (int rendererIndex = 0; rendererIndex < rendererStates.Length; rendererIndex++)
                {
                    RuntimeRendererState rendererState = rendererStates[rendererIndex];
                if (rendererState?.Renderer != null)
                {
                    // 释放阶段无条件恢复缓存材质；调用方应避免让其他系统同时接管同一渲染器。
                    rendererState.Renderer.sharedMaterials = rendererState.OriginalMaterials;
                }
                }

                RuntimeOverlayState[] overlayStates = targetState.Overlays;
                for (int overlayIndex = 0; overlayIndex < overlayStates.Length; overlayIndex++)
                {
                    GameObject overlayObject = overlayStates[overlayIndex]?.OverlayObject;
                    if (overlayObject != null)
                    {
                        DestroyRuntimeObject(overlayObject);
                    }
                }
            }
        }

        if (_runtimeHologramMaterial != null)
        {
            DestroyRuntimeObject(_runtimeHologramMaterial);
        }

        _runtimeTargets = null;
        _targetIndexByObject.Clear();
        _targetIndexById.Clear();
        _runtimeHologramMaterial = null;
        _breathingSettingsApplied = false;
        _hologramSupportsBreathing = false;
        _isInitialized = false;
    }

    private static void DestroyRuntimeObject(UnityEngine.Object target)
    {
        if (target == null)
        {
            return;
        }

        if (Application.isPlaying)
        {
            Destroy(target);
        }
        else
        {
            DestroyImmediate(target);
        }
    }
}

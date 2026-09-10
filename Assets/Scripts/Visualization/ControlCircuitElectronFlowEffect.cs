using UnityEngine;
using UnityEngine.Rendering;

/// <summary>控制线路上的电子脉冲覆盖层；UV1 记录实际路径距离，不修改原线路网格或材质。</summary>
[DisallowMultipleComponent]
public sealed class ControlCircuitElectronFlowEffect : MonoBehaviour
{
    [Header("Source")]
    [SerializeField] private MeshFilter _circuitMeshFilter;
    [SerializeField] private MeshRenderer _circuitRenderer;
    [SerializeField] private Mesh _flowMesh;
    [SerializeField] private Material _flowMaterial;

    [Header("Electron Flow")]
    [SerializeField, ColorUsage(true, true)] private Color _baseGlowColor = new Color(0.005f, 0.09f, 0.25f, 1f);
    [SerializeField, ColorUsage(true, true)] private Color _flowColor = new Color(0.015f, 1.1f, 2.8f, 1f);
    [SerializeField, ColorUsage(true, true)] private Color _headColor = new Color(1.5f, 3f, 3.5f, 1f);
    [SerializeField, Range(0f, 1f)] private float _opacity = 0.85f;
    [Tooltip("米/秒；正值从控制机柜流向设备，负值反向。这是信号示意方向，不是物理电子漂移仿真。")]
    [SerializeField] private float _flowSpeed = 3f;
    [SerializeField, Min(0.1f)] private float _pulseSpacing = 5f;
    [SerializeField, Min(0.02f)] private float _tailLength = 1.3f;
    [SerializeField, Min(0.01f)] private float _headLength = 0.16f;
    [SerializeField, Min(0f)] private float _surfaceOffset = 0.028f;

    private static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
    private static readonly int FlowColorId = Shader.PropertyToID("_FlowColor");
    private static readonly int HeadColorId = Shader.PropertyToID("_HeadColor");
    private static readonly int OpacityId = Shader.PropertyToID("_Opacity");
    private static readonly int FlowSpeedId = Shader.PropertyToID("_FlowSpeed");
    private static readonly int SpacingId = Shader.PropertyToID("_Spacing");
    private static readonly int TailLengthId = Shader.PropertyToID("_TailLength");
    private static readonly int HeadLengthId = Shader.PropertyToID("_HeadLength");
    private static readonly int SurfaceOffsetId = Shader.PropertyToID("_SurfaceOffset");

    private GameObject _runtimeOverlay;
    private MeshRenderer _runtimeRenderer;
    private MaterialPropertyBlock _properties;
    private bool _appearanceDirty = true;
    private bool _creationAttempted;

    public void Configure(MeshFilter source, MeshRenderer sourceRenderer, Mesh flowMesh, Material material)
    {
        _circuitMeshFilter = source;
        _circuitRenderer = sourceRenderer;
        _flowMesh = flowMesh;
        _flowMaterial = material;
        ReleaseOverlay();
        _appearanceDirty = true;
    }

    public void SetFlowDirection(bool cabinetsToEquipment)
    {
        _flowSpeed = Mathf.Abs(_flowSpeed) * (cabinetsToEquipment ? 1f : -1f);
        _appearanceDirty = true;
    }

    private void OnEnable()
    {
        _appearanceDirty = true;
        _creationAttempted = false;
    }

    private void LateUpdate()
    {
        if (!EnsureOverlay()) return;
        bool visible = _circuitRenderer != null && _circuitRenderer.enabled
            && _circuitRenderer.gameObject.activeInHierarchy && !_circuitRenderer.forceRenderingOff;
        if (_runtimeOverlay.activeSelf != visible) _runtimeOverlay.SetActive(visible);
        if (_appearanceDirty) ApplyAppearance();
    }

    private bool EnsureOverlay()
    {
        if (_runtimeOverlay != null) return true;
        if (_creationAttempted) return false;
        _creationAttempted = true;
        if (_circuitMeshFilter == null || _circuitRenderer == null || _flowMesh == null || _flowMaterial == null)
        {
            Debug.LogWarning("Control circuit flow needs its source, baked route mesh and material configured.", this);
            return false;
        }
        _runtimeOverlay = new GameObject("__ControlCircuitElectronFlow");
        _runtimeOverlay.hideFlags = HideFlags.DontSave;
        _runtimeOverlay.layer = _circuitRenderer.gameObject.layer;
        _runtimeOverlay.transform.SetParent(_circuitMeshFilter.transform, false);
        _runtimeOverlay.AddComponent<MeshFilter>().sharedMesh = _flowMesh;
        _runtimeRenderer = _runtimeOverlay.AddComponent<MeshRenderer>();
        var materials = new Material[_flowMesh.subMeshCount];
        for (int i = 0; i < materials.Length; i++) materials[i] = _flowMaterial;
        _runtimeRenderer.sharedMaterials = materials;
        _runtimeRenderer.shadowCastingMode = ShadowCastingMode.Off;
        _runtimeRenderer.receiveShadows = false;
        _runtimeRenderer.lightProbeUsage = LightProbeUsage.Off;
        _runtimeRenderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
        _runtimeRenderer.sortingOrder = 115;
        _properties = new MaterialPropertyBlock();
        _appearanceDirty = true;
        return true;
    }

    private void ApplyAppearance()
    {
        _properties.Clear();
        _properties.SetColor(BaseColorId, _baseGlowColor);
        _properties.SetColor(FlowColorId, _flowColor);
        _properties.SetColor(HeadColorId, _headColor);
        _properties.SetFloat(OpacityId, Mathf.Clamp01(_opacity));
        _properties.SetFloat(FlowSpeedId, _flowSpeed);
        _properties.SetFloat(SpacingId, Mathf.Max(0.1f, _pulseSpacing));
        _properties.SetFloat(TailLengthId, Mathf.Max(0.02f, _tailLength));
        _properties.SetFloat(HeadLengthId, Mathf.Max(0.01f, _headLength));
        _properties.SetFloat(SurfaceOffsetId, Mathf.Max(0f, _surfaceOffset));
        _runtimeRenderer.SetPropertyBlock(_properties);
        _appearanceDirty = false;
    }

    private void OnValidate() { _appearanceDirty = true; }
    private void OnDisable() { ReleaseOverlay(); }
    private void OnDestroy() { ReleaseOverlay(); }

    private void ReleaseOverlay()
    {
        if (_runtimeOverlay != null)
        {
            _runtimeOverlay.SetActive(false);
            Destroy(_runtimeOverlay);
        }
        _runtimeOverlay = null;
        _runtimeRenderer = null;
        _creationAttempted = false;
    }
}

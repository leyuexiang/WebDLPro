using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>基于 FlyLineEffect 的世界坐标线路流光：LineRenderer 主线 + 单个移动亮点。</summary>
[DisallowMultipleComponent]
public sealed class ControlCircuitElectronFlowEffect : MonoBehaviour
{
    [Header("Source")]
    [SerializeField] private MeshFilter _circuitMeshFilter;
    [SerializeField] private MeshRenderer _circuitRenderer;
    [SerializeField] private Mesh _flowMesh;
    [SerializeField] private Material _flowMaterial;
    [SerializeField] private Material _glowMaterial;

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
    [SerializeField, Min(0.001f)] private float _lineWidth = 0.09f;
    [SerializeField, Min(1f)] private float _glowWidthMultiplier = 1.3f;

    private static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
    private static readonly int FlowColorId = Shader.PropertyToID("_FlowColor");
    private static readonly int FlowSpeedId = Shader.PropertyToID("_FlowSpeed");
    private static readonly int FlowIntensityId = Shader.PropertyToID("_FlowIntensity");
    private static readonly int FlowTilingId = Shader.PropertyToID("_FlowTiling");
    private static readonly int FlowWidthId = Shader.PropertyToID("_FlowWidth");
    private static readonly int FlowContrastId = Shader.PropertyToID("_FlowContrast");
    private static readonly int OpacityId = Shader.PropertyToID("_Opacity");
    private static readonly int GlowColorId = Shader.PropertyToID("_GlowColor");
    private static readonly int GlowSpeedId = Shader.PropertyToID("_GlowSpeed");
    private static readonly int GlowTilingId = Shader.PropertyToID("_GlowTiling");
    private static readonly int GlowWidthId = Shader.PropertyToID("_GlowWidth");
    private static readonly int GlowIntensityId = Shader.PropertyToID("_GlowIntensity");
    private static readonly int GlowOpacityId = Shader.PropertyToID("_GlowOpacity");
    private static readonly int GlowBaseId = Shader.PropertyToID("_GlowBase");

    private bool _playbackEnabled = true;

    private GameObject _runtimeOverlay;
    private LineRenderer _flowRenderer;
    private LineRenderer _glowRenderer;
    private MaterialPropertyBlock _properties;
    private bool _appearanceDirty = true;
    private bool _creationAttempted;

    public void Configure(MeshFilter source, MeshRenderer sourceRenderer, Mesh flowMesh, Material material)
    {
        Configure(source, sourceRenderer, flowMesh, material, null);
    }

    public void Configure(
        MeshFilter source,
        MeshRenderer sourceRenderer,
        Mesh flowMesh,
        Material material,
        Material glowMaterial)
    {
        _circuitMeshFilter = source;
        _circuitRenderer = sourceRenderer;
        _flowMesh = flowMesh;
        _flowMaterial = material;
        _glowMaterial = glowMaterial;
        ReleaseOverlay();
        _appearanceDirty = true;
    }

    public void SetPlayback(bool playing)
    {
        if (_playbackEnabled == playing) return;
        _playbackEnabled = playing;
        if (_flowRenderer != null) _flowRenderer.enabled = playing;
        if (_glowRenderer != null) _glowRenderer.enabled = playing;
    }

    public bool IsPlaybackEnabled => _playbackEnabled;


#if UNITY_EDITOR
    public void ConfigureAppearanceForEditor(
        Color baseGlowColor,
        Color flowColor,
        Color headColor,
        float flowSpeed)
    {
        _baseGlowColor = baseGlowColor;
        _flowColor = flowColor;
        _headColor = headColor;
        _flowSpeed = flowSpeed;
        _appearanceDirty = true;
    }
#endif

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
            Debug.LogWarning("Control circuit flow needs its source, baked route mesh and FlyLine materials configured.", this);
            return false;
        }

        Vector3[] route = BuildWorldRoute();
        if (route == null || route.Length < 2) return false;

        _runtimeOverlay = new GameObject("__ControlCircuitFlyLine");
        _runtimeOverlay.hideFlags = HideFlags.DontSave;
        _runtimeOverlay.layer = _circuitRenderer.gameObject.layer;
        _runtimeOverlay.transform.SetParent(_circuitMeshFilter.transform, false);
        _flowRenderer = CreateLineRenderer("Flow", _flowMaterial, _lineWidth);
        _glowRenderer = CreateLineRenderer("Glow", _glowMaterial != null ? _glowMaterial : _flowMaterial, _lineWidth * _glowWidthMultiplier);
        _flowRenderer.positionCount = route.Length;
        _glowRenderer.positionCount = route.Length;
        _flowRenderer.SetPositions(route);
        _glowRenderer.SetPositions(route);
        _flowRenderer.enabled = _playbackEnabled;
        _glowRenderer.enabled = _playbackEnabled;
        _properties = new MaterialPropertyBlock();
        _appearanceDirty = true;
        return true;
    }

    private LineRenderer CreateLineRenderer(string name, Material material, float width)
    {
        GameObject lineObject = new GameObject(name);
        lineObject.transform.SetParent(_runtimeOverlay.transform, false);
        LineRenderer line = lineObject.AddComponent<LineRenderer>();
        line.useWorldSpace = true;
        line.loop = false;
        line.alignment = LineAlignment.View;
        line.textureMode = LineTextureMode.Stretch;
        line.numCapVertices = 4;
        line.numCornerVertices = 4;
        line.shadowCastingMode = ShadowCastingMode.Off;
        line.receiveShadows = false;
        line.lightProbeUsage = LightProbeUsage.Off;
        line.reflectionProbeUsage = ReflectionProbeUsage.Off;
        line.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
        line.allowOcclusionWhenDynamic = false;
        line.startWidth = width;
        line.endWidth = width;
        line.startColor = Color.white;
        line.endColor = Color.white;
        line.sharedMaterial = material;
        return line;
    }

    private Vector3[] BuildWorldRoute()
    {
        Vector3[] vertices = _flowMesh.vertices;
        Vector2[] uv = _flowMesh.uv2;
        if (vertices.Length == 0 || uv.Length != vertices.Length) return null;
        var indices = new List<int>(vertices.Length);
        for (int i = 0; i < vertices.Length; i++) indices.Add(i);
        indices.Sort((a, b) => uv[a].x.CompareTo(uv[b].x));
        float min = uv[indices[0]].x;
        float max = uv[indices[indices.Count - 1]].x;
        float range = Mathf.Max(0.00001f, max - min);
        int sampleCount = Mathf.Clamp(Mathf.CeilToInt(range * 100f) + 2, 8, 96);
        var route = new List<Vector3>(sampleCount);
        for (int sample = 0; sample < sampleCount; sample++)
        {
            float target = Mathf.Lerp(min, max, sample / (float)(sampleCount - 1));
            float window = range / (sampleCount - 1) * 0.7f;
            Vector3 center = Vector3.zero;
            int count = 0;
            for (int i = 0; i < indices.Count; i++)
            {
                int vertex = indices[i];
                if (Mathf.Abs(uv[vertex].x - target) <= window)
                {
                    center += _circuitMeshFilter.transform.TransformPoint(vertices[vertex]);
                    count++;
                }
            }
            if (count > 0) route.Add(center / count);
        }
        return route.ToArray();
    }

    private void ApplyAppearance()
    {
        if (_flowRenderer == null || _glowRenderer == null) return;
        _properties.Clear();
        _properties.SetColor(BaseColorId, _baseGlowColor);
        _properties.SetColor(FlowColorId, _flowColor);
        _properties.SetFloat(FlowSpeedId, _flowSpeed);
        _properties.SetFloat(FlowIntensityId, 0.65f);
        _properties.SetFloat(FlowTilingId, 1.2f);
        _properties.SetFloat(FlowWidthId, 0.12f);
        _properties.SetFloat(FlowContrastId, 1.15f);
        _properties.SetFloat(OpacityId, Mathf.Clamp01(_opacity));
        _flowRenderer.SetPropertyBlock(_properties);
        _properties.Clear();
        _properties.SetColor(GlowColorId, _headColor);
        _properties.SetFloat(GlowSpeedId, _flowSpeed);
        _properties.SetFloat(GlowTilingId, 3.8f);
        _properties.SetFloat(GlowWidthId, 0.025f);
        _properties.SetFloat(GlowIntensityId, 3.5f);
        _properties.SetFloat(GlowOpacityId, Mathf.Clamp01(_opacity));
        _properties.SetFloat(GlowBaseId, 0.045f);
        _glowRenderer.SetPropertyBlock(_properties);
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
        _flowRenderer = null;
        _glowRenderer = null;
        _creationAttempted = false;
    }
}

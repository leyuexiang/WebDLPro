using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Draws a compact, diameter-scaled turbine rotation indicator: a fine scale ring and a segmented arrow ring.
/// Geometry is generated at runtime, keeping the source turbine model free of auxiliary meshes.
/// </summary>
[DisallowMultipleComponent]
public sealed class TurbineRotationDirectionEffect : MonoBehaviour
{
    private const string RuntimeRootName = "__TurbineRotationDirectionEffect";
    private const int CircleSegments = 128;
    private static readonly int BaseColorPropertyId = Shader.PropertyToID("_BaseColor");
    private static readonly int OpacityPropertyId = Shader.PropertyToID("_Opacity");

    private sealed class EffectRenderer
    {
        public Renderer Renderer;
        public float OpacityMultiplier;
    }

    [Header("Turbine Shaft")]
    [Tooltip("The two transforms define the turbine rotation axis and the centre of the indicator.")]
    [SerializeField] private Transform _axisStart;
    [SerializeField] private Transform _axisEnd;
    [Tooltip("Optional turbine or rotor model used to derive the visible wheel diameter for the scale ring.")]
    [SerializeField] private Transform _wheelVisual;
    [Tooltip("Optional visible rotor/disc used as the exact scale-ring centre and measurement plane.")]
    [SerializeField] private Transform _scaleRingAnchor;
    [Tooltip("Additional local offset for aligning the scale-ring centre to the visible rotor centre.")]
    [SerializeField] private Vector2 _scaleRingRadialOffset;

    [Header("Axial Layering")]
    [Tooltip("Scale ring position from the shaft midpoint along the axis. Keep it close to the visible rotor plane.")]
    [SerializeField] private float _scaleRingAxialOffset;
    [Tooltip("Arrow ring position from the shaft midpoint along the axis. Offset it from the scale ring to separate their meanings.")]
    [SerializeField] private float _arrowRingAxialOffset = -2f;
    [Tooltip("Half-width of the wheel cross-section sampled around the scale-ring plane, relative to the shaft diameter.")]
    [SerializeField, Min(0.02f)] private float _wheelSliceHalfWidthMultiplier = 0.12f;
    [Tooltip("Vertex-radius percentile used to reject casing details crossing the sampled wheel plane.")]
    [SerializeField, Range(0.5f, 0.99f)] private float _wheelRadiusPercentile = 0.9f;

    [Header("Automatic Size")]
    [Tooltip("Calculates both ring diameters from the rendered diameter of the configured shaft meshes.")]
    [SerializeField] private bool _scaleToShaftDiameter = true;
    [Tooltip("Used only when no rendered shaft diameter can be measured.")]
    [SerializeField, Min(0.01f)] private float _fallbackShaftDiameter = 1f;
    [Tooltip("Scale-ring diameter in world units, matching the visible turbine wheel. This avoids runtime mesh-read requirements.")]
    [SerializeField, Min(0.01f)] private float _wheelDiameter = 11.84f;
    [Tooltip("Diameter of the tick ring relative to the visible turbine wheel diameter.")]
    [SerializeField, Min(0.5f)] private float _scaleRingDiameterMultiplier = 1.02f;
    [Tooltip("Arrow-ring diameter relative to the visible turbine wheel diameter. It stays just outside the scale ring.")]
    [SerializeField, Min(0.8f)] private float _arrowRingDiameterMultiplier = 1.18f;

    [Header("Appearance")]
    [Tooltip("Unlit additive material used by the rings, ticks and arrows.")]
    [SerializeField] private Material _effectMaterial;
    [SerializeField, ColorUsage(true, true)] private Color _color = new Color(0.01f, 0.78f, 1.8f, 1f);
    [SerializeField, Range(0f, 1f)] private float _opacity = 0.58f;

    [Header("Scale Ring")]
    [SerializeField, Range(24, 96)] private int _tickCount = 48;
    [SerializeField, Range(4, 16)] private int _majorTickInterval = 8;
    [SerializeField, Min(0.002f)] private float _scaleRingWidthMultiplier = 0.006f;
    [SerializeField, Min(0.002f)] private float _minorTickLengthMultiplier = 0.021f;
    [SerializeField, Min(0.002f)] private float _majorTickLengthMultiplier = 0.038f;
    [SerializeField, Min(0.002f)] private float _minorTickWidthMultiplier = 0.0035f;
    [SerializeField, Min(0.002f)] private float _majorTickWidthMultiplier = 0.006f;

    [Header("Spaced Arrow Ring")]
    [Tooltip("The dim guide circle behind the moving arrows.")]
    [SerializeField, Range(0f, 1f)] private float _arrowGuideOpacity = 0.08f;
    [SerializeField, Min(0.002f)] private float _arrowGuideWidthMultiplier = 0.006f;
    [Tooltip("Number of curved arrow segments. Each segment is deliberately separated from the next.")]
    [SerializeField, Range(3, 12)] private int _arrowCount = 6;
    [Tooltip("Portion of each arrow interval occupied by its curved body. Lower values create wider gaps.")]
    [SerializeField, Range(0.2f, 0.8f)] private float _arrowArcFill = 0.54f;
    [SerializeField, Min(0.002f)] private float _arrowTrackWidthMultiplier = 0.032f;

    [Header("Animation")]
    [Tooltip("Signed angular speed in degrees per second. Positive follows the configured shaft's local positive X rotation.")]
    [SerializeField] private float _speedDegreesPerSecond = 115f;
    [SerializeField] private bool _playOnEnable = true;
    [SerializeField] private bool _useUnscaledTime;

    private readonly List<EffectRenderer> _effectRenderers = new List<EffectRenderer>();
    private Transform _runtimeRoot;
    private Transform _scaleRingRoot;
    private Transform _arrowRingRoot;
    private Mesh _tickMesh;
    private Material _runtimeFallbackMaterial;
    private MaterialPropertyBlock _propertyBlock;
    private float _shaftDiameter;
    private float _scaleRingRadius;
    private float _arrowRingRadius;
    private float _angle;
    private bool _isPlaying;

    /// <summary>Configures the shaft references and material when the effect is added by setup tooling.</summary>
    public void Configure(Transform axisStart, Transform axisEnd, Transform wheelVisual, Transform scaleRingAnchor, Material effectMaterial)
    {
        _axisStart = axisStart;
        _axisEnd = axisEnd;
        _wheelVisual = wheelVisual;
        _scaleRingAnchor = scaleRingAnchor;
        _effectMaterial = effectMaterial;
    }

    /// <summary>Starts the direction animation without recreating the generated geometry.</summary>
    public void Play()
    {
        _isPlaying = true;
    }

    /// <summary>Pauses the direction animation at its current arrow positions.</summary>
    public void Pause()
    {
        _isPlaying = false;
    }

    private void OnEnable()
    {
        _isPlaying = _playOnEnable;
    }

    private void Start()
    {
        TryCreateVisuals();
    }

    private void Update()
    {
        if (!TryCreateVisuals() || !TryUpdateRootPose())
        {
            SetVisible(false);
            return;
        }

        SetVisible(true);
        if (_isPlaying)
        {
            float deltaTime = _useUnscaledTime ? Time.unscaledDeltaTime : Time.deltaTime;
            _angle = Mathf.Repeat(_angle + _speedDegreesPerSecond * deltaTime, 360f);
        }

        _arrowRingRoot.localRotation = Quaternion.AngleAxis(_angle, Vector3.right);
    }

    private bool TryCreateVisuals()
    {
        if (_runtimeRoot != null)
        {
            return true;
        }

        if (!HasValidAxis())
        {
            Debug.LogWarning($"[{nameof(TurbineRotationDirectionEffect)}] Missing or invalid shaft transforms; the direction effect is disabled.", this);
            return false;
        }

        Material material = ResolveMaterial();
        if (material == null)
        {
            Debug.LogWarning($"[{nameof(TurbineRotationDirectionEffect)}] Missing effect material and fallback shader.", this);
            return false;
        }

        _propertyBlock = new MaterialPropertyBlock();

        _runtimeRoot = new GameObject(RuntimeRootName).transform;
        _runtimeRoot.SetParent(transform, false);
        _runtimeRoot.gameObject.hideFlags = HideFlags.DontSave;
        TryUpdateRootPose();

        _shaftDiameter = CalculateShaftDiameter();
        float wheelDiameter = Mathf.Max(_shaftDiameter, _wheelDiameter);
        _scaleRingRadius = wheelDiameter * _scaleRingDiameterMultiplier * 0.5f;
        _arrowRingRadius = wheelDiameter * _arrowRingDiameterMultiplier * 0.5f;

        _scaleRingRoot = new GameObject("ScaleRingLayer").transform;
        _scaleRingRoot.SetParent(_runtimeRoot, false);
        float scaleAxialOffset = _scaleRingAxialOffset;
        if (_scaleRingAnchor != null)
        {
            Vector3 axis = (_axisEnd.position - _axisStart.position).normalized;
            scaleAxialOffset += Vector3.Dot(_scaleRingAnchor.position - _runtimeRoot.position, axis);
        }
        _scaleRingRoot.localPosition = new Vector3(scaleAxialOffset, _scaleRingRadialOffset.x, _scaleRingRadialOffset.y);
        _scaleRingRoot.gameObject.hideFlags = HideFlags.DontSave;

        _arrowRingRoot = new GameObject("ArrowRingLayer").transform;
        _arrowRingRoot.SetParent(_runtimeRoot, false);
        _arrowRingRoot.localPosition = new Vector3(
            scaleAxialOffset + _arrowRingAxialOffset,
            _scaleRingRadialOffset.x,
            _scaleRingRadialOffset.y);
        _arrowRingRoot.gameObject.hideFlags = HideFlags.DontSave;

        CreateRing("ScaleRing", _scaleRingRoot, _scaleRingRadius, wheelDiameter * _scaleRingWidthMultiplier, material, 0.52f, 100);
        CreateTicks(material, wheelDiameter);
        CreateRing("ArrowGuideRing", _arrowRingRoot, _arrowRingRadius, wheelDiameter * _arrowGuideWidthMultiplier, material, _arrowGuideOpacity, 101);
        CreateArrowRing(material, wheelDiameter);
        ApplyAppearance();
        return true;
    }

    private Material ResolveMaterial()
    {
        if (_effectMaterial != null)
        {
            return _effectMaterial;
        }

        Shader shader = Shader.Find("自定义/URP/汽轮机旋转方向");
        if (shader == null)
        {
            return null;
        }

        _runtimeFallbackMaterial = new Material(shader)
        {
            name = "Turbine Rotation Direction Runtime Material",
            hideFlags = HideFlags.DontSave
        };
        return _runtimeFallbackMaterial;
    }

    private bool HasValidAxis()
    {
        return _axisStart != null
            && _axisEnd != null
            && (_axisEnd.position - _axisStart.position).sqrMagnitude >= 0.0001f;
    }

    private bool TryUpdateRootPose()
    {
        if (_runtimeRoot == null || !HasValidAxis())
        {
            return false;
        }

        Vector3 axis = _axisEnd.position - _axisStart.position;
        axis.Normalize();
        Vector3 radial = Vector3.ProjectOnPlane(Vector3.up, axis);
        if (radial.sqrMagnitude < 0.0001f)
        {
            radial = Vector3.ProjectOnPlane(Vector3.forward, axis);
        }

        radial.Normalize();
        Vector3 lateral = Vector3.Cross(axis, radial).normalized;
        _runtimeRoot.position = (_axisStart.position + _axisEnd.position) * 0.5f;
        _runtimeRoot.rotation = Quaternion.LookRotation(lateral, radial);
        return true;
    }

    private float CalculateShaftDiameter()
    {
        if (!_scaleToShaftDiameter)
        {
            return _fallbackShaftDiameter;
        }

        Vector3 axis = (_axisEnd.position - _axisStart.position).normalized;
        Vector3 radial = Vector3.ProjectOnPlane(Vector3.up, axis).normalized;
        if (radial.sqrMagnitude < 0.0001f)
        {
            radial = Vector3.ProjectOnPlane(Vector3.forward, axis).normalized;
        }

        Vector3 lateral = Vector3.Cross(axis, radial).normalized;
        float shaftRadius = 0f;
        MeasureShaftRadius(_axisStart, radial, lateral, ref shaftRadius);
        MeasureShaftRadius(_axisEnd, radial, lateral, ref shaftRadius);
        return Mathf.Max(_fallbackShaftDiameter, shaftRadius * 2f);
    }

    private static void MeasureShaftRadius(Transform shaftTransform, Vector3 radial, Vector3 lateral, ref float shaftRadius)
    {
        Renderer[] renderers = shaftTransform.GetComponentsInChildren<Renderer>(true);
        for (int index = 0; index < renderers.Length; index++)
        {
            Bounds bounds = renderers[index].bounds;
            Vector3 extents = bounds.extents;
            float radialExtent = Mathf.Abs(radial.x) * extents.x + Mathf.Abs(radial.y) * extents.y + Mathf.Abs(radial.z) * extents.z;
            float lateralExtent = Mathf.Abs(lateral.x) * extents.x + Mathf.Abs(lateral.y) * extents.y + Mathf.Abs(lateral.z) * extents.z;
            shaftRadius = Mathf.Max(shaftRadius, radialExtent, lateralExtent);
        }
    }

    private void CreateRing(string name, Transform parent, float radius, float width, Material material, float opacityMultiplier, int sortingOrder)
    {
        GameObject ringObject = new GameObject(name);
        ringObject.transform.SetParent(parent, false);
        ringObject.hideFlags = HideFlags.DontSave;

        LineRenderer line = ringObject.AddComponent<LineRenderer>();
        line.useWorldSpace = false;
        line.loop = false;
        line.alignment = LineAlignment.View;
        line.positionCount = CircleSegments + 1;
        line.widthMultiplier = Mathf.Max(width, 0.01f);
        line.numCapVertices = 4;
        line.numCornerVertices = 4;
        line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        line.receiveShadows = false;
        line.sharedMaterial = material;
        line.sortingOrder = sortingOrder;
        for (int index = 0; index <= CircleSegments; index++)
        {
            float radians = index * Mathf.PI * 2f / CircleSegments;
            line.SetPosition(index, new Vector3(0f, Mathf.Cos(radians) * radius, Mathf.Sin(radians) * radius));
        }

        _effectRenderers.Add(new EffectRenderer { Renderer = line, OpacityMultiplier = opacityMultiplier });
    }

    private void CreateTicks(Material material, float wheelDiameter)
    {
        int tickCount = Mathf.Clamp(_tickCount, 24, 96);
        int majorInterval = Mathf.Clamp(_majorTickInterval, 4, tickCount);
        Vector3[] vertices = new Vector3[tickCount * 4];
        int[] triangles = new int[tickCount * 6];

        for (int index = 0; index < tickCount; index++)
        {
            bool isMajor = index % majorInterval == 0;
            float radians = index * Mathf.PI * 2f / tickCount;
            Vector3 radial = new Vector3(0f, Mathf.Cos(radians), Mathf.Sin(radians));
            Vector3 tangent = new Vector3(0f, -Mathf.Sin(radians), Mathf.Cos(radians));
            float length = wheelDiameter * (isMajor ? _majorTickLengthMultiplier : _minorTickLengthMultiplier);
            float halfWidth = wheelDiameter * (isMajor ? _majorTickWidthMultiplier : _minorTickWidthMultiplier) * 0.5f;
            Vector3 outer = radial * _scaleRingRadius;
            Vector3 inner = radial * (_scaleRingRadius - length);
            int vertexIndex = index * 4;
            vertices[vertexIndex] = inner - tangent * halfWidth;
            vertices[vertexIndex + 1] = outer - tangent * halfWidth;
            vertices[vertexIndex + 2] = outer + tangent * halfWidth;
            vertices[vertexIndex + 3] = inner + tangent * halfWidth;

            int triangleIndex = index * 6;
            triangles[triangleIndex] = vertexIndex;
            triangles[triangleIndex + 1] = vertexIndex + 1;
            triangles[triangleIndex + 2] = vertexIndex + 2;
            triangles[triangleIndex + 3] = vertexIndex;
            triangles[triangleIndex + 4] = vertexIndex + 2;
            triangles[triangleIndex + 5] = vertexIndex + 3;
        }

        _tickMesh = new Mesh { name = "Turbine Rotation Scale Ticks" };
        _tickMesh.vertices = vertices;
        _tickMesh.triangles = triangles;
        _tickMesh.RecalculateBounds();

        GameObject ticksObject = new GameObject("ScaleTicks");
        ticksObject.transform.SetParent(_scaleRingRoot, false);
        ticksObject.hideFlags = HideFlags.DontSave;
        MeshFilter meshFilter = ticksObject.AddComponent<MeshFilter>();
        meshFilter.sharedMesh = _tickMesh;
        MeshRenderer meshRenderer = ticksObject.AddComponent<MeshRenderer>();
        meshRenderer.sharedMaterial = material;
        meshRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        meshRenderer.receiveShadows = false;
        meshRenderer.sortingOrder = 102;
        _effectRenderers.Add(new EffectRenderer { Renderer = meshRenderer, OpacityMultiplier = 1f });
    }

    private void CreateArrowRing(Material material, float wheelDiameter)
    {
        GameObject arrowRingObject = new GameObject("SpacedDirectionArrows");
        arrowRingObject.transform.SetParent(_arrowRingRoot, false);
        arrowRingObject.hideFlags = HideFlags.DontSave;
        Transform arrowsRoot = arrowRingObject.transform;

        int count = Mathf.Clamp(_arrowCount, 3, 12);
        float intervalDegrees = 360f / count;
        float arcDegrees = intervalDegrees * _arrowArcFill;
        float trackWidth = Mathf.Max(wheelDiameter * _arrowTrackWidthMultiplier, 0.01f);
        for (int index = 0; index < count; index++)
        {
            GameObject arrowObject = new GameObject($"DirectionArrow_{index + 1}");
            arrowObject.transform.SetParent(arrowsRoot, false);
            arrowObject.hideFlags = HideFlags.DontSave;

            LineRenderer arrowLine = arrowObject.AddComponent<LineRenderer>();
            arrowLine.useWorldSpace = false;
            arrowLine.alignment = LineAlignment.View;
            arrowLine.widthMultiplier = trackWidth;
            arrowLine.numCapVertices = 3;
            arrowLine.numCornerVertices = 3;
            arrowLine.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            arrowLine.receiveShadows = false;
            arrowLine.sharedMaterial = material;
            arrowLine.sortingOrder = 103;
            PopulateArrowArc(arrowLine, index * intervalDegrees, arcDegrees, trackWidth, wheelDiameter);
            _effectRenderers.Add(new EffectRenderer { Renderer = arrowLine, OpacityMultiplier = 1f });
        }
    }

    private void PopulateArrowArc(LineRenderer line, float startDegrees, float arcDegrees, float trackWidth, float wheelDiameter)
    {
        const int arcSegments = 8;
        line.positionCount = arcSegments + 3;
        for (int index = 0; index <= arcSegments; index++)
        {
            float degrees = startDegrees + arcDegrees * index / arcSegments;
            float radians = degrees * Mathf.Deg2Rad;
            line.SetPosition(index, new Vector3(0f, Mathf.Cos(radians) * _arrowRingRadius, Mathf.Sin(radians) * _arrowRingRadius));
        }

        float endRadians = (startDegrees + arcDegrees) * Mathf.Deg2Rad;
        Vector3 end = new Vector3(0f, Mathf.Cos(endRadians) * _arrowRingRadius, Mathf.Sin(endRadians) * _arrowRingRadius);
        Vector3 radial = new Vector3(0f, Mathf.Cos(endRadians), Mathf.Sin(endRadians));
        Vector3 tangent = new Vector3(0f, -Mathf.Sin(endRadians), Mathf.Cos(endRadians));
        float headLength = Mathf.Max(wheelDiameter * 0.028f, trackWidth * 1.35f);
        float headWidth = Mathf.Max(wheelDiameter * 0.024f, trackWidth * 1.1f);
        line.SetPosition(arcSegments + 1, end - tangent * headLength + radial * headWidth);
        line.SetPosition(arcSegments + 2, end - tangent * headLength - radial * headWidth);
    }

    private void ApplyAppearance()
    {
        for (int index = 0; index < _effectRenderers.Count; index++)
        {
            EffectRenderer effectRenderer = _effectRenderers[index];
            _propertyBlock.SetColor(BaseColorPropertyId, _color);
            _propertyBlock.SetFloat(OpacityPropertyId, _opacity * effectRenderer.OpacityMultiplier);
            effectRenderer.Renderer.SetPropertyBlock(_propertyBlock);
        }
    }

    private void SetVisible(bool visible)
    {
        if (_runtimeRoot != null && _runtimeRoot.gameObject.activeSelf != visible)
        {
            _runtimeRoot.gameObject.SetActive(visible);
        }
    }

    private void OnDestroy()
    {
        if (_tickMesh != null)
        {
            Destroy(_tickMesh);
        }

        if (_runtimeFallbackMaterial != null)
        {
            Destroy(_runtimeFallbackMaterial);
        }
    }
}

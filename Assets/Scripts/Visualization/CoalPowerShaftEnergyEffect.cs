using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// Builds a holographic energy layer around the coal-power turbine and generator shafts.
/// The source meshes and materials remain untouched; all visual geometry is generated at runtime.
/// </summary>
[DisallowMultipleComponent]
public sealed class CoalPowerShaftEnergyEffect : MonoBehaviour
{
    private const string RuntimeRootName = "__CoalPowerShaftEnergyEffect";
    private const int RingSegments = 64;
    private const int HelixSegments = 96;
    private static readonly int BaseColorPropertyId = Shader.PropertyToID("_BaseColor");
    private static readonly int OpacityPropertyId = Shader.PropertyToID("_Opacity");
    private static readonly int SoftEdgesPropertyId = Shader.PropertyToID("_SoftEdges");
    private static readonly int SurfaceModePropertyId = Shader.PropertyToID("_SurfaceMode");
    private static readonly int AnimationTimePropertyId = Shader.PropertyToID("_AnimationTime");
    private static readonly int AxialGradientPropertyId = Shader.PropertyToID("_AxialGradient");
    private static readonly int CentreColorPropertyId = Shader.PropertyToID("_CentreColor");
    private static readonly int AxialHalfLengthPropertyId = Shader.PropertyToID("_AxialHalfLength");
    private static readonly int AxialCentrePropertyId = Shader.PropertyToID("_AxialCentre");
    private static readonly int EndBrightnessPropertyId = Shader.PropertyToID("_EndBrightness");
    private static readonly int CentreWidthPropertyId = Shader.PropertyToID("_CentreWidth");

    private sealed class ShaftVisual
    {
        public Transform Target;
        public Transform Root;
        public Transform HelixRoot;
        public Transform[] RingRoots;
        public Transform PulseRoot;
        public Renderer SurfaceRenderer;
        public float HalfLength;
        public float CentreOffset;
        public float Phase;
    }

    [Header("Shaft Targets")]
    [Tooltip("Independent turbine and generator shaft transforms that receive the holographic energy layer.")]
    [SerializeField] private Transform[] _shaftTargets = Array.Empty<Transform>();

    [Header("Material and Colour")]
    [Tooltip("Dedicated additive shaft-energy material; source rotor materials are not changed.")]
    [SerializeField] private Material _effectMaterial;
    [SerializeField, ColorUsage(true, true)] private Color _energyColor = new Color(0.15f, 0.95f, 2.4f, 1f);
    [SerializeField, ColorUsage(true, true)] private Color _accentColor = new Color(2.8f, 0.32f, 0.19f, 1f);
    [SerializeField, Range(0f, 1f)] private float _overallOpacity = 0.62f;
    [SerializeField, Range(0f, 1f)] private float _surfaceOpacity = 0.22f;
    [SerializeField, ColorUsage(true, true)] private Color _turbineCentreColor = new Color(4.2f, 0.72f, 0.52f, 1f);
    [SerializeField, Range(0f, 1f)] private float _turbineEndBrightness = 0.34f;
    [SerializeField, Range(0.1f, 1f)] private float _turbineCentreWidth = 0.68f;

    [Header("Energy Sleeve")]
    [SerializeField, Min(0.5f)] private float _lengthMultiplier = 0.94f;
    [SerializeField, Min(0.5f)] private float _radiusMultiplier = 1.025f;
    [SerializeField, Range(0f, 0.25f)] private float _sleeveOpacity = 0.014f;
    [SerializeField, Min(0.002f)] private float _railWidthMultiplier = 0.012f;
    [SerializeField, Min(0.002f)] private float _coreWidthMultiplier = 0.045f;

    [Header("Rotating Energy")]
    [SerializeField, Range(2, 8)] private int _ringCount = 4;
    [SerializeField, Range(2, 6)] private int _arcsPerRing = 3;
    [SerializeField, Range(0.2f, 0.85f)] private float _arcFill = 0.5f;
    [SerializeField, Min(0.002f)] private float _ringWidthMultiplier = 0.03f;
    [SerializeField, Range(1, 4)] private int _helixStrands = 1;
    [SerializeField, Range(1f, 8f)] private float _helixTurns = 2.5f;
    [SerializeField, Min(0.002f)] private float _helixWidthMultiplier = 0.018f;

    [Header("Animation")]
    [Tooltip("Signed angular speed for the segmented rings and helices.")]
    [SerializeField] private float _rotationSpeedDegreesPerSecond = 155f;
    [Tooltip("Number of full shaft-length scans per second.")]
    [SerializeField, Min(0f)] private float _pulseTravelSpeed = 0.42f;
    [SerializeField] private bool _playOnEnable = true;
    [SerializeField] private bool _useUnscaledTime;
    [Tooltip("Follow the shaft controller: changing its speed or pausing also affects the energy animation.")]
    [SerializeField] private bool _syncWithShaftRotation = true;

    private readonly List<ShaftVisual> _visuals = new List<ShaftVisual>();
    private readonly List<Mesh> _runtimeMeshes = new List<Mesh>();
    private Transform _runtimeRoot;
    private Material _runtimeFallbackMaterial;
    private MaterialPropertyBlock _propertyBlock;
    private float _animationTime;
    private bool _isPlaying;
    private bool _creationAttempted;
    private bool _appearanceDirty;
    private CoalPowerShaftRotationController _rotationController;

    /// <summary>Stores the shaft references and effect material on the owning prefab.</summary>
    public void Configure(Transform[] shaftTargets, Material effectMaterial)
    {
        _shaftTargets = shaftTargets ?? Array.Empty<Transform>();
        _effectMaterial = effectMaterial;
    }

    /// <summary>Configures a balanced red-turbine / blue-generator presentation for setup tooling.</summary>
    public void ConfigureAppearance(
        Color energyColor,
        Color accentColor,
        float overallOpacity,
        float surfaceOpacity,
        float radiusMultiplier,
        float sleeveOpacity,
        float railWidthMultiplier,
        float coreWidthMultiplier,
        float arcFill,
        float ringWidthMultiplier,
        int helixStrands,
        float helixTurns,
        float helixWidthMultiplier)
    {
        _energyColor = energyColor;
        _accentColor = accentColor;
        _overallOpacity = overallOpacity;
        _surfaceOpacity = surfaceOpacity;
        _radiusMultiplier = radiusMultiplier;
        _sleeveOpacity = sleeveOpacity;
        _railWidthMultiplier = railWidthMultiplier;
        _coreWidthMultiplier = coreWidthMultiplier;
        _arcFill = arcFill;
        _ringWidthMultiplier = ringWidthMultiplier;
        _helixStrands = helixStrands;
        _helixTurns = helixTurns;
        _helixWidthMultiplier = helixWidthMultiplier;
    }

    public void Play()
    {
        _isPlaying = true;
    }

    public void Pause()
    {
        _isPlaying = false;
    }

    private void OnEnable()
    {
        _isPlaying = _playOnEnable;
        _rotationController = GetComponent<CoalPowerShaftRotationController>();
    }

    private void Start()
    {
        TryCreateVisuals();
    }

    private void Update()
    {
        if (_appearanceDirty)
        {
            ReleaseVisuals();
            _appearanceDirty = false;
        }
        if (!TryCreateVisuals())
            return;

        float deltaTime = _useUnscaledTime ? Time.unscaledDeltaTime : Time.deltaTime;
        if (_syncWithShaftRotation && _rotationController != null)
            deltaTime *= _rotationController.CurrentSpeedDegreesPerSecond / 360f;
        if (_isPlaying)
            _animationTime += deltaTime;

        float angle = _animationTime * _rotationSpeedDegreesPerSecond;
        for (int index = 0; index < _visuals.Count; index++)
        {
            ShaftVisual visual = _visuals[index];
            bool visible = visual.Target != null && visual.Target.gameObject.activeInHierarchy;
            if (visual.Root.gameObject.activeSelf != visible)
                visual.Root.gameObject.SetActive(visible);
            if (!visible)
                continue;

            UpdateRootPose(visual.Target, visual.Root);
            visual.Root.position += visual.Root.right * visual.CentreOffset;
            visual.HelixRoot.localRotation = Quaternion.AngleAxis(angle * (index % 2 == 0 ? 1f : -0.82f), Vector3.right);

            for (int ringIndex = 0; ringIndex < visual.RingRoots.Length; ringIndex++)
            {
                float direction = (ringIndex & 1) == 0 ? 1f : -1f;
                visual.RingRoots[ringIndex].localRotation = Quaternion.AngleAxis(
                    angle * direction * (1f + ringIndex * 0.07f) + ringIndex * 23f,
                    Vector3.right);
            }

            float travel = Mathf.Repeat(_animationTime * _pulseTravelSpeed + visual.Phase, 1f);
            if (visual.SurfaceRenderer != null)
            {
                visual.SurfaceRenderer.GetPropertyBlock(_propertyBlock);
                _propertyBlock.SetFloat(AnimationTimePropertyId, _animationTime + visual.Phase * 2f);
                visual.SurfaceRenderer.SetPropertyBlock(_propertyBlock);
            }
            visual.PulseRoot.localPosition = new Vector3(Mathf.Lerp(-visual.HalfLength, visual.HalfLength, travel), 0f, 0f);
            float pulseScale = 0.9f + Mathf.Sin(travel * Mathf.PI) * 0.22f;
            visual.PulseRoot.localScale = new Vector3(1f, pulseScale, pulseScale);
        }
    }

    private bool TryCreateVisuals()
    {
        if (_creationAttempted)
            return _visuals.Count > 0;
        _creationAttempted = true;

        Material material = ResolveMaterial();
        if (material == null || _shaftTargets == null || _shaftTargets.Length == 0)
            return false;

        _propertyBlock = new MaterialPropertyBlock();
        _runtimeRoot = new GameObject(RuntimeRootName).transform;
        _runtimeRoot.SetParent(transform, false);
        _runtimeRoot.gameObject.hideFlags = HideFlags.DontSave;

        for (int index = 0; index < _shaftTargets.Length; index++)
        {
            Transform target = _shaftTargets[index];
            if (target == null || !TryMeasureShaft(target, out float centreOffset, out float length, out float radius))
                continue;

            CreateShaftVisual(target, centreOffset, length, radius, index, material);
        }

        if (_visuals.Count == 0)
        {
            Debug.LogWarning($"[{nameof(CoalPowerShaftEnergyEffect)}] No measurable shaft renderers were found; the effect is disabled.", this);
            return false;
        }

        return true;
    }

    private Material ResolveMaterial()
    {
        if (_effectMaterial != null)
            return _effectMaterial;

        Shader shader = Shader.Find("Custom/URP/Coal Shaft Energy");
        if (shader == null)
        {
            Debug.LogWarning($"[{nameof(CoalPowerShaftEnergyEffect)}] Missing effect material and fallback shader.", this);
            return null;
        }

        _runtimeFallbackMaterial = new Material(shader)
        {
            name = "Coal Shaft Energy Runtime Material",
            hideFlags = HideFlags.DontSave
        };
        return _runtimeFallbackMaterial;
    }

    private void CreateShaftVisual(Transform target, float centreOffset, float measuredLength, float measuredRadius, int index, Material material)
    {
        float length = Mathf.Max(0.1f, measuredLength * _lengthMultiplier);
        float radius = Mathf.Max(0.05f, measuredRadius * _radiusMultiplier);
        float halfLength = length * 0.5f;

        Transform root = new GameObject($"ShaftEnergy_{target.name}").transform;
        root.SetParent(_runtimeRoot, false);
        root.gameObject.hideFlags = HideFlags.DontSave;
        UpdateRootPose(target, root);
        root.position += root.right * centreOffset;

        Color shaftColor = index < 2 ? _accentColor : _energyColor;
        CreateRotorSurfaceOverlay(target, material, index, out Renderer surfaceRenderer);
        CreateSleeve(root, halfLength, radius, material);
        CreateAxialLine("EnergyCoreGlow", root, halfLength, radius * _coreWidthMultiplier * 3.2f, material, _energyColor, _overallOpacity * 0.18f, 120);
        CreateAxialLine("EnergyCore", root, halfLength, radius * _coreWidthMultiplier, material, _accentColor, _overallOpacity * 0.9f, 124);
        CreateRails(root, halfLength, radius, material);

        Transform helixRoot = new GameObject("RotatingHelices").transform;
        helixRoot.SetParent(root, false);
        helixRoot.gameObject.hideFlags = HideFlags.DontSave;
        CreateHelices(helixRoot, halfLength, radius, material, shaftColor);

        int ringCount = Mathf.Clamp(_ringCount, 2, 8);
        Transform[] ringRoots = new Transform[ringCount];
        for (int ringIndex = 0; ringIndex < ringCount; ringIndex++)
        {
            Transform ringRoot = new GameObject($"EnergyRing_{ringIndex + 1}").transform;
            ringRoot.SetParent(root, false);
            ringRoot.localPosition = new Vector3(Mathf.Lerp(-halfLength * 0.86f, halfLength * 0.86f, ringCount == 1 ? 0.5f : ringIndex / (float)(ringCount - 1)), 0f, 0f);
            ringRoot.gameObject.hideFlags = HideFlags.DontSave;
            CreateSegmentedRing(ringRoot, radius * (1.03f + (ringIndex & 1) * 0.06f), material, shaftColor);
            ringRoots[ringIndex] = ringRoot;
        }

        Transform pulseRoot = new GameObject("TravellingPulse").transform;
        pulseRoot.SetParent(root, false);
        pulseRoot.gameObject.hideFlags = HideFlags.DontSave;
        CreateRing("PulseGlow", pulseRoot, radius * 1.2f, radius * _ringWidthMultiplier * 3f, material, _energyColor, _overallOpacity * 0.16f, 121);
        CreateRing("PulseCore", pulseRoot, radius * 1.13f, radius * _ringWidthMultiplier * 0.75f, material, Color.Lerp(_energyColor, Color.white, 0.4f), _overallOpacity, 126);

        _visuals.Add(new ShaftVisual
        {
            Target = target,
            Root = root,
            HelixRoot = helixRoot,
            RingRoots = ringRoots,
            PulseRoot = pulseRoot,
            SurfaceRenderer = surfaceRenderer,
            HalfLength = halfLength,
            CentreOffset = centreOffset,
            Phase = index / Mathf.Max(1f, _shaftTargets.Length)
        });
    }

    private void CreateRotorSurfaceOverlay(Transform target, Material material, int shaftIndex, out Renderer overlayRenderer)
    {
        overlayRenderer = null;
        MeshFilter sourceFilter = target.GetComponent<MeshFilter>();
        Renderer sourceRenderer = target.GetComponent<Renderer>();
        if (sourceFilter == null || sourceFilter.sharedMesh == null || sourceRenderer == null)
            return;

        GameObject overlay = new GameObject("RotorSurfaceGlow");
        overlay.transform.SetParent(target, false);
        overlay.hideFlags = HideFlags.DontSave;
        overlay.AddComponent<MeshFilter>().sharedMesh = sourceFilter.sharedMesh;
        MeshRenderer renderer = overlay.AddComponent<MeshRenderer>();
        Color surfaceColor = shaftIndex < 2 ? _accentColor : _energyColor;
        ConfigureRenderer(renderer, material, surfaceColor, _surfaceOpacity, 110, true);
        if (shaftIndex < 2)
        {
            renderer.GetPropertyBlock(_propertyBlock);
            _propertyBlock.SetFloat(AxialGradientPropertyId, 1f);
            _propertyBlock.SetColor(CentreColorPropertyId, _turbineCentreColor);
            Bounds bounds = sourceFilter.sharedMesh.bounds;
            _propertyBlock.SetFloat(AxialCentrePropertyId, bounds.center.x);
            _propertyBlock.SetFloat(AxialHalfLengthPropertyId, Mathf.Max(bounds.extents.x, 0.001f));
            _propertyBlock.SetFloat(EndBrightnessPropertyId, _turbineEndBrightness);
            _propertyBlock.SetFloat(CentreWidthPropertyId, _turbineCentreWidth);
            renderer.SetPropertyBlock(_propertyBlock);
        }
        // Every source submesh needs an overlay material slot.
        var materials = new Material[sourceFilter.sharedMesh.subMeshCount];
        for (int i = 0; i < materials.Length; i++) materials[i] = material;
        renderer.sharedMaterials = materials;
        overlayRenderer = renderer;
    }

    private void CreateSleeve(Transform parent, float halfLength, float radius, Material material)
    {
        const int sides = 32;
        Vector3[] vertices = new Vector3[(sides + 1) * 2];
        int[] triangles = new int[sides * 6];
        for (int side = 0; side <= sides; side++)
        {
            float radians = side * Mathf.PI * 2f / sides;
            float y = Mathf.Cos(radians) * radius;
            float z = Mathf.Sin(radians) * radius;
            vertices[side * 2] = new Vector3(-halfLength, y, z);
            vertices[side * 2 + 1] = new Vector3(halfLength, y, z);
            if (side == sides)
                continue;

            int vertex = side * 2;
            int triangle = side * 6;
            triangles[triangle] = vertex;
            triangles[triangle + 1] = vertex + 1;
            triangles[triangle + 2] = vertex + 3;
            triangles[triangle + 3] = vertex;
            triangles[triangle + 4] = vertex + 3;
            triangles[triangle + 5] = vertex + 2;
        }

        Mesh mesh = new Mesh { name = "Coal Shaft Energy Sleeve" };
        mesh.vertices = vertices;
        mesh.triangles = triangles;
        mesh.RecalculateBounds();
        _runtimeMeshes.Add(mesh);

        GameObject sleeve = new GameObject("EnergySleeve");
        sleeve.transform.SetParent(parent, false);
        sleeve.hideFlags = HideFlags.DontSave;
        sleeve.AddComponent<MeshFilter>().sharedMesh = mesh;
        MeshRenderer renderer = sleeve.AddComponent<MeshRenderer>();
        ConfigureRenderer(renderer, material, _energyColor, _overallOpacity * _sleeveOpacity, 112);
    }

    private void CreateRails(Transform parent, float halfLength, float radius, Material material)
    {
        for (int index = 0; index < 4; index++)
        {
            float radians = index * Mathf.PI * 0.5f;
            float y = Mathf.Cos(radians) * radius;
            float z = Mathf.Sin(radians) * radius;
            LineRenderer line = CreateLine($"EnergyRail_{index + 1}", parent, material, radius * _railWidthMultiplier, _energyColor, _overallOpacity * 0.42f, 118);
            line.positionCount = 2;
            line.SetPosition(0, new Vector3(-halfLength, y, z));
            line.SetPosition(1, new Vector3(halfLength, y, z));
        }
    }

    private void CreateAxialLine(string name, Transform parent, float halfLength, float width, Material material, Color color, float opacity, int sortingOrder)
    {
        LineRenderer line = CreateLine(name, parent, material, width, color, opacity, sortingOrder);
        line.positionCount = 2;
        line.SetPosition(0, new Vector3(-halfLength, 0f, 0f));
        line.SetPosition(1, new Vector3(halfLength, 0f, 0f));
    }

    private void CreateHelices(Transform parent, float halfLength, float radius, Material material, Color color)
    {
        int strandCount = Mathf.Clamp(_helixStrands, 1, 4);
        for (int strand = 0; strand < strandCount; strand++)
        {
            LineRenderer line = CreateLine($"EnergyHelix_{strand + 1}", parent, material, radius * _helixWidthMultiplier, color, _overallOpacity * 0.4f, 122);
            line.positionCount = HelixSegments + 1;
            float phase = strand * Mathf.PI * 2f / strandCount;
            for (int point = 0; point <= HelixSegments; point++)
            {
                float t = point / (float)HelixSegments;
                float radians = phase + t * Mathf.PI * 2f * _helixTurns;
                line.SetPosition(point, new Vector3(Mathf.Lerp(-halfLength, halfLength, t), Mathf.Cos(radians) * radius, Mathf.Sin(radians) * radius));
            }
        }
    }

    private void CreateSegmentedRing(Transform parent, float radius, Material material, Color color)
    {
        int arcCount = Mathf.Clamp(_arcsPerRing, 2, 6);
        float interval = 360f / arcCount;
        float arcDegrees = interval * _arcFill;
        for (int arc = 0; arc < arcCount; arc++)
        {
            LineRenderer line = CreateLine($"Arc_{arc + 1}", parent, material, radius * _ringWidthMultiplier, color, _overallOpacity * 0.78f, 125);
            PopulateArc(line, radius, arc * interval, arcDegrees);
        }
    }

    private static void PopulateArc(LineRenderer line, float radius, float startDegrees, float arcDegrees)
    {
        const int segments = 12;
        line.positionCount = segments + 1;
        for (int point = 0; point <= segments; point++)
        {
            float radians = (startDegrees + arcDegrees * point / segments) * Mathf.Deg2Rad;
            line.SetPosition(point, new Vector3(0f, Mathf.Cos(radians) * radius, Mathf.Sin(radians) * radius));
        }
    }

    private void CreateRing(string name, Transform parent, float radius, float width, Material material, Color color, float opacity, int sortingOrder)
    {
        LineRenderer line = CreateLine(name, parent, material, width, color, opacity, sortingOrder);
        line.loop = true;
        line.positionCount = RingSegments;
        for (int point = 0; point < RingSegments; point++)
        {
            float radians = point * Mathf.PI * 2f / RingSegments;
            line.SetPosition(point, new Vector3(0f, Mathf.Cos(radians) * radius, Mathf.Sin(radians) * radius));
        }
    }

    private LineRenderer CreateLine(string name, Transform parent, Material material, float width, Color color, float opacity, int sortingOrder)
    {
        GameObject lineObject = new GameObject(name);
        lineObject.transform.SetParent(parent, false);
        lineObject.hideFlags = HideFlags.DontSave;
        LineRenderer line = lineObject.AddComponent<LineRenderer>();
        line.useWorldSpace = false;
        line.alignment = LineAlignment.View;
        line.widthMultiplier = Mathf.Max(0.006f, width);
        line.numCapVertices = 3;
        line.numCornerVertices = 3;
        line.shadowCastingMode = ShadowCastingMode.Off;
        line.receiveShadows = false;
        ConfigureRenderer(line, material, color, opacity, sortingOrder);
        return line;
    }

    private void ConfigureRenderer(Renderer renderer, Material material, Color color, float opacity, int sortingOrder, bool surfaceMode = false)
    {
        renderer.sharedMaterial = material;
        renderer.sortingOrder = sortingOrder;
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        _propertyBlock.Clear();
        _propertyBlock.SetColor(BaseColorPropertyId, color);
        _propertyBlock.SetFloat(OpacityPropertyId, Mathf.Clamp01(opacity));
        _propertyBlock.SetFloat(SoftEdgesPropertyId, renderer is LineRenderer ? 1f : 0f);
        _propertyBlock.SetFloat(SurfaceModePropertyId, surfaceMode ? 1f : 0f);
        renderer.SetPropertyBlock(_propertyBlock);
    }

    private static bool TryMeasureShaft(Transform target, out float centreOffset, out float length, out float radius)
    {
        centreOffset = 0f;
        length = 0f;
        radius = 0f;
        // Imported bounds are available without Read/Write and do not inflate as the rotor turns.
        MeshFilter filter = target.GetComponent<MeshFilter>();
        if (filter != null && filter.sharedMesh != null)
        {
            Bounds meshBounds = filter.sharedMesh.bounds;
            Vector3 scale = target.lossyScale;
            centreOffset = meshBounds.center.x * scale.x;
            length = meshBounds.size.x * Mathf.Abs(scale.x);
            radius = Mathf.Max(
                (Mathf.Abs(meshBounds.center.y) + meshBounds.extents.y) * Mathf.Abs(scale.y),
                (Mathf.Abs(meshBounds.center.z) + meshBounds.extents.z) * Mathf.Abs(scale.z));
            return length > 0.01f && radius > 0.01f;
        }
        Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
        if (renderers.Length == 0)
            return false;

        Vector3 axis = target.right.normalized;
        Vector3 radial = Vector3.ProjectOnPlane(Vector3.up, axis);
        if (radial.sqrMagnitude < 0.0001f)
            radial = Vector3.ProjectOnPlane(Vector3.forward, axis);
        radial.Normalize();
        Vector3 lateral = Vector3.Cross(axis, radial).normalized;
        Vector3 origin = target.position;
        float minAxis = float.PositiveInfinity;
        float maxAxis = float.NegativeInfinity;

        for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
        {
            Bounds bounds = renderers[rendererIndex].bounds;
            Vector3 min = bounds.min;
            Vector3 max = bounds.max;
            for (int corner = 0; corner < 8; corner++)
            {
                Vector3 point = new Vector3(
                    (corner & 1) == 0 ? min.x : max.x,
                    (corner & 2) == 0 ? min.y : max.y,
                    (corner & 4) == 0 ? min.z : max.z);
                Vector3 offset = point - origin;
                float axial = Vector3.Dot(offset, axis);
                minAxis = Mathf.Min(minAxis, axial);
                maxAxis = Mathf.Max(maxAxis, axial);
                radius = Mathf.Max(radius, Mathf.Abs(Vector3.Dot(offset, radial)), Mathf.Abs(Vector3.Dot(offset, lateral)));
            }
        }

        centreOffset = (minAxis + maxAxis) * 0.5f;
        length = maxAxis - minAxis;
        return length > 0.01f && radius > 0.01f;
    }

    private static void UpdateRootPose(Transform target, Transform root)
    {
        Vector3 axis = target.right.normalized;
        Vector3 radial = Vector3.ProjectOnPlane(Vector3.up, axis);
        if (radial.sqrMagnitude < 0.0001f)
            radial = Vector3.ProjectOnPlane(Vector3.forward, axis);
        radial.Normalize();
        Vector3 lateral = Vector3.Cross(axis, radial).normalized;
        root.position = target.position;
        root.rotation = Quaternion.LookRotation(lateral, radial);
    }

    private void OnValidate()
    {
        _appearanceDirty = true;
    }

    private void OnDisable()
    {
        ReleaseVisuals();
    }

    private void OnDestroy()
    {
        ReleaseVisuals();
    }

    private void ReleaseVisuals()
    {
        foreach (ShaftVisual visual in _visuals)
        {
            if (visual.SurfaceRenderer != null)
            {
                visual.SurfaceRenderer.gameObject.SetActive(false);
                Destroy(visual.SurfaceRenderer.gameObject);
            }
        }
        _visuals.Clear();
        if (_runtimeRoot != null)
        {
            _runtimeRoot.gameObject.SetActive(false);
            Destroy(_runtimeRoot.gameObject);
            _runtimeRoot = null;
        }
        for (int index = 0; index < _runtimeMeshes.Count; index++)
        {
            if (_runtimeMeshes[index] != null)
                Destroy(_runtimeMeshes[index]);
        }
        _runtimeMeshes.Clear();
        if (_runtimeFallbackMaterial != null)
            Destroy(_runtimeFallbackMaterial);
        _runtimeFallbackMaterial = null;
        _creationAttempted = false;
    }
}

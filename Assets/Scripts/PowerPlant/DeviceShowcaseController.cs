using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;

[DisallowMultipleComponent]
public sealed class DeviceShowcaseController : MonoBehaviour
{
    [Header("场景引用")]
    [SerializeField] private Transform _sceneRoot;
    [SerializeField] private Camera _showcaseCamera;

    [Header("默认展示")]
    [SerializeField] private bool _showOnStart = true;
    [SerializeField] private string _defaultDeviceId = "燃气轮机1";

    [Header("展台效果")]
    [SerializeField, Range(35f, 75f)] private float _showcaseFieldOfView = 50f;
    [SerializeField, Min(1f)] private float _stagePadding = 7f;
    [SerializeField, Min(1f)] private float _minimumStageRadius = 16f;
    [SerializeField, Min(1f)] private float _maximumStageRadius = 70f;
    [SerializeField, Min(1f)] private float _arrowOrbitSpeed = 18f;

    private readonly List<GameObject> _devices = new List<GameObject>();
    private readonly Dictionary<Renderer, bool> _sceneRendererStates = new Dictionary<Renderer, bool>();
    private readonly List<Renderer> _sceneRenderers = new List<Renderer>();
    private readonly List<LightState> _sceneLightStates = new List<LightState>();

    private Transform _showcaseRoot;
    private Transform _displayRoot;
    private Transform _stageRoot;
    private Transform _orbitRoot;
    private GameObject _displayInstance;
    private Material _floorMaterial;
    private Material _gridMaterial;
    private CameraClearFlags _initialClearFlags;
    private Color _initialBackgroundColor;
    private float _initialFieldOfView;
    private Color _initialAmbientLight;
    private bool _environmentCached;
    private bool _isShowcaseActive;
    private int _currentDeviceIndex = -1;

    private readonly struct LightState
    {
        public readonly Light Light;
        public readonly bool Enabled;

        public LightState(Light light)
        {
            Light = light;
            Enabled = light.enabled;
        }
    }

    public bool IsShowcaseActive => _isShowcaseActive;
    public string CurrentDeviceId => _currentDeviceIndex >= 0 && _currentDeviceIndex < _devices.Count ? _devices[_currentDeviceIndex].name : string.Empty;
    public IReadOnlyList<GameObject> Devices => _devices;

    private void Awake()
    {
        CacheDevices();
    }

    private void Start()
    {
        if (_showOnStart && _devices.Count > 0)
        {
            TryShowDevice(_defaultDeviceId, out _);
        }
    }

    private void Update()
    {
        if (_orbitRoot != null)
        {
            _orbitRoot.Rotate(Vector3.up, _arrowOrbitSpeed * Time.unscaledDeltaTime, Space.Self);
        }

        HandleKeyboardShortcuts();
    }

    private void OnDestroy()
    {
        ExitShowcase();
    }

    public bool TryShowDevice(string deviceId, out string message)
    {
        if (!TryFindDeviceIndex(deviceId, out int deviceIndex))
        {
            message = $"未找到展示设备：{deviceId}";
            return false;
        }

        ShowDevice(deviceIndex);
        message = $"已切换设备展台：{CurrentDeviceId}";
        return true;
    }

    public bool ShowNextDevice(out string message)
    {
        if (_devices.Count == 0)
        {
            message = "场景中没有可展示设备。";
            return false;
        }

        int nextIndex = _currentDeviceIndex < 0 ? 0 : (_currentDeviceIndex + 1) % _devices.Count;
        ShowDevice(nextIndex);
        message = $"已切换设备展台：{CurrentDeviceId}";
        return true;
    }

    public bool ShowPreviousDevice(out string message)
    {
        if (_devices.Count == 0)
        {
            message = "场景中没有可展示设备。";
            return false;
        }

        int previousIndex = _currentDeviceIndex <= 0 ? _devices.Count - 1 : _currentDeviceIndex - 1;
        ShowDevice(previousIndex);
        message = $"已切换设备展台：{CurrentDeviceId}";
        return true;
    }

    public void ExitShowcase()
    {
        if (!_isShowcaseActive)
        {
            return;
        }

        RestoreSceneRenderers();
        RestoreEnvironment();
        DestroyShowcaseRoot();
        _isShowcaseActive = false;
        _currentDeviceIndex = -1;
    }

    private void ShowDevice(int deviceIndex)
    {
        CacheEnvironment();
        EnsureShowcaseRoot();
        HideSceneRenderers();
        ActivateShowcaseEnvironment();
        DestroyDisplayInstance();

        _currentDeviceIndex = deviceIndex;
        GameObject source = _devices[deviceIndex];
        _displayInstance = Instantiate(source, _displayRoot);
        _displayInstance.name = $"{source.name}（展示副本）";
        _displayInstance.SetActive(true);
        SetDisplayRenderersEnabled(_displayInstance, true);

        Bounds displayBounds = CalculateBounds(_displayInstance);
        _displayInstance.transform.position -= displayBounds.center;
        displayBounds = CalculateBounds(_displayInstance);
        _displayInstance.transform.position += Vector3.up * (0.08f - displayBounds.min.y);
        displayBounds = CalculateBounds(_displayInstance);

        float stageRadius = Mathf.Clamp(
            Mathf.Max(displayBounds.extents.x, displayBounds.extents.z) + _stagePadding,
            _minimumStageRadius,
            _maximumStageRadius);
        RebuildStage(stageRadius);
        FrameCamera(displayBounds, stageRadius);
        _showcaseCamera?.GetComponent<DeviceShowcaseCameraController>()?.Focus(displayBounds);
        _isShowcaseActive = true;
    }

    private void CacheDevices()
    {
        _devices.Clear();
        if (_sceneRoot == null)
        {
            _sceneRoot = GameObject.Find("场景")?.transform;
        }

        if (_sceneRoot == null)
        {
            return;
        }

        for (int index = 0; index < _sceneRoot.childCount; index++)
        {
            GameObject candidate = _sceneRoot.GetChild(index).gameObject;
            if (candidate.name.StartsWith("地面", StringComparison.Ordinal) || candidate.GetComponentInChildren<Renderer>(true) == null)
            {
                continue;
            }

            _devices.Add(candidate);
        }

        if (_sceneRoot.GetComponentInChildren<Renderer>(true) != null && !_devices.Contains(_sceneRoot.gameObject))
        {
            _devices.Insert(0, _sceneRoot.gameObject);
        }
    }

    private bool TryFindDeviceIndex(string deviceId, out int deviceIndex)
    {
        if (_devices.Count == 0)
        {
            CacheDevices();
        }

        if (string.IsNullOrWhiteSpace(deviceId))
        {
            deviceIndex = -1;
            return false;
        }

        for (int index = 0; index < _devices.Count; index++)
        {
            if (string.Equals(_devices[index].name, deviceId, StringComparison.OrdinalIgnoreCase))
            {
                deviceIndex = index;
                return true;
            }
        }

        deviceIndex = -1;
        return false;
    }

    private void CacheEnvironment()
    {
        if (_environmentCached)
        {
            return;
        }

        if (_showcaseCamera == null)
        {
            _showcaseCamera = Camera.main;
        }

        if (_showcaseCamera != null)
        {
            _initialClearFlags = _showcaseCamera.clearFlags;
            _initialBackgroundColor = _showcaseCamera.backgroundColor;
            _initialFieldOfView = _showcaseCamera.fieldOfView;
        }

        _initialAmbientLight = RenderSettings.ambientLight;
        _sceneRenderers.Clear();
        _sceneRendererStates.Clear();
        if (_sceneRoot != null)
        {
            Renderer[] renderers = _sceneRoot.GetComponentsInChildren<Renderer>(true);
            for (int index = 0; index < renderers.Length; index++)
            {
                Renderer renderer = renderers[index];
                if (renderer == null)
                {
                    continue;
                }

                _sceneRenderers.Add(renderer);
                _sceneRendererStates[renderer] = renderer.enabled;
            }
        }

        _sceneLightStates.Clear();
        Light[] lights = FindObjectsByType<Light>(FindObjectsInactive.Include, FindObjectsSortMode.None);
        for (int index = 0; index < lights.Length; index++)
        {
            _sceneLightStates.Add(new LightState(lights[index]));
        }

        _environmentCached = true;
    }

    private void HideSceneRenderers()
    {
        for (int index = 0; index < _sceneRenderers.Count; index++)
        {
            if (_sceneRenderers[index] != null)
            {
                _sceneRenderers[index].enabled = false;
            }
        }
    }

    private void RestoreSceneRenderers()
    {
        for (int index = 0; index < _sceneRenderers.Count; index++)
        {
            Renderer renderer = _sceneRenderers[index];
            if (renderer != null && _sceneRendererStates.TryGetValue(renderer, out bool wasEnabled))
            {
                renderer.enabled = wasEnabled;
            }
        }
    }

    private void ActivateShowcaseEnvironment()
    {
        if (_showcaseCamera != null)
        {
            _showcaseCamera.clearFlags = CameraClearFlags.SolidColor;
            _showcaseCamera.backgroundColor = new Color(0.008f, 0.014f, 0.024f, 1f);
            _showcaseCamera.fieldOfView = _showcaseFieldOfView;
        }

        RenderSettings.ambientLight = new Color(0.18f, 0.18f, 0.19f, 1f);
        for (int index = 0; index < _sceneLightStates.Count; index++)
        {
            if (_sceneLightStates[index].Light != null)
            {
                _sceneLightStates[index].Light.enabled = false;
            }
        }
    }

    private void RestoreEnvironment()
    {
        if (!_environmentCached)
        {
            return;
        }

        if (_showcaseCamera != null)
        {
            _showcaseCamera.clearFlags = _initialClearFlags;
            _showcaseCamera.backgroundColor = _initialBackgroundColor;
            _showcaseCamera.fieldOfView = _initialFieldOfView;
        }

        RenderSettings.ambientLight = _initialAmbientLight;
        for (int index = 0; index < _sceneLightStates.Count; index++)
        {
            LightState state = _sceneLightStates[index];
            if (state.Light != null)
            {
                state.Light.enabled = state.Enabled;
            }
        }

        _environmentCached = false;
    }

    private void EnsureShowcaseRoot()
    {
        if (_showcaseRoot != null)
        {
            return;
        }

        GameObject root = new GameObject("设备数字孪生展台（运行时）");
        root.hideFlags = HideFlags.DontSave;
        _showcaseRoot = root.transform;

        _displayRoot = new GameObject("主展示设备").transform;
        _displayRoot.SetParent(_showcaseRoot, false);

        _stageRoot = new GameObject("深色科技展厅").transform;
        _stageRoot.SetParent(_showcaseRoot, false);

        CreateStudioLight("主光", new Vector3(0.35f, 0.9f, -0.4f), new Color(0.92f, 0.96f, 1f), 1.85f);
        CreateStudioLight("轮廓光", new Vector3(-0.6f, 0.55f, 0.55f), new Color(0.62f, 0.8f, 1f), 0.65f);
        CreateStudioLight("暖色补光", new Vector3(0.2f, 0.45f, 0.8f), new Color(1f, 0.78f, 0.58f), 0.35f);
    }

    private void DestroyShowcaseRoot()
    {
        if (_showcaseRoot == null)
        {
            return;
        }

        DestroyShowcaseObject(_showcaseRoot.gameObject);
        _showcaseRoot = null;
        _displayRoot = null;
        _stageRoot = null;
        _orbitRoot = null;
        _displayInstance = null;
        DestroyMaterial(ref _floorMaterial);
        DestroyMaterial(ref _gridMaterial);
    }

    private void DestroyDisplayInstance()
    {
        if (_displayInstance != null)
        {
            DestroyShowcaseObject(_displayInstance);
            _displayInstance = null;
        }
    }

    private void RebuildStage(float radius)
    {
        for (int index = _stageRoot.childCount - 1; index >= 0; index--)
        {
            DestroyShowcaseObject(_stageRoot.GetChild(index).gameObject);
        }

        EnsureStageMaterials();
        float visualRadius = Mathf.Max(radius * 10f, 260f);
        GameObject floor = GameObject.CreatePrimitive(PrimitiveType.Plane);
        floor.name = "深灰展台地盘";
        floor.transform.SetParent(_stageRoot, false);
        floor.transform.localPosition = new Vector3(0f, -0.02f, 0f);
        floor.transform.localScale = new Vector3(visualRadius * 0.2f, 1f, visualRadius * 0.2f);
        floor.GetComponent<Renderer>().sharedMaterial = _floorMaterial;
        DestroyShowcaseObject(floor.GetComponent<Collider>());

        float gridSpacing = Mathf.Max(2f, Mathf.Round(radius / 10f));
        int gridCount = Mathf.CeilToInt(visualRadius / gridSpacing);
        float lineWidth = Mathf.Max(0.012f, radius * 0.00085f);
        for (int index = -gridCount; index <= gridCount; index++)
        {
            float offset = index * gridSpacing;
            bool isMajor = index % 5 == 0;
            Color color = isMajor ? new Color(0.44f, 0.45f, 0.46f, 0.48f) : new Color(0.3f, 0.31f, 0.32f, 0.34f);
            float width = isMajor ? lineWidth * 1.65f : lineWidth;
            CreateLine("灰色地盘网格 X", _stageRoot, new[]
            {
                new Vector3(-visualRadius, 0.018f, offset),
                new Vector3(visualRadius, 0.018f, offset)
            }, color, width);
            CreateLine("灰色地盘网格 Z", _stageRoot, new[]
            {
                new Vector3(offset, 0.019f, -visualRadius),
                new Vector3(offset, 0.019f, visualRadius)
            }, color, width);
        }

        float orbitRadius = radius * 0.78f;
        CreateRing(orbitRadius, lineWidth * 1.8f);
        _orbitRoot = new GameObject("循环箭头").transform;
        _orbitRoot.SetParent(_stageRoot, false);
        for (int index = 0; index < 3; index++)
        {
            CreateOrbitArrow(_orbitRoot, orbitRadius, index * 120f, lineWidth * 3.4f);
        }
    }

    private void EnsureStageMaterials()
    {
        if (_floorMaterial == null)
        {
            _floorMaterial = CreateLitMaterial("设备展台半透明磨砂地面材质", new Color(0.055f, 0.055f, 0.058f, 0.78f), 0f, 0.5f);
        }

        if (_gridMaterial == null)
        {
            _gridMaterial = CreateLineMaterial("设备展台灰色线框材质", new Color(0.52f, 0.54f, 0.56f, 1f));
        }
    }

    private Material CreateLineMaterial(string materialName, Color color)
    {
        Shader shader = Shader.Find("Sprites/Default");
        if (shader == null)
        {
            shader = Shader.Find("Universal Render Pipeline/Unlit");
        }

        Material material = new Material(shader)
        {
            name = materialName,
            hideFlags = HideFlags.DontSave
        };
        if (material.HasProperty("_Color"))
        {
            material.SetColor("_Color", color);
        }
        if (material.HasProperty("_BaseColor"))
        {
            material.SetColor("_BaseColor", color);
        }

        return material;
    }

    private Material CreateLitMaterial(string materialName, Color color, float metallic = 0f, float smoothness = 0.28f)
    {
        Shader shader = Shader.Find("Universal Render Pipeline/Lit");
        if (shader == null)
        {
            shader = Shader.Find("Standard");
        }

        Material material = new Material(shader)
        {
            name = materialName,
            hideFlags = HideFlags.DontSave
        };
        if (material.HasProperty("_BaseColor"))
        {
            material.SetColor("_BaseColor", color);
        }
        else if (material.HasProperty("_Color"))
        {
            material.SetColor("_Color", color);
        }

        if (material.HasProperty("_Metallic"))
        {
            material.SetFloat("_Metallic", metallic);
        }

        if (material.HasProperty("_Smoothness"))
        {
            material.SetFloat("_Smoothness", smoothness);
        }

        if (color.a < 0.999f)
        {
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            if (material.HasProperty("_Surface"))
            {
                material.SetFloat("_Surface", 1f);
            }
            if (material.HasProperty("_Blend"))
            {
                material.SetFloat("_Blend", 0f);
            }
            if (material.HasProperty("_SrcBlend"))
            {
                material.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            }
            if (material.HasProperty("_DstBlend"))
            {
                material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            }
            if (material.HasProperty("_ZWrite"))
            {
                material.SetFloat("_ZWrite", 0f);
            }
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
        }

        return material;
    }

    private Material CreateUnlitMaterial(string materialName, Color color)
    {
        Shader shader = Shader.Find("Universal Render Pipeline/Unlit");
        if (shader == null)
        {
            shader = Shader.Find("Unlit/Color");
        }

        Material material = new Material(shader)
        {
            name = materialName,
            hideFlags = HideFlags.DontSave
        };
        if (material.HasProperty("_BaseColor"))
        {
            material.SetColor("_BaseColor", color);
        }
        else if (material.HasProperty("_Color"))
        {
            material.SetColor("_Color", color);
        }

        return material;
    }

    private void CreateStudioLight(string lightName, Vector3 direction, Color color, float intensity)
    {
        GameObject lightObject = new GameObject(lightName);
        lightObject.transform.SetParent(_showcaseRoot, false);
        Light light = lightObject.AddComponent<Light>();
        light.type = LightType.Directional;
        light.color = color;
        light.intensity = intensity;
        light.shadows = LightShadows.None;
        lightObject.transform.rotation = Quaternion.LookRotation(-direction.normalized, Vector3.up);
    }

    private void CreateRing(float radius, float lineWidth)
    {
        const int segmentCount = 96;
        Vector3[] points = new Vector3[segmentCount];
        for (int index = 0; index < segmentCount; index++)
        {
            float angle = index * Mathf.PI * 2f / segmentCount;
            points[index] = new Vector3(Mathf.Cos(angle) * radius, 0.03f, Mathf.Sin(angle) * radius);
        }

        LineRenderer line = CreateLine("循环轨道", _stageRoot, points, new Color(0.55f, 0.57f, 0.59f, 0.58f), lineWidth);
        line.loop = true;
    }

    private void CreateOrbitArrow(Transform parent, float radius, float angleDegrees, float lineWidth)
    {
        float angle = angleDegrees * Mathf.Deg2Rad;
        Vector3 position = new Vector3(Mathf.Cos(angle) * radius, 0.09f, Mathf.Sin(angle) * radius);
        Vector3 tangent = new Vector3(-Mathf.Sin(angle), 0f, Mathf.Cos(angle));
        Vector3 side = Vector3.Cross(Vector3.up, tangent);
        float arrowLength = Mathf.Max(1.4f, radius * 0.12f);
        float arrowWidth = arrowLength * 0.38f;
        CreateLine("循环方向箭头", parent, new[]
        {
            position - tangent * arrowLength + side * arrowWidth,
            position + tangent * arrowLength,
            position - tangent * arrowLength - side * arrowWidth
        }, new Color(0.68f, 0.7f, 0.72f, 0.88f), lineWidth);
    }

    private LineRenderer CreateLine(string lineName, Transform parent, Vector3[] points, Color color, float lineWidth)
    {
        GameObject lineObject = new GameObject(lineName);
        lineObject.transform.SetParent(parent, false);
        LineRenderer line = lineObject.AddComponent<LineRenderer>();
        line.sharedMaterial = _gridMaterial;
        line.useWorldSpace = false;
        line.alignment = LineAlignment.View;
        line.textureMode = LineTextureMode.Stretch;
        line.positionCount = points.Length;
        line.SetPositions(points);
        line.startWidth = lineWidth;
        line.endWidth = lineWidth;
        line.startColor = color;
        line.endColor = color;
        line.numCapVertices = 2;
        line.numCornerVertices = 2;
        line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        line.receiveShadows = false;
        return line;
    }

    private void FrameCamera(Bounds bounds, float stageRadius)
    {
        if (_showcaseCamera == null)
        {
            return;
        }

        float fieldOfViewRadians = _showcaseFieldOfView * Mathf.Deg2Rad;
        float targetRadius = Mathf.Max(bounds.extents.magnitude, stageRadius * 0.32f);
        float distance = targetRadius / Mathf.Tan(fieldOfViewRadians * 0.5f) * 1.38f;
        Vector3 direction = new Vector3(1f, 0.42f, -1f).normalized;
        Vector3 target = bounds.center + Vector3.up * bounds.extents.y * 0.08f;
        _showcaseCamera.transform.position = target + direction * distance;
        _showcaseCamera.transform.rotation = Quaternion.LookRotation(target - _showcaseCamera.transform.position, Vector3.up);
        _showcaseCamera.fieldOfView = _showcaseFieldOfView;
    }

    private static Bounds CalculateBounds(GameObject target)
    {
        Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
        Bounds bounds = new Bounds(target.transform.position, Vector3.zero);
        bool hasBounds = false;
        for (int index = 0; index < renderers.Length; index++)
        {
            Renderer renderer = renderers[index];
            if (renderer == null)
            {
                continue;
            }

            if (!hasBounds)
            {
                bounds = renderer.bounds;
                hasBounds = true;
            }
            else
            {
                bounds.Encapsulate(renderer.bounds);
            }
        }

        return bounds;
    }

    private static void SetDisplayRenderersEnabled(GameObject displayInstance, bool enabled)
    {
        Renderer[] renderers = displayInstance.GetComponentsInChildren<Renderer>(true);
        for (int index = 0; index < renderers.Length; index++)
        {
            if (renderers[index] != null)
            {
                renderers[index].enabled = enabled;
            }
        }
    }

    private void HandleKeyboardShortcuts()
    {
        Keyboard keyboard = Keyboard.current;
        if (keyboard == null)
        {
            return;
        }

        if (keyboard.f5Key.wasPressedThisFrame)
        {
            ShowPreviousDevice(out _);
        }
        else if (keyboard.f7Key.wasPressedThisFrame)
        {
            ShowNextDevice(out _);
        }
        else if (keyboard.f6Key.wasPressedThisFrame)
        {
            ExitShowcase();
        }
    }

    private static void DestroyShowcaseObject(UnityEngine.Object target)
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

    private static void DestroyMaterial(ref Material material)
    {
        if (material == null)
        {
            return;
        }

        DestroyShowcaseObject(material);
        material = null;
    }
}

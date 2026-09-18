using System;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;

/// <summary>齿轮箱分组爆炸展示。只平移已绑定节点，不修改 FBX、材质、旋转或缩放。</summary>
[DisallowMultipleComponent]
public sealed class GearboxExplodedView : MonoBehaviour
{
    [Serializable]
    public sealed class Part
    {
        public string label;
        public Transform target;
        [Tooltip("相对零件父节点的展开位移。")]
        public Vector3 offset;
        [Tooltip("标注连接点，使用零件自身局部坐标。")]
        public Vector3 anchor;
        public bool rightSide;
        [Range(0, 4)] public int row;
        [Min(0), Tooltip("外围到内部的展开阶段，同阶段零件同时移动。")]
        public int stage;
        public Mesh wireframeMesh;
        [HideInInspector] public Vector3 assembledPosition;
    }

    [Header("拆解分组")]
    [SerializeField] private Part[] _parts = Array.Empty<Part>();
    [Header("动画")]
    [SerializeField, Min(0.1f)] private float _duration = 2.8f;
    [SerializeField, Min(0f)] private float _explodeDistance = 1f;
    [SerializeField] private bool _expandOnEnable = true;
    [SerializeField, Range(0.1f, 1f)] private float _stageOverlap = 0.75f;
    [Header("零件科技扫描")]
    [SerializeField] private Material _scanMaterial;
    [SerializeField, Range(0f, 1f)] private float _scanIntensity = 0.45f;
    [Header("全息特征边叠加（保留原材质）")]
    [SerializeField] private Material _wireframeMaterial;
    [SerializeField, Range(0f, 1f)] private float _wireframeOpacity = 0.65f;
    [SerializeField] private bool _showWireframe = true;
    [Tooltip("仅在零件当前正在移动时绘制线框；完成后关闭，避免所有零件长期叠加渲染。")]
    [SerializeField] private bool _wireframeOnlyDuringMotion = true;
    [Tooltip("拆解展示期间关闭源模型投射阴影，保留接收阴影。")]
    [SerializeField] private bool _disableCastingShadowsDuringExplode = true;
    [Header("屏幕标识牌")]
    [SerializeField] private Camera _targetCamera;
    [SerializeField] private TMP_FontAsset _labelFont;
    [SerializeField] private bool _showLabels = true;
    [SerializeField] private bool _showControls = true;
    [Tooltip("标识牌底板不透明度；越小越通透，不影响文字、边框和引线。")]
    [SerializeField, Range(0f, 1f)] private float _labelBackgroundOpacity = 0.55f;
    [SerializeField] private bool _autoArrangeLabels = true;
    [ColorUsage(true, true)]
    [SerializeField] private Color _accentColor = new Color(0.15f, 0.82f, 1f, 1f);

    private sealed class Callout
    {
        public RectTransform panel;
        public RectTransform line;
        public RectTransform secondLine;
        public RectTransform glow;
        public RectTransform secondGlow;
        public RectTransform elbow;
        public RectTransform pulse;
        public RectTransform reticle;
        public RectTransform statusBar;
        public TextMeshProUGUI status;
        public int state = -1;
        public RectTransform dot;
        public CanvasGroup group;
    }

    private Callout[] _callouts;
    private Vector3[] _screenPoints;
    private Vector3[] _layoutPoints;
    private int[] _labelOrder;
    private int[] _layoutRows;
    private bool[] _layoutRight;
    private Canvas _canvas;
    private RectTransform _canvasRect;
    private RectTransform _controls;
    private Slider _slider;
    private float _progress;
    private float _goal;
    private bool _initialized;
    private float _cameraRetryTime;
    private int _maxStage;
    private MeshRenderer[] _partRenderers;
    private UnityEngine.Rendering.ShadowCastingMode[] _originalShadowModes;
    private MeshRenderer[] _wireRenderers;
    private MaterialPropertyBlock _wireProperties;
    private static readonly int LineColorId = Shader.PropertyToID("_LineColor");
    private MeshRenderer[][] _scanRenderers;
    private MaterialPropertyBlock _scanProperties;
    private RectTransform _header;
    private TextMeshProUGUI _sequenceStatus;
    private int _lastSequenceStatus = -1;
    private static readonly int IntensityId = Shader.PropertyToID("_Intensity");
    private static readonly int ScanColorId = Shader.PropertyToID("_Color");

    private int _selectedPart = -1;
    public int SelectedPart => _selectedPart;

    public float Progress => _progress;
    public int PartCount => _parts.Length;

    /// <summary>由配置工具写入显式绑定和装配位置，不在运行时按名称猜测零件。</summary>
    public void Configure(Part[] parts, TMP_FontAsset font)
    {
        _parts = parts;
        _labelFont = font;
        foreach (Part part in _parts)
            if (part.target != null) part.assembledPosition = part.target.localPosition;
    }

    private void OnEnable()
    {
        _goal = _expandOnEnable ? 1f : 0f;
        if (_initialized) ApplyPose();
    }

    private void Start()
    {
        _initialized = true;
        if (_targetCamera == null) _targetCamera = Camera.main;
        CacheStages();
        CachePartRenderers();
        CreateOverlay();
        CreateScanOverlays();
        CreateWireOverlays();
    }

    private void Update()
    {
        if (!Mathf.Approximately(_progress, _goal))
        {
            _progress = Mathf.MoveTowards(_progress, _goal, Time.unscaledDeltaTime / Mathf.Max(0.1f, _duration));
            ApplyPose();
        }
        if (_slider != null) _slider.SetValueWithoutNotify(_progress);
    }

    public void Expand() { _goal = 1f; }
    public void Restore() { _goal = 0f; }
    public void ToggleExploded() { _goal = _goal > 0.5f ? 0f : 1f; }

    /// <summary>支持滑条定位；动画反向时从当前位置连续复原。</summary>
    public void SetProgress(float value)
    {
        _progress = _goal = Mathf.Clamp01(value);
        ApplyPose();
    }

    public void SetTargetCamera(Camera camera) { _targetCamera = camera; }
    public void SetLabelsVisible(bool visible) { _showLabels = visible; }

    private void CachePartRenderers()
    {
        _partRenderers = new MeshRenderer[_parts.Length];
        _originalShadowModes = new UnityEngine.Rendering.ShadowCastingMode[_parts.Length];
        for (int i = 0; i < _parts.Length; i++)
        {
            MeshRenderer renderer = _parts[i].target == null ? null : _parts[i].target.GetComponent<MeshRenderer>();
            _partRenderers[i] = renderer;
            if (renderer != null) _originalShadowModes[i] = renderer.shadowCastingMode;
        }
    }

    private void CacheStages()
    {
        _maxStage = 0;
        foreach (Part part in _parts) _maxStage = Mathf.Max(_maxStage, part.stage);
    }

    public float GetPartProgress(int index)
    {
        return Mathf.Clamp01(_progress * (1f + _maxStage * _stageOverlap) - _parts[index].stage * _stageOverlap);
    }

    private void ApplyPose()
    {
        CacheStages();
        for (int i = 0; i < _parts.Length; i++)
        {
            Part part = _parts[i];
            float progress = GetPartProgress(i);
            if (part.target != null)
                part.target.localPosition = part.assembledPosition + part.offset * Mathf.SmoothStep(0f, 1f, progress) * _explodeDistance;
            bool moving = progress > 0.001f && progress < 0.999f;
            if (_partRenderers != null && _partRenderers[i] != null)
            {
                _partRenderers[i].shadowCastingMode = _disableCastingShadowsDuringExplode && _progress > 0.001f
                    ? UnityEngine.Rendering.ShadowCastingMode.Off
                    : _originalShadowModes[i];
            }
            if (_wireRenderers != null && _wireRenderers[i] != null)
            {
                bool showWire = _showWireframe && (!_wireframeOnlyDuringMotion || moving || _selectedPart == i);
                Color tint = _accentColor;
                tint.a = showWire ? _wireframeOpacity : 0f;
                _wireProperties.SetColor(LineColorId, tint);
                _wireRenderers[i].enabled = isActiveAndEnabled && tint.a > .001f;
                _wireRenderers[i].SetPropertyBlock(_wireProperties);
            }
            if (_scanRenderers == null) continue;
            float intensity = moving ? _scanIntensity * 1.8f : 0f;
            _scanProperties.SetFloat(IntensityId, intensity);
            _scanProperties.SetColor(ScanColorId, _accentColor);
            foreach (MeshRenderer renderer in _scanRenderers[i])
            {
                renderer.enabled = intensity > .001f;
                renderer.SetPropertyBlock(_scanProperties);
            }
        }
    }

    private void CreateWireOverlays()
    {
        _wireRenderers = new MeshRenderer[_parts.Length];
        _wireProperties = new MaterialPropertyBlock();
        if (_wireframeMaterial == null) return;
        for (int i = 0; i < _parts.Length; i++)
        {
            Part part = _parts[i];
            if (part.target == null || part.wireframeMesh == null) continue;
            var go = new GameObject("Gearbox Feature Wireframe");
            go.layer = part.target.gameObject.layer;
            go.transform.SetParent(part.target, false);
            go.AddComponent<MeshFilter>().sharedMesh = part.wireframeMesh;
            MeshRenderer renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = _wireframeMaterial;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
            renderer.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;
            _wireRenderers[i] = renderer;
        }
        ApplyPose();
    }

    /// <summary>点击标识牌选中/再次点击取消；也可由业务选择系统传入零基索引，-1 清除。</summary>
    public void SelectPart(int index)
    {
        _selectedPart = index >= 0 && index < _parts.Length ? index : -1;
        ApplyPose();
    }

    public void SetWireframeVisible(bool visible)
    {
        _showWireframe = visible;
        ApplyPose();
    }

    private void CreateScanOverlays()
    {
        if (_scanMaterial == null) return;
        _scanProperties = new MaterialPropertyBlock();
        _scanRenderers = new MeshRenderer[_parts.Length][];
        for (int i = 0; i < _parts.Length; i++)
        {
            MeshFilter[] filters = _parts[i].target == null ? Array.Empty<MeshFilter>() : _parts[i].target.GetComponentsInChildren<MeshFilter>(true);
            var overlays = new System.Collections.Generic.List<MeshRenderer>();
            foreach (MeshFilter source in filters)
            {
                if (source.sharedMesh == null || source.GetComponent<MeshRenderer>() == null) continue;
                var go = new GameObject("Gearbox Scan");
                go.layer = source.gameObject.layer;
                go.transform.SetParent(source.transform, false);
                go.AddComponent<MeshFilter>().sharedMesh = source.sharedMesh;
                MeshRenderer renderer = go.AddComponent<MeshRenderer>();
                Material[] materials = new Material[source.sharedMesh.subMeshCount];
                for (int m = 0; m < materials.Length; m++) materials[m] = _scanMaterial;
                renderer.sharedMaterials = materials;
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                renderer.receiveShadows = false;
                renderer.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
                renderer.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;
                overlays.Add(renderer);
            }
            _scanRenderers[i] = overlays.ToArray();
        }
        ApplyPose();
    }

    private void OnDisable()
    {
        _progress = _goal = 0f;
        _selectedPart = -1;
        if (_initialized) ApplyPose();
        if (_canvas != null) _canvas.gameObject.SetActive(false);
    }

    private void LateUpdate()
    {
        if (_canvas == null) return;
        // 场景切换后允许延迟出现主相机，不逐帧搜索。
        if (_targetCamera == null && Time.unscaledTime >= _cameraRetryTime)
        {
            _targetCamera = Camera.main;
            _cameraRetryTime = Time.unscaledTime + 1f;
        }
        bool available = _targetCamera != null && _targetCamera.isActiveAndEnabled;
        _canvas.gameObject.SetActive(available);
        if (!available) return;
        _controls.gameObject.SetActive(_showControls);
        Rect pixels = _targetCamera.pixelRect;
        float scale = _canvas.scaleFactor;
        float left = pixels.xMin / scale;
        float right = pixels.xMax / scale;
        float bottom = pixels.yMin / scale;
        float height = pixels.height / scale;
        float width = Mathf.Min(260f, pixels.width / scale * 0.22f);
        _controls.anchoredPosition = new Vector2((left + right) * 0.5f, bottom + 42f);
        _header.anchoredPosition = new Vector2((left + right) * .5f, bottom + height - 42f);
        _header.gameObject.SetActive(_showControls);
        int sequence = _progress <= 0f ? -1 : _progress >= 1f ? _maxStage + 1 : Mathf.FloorToInt(_progress * (_maxStage + 1));
        if (sequence != _lastSequenceStatus)
        {
            _lastSequenceStatus = sequence;
            _sequenceStatus.text = sequence < 0 ? "装配状态 / READY" : sequence > _maxStage ? "拆解完成 / ALL PARTS ONLINE" : "拆解序列 / STAGE " + (sequence + 1).ToString("00");
        }

        ArrangeLabels();
        for (int i = 0; i < _parts.Length; i++)
        {
            Part part = _parts[i];
            Callout callout = _callouts[i];
            if (part.target == null) { callout.group.alpha = 0f; continue; }
            Vector3 projected = _screenPoints[i];
            bool visible = part.target.gameObject.activeInHierarchy && projected.z > _targetCamera.nearClipPlane && pixels.Contains(projected);
            float partProgress = GetPartProgress(i);
            float alpha = _showLabels ? Mathf.InverseLerp(0.03f, 0.4f, partProgress) : 0f;
            callout.group.alpha = visible ? alpha : 0f;
            callout.group.blocksRaycasts = visible && alpha > .5f;
            int state = _selectedPart == i ? 2 : partProgress >= 1f ? 1 : 0;
            if (callout.state != state)
            {
                callout.state = state;
                callout.status.text = state == 2 ? "SELECTED / 已选中" : state == 1 ? "LINKED / 已展开" : "SCANNING / 展开中";
            }
            if (!visible || alpha <= 0f) continue;
            Vector2 point = new Vector2(projected.x, projected.y) / scale;
            bool rightSide = _autoArrangeLabels ? _layoutRight[i] : part.rightSide;
            int row = _autoArrangeLabels ? _layoutRows[i] : part.row;
            float x = rightSide ? right - width * 0.5f - 20f : left + width * 0.5f + 20f;
            float y = bottom + height * (0.82f - row * 0.145f);
            callout.panel.anchoredPosition = new Vector2(x, y);
            callout.panel.sizeDelta = new Vector2(width, 66f);
            Vector2 end = new Vector2(x + (rightSide ? -1 : 1) * width * 0.5f, y);
            // 两段：零件到折点的斜线，加水平线接入标识牌。
            Vector2 elbow = end + Vector2.right * (rightSide ? -1f : 1f) * 46f;
            PlaceLine(callout.line, point, elbow, 1.3f);
            PlaceLine(callout.secondLine, elbow, end, 1.3f);
            PlaceLine(callout.glow, point, elbow, 4f);
            PlaceLine(callout.secondGlow, elbow, end, 4f);
            callout.elbow.anchoredPosition = elbow;
            callout.dot.anchoredPosition = point;
            callout.reticle.anchoredPosition = point;
            callout.reticle.localRotation = Quaternion.Euler(0, 0, -Time.unscaledTime * 18f);
            float pulse = Mathf.Repeat(Time.unscaledTime * .35f + i * .17f, 1f);
            callout.pulse.anchoredPosition = pulse < .8f ? Vector2.Lerp(point, elbow, pulse / .8f) : Vector2.Lerp(elbow, end, (pulse - .8f) / .2f);
            callout.statusBar.localScale = new Vector3(partProgress, 1f, 1f);
        }
    }

    // 固定小数组原地插入排序，按投影左右分列、从上至下排列，避免每帧分配。
    private void ArrangeLabels()
    {
        for (int i = 0; i < _parts.Length; i++)
        {
            _labelOrder[i] = i;
            _screenPoints[i] = _parts[i].target == null ? Vector3.zero :
                _targetCamera.WorldToScreenPoint(_parts[i].target.TransformPoint(_parts[i].anchor));
            // 用最终展开位置排序，避免拆解过程中标牌频繁跳列；引线仍追踪实时位置。
            Vector3 finalPoint = _screenPoints[i];
            if (_parts[i].target != null && _parts[i].target.parent != null)
            {
                Part part = _parts[i];
                Vector3 remaining = part.assembledPosition + part.offset * _explodeDistance - part.target.localPosition;
                finalPoint = _targetCamera.WorldToScreenPoint(part.target.TransformPoint(part.anchor) + part.target.parent.TransformVector(remaining));
            }
            _layoutPoints[i] = finalPoint;
        }
        SortLabels(0, _parts.Length, false);
        int split = (_parts.Length + 1) / 2;
        SortLabels(0, split, true);
        SortLabels(split, _parts.Length, true);
        for (int i = 0; i < _parts.Length; i++)
        {
            _layoutRight[_labelOrder[i]] = i >= split;
            _layoutRows[_labelOrder[i]] = i >= split ? i - split : i;
        }
    }

    private void SortLabels(int start, int end, bool vertical)
    {
        for (int i = start + 1; i < end; i++)
        {
            int value = _labelOrder[i];
            float key = vertical ? -_layoutPoints[value].y : _layoutPoints[value].x;
            int j = i - 1;
            while (j >= start && (vertical ? -_layoutPoints[_labelOrder[j]].y : _layoutPoints[_labelOrder[j]].x) > key)
            {
                _labelOrder[j + 1] = _labelOrder[j];
                j--;
            }
            _labelOrder[j + 1] = value;
        }
    }

    private void CreateOverlay()
    {
        var root = new GameObject("Gearbox Callouts", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        root.transform.SetParent(transform, false);
        _canvas = root.GetComponent<Canvas>();
        _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        _canvas.sortingOrder = 30;
        _canvasRect = root.GetComponent<RectTransform>();
        CanvasScaler scaler = root.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1600f, 900f);
        scaler.matchWidthOrHeight = 0.5f;
        _callouts = new Callout[_parts.Length];
        _screenPoints = new Vector3[_parts.Length];
        _layoutPoints = new Vector3[_parts.Length];
        _labelOrder = new int[_parts.Length];
        _layoutRows = new int[_parts.Length];
        _layoutRight = new bool[_parts.Length];
        for (int i = 0; i < _parts.Length; i++)
        {
            RectTransform group = Rect("Callout " + (i + 1), _canvasRect);
            var canvasGroup = group.gameObject.AddComponent<CanvasGroup>();
            canvasGroup.blocksRaycasts = true;
            canvasGroup.interactable = true;
            canvasGroup.alpha = 0f;
            RectTransform glow = ImageRect("Leader Glow A", group, Tint(.12f));
            RectTransform secondGlow = ImageRect("Leader Glow B", group, Tint(.12f));
            RectTransform line = ImageRect("Leader A", group, Tint(.8f));
            RectTransform secondLine = ImageRect("Leader B", group, Tint(.8f));
            RectTransform elbow = ImageRect("Elbow", group, _accentColor);
            elbow.sizeDelta = new Vector2(4, 4);
            RectTransform dot = ImageRect("Anchor", group, Color.white);
            dot.sizeDelta = new Vector2(4f, 4f);
            RectTransform pulse = ImageRect("Signal", group, new Color(.7f, 1f, 1f, 1f));
            pulse.sizeDelta = new Vector2(4, 4);
            RectTransform reticle = TechRect("Lock Reticle", group, true);
            reticle.sizeDelta = new Vector2(23, 23);
            RectTransform panel = TechRect("Plate", group);
            GearboxTechGraphic background = panel.GetComponent<GearboxTechGraphic>();
            Color backgroundColor = background.color;
            backgroundColor.a = _labelBackgroundOpacity;
            background.color = backgroundColor;
            background.raycastTarget = true;
            Button select = panel.gameObject.AddComponent<Button>();
            select.targetGraphic = background;
            select.transition = Selectable.Transition.None;
            select.navigation = new Navigation { mode = Navigation.Mode.None };
            int partIndex = i;
            select.onClick.AddListener(() => SelectPart(_selectedPart == partIndex ? -1 : partIndex));
            RectTransform badge = ImageRect("Number Badge", panel, Tint(.15f));
            badge.anchorMin = badge.anchorMax = new Vector2(0, .5f);
            badge.anchoredPosition = new Vector2(28, 0);
            badge.sizeDelta = new Vector2(38, 42);
            Text("Number", badge, (i + 1).ToString("00"), 24f);
            TextMeshProUGUI nameText = Text("Name", panel, _parts[i].label, 20f);
            nameText.alignment = TextAlignmentOptions.MidlineLeft;
            nameText.rectTransform.offsetMin = new Vector2(58, 25);
            nameText.rectTransform.offsetMax = new Vector2(-12, -7);
            TextMeshProUGUI status = Text("Status", panel, "SCANNING / 展开中", 10f);
            status.alignment = TextAlignmentOptions.MidlineLeft;
            status.color = Tint(.8f);
            status.rectTransform.offsetMin = new Vector2(59, 7);
            status.rectTransform.offsetMax = new Vector2(-12, -39);
            RectTransform bar = ImageRect("Stage Progress", panel, Tint(.75f));
            bar.anchorMin = new Vector2(0, 0);
            bar.anchorMax = new Vector2(1, 0);
            bar.pivot = Vector2.zero;
            bar.offsetMin = new Vector2(58, 3);
            bar.offsetMax = new Vector2(-18, 5);
            _callouts[i] = new Callout { panel = panel, line = line, secondLine = secondLine, glow = glow, secondGlow = secondGlow,
                elbow = elbow, pulse = pulse, reticle = reticle, status = status, statusBar = bar, dot = dot, group = canvasGroup };
        }
        if (EventSystem.current == null && FindObjectOfType<EventSystem>() == null)
        {
            var events = new GameObject("Gearbox EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
            events.transform.SetParent(root.transform, false);
        }
        CreateControls();
    }

    private void OnDestroy()
    {
        if (_partRenderers != null)
            for (int i = 0; i < _partRenderers.Length; i++)
                if (_partRenderers[i] != null) _partRenderers[i].shadowCastingMode = _originalShadowModes[i];
        if (_wireRenderers != null)
            foreach (MeshRenderer renderer in _wireRenderers)
                if (renderer != null) Destroy(renderer.gameObject);
        if (_scanRenderers != null)
            foreach (MeshRenderer[] renderers in _scanRenderers)
                foreach (MeshRenderer renderer in renderers)
                    if (renderer != null) Destroy(renderer.gameObject);
        if (_canvas != null) Destroy(_canvas.gameObject);
    }

    private void CreateControls()
    {
        _header = TechRect("Sequence Header", _canvasRect);
        _header.sizeDelta = new Vector2(510, 64);
        var title = Text("Title", _header, "齿轮箱 · 结构解析", 22);
        title.rectTransform.offsetMin = new Vector2(10, 25);
        title.rectTransform.offsetMax = new Vector2(-10, -5);
        _sequenceStatus = Text("Sequence", _header, "装配状态 / READY", 11);
        _sequenceStatus.color = Tint(.8f);
        _sequenceStatus.rectTransform.offsetMin = new Vector2(10, 5);
        _sequenceStatus.rectTransform.offsetMax = new Vector2(-10, -38);
        _controls = TechRect("Controls", _canvasRect);
        _controls.sizeDelta = new Vector2(560f, 60f);
        Button expand = Button("展开", _controls, new Vector2(-202f, 0f));
        expand.onClick.AddListener(Expand);
        Button restore = Button("复原", _controls, new Vector2(202f, 0f));
        restore.onClick.AddListener(Restore);
        RectTransform track = ImageRect("Progress", _controls, new Color(0.15f, 0.23f, 0.28f, 1f));
        track.anchorMin = track.anchorMax = new Vector2(0.5f, 0.5f);
        track.sizeDelta = new Vector2(275f, 12f);
        track.GetComponent<Image>().raycastTarget = true;
        RectTransform handle = ImageRect("Handle", track, _accentColor);
        handle.sizeDelta = new Vector2(16f, 26f);
        _slider = track.gameObject.AddComponent<Slider>();
        _slider.handleRect = handle;
        _slider.targetGraphic = handle.GetComponent<Image>();
        _slider.navigation = new Navigation { mode = Navigation.Mode.None };
        _slider.onValueChanged.AddListener(SetProgress);
    }

    private Button Button(string title, RectTransform parent, Vector2 position)
    {
        RectTransform rect = ImageRect(title, parent, new Color(0.06f, 0.28f, 0.38f, 1f));
        rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
        rect.anchoredPosition = position;
        rect.sizeDelta = new Vector2(100f, 34f);
        Image image = rect.GetComponent<Image>();
        image.raycastTarget = true;
        Button button = rect.gameObject.AddComponent<Button>();
        button.targetGraphic = image;
        button.navigation = new Navigation { mode = Navigation.Mode.None };
        Text("Text", rect, title, 19f);
        return button;
    }

    private TextMeshProUGUI Text(string name, RectTransform parent, string value, float size)
    {
        RectTransform rect = Rect(name, parent);
        rect.anchorMin = Vector2.zero;
        rect.anchorMax = Vector2.one;
        rect.offsetMin = new Vector2(8f, 0f);
        rect.offsetMax = new Vector2(-8f, 0f);
        TextMeshProUGUI text = rect.gameObject.AddComponent<TextMeshProUGUI>();
        if (_labelFont != null) text.font = _labelFont;
        text.text = value;
        text.fontSize = size;
        text.enableAutoSizing = true;
        text.fontSizeMin = 11f;
        text.fontSizeMax = size;
        text.enableWordWrapping = false;
        text.alignment = TextAlignmentOptions.Center;
        text.color = new Color(0.9f, 0.97f, 1f, 1f);
        text.raycastTarget = false;
        return text;
    }

    private Color Tint(float alpha)
    {
        Color color = _accentColor;
        color.a = alpha;
        return color;
    }

    private RectTransform TechRect(string name, Transform parent, bool reticle = false)
    {
        RectTransform rect = Rect(name, parent);
        GearboxTechGraphic graphic = rect.gameObject.AddComponent<GearboxTechGraphic>();
        graphic.reticle = reticle;
        graphic.accent = _accentColor;
        graphic.color = new Color(.015f, .045f, .085f, .94f);
        graphic.raycastTarget = false;
        graphic.SetVerticesDirty();
        return rect;
    }

    private static void PlaceLine(RectTransform rect, Vector2 from, Vector2 to, float width)
    {
        rect.pivot = new Vector2(0f, .5f);
        Vector2 delta = to - from;
        rect.anchoredPosition = from;
        rect.sizeDelta = new Vector2(delta.magnitude, width);
        rect.localRotation = Quaternion.Euler(0, 0, Mathf.Atan2(delta.y, delta.x) * Mathf.Rad2Deg);
    }

    private static RectTransform Rect(string name, Transform parent)
    {
        var go = new GameObject(name, typeof(RectTransform));
        var rect = (RectTransform)go.transform;
        rect.SetParent(parent, false);
        rect.anchorMin = rect.anchorMax = Vector2.zero;
        rect.sizeDelta = Vector2.zero;
        rect.pivot = new Vector2(0.5f, 0.5f);
        return rect;
    }

    private static RectTransform ImageRect(string name, Transform parent, Color color)
    {
        RectTransform rect = Rect(name, parent);
        Image image = rect.gameObject.AddComponent<Image>();
        image.color = color;
        image.raycastTarget = false;
        return rect;
    }
}

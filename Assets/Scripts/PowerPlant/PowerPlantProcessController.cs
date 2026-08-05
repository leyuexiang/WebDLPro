using System;
using System.Collections.Generic;
using HighlightPlus;
using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// 燃气发电厂的场景状态控制器。
/// 外部平台只传递流程、步骤、机组和路由 ID；模型名称、显隐集合、材质与相机策略全部保留在 Unity 内。
/// </summary>
[DisallowMultipleComponent]
public sealed class PowerPlantProcessController : MonoBehaviour
{
    private const string GasPowerGenerationProcessId = "gas-power-generation";
    private const string OverviewStepId = "overview";
    private const string AllUnitsId = "all";

    [Serializable]
    private sealed class SceneNodeBinding
    {
        [SerializeField] private string _id;
        [SerializeField] private GameObject[] _targets;

        public string Id => _id;
        public GameObject[] Targets => _targets;

        public SceneNodeBinding(string id, GameObject[] targets)
        {
            _id = id;
            _targets = targets;
        }
    }

    private sealed class ActiveContextFadeMaterials
    {
        public Material[] OriginalMaterials;
        public Material[] RuntimeMaterials;
    }

    [Header("场景引用")]
    [SerializeField] private Transform _sceneRoot;
    [SerializeField] private Camera _interactionCamera;
    [SerializeField] private Material _contextFadeMaterial;
    [SerializeField, Range(0.05f, 0.95f)] private float _contextOpacity = 0.22f;
    [SerializeField] private GameObject[] _groundObjects = Array.Empty<GameObject>();
    [SerializeField] private GameObject[] _persistentFlowObjects = Array.Empty<GameObject>();

    [Header("运行时相机")]
    [SerializeField, Min(0.15f)] private float _cameraTransitionDuration = 1.45f;
    [SerializeField, Range(25f, 80f)] private float _focusFieldOfView = 52f;
    [SerializeField] private Vector3 _cameraViewDirection = new Vector3(1f, 0.65f, -1f);

    [Header("由场景配置工具写入")]
    [SerializeField] private SceneNodeBinding[] _nodes = Array.Empty<SceneNodeBinding>();

    public void ConfigureForCurrentSampleScene(
        Transform sceneRoot,
        Camera interactionCamera,
        Material contextFadeMaterial,
        GameObject[] groundObjects,
        GameObject[] persistentFlowObjects,
        GameObject[] overview,
        GameObject[] hrsgSystem,
        GameObject inletDuct,
        GameObject gasTurbine,
        GameObject hrsg,
        GameObject steamTurbine,
        GameObject generator,
        GameObject gridOutput)
    {
        _sceneRoot = sceneRoot;
        _interactionCamera = interactionCamera;
        _contextFadeMaterial = contextFadeMaterial;
        _groundObjects = groundObjects;
        _persistentFlowObjects = persistentFlowObjects;
        _nodes = new[]
        {
            CreateNode("plant.overview", overview),
            CreateNode("unit.ccgt.1.gas-train", hrsgSystem),
            CreateNode("unit.ccgt.2.gas-train", hrsgSystem),
            CreateNode("node.hrsg.1", hrsgSystem),
            CreateNode("node.hrsg.2", hrsgSystem),
            CreateNode("inlet-duct", new[] { inletDuct }),
            CreateNode("gas-turbine", new[] { gasTurbine }),
            CreateNode("hrsg", new[] { hrsg }),
            CreateNode("steam-turbine", new[] { steamTurbine }),
            CreateNode("generator", new[] { generator }),
            CreateNode("grid-output", new[] { gridOutput })
        };

        CacheSceneBindings();
    }

    private readonly Dictionary<string, SceneNodeBinding> _nodesById = new Dictionary<string, SceneNodeBinding>(StringComparer.Ordinal);
    private readonly Dictionary<GameObject, bool> _initialRootActiveStates = new Dictionary<GameObject, bool>();
    private readonly Dictionary<GameObject, string> _selectionNodeByObject = new Dictionary<GameObject, string>();
    private readonly Dictionary<Renderer, ActiveContextFadeMaterials> _activeContextFades = new Dictionary<Renderer, ActiveContextFadeMaterials>();
    private readonly HashSet<GameObject> _groundObjectSet = new HashSet<GameObject>();
    private readonly HashSet<GameObject> _persistentFlowObjectSet = new HashSet<GameObject>();
    private readonly HashSet<Renderer> _highlightRendererSet = new HashSet<Renderer>();

    private HighlightEffect _processHighlightEffect;
    private HighlightEffect _alarmHighlightEffect;

    private Vector3 _cameraTransitionStartPosition;
    private Quaternion _cameraTransitionStartRotation;
    private float _cameraTransitionStartFieldOfView;
    private Vector3 _cameraTargetPosition;
    private Quaternion _cameraTargetRotation;
    private float _cameraTargetFieldOfView;
    private float _cameraTransitionElapsed;
    private bool _hasCameraTransition;
    private string _currentProcessId = GasPowerGenerationProcessId;
    private string _currentStepId = OverviewStepId;
    private string _currentUnitId = AllUnitsId;

    public string CurrentProcessId => _currentProcessId;
    public string CurrentStepId => _currentStepId;
    public string CurrentUnitId => _currentUnitId;

    private void Awake()
    {
        CacheSceneBindings();
        EnsureHighlightEffects();
    }

    private void Update()
    {
        UpdateCameraTransition();
        HandlePointerSelection();
    }

    private void OnDestroy()
    {
        ClearProcessHighlight();
        ClearAlarmHighlight();
        RestoreAllContextFades();
    }

    /// <summary>
    /// 进入已配置流程步骤并更新场景显示与镜头；管道流动由场景静态材质持续播放，不参与步骤切换。
    /// </summary>
    public bool TryEnterProcessStep(string processId, string stepId, string unitId, bool isolate, out string message)
    {
        if (!string.Equals(processId, GasPowerGenerationProcessId, StringComparison.Ordinal))
        {
            message = $"不支持流程：{processId}";
            return false;
        }

        if (!TryNormalizeUnit(unitId, out string normalizedUnitId))
        {
            message = $"不支持机组标识：{unitId}";
            return false;
        }

        if (!TryResolveStep(stepId, normalizedUnitId, out List<string> visibleNodeIds, out string focusNodeId))
        {
            message = $"不支持或尚未配置的流程步骤：{stepId}";
            return false;
        }

        ClearProcessHighlight();
        if (isolate)
        {
            SetIsolatedVisibility(visibleNodeIds);
        }
        else
        {
            RestoreInitialVisibility();
        }

        ClearProcessHighlight();

        FocusProcessTargets(focusNodeId, visibleNodeIds, normalizedUnitId);
        _currentProcessId = processId;
        _currentStepId = stepId;
        _currentUnitId = normalizedUnitId;
        message = $"已进入 {stepId}（机组：{normalizedUnitId}）。";
        return true;
    }

    public bool TryResetScene(out string message)
    {
        ClearProcessHighlight();
        ClearAlarmHighlight();
        RestoreInitialVisibility();
        FocusNode("plant.overview");
        _currentProcessId = GasPowerGenerationProcessId;
        _currentStepId = OverviewStepId;
        _currentUnitId = AllUnitsId;
        message = "已恢复全景场景。";
        return true;
    }

    public bool TryFocusNode(string nodeId, bool isolate, out string message)
    {
        if (!_nodesById.ContainsKey(nodeId))
        {
            message = $"未知场景节点：{nodeId}";
            return false;
        }

        ClearProcessHighlight();
        if (isolate)
        {
            SetIsolatedVisibility(new List<string> { nodeId });
        }

        _highlightRendererSet.Clear();
        CollectNodeRenderers(nodeId, _highlightRendererSet);
        ApplyHighlight(_processHighlightEffect, _highlightRendererSet);
        FocusNode(nodeId);
        message = $"已聚焦节点：{nodeId}";
        return true;
    }

    /// <summary>
    /// 由自由相机控制器在检测到手动输入时调用，防止流程镜头动画和玩家控制互相覆盖。
    /// </summary>
    public void CancelCameraTransition()
    {
        _hasCameraTransition = false;
    }

    /// <summary>
    /// 仅允许平台控制已登记的业务节点，不暴露 Unity 层级路径或任意对象名称。
    /// </summary>
    public bool TrySetNodeVisibility(string nodeId, bool visible, out string message)
    {
        if (!_nodesById.TryGetValue(nodeId, out SceneNodeBinding node))
        {
            message = $"未知场景节点：{nodeId}";
            return false;
        }

        GameObject[] targets = node.Targets;
        for (int targetIndex = 0; targetIndex < targets.Length; targetIndex++)
        {
            GameObject target = targets[targetIndex];
            if (target == null)
            {
                continue;
            }

            target.SetActive(true);
            if (visible || IsGroundObject(target))
            {
                RestoreContextFade(target);
            }
            else
            {
                ApplyContextFade(target);
            }
        }

        message = visible ? $"已显示节点：{nodeId}" : $"已将节点调整为半透明上下文：{nodeId}";
        return true;
    }

    /// <summary>
    /// 为后续平台告警指令预留的内部入口。当前 iframe 协议不调用此方法。
    /// </summary>
    public bool TrySetNodeAlarm(string nodeId, bool enabled, out string message)
    {
        if (!_nodesById.ContainsKey(nodeId))
        {
            message = $"未知场景节点：{nodeId}";
            return false;
        }

        EnsureHighlightEffects();
        if (!enabled)
        {
            ClearAlarmHighlight();
            message = $"已关闭节点告警效果：{nodeId}";
            return true;
        }

        _highlightRendererSet.Clear();
        CollectNodeRenderers(nodeId, _highlightRendererSet);
        ApplyHighlight(_alarmHighlightEffect, _highlightRendererSet);
        message = _highlightRendererSet.Count > 0 ? $"已启用节点告警效果：{nodeId}" : $"节点没有可高亮的渲染器：{nodeId}";
        return _highlightRendererSet.Count > 0;
    }

    public string GetStateDescription()
    {
        return $"process={_currentProcessId};step={_currentStepId};unit={_currentUnitId}";
    }

    private void EnsureHighlightEffects()
    {
        // 仅在运行时创建效果组件：场景配置工具不应把 HighlightEffect 序列化到 SampleScene，
        // 否则每次进入 Play Mode 都会额外保留一组组件和渲染资源。
        if (!Application.isPlaying)
        {
            return;
        }

        if (_processHighlightEffect == null)
        {
            _processHighlightEffect = gameObject.AddComponent<HighlightEffect>();
            _processHighlightEffect.hideFlags = HideFlags.DontSave;
            ConfigureHighlightEffect(
                _processHighlightEffect,
                new Color(0f, 1f, 0.921f, 1f),
                0.24f);
        }

        if (_alarmHighlightEffect == null)
        {
            _alarmHighlightEffect = gameObject.AddComponent<HighlightEffect>();
            _alarmHighlightEffect.hideFlags = HideFlags.DontSave;
            ConfigureHighlightEffect(
                _alarmHighlightEffect,
                new Color(1f, 0.018f, 0f, 1f),
                0.3f);
        }
    }

    private static void ConfigureHighlightEffect(HighlightEffect effect, Color outlineColor, float outlineWidth)
    {
        effect.profile = null;
        effect.profileSync = false;
        effect.previewInEditor = false;
        effect.camerasLayerMask = -1;
        effect.cullBackFaces = true;
        effect.constantWidth = true;
        effect.fadeInDuration = 0f;
        effect.fadeOutDuration = 0f;
        effect.outline = 1f;
        effect.outlineColor = outlineColor;
        effect.outlineWidth = outlineWidth;
        effect.outlineQuality = HighlightPlus.QualityLevel.High;
        effect.outlineDownsampling = 1;
        effect.outlineVisibility = HighlightPlus.Visibility.Normal;
        effect.outlineIndependent = false;
        effect.glow = 0f;
        effect.innerGlow = 0f;
        effect.overlay = 0f;
        effect.seeThrough = SeeThroughMode.Never;
        effect.ignore = false;
        effect.SetHighlighted(false);
        effect.Refresh();
    }

    private void CollectNodeRenderers(string nodeId, ISet<Renderer> destination)
    {
        if (!_nodesById.TryGetValue(nodeId, out SceneNodeBinding node))
        {
            return;
        }

        GameObject[] targets = node.Targets;
        for (int targetIndex = 0; targetIndex < targets.Length; targetIndex++)
        {
            GameObject target = targets[targetIndex];
            if (target == null)
            {
                continue;
            }

            Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
            for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
            {
                if (renderers[rendererIndex] != null)
                {
                    destination.Add(renderers[rendererIndex]);
                }
            }
        }
    }

    private void ApplyHighlight(HighlightEffect effect, ISet<Renderer> renderers)
    {
        if (effect == null)
        {
            return;
        }

        if (renderers == null || renderers.Count == 0)
        {
            effect.SetHighlighted(false);
            return;
        }

        Renderer[] targets = new Renderer[renderers.Count];
        renderers.CopyTo(targets, 0);
        effect.SetTargets(transform, targets);
        effect.SetHighlighted(true);
    }

    private void ClearProcessHighlight()
    {
        if (_processHighlightEffect != null)
        {
            _processHighlightEffect.SetHighlighted(false);
        }
    }

    private void ClearAlarmHighlight()
    {
        if (_alarmHighlightEffect != null)
        {
            _alarmHighlightEffect.SetHighlighted(false);
        }
    }

    private void CacheSceneBindings()
    {
        _nodesById.Clear();
        _selectionNodeByObject.Clear();
        _initialRootActiveStates.Clear();
        _groundObjectSet.Clear();
        _persistentFlowObjectSet.Clear();

        if (_sceneRoot == null)
        {
            Debug.LogError($"[{nameof(PowerPlantProcessController)}] 未配置场景根节点。请运行 Tools/WebDLPro/Configure Current Power Plant Scene。", this);
            return;
        }

        if (_interactionCamera == null)
        {
            _interactionCamera = Camera.main;
        }

        for (int childIndex = 0; childIndex < _sceneRoot.childCount; childIndex++)
        {
            GameObject child = _sceneRoot.GetChild(childIndex).gameObject;
            _initialRootActiveStates[child] = child.activeSelf;
        }

        for (int groundIndex = 0; groundIndex < _groundObjects.Length; groundIndex++)
        {
            if (_groundObjects[groundIndex] != null)
            {
                _groundObjectSet.Add(_groundObjects[groundIndex]);
            }
        }

        for (int flowIndex = 0; flowIndex < _persistentFlowObjects.Length; flowIndex++)
        {
            if (_persistentFlowObjects[flowIndex] != null)
            {
                _persistentFlowObjectSet.Add(_persistentFlowObjects[flowIndex]);
            }
        }

        for (int nodeIndex = 0; nodeIndex < _nodes.Length; nodeIndex++)
        {
            SceneNodeBinding node = _nodes[nodeIndex];
            if (node == null || string.IsNullOrWhiteSpace(node.Id))
            {
                continue;
            }

            _nodesById[node.Id] = node;
            if (node.Id == "plant.overview" || node.Id.StartsWith("unit.", StringComparison.Ordinal))
            {
                continue;
            }

            GameObject[] targets = node.Targets;
            for (int targetIndex = 0; targetIndex < targets.Length; targetIndex++)
            {
                GameObject target = targets[targetIndex];
                if (target == null)
                {
                    continue;
                }

                _selectionNodeByObject[target] = node.Id;
                EnsureClickCollider(target);
            }
        }
    }

    private bool TryResolveStep(string stepId, string unitId, out List<string> visibleNodeIds, out string focusNodeId)
    {
        visibleNodeIds = new List<string>();
        focusNodeId = string.Empty;

        if (string.Equals(stepId, OverviewStepId, StringComparison.Ordinal))
        {
            visibleNodeIds.Add("plant.overview");
            focusNodeId = "plant.overview";
            return true;
        }

        if (string.Equals(stepId, "grid-output", StringComparison.Ordinal))
        {
            visibleNodeIds.Add("utility.grid");
            focusNodeId = "node.grid";
            return true;
        }

        if (string.Equals(stepId, "gas-network", StringComparison.Ordinal))
        {
            AddUnitNodeIds(visibleNodeIds, unitId, "gas-train");
            AddUnitNodeIds(visibleNodeIds, unitId, "steam-train");
            focusNodeId = unitId == AllUnitsId ? "plant.overview" : $"node.inlet.{unitId}";
            return true;
        }

        switch (stepId)
        {
            case "inlet-duct":
                AddUnitNodeIds(visibleNodeIds, unitId, "gas-train");
                focusNodeId = unitId == AllUnitsId ? "plant.overview" : $"node.inlet.{unitId}";
                return true;

            case "gas-turbine":
                AddUnitNodeIds(visibleNodeIds, unitId, "gas-train");
                focusNodeId = unitId == AllUnitsId ? "plant.overview" : $"node.gas-turbine.{unitId}";
                return true;

            case "hrsg":
                AddUnitNodeIds(visibleNodeIds, unitId, "gas-train");
                focusNodeId = "node.hrsg.1";
                return true;

            case "steam-turbine":
                AddUnitNodeIds(visibleNodeIds, unitId, "steam-train");
                focusNodeId = unitId == AllUnitsId ? "plant.overview" : $"node.steam-turbine.{unitId}";
                return true;

            case "generator":
                AddUnitNodeIds(visibleNodeIds, unitId, "gas-train");
                AddUnitNodeIds(visibleNodeIds, unitId, "steam-train");
                visibleNodeIds.Add("utility.grid");
                focusNodeId = unitId == AllUnitsId ? "node.grid" : $"node.gas-generator.{unitId}";
                return true;

            default:
                return false;
        }
    }

    private void AddUnitNodeIds(List<string> destination, string unitId, string trainName)
    {
        if (unitId == AllUnitsId || unitId == "1")
        {
            destination.Add($"unit.ccgt.1.{trainName}");
        }

        if (unitId == AllUnitsId || unitId == "2")
        {
            destination.Add($"unit.ccgt.2.{trainName}");
        }
    }

    private void SetIsolatedVisibility(List<string> visibleNodeIds)
    {
        HashSet<GameObject> visibleObjects = new HashSet<GameObject>();
        for (int nodeIndex = 0; nodeIndex < visibleNodeIds.Count; nodeIndex++)
        {
            if (!_nodesById.TryGetValue(visibleNodeIds[nodeIndex], out SceneNodeBinding node))
            {
                continue;
            }

            GameObject[] targets = node.Targets;
            for (int targetIndex = 0; targetIndex < targets.Length; targetIndex++)
            {
                if (targets[targetIndex] != null)
                {
                    visibleObjects.Add(targets[targetIndex]);
                }
            }
        }

        foreach (KeyValuePair<GameObject, bool> entry in _initialRootActiveStates)
        {
            GameObject target = entry.Key;
            if (target == null)
            {
                continue;
            }

            if (!entry.Value)
            {
                target.SetActive(false);
                continue;
            }

            target.SetActive(true);
            if (visibleObjects.Contains(target) || IsGroundObject(target) || IsPersistentFlowObject(target))
            {
                RestoreContextFade(target);
            }
            else
            {
                ApplyContextFade(target);
            }
        }
    }

    private void RestoreInitialVisibility()
    {
        RestoreAllContextFades();
        foreach (KeyValuePair<GameObject, bool> entry in _initialRootActiveStates)
        {
            if (entry.Key != null)
            {
                entry.Key.SetActive(entry.Value);
            }
        }
    }

    private void FocusProcessTargets(string focusNodeId, List<string> visibleNodeIds, string unitId)
    {
        if (unitId == AllUnitsId && TryCalculateBounds(visibleNodeIds, out Bounds processBounds))
        {
            BeginCameraTransition(processBounds);
            return;
        }

        FocusNode(focusNodeId);
    }

    private void FocusNode(string nodeId)
    {
        if (_interactionCamera == null || !_nodesById.TryGetValue(nodeId, out SceneNodeBinding node))
        {
            return;
        }

        if (!TryCalculateBounds(node.Targets, out Bounds bounds))
        {
            return;
        }

        BeginCameraTransition(bounds);
    }

    private void BeginCameraTransition(Bounds bounds)
    {
        if (_interactionCamera == null)
        {
            return;
        }

        Vector3 direction = _cameraViewDirection.sqrMagnitude > 0.001f ? _cameraViewDirection.normalized : new Vector3(1f, 0.65f, -1f).normalized;
        float verticalFovRadians = _focusFieldOfView * Mathf.Deg2Rad;
        float radius = Mathf.Max(bounds.extents.magnitude, 3f);
        float distance = radius / Mathf.Tan(verticalFovRadians * 0.5f) * 1.25f;

        Transform cameraTransform = _interactionCamera.transform;
        _cameraTransitionStartPosition = cameraTransform.position;
        _cameraTransitionStartRotation = cameraTransform.rotation;
        _cameraTransitionStartFieldOfView = _interactionCamera.fieldOfView;
        _cameraTargetPosition = bounds.center + direction * distance;
        _cameraTargetRotation = Quaternion.LookRotation(bounds.center - _cameraTargetPosition, Vector3.up);
        _cameraTargetFieldOfView = _focusFieldOfView;
        _cameraTransitionElapsed = 0f;
        _hasCameraTransition = true;
    }

    private void UpdateCameraTransition()
    {
        if (!_hasCameraTransition || _interactionCamera == null)
        {
            return;
        }

        _cameraTransitionElapsed += Time.unscaledDeltaTime;
        float duration = Mathf.Max(_cameraTransitionDuration, 0.15f);
        float progress = Mathf.Clamp01(_cameraTransitionElapsed / duration);
        float blend = progress * progress * (3f - 2f * progress);
        Transform cameraTransform = _interactionCamera.transform;
        cameraTransform.position = Vector3.Lerp(_cameraTransitionStartPosition, _cameraTargetPosition, blend);
        cameraTransform.rotation = Quaternion.Slerp(_cameraTransitionStartRotation, _cameraTargetRotation, blend);
        _interactionCamera.fieldOfView = Mathf.Lerp(_cameraTransitionStartFieldOfView, _cameraTargetFieldOfView, blend);

        if (progress >= 1f)
        {
            _hasCameraTransition = false;
        }
    }

    private void HandlePointerSelection()
    {
        if (_interactionCamera == null || Mouse.current == null || !Mouse.current.leftButton.wasPressedThisFrame)
        {
            return;
        }

        Ray ray = _interactionCamera.ScreenPointToRay(Mouse.current.position.ReadValue());
        if (!Physics.Raycast(ray, out RaycastHit hit))
        {
            return;
        }

        GameObject rootObject = FindDirectSceneChild(hit.collider.transform);
        if (rootObject != null && _selectionNodeByObject.TryGetValue(rootObject, out string nodeId))
        {
            UnityIframeBridgeManager.Instance?.ReportObjectSelected(nodeId, rootObject.name);
        }
    }

    private GameObject FindDirectSceneChild(Transform transform)
    {
        if (_sceneRoot == null)
        {
            return null;
        }

        Transform current = transform;
        while (current != null && current.parent != _sceneRoot)
        {
            current = current.parent;
        }

        return current != null && current.parent == _sceneRoot ? current.gameObject : null;
    }

    private void EnsureClickCollider(GameObject target)
    {
        if (target.GetComponent<Collider>() != null)
        {
            return;
        }

        Renderer renderer = target.GetComponent<Renderer>();
        if (renderer == null)
        {
            return;
        }

        BoxCollider collider = target.AddComponent<BoxCollider>();
        collider.center = renderer.localBounds.center;
        collider.size = renderer.localBounds.size;
    }

    private void ApplyContextFade(GameObject target)
    {
        if (target == null || IsGroundObject(target) || _contextFadeMaterial == null)
        {
            return;
        }

        Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
        for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
        {
            Renderer renderer = renderers[rendererIndex];
            if (renderer == null || _activeContextFades.ContainsKey(renderer))
            {
                continue;
            }

            Material[] originalMaterials = renderer.sharedMaterials;
            Material[] runtimeMaterials = new Material[originalMaterials.Length];
            for (int materialIndex = 0; materialIndex < originalMaterials.Length; materialIndex++)
            {
                Material originalMaterial = originalMaterials[materialIndex];
                if (originalMaterial == null)
                {
                    continue;
                }

                Material runtimeMaterial = new Material(_contextFadeMaterial)
                {
                    name = $"{_contextFadeMaterial.name} (Runtime Context)"
                };
                CopyOriginalAppearance(originalMaterial, runtimeMaterial);
                if (runtimeMaterial.HasProperty("_Opacity"))
                {
                    runtimeMaterial.SetFloat("_Opacity", _contextOpacity);
                }

                runtimeMaterials[materialIndex] = runtimeMaterial;
            }

            renderer.sharedMaterials = runtimeMaterials;
            _activeContextFades.Add(renderer, new ActiveContextFadeMaterials
            {
                OriginalMaterials = originalMaterials,
                RuntimeMaterials = runtimeMaterials
            });
        }
    }

    private void RestoreContextFade(GameObject target)
    {
        if (target == null)
        {
            return;
        }

        Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
        for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
        {
            RestoreContextFade(renderers[rendererIndex]);
        }
    }

    private void RestoreContextFade(Renderer renderer)
    {
        if (renderer == null || !_activeContextFades.TryGetValue(renderer, out ActiveContextFadeMaterials activeMaterials))
        {
            return;
        }

        renderer.sharedMaterials = activeMaterials.OriginalMaterials;
        for (int materialIndex = 0; materialIndex < activeMaterials.RuntimeMaterials.Length; materialIndex++)
        {
            if (activeMaterials.RuntimeMaterials[materialIndex] != null)
            {
                Destroy(activeMaterials.RuntimeMaterials[materialIndex]);
            }
        }

        _activeContextFades.Remove(renderer);
    }

    private void RestoreAllContextFades()
    {
        List<Renderer> renderers = new List<Renderer>(_activeContextFades.Keys);
        for (int rendererIndex = 0; rendererIndex < renderers.Count; rendererIndex++)
        {
            RestoreContextFade(renderers[rendererIndex]);
        }
    }

    private bool IsGroundObject(GameObject target)
    {
        return target != null && _groundObjectSet.Contains(target);
    }

    private bool IsPersistentFlowObject(GameObject target)
    {
        return target != null && _persistentFlowObjectSet.Contains(target);
    }

    private static void CopyOriginalAppearance(Material original, Material target)
    {
        if (original == null || target == null)
        {
            return;
        }

        CopyTexture(original, target, "_BaseMap", "_BaseMap");
        CopyTexture(original, target, "_MainTex", "_BaseMap");
        CopyTexture(original, target, "_BumpMap", "_BumpMap");
        CopyTexture(original, target, "_MetallicGlossMap", "_MetallicGlossMap");

        if (target.HasProperty("_BaseColor"))
        {
            if (original.HasProperty("_BaseColor"))
            {
                target.SetColor("_BaseColor", original.GetColor("_BaseColor"));
            }
            else if (original.HasProperty("_Color"))
            {
                target.SetColor("_BaseColor", original.GetColor("_Color"));
            }
        }

        CopyFloat(original, target, "_Metallic");
        CopyFloat(original, target, "_Smoothness");
        CopyFloat(original, target, "_BumpScale");
    }

    private static void CopyTexture(Material source, Material target, string sourceProperty, string targetProperty)
    {
        if (!source.HasProperty(sourceProperty) || !target.HasProperty(targetProperty))
        {
            return;
        }

        Texture texture = source.GetTexture(sourceProperty);
        if (texture == null)
        {
            return;
        }

        target.SetTexture(targetProperty, texture);
        target.SetTextureScale(targetProperty, source.GetTextureScale(sourceProperty));
        target.SetTextureOffset(targetProperty, source.GetTextureOffset(sourceProperty));
    }

    private static void CopyFloat(Material source, Material target, string property)
    {
        if (source.HasProperty(property) && target.HasProperty(property))
        {
            target.SetFloat(property, source.GetFloat(property));
        }
    }

    private static bool TryNormalizeUnit(string unitId, out string normalizedUnitId)
    {
        if (string.IsNullOrWhiteSpace(unitId) || string.Equals(unitId, AllUnitsId, StringComparison.OrdinalIgnoreCase))
        {
            normalizedUnitId = AllUnitsId;
            return true;
        }

        if (unitId == "1" || string.Equals(unitId, "unit-1", StringComparison.OrdinalIgnoreCase) || string.Equals(unitId, "unit.ccgt.1", StringComparison.OrdinalIgnoreCase))
        {
            normalizedUnitId = "1";
            return true;
        }

        if (unitId == "2" || string.Equals(unitId, "unit-2", StringComparison.OrdinalIgnoreCase) || string.Equals(unitId, "unit.ccgt.2", StringComparison.OrdinalIgnoreCase))
        {
            normalizedUnitId = "2";
            return true;
        }

        normalizedUnitId = string.Empty;
        return false;
    }

    private bool TryCalculateBounds(IReadOnlyList<string> nodeIds, out Bounds bounds)
    {
        bounds = new Bounds();
        bool hasBounds = false;
        for (int nodeIndex = 0; nodeIndex < nodeIds.Count; nodeIndex++)
        {
            if (!_nodesById.TryGetValue(nodeIds[nodeIndex], out SceneNodeBinding node) || !TryCalculateBounds(node.Targets, out Bounds nodeBounds))
            {
                continue;
            }

            if (!hasBounds)
            {
                bounds = nodeBounds;
                hasBounds = true;
            }
            else
            {
                bounds.Encapsulate(nodeBounds);
            }
        }

        return hasBounds;
    }

    private static bool TryCalculateBounds(GameObject[] targets, out Bounds bounds)
    {
        bounds = new Bounds();
        bool hasBounds = false;
        for (int targetIndex = 0; targetIndex < targets.Length; targetIndex++)
        {
            GameObject target = targets[targetIndex];
            if (target == null)
            {
                continue;
            }

            Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
            for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
            {
                Renderer renderer = renderers[rendererIndex];
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
        }

        return hasBounds;
    }

    private static SceneNodeBinding CreateNode(string id, GameObject[] targets)
    {
        return new SceneNodeBinding(id, targets);
    }

}

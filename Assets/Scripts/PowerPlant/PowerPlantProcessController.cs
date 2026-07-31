using System;
using System.Collections.Generic;
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

    [Serializable]
    private sealed class FlowRouteBinding
    {
        [SerializeField] private string _id;
        [SerializeField] private Renderer[] _renderers;
        [SerializeField] private Material _flowMaterialTemplate;
        [SerializeField] private float _speedMultiplier = 1f;

        public string Id => _id;
        public Renderer[] Renderers => _renderers;
        public Material FlowMaterialTemplate => _flowMaterialTemplate;
        public float SpeedMultiplier => _speedMultiplier;

        public FlowRouteBinding(string id, Renderer[] renderers, Material flowMaterialTemplate, float speedMultiplier)
        {
            _id = id;
            _renderers = renderers;
            _flowMaterialTemplate = flowMaterialTemplate;
            _speedMultiplier = speedMultiplier;
        }
    }

    private sealed class ActiveFlowMaterials
    {
        public Renderer Renderer;
        public Material[] OriginalMaterials;
        public Material[] RuntimeMaterials;
    }

    private sealed class ActiveContextFadeMaterials
    {
        public Material[] OriginalMaterials;
        public Material[] RuntimeMaterials;
    }

    [Header("场景引用")]
    [SerializeField] private Transform _sceneRoot;
    [SerializeField] private Camera _interactionCamera;
    [SerializeField] private Material _gasFlowMaterial;
    [SerializeField] private Material _contextFadeMaterial;
    [SerializeField, Range(0.05f, 0.95f)] private float _contextOpacity = 0.22f;
    [SerializeField] private GameObject[] _groundObjects = Array.Empty<GameObject>();

    [Header("运行时相机")]
    [SerializeField, Min(0.15f)] private float _cameraTransitionDuration = 1.45f;
    [SerializeField, Range(25f, 80f)] private float _focusFieldOfView = 52f;
    [SerializeField] private Vector3 _cameraViewDirection = new Vector3(1f, 0.65f, -1f);

    [Header("由场景配置工具写入")]
    [SerializeField] private SceneNodeBinding[] _nodes = Array.Empty<SceneNodeBinding>();
    [SerializeField] private FlowRouteBinding[] _routes = Array.Empty<FlowRouteBinding>();

    private readonly Dictionary<string, SceneNodeBinding> _nodesById = new Dictionary<string, SceneNodeBinding>(StringComparer.Ordinal);
    private readonly Dictionary<string, FlowRouteBinding> _routesById = new Dictionary<string, FlowRouteBinding>(StringComparer.Ordinal);
    private readonly Dictionary<GameObject, bool> _initialRootActiveStates = new Dictionary<GameObject, bool>();
    private readonly Dictionary<GameObject, string> _selectionNodeByObject = new Dictionary<GameObject, string>();
    private readonly Dictionary<string, List<ActiveFlowMaterials>> _activeFlowsByRoute = new Dictionary<string, List<ActiveFlowMaterials>>(StringComparer.Ordinal);
    private readonly Dictionary<Renderer, ActiveContextFadeMaterials> _activeContextFades = new Dictionary<Renderer, ActiveContextFadeMaterials>();
    private readonly HashSet<GameObject> _groundObjectSet = new HashSet<GameObject>();

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
    }

    private void Update()
    {
        UpdateCameraTransition();
        HandlePointerSelection();
    }

    private void OnDestroy()
    {
        StopAllFlows();
        RestoreAllContextFades();
    }

    /// <summary>
    /// 由编辑器配置命令写入与当前 SampleScene 对应的稳定绑定。运行时不依赖模型显示名称。
    /// </summary>
    public void ConfigureForCurrentSampleScene(Transform sceneRoot, Camera interactionCamera, Material gasFlowMaterial, Material contextFadeMaterial)
    {
        _sceneRoot = sceneRoot;
        _interactionCamera = interactionCamera;
        _gasFlowMaterial = gasFlowMaterial;
        _contextFadeMaterial = contextFadeMaterial;
        _groundObjects = FindObjects(sceneRoot, "地面1", "地面2");

        GameObject[] overview = GetDirectChildren(sceneRoot);

        _nodes = new[]
        {
            CreateNode("plant.overview", overview),
            CreateNode("unit.ccgt.1.gas-train", FindObjects(sceneRoot,
                "进气室1", "进气室1外壳", "进气室支架2", "燃气轮机1", "燃机发电机1", "余热锅炉1", "管道5", "管道6", "启动马达1", "启动马达1外壳", "控制站1")),
            CreateNode("unit.ccgt.1.steam-train", FindObjects(sceneRoot,
                "汽轮机1", "汽轮发电机1", "冷凝器1", "管道1", "管道2")),
            CreateNode("unit.ccgt.2.gas-train", FindObjects(sceneRoot,
                "进气室2", "进气室2外壳", "进气室支架1", "燃气轮机2", "燃机发电机2", "余热锅炉2", "管道7", "管道9", "启动马达2", "启动马达外壳2", "控制站2")),
            CreateNode("unit.ccgt.2.steam-train", FindObjects(sceneRoot,
                "汽轮机2", "汽轮发电机2", "冷凝器2", "管道3", "管道4")),
            CreateNode("utility.grid", FindObjects(sceneRoot,
                "升压站", "电网打组", "电网电线", "配电变电站", "开关站+降压站", "降压变电站")),

            CreateNode("node.inlet.1", FindObjects(sceneRoot, "进气室1", "进气室1外壳", "进气室支架2", "管道5")),
            CreateNode("node.gas-turbine.1", FindObjects(sceneRoot, "燃气轮机1")),
            CreateNode("node.gas-generator.1", FindObjects(sceneRoot, "燃机发电机1", "启动马达1", "启动马达1外壳")),
            CreateNode("node.hrsg.1", FindObjects(sceneRoot, "余热锅炉1", "管道6")),
            CreateNode("node.steam-turbine.1", FindObjects(sceneRoot, "汽轮机1")),
            CreateNode("node.steam-generator.1", FindObjects(sceneRoot, "汽轮发电机1", "管道1")),
            CreateNode("node.condenser.1", FindObjects(sceneRoot, "冷凝器1", "管道2")),

            CreateNode("node.inlet.2", FindObjects(sceneRoot, "进气室2", "进气室2外壳", "进气室支架1", "管道7")),
            CreateNode("node.gas-turbine.2", FindObjects(sceneRoot, "燃气轮机2")),
            CreateNode("node.gas-generator.2", FindObjects(sceneRoot, "燃机发电机2", "启动马达2", "启动马达外壳2")),
            CreateNode("node.hrsg.2", FindObjects(sceneRoot, "余热锅炉2", "管道9")),
            CreateNode("node.steam-turbine.2", FindObjects(sceneRoot, "汽轮机2")),
            CreateNode("node.steam-generator.2", FindObjects(sceneRoot, "汽轮发电机2", "管道3")),
            CreateNode("node.condenser.2", FindObjects(sceneRoot, "冷凝器2", "管道4")),
            CreateNode("node.grid", FindObjects(sceneRoot,
                "升压站", "电网打组", "电网电线", "配电变电站", "开关站+降压站", "降压变电站"))
        };

        _routes = new[]
        {
            CreateRoute("route.exhaust-to-hrsg.1", FindRenderers(sceneRoot, "管道6"), gasFlowMaterial, 1f),
            CreateRoute("route.exhaust-to-hrsg.2", FindRenderers(sceneRoot, "管道9"), gasFlowMaterial, 1f)
        };

        CacheSceneBindings();
    }

    /// <summary>
    /// 进入一个已配置流程步骤。成功时所有显隐与流动路由会以当前状态整体替换，不会叠加上一步效果。
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

        if (!TryResolveStep(stepId, normalizedUnitId, out List<string> visibleNodeIds, out string focusNodeId, out List<string> routeIds))
        {
            message = $"不支持或尚未配置的流程步骤：{stepId}";
            return false;
        }

        StopAllFlows();
        if (isolate)
        {
            SetIsolatedVisibility(visibleNodeIds);
        }
        else
        {
            RestoreInitialVisibility();
        }

        for (int index = 0; index < routeIds.Count; index++)
        {
            if (!TrySetRouteFlow(routeIds[index], true, 1f, out string routeMessage))
            {
                Debug.LogWarning($"[{nameof(PowerPlantProcessController)}] {routeMessage}", this);
            }
        }

        FocusProcessTargets(focusNodeId, visibleNodeIds, normalizedUnitId);
        _currentProcessId = processId;
        _currentStepId = stepId;
        _currentUnitId = normalizedUnitId;
        message = $"已进入 {stepId}（机组：{normalizedUnitId}）。";
        return true;
    }

    public bool TryResetScene(out string message)
    {
        StopAllFlows();
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

        if (isolate)
        {
            StopAllFlows();
            SetIsolatedVisibility(new List<string> { nodeId });
        }

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

    public bool TrySetRouteFlow(string routeId, bool enabled, float speedMultiplier, out string message)
    {
        if (!_routesById.TryGetValue(routeId, out FlowRouteBinding route))
        {
            message = $"未知或尚未配置的流动路由：{routeId}";
            return false;
        }

        StopRouteFlow(routeId);
        if (!enabled)
        {
            message = $"已停止路由：{routeId}";
            return true;
        }

        if (route.FlowMaterialTemplate == null)
        {
            message = $"路由未配置流动材质：{routeId}";
            return false;
        }

        List<ActiveFlowMaterials> activeMaterials = new List<ActiveFlowMaterials>();
        Renderer[] renderers = route.Renderers;
        for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
        {
            Renderer renderer = renderers[rendererIndex];
            if (renderer == null)
            {
                continue;
            }

            RestoreContextFade(renderer);
            Material[] originalMaterials = renderer.sharedMaterials;
            Material[] runtimeMaterials = new Material[originalMaterials.Length];
            for (int materialIndex = 0; materialIndex < originalMaterials.Length; materialIndex++)
            {
                if (originalMaterials[materialIndex] == null)
                {
                    continue;
                }

                Material runtimeMaterial = new Material(route.FlowMaterialTemplate)
                {
                    name = $"{route.FlowMaterialTemplate.name} (Runtime {routeId})"
                };
                CopyOriginalAppearance(originalMaterials[materialIndex], runtimeMaterial);
                if (runtimeMaterial.HasProperty("_FlowSpeed"))
                {
                    runtimeMaterial.SetFloat("_FlowSpeed", runtimeMaterial.GetFloat("_FlowSpeed") * route.SpeedMultiplier * speedMultiplier);
                }

                runtimeMaterials[materialIndex] = runtimeMaterial;
            }

            renderer.sharedMaterials = runtimeMaterials;
            activeMaterials.Add(new ActiveFlowMaterials
            {
                Renderer = renderer,
                OriginalMaterials = originalMaterials,
                RuntimeMaterials = runtimeMaterials
            });
        }

        _activeFlowsByRoute[routeId] = activeMaterials;
        message = $"已启用路由：{routeId}";
        return true;
    }

    public string GetStateDescription()
    {
        return $"process={_currentProcessId};step={_currentStepId};unit={_currentUnitId}";
    }

    private void CacheSceneBindings()
    {
        _nodesById.Clear();
        _routesById.Clear();
        _selectionNodeByObject.Clear();
        _initialRootActiveStates.Clear();
        _groundObjectSet.Clear();

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

        for (int routeIndex = 0; routeIndex < _routes.Length; routeIndex++)
        {
            FlowRouteBinding route = _routes[routeIndex];
            if (route != null && !string.IsNullOrWhiteSpace(route.Id))
            {
                _routesById[route.Id] = route;
            }
        }
    }

    private bool TryResolveStep(string stepId, string unitId, out List<string> visibleNodeIds, out string focusNodeId, out List<string> routeIds)
    {
        visibleNodeIds = new List<string>();
        routeIds = new List<string>();
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
                AddExhaustRouteIds(routeIds, unitId);
                focusNodeId = unitId == AllUnitsId ? "plant.overview" : $"node.gas-turbine.{unitId}";
                return true;

            case "hrsg":
                AddUnitNodeIds(visibleNodeIds, unitId, "gas-train");
                AddExhaustRouteIds(routeIds, unitId);
                focusNodeId = unitId == AllUnitsId ? "plant.overview" : $"node.hrsg.{unitId}";
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

    private static void AddExhaustRouteIds(List<string> destination, string unitId)
    {
        if (unitId == AllUnitsId || unitId == "1")
        {
            destination.Add("route.exhaust-to-hrsg.1");
        }

        if (unitId == AllUnitsId || unitId == "2")
        {
            destination.Add("route.exhaust-to-hrsg.2");
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
            if (visibleObjects.Contains(target) || IsGroundObject(target))
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

    private void StopAllFlows()
    {
        List<string> routeIds = new List<string>(_activeFlowsByRoute.Keys);
        for (int index = 0; index < routeIds.Count; index++)
        {
            StopRouteFlow(routeIds[index]);
        }
    }

    private void StopRouteFlow(string routeId)
    {
        if (!_activeFlowsByRoute.TryGetValue(routeId, out List<ActiveFlowMaterials> activeMaterials))
        {
            return;
        }

        for (int assignmentIndex = 0; assignmentIndex < activeMaterials.Count; assignmentIndex++)
        {
            ActiveFlowMaterials assignment = activeMaterials[assignmentIndex];
            if (assignment.Renderer != null)
            {
                assignment.Renderer.sharedMaterials = assignment.OriginalMaterials;
            }

            for (int materialIndex = 0; materialIndex < assignment.RuntimeMaterials.Length; materialIndex++)
            {
                if (assignment.RuntimeMaterials[materialIndex] != null)
                {
                    Destroy(assignment.RuntimeMaterials[materialIndex]);
                }
            }
        }

        _activeFlowsByRoute.Remove(routeId);
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

    private static FlowRouteBinding CreateRoute(string id, Renderer[] renderers, Material flowMaterialTemplate, float speedMultiplier)
    {
        return new FlowRouteBinding(id, renderers, flowMaterialTemplate, speedMultiplier);
    }

    private static GameObject[] GetDirectChildren(Transform root)
    {
        if (root == null)
        {
            return Array.Empty<GameObject>();
        }

        GameObject[] children = new GameObject[root.childCount];
        for (int index = 0; index < root.childCount; index++)
        {
            children[index] = root.GetChild(index).gameObject;
        }

        return children;
    }

    private static GameObject[] FindObjects(Transform root, params string[] names)
    {
        List<GameObject> targets = new List<GameObject>();
        if (root == null)
        {
            return targets.ToArray();
        }

        for (int nameIndex = 0; nameIndex < names.Length; nameIndex++)
        {
            Transform target = root.Find(names[nameIndex]);
            if (target == null)
            {
                Debug.LogWarning($"[{nameof(PowerPlantProcessController)}] 找不到映射对象：{names[nameIndex]}");
                continue;
            }

            targets.Add(target.gameObject);
        }

        return targets.ToArray();
    }

    private static Renderer[] FindRenderers(Transform root, params string[] names)
    {
        List<Renderer> renderers = new List<Renderer>();
        GameObject[] objects = FindObjects(root, names);
        for (int index = 0; index < objects.Length; index++)
        {
            Renderer renderer = objects[index].GetComponent<Renderer>();
            if (renderer != null)
            {
                renderers.Add(renderer);
            }
        }

        return renderers.ToArray();
    }
}

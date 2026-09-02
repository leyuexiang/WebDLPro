using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 第三层关键环节的目录驱动协调器。场景、流程、状态节点、资源和动态目标均由目录及包装预制体
    /// 的显式序列化引用提供；该组件不依赖燃气、燃机或任何模型名称。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class ProcessDetailCoordinator : MonoBehaviour
    {
        private const int MaxTrackedProcessDetailTransitions = 64;
        private const float MinimumRemoteDisplayDistance = 1000f;
        private const float MaximumCameraDistanceFromDisplay = 500f;

        [Header("第三层目录与加载器")]
        [SerializeField] private string _sceneId;
        [SerializeField] private ProcessDetailCatalog _catalog;
        [SerializeField] private MonoBehaviour _resourceLoaderBehaviour;
        [SerializeField] private Transform _detailMount;

        [Header("二层业务场景返回上下文")]
        [SerializeField] private Transform _businessSceneRoot;
        [SerializeField] private Behaviour _secondLayerInteractionController;
        [SerializeField] private MonoBehaviour _cameraControllerBehaviour;

        private IProcessDetailResourceLoader _resourceLoader;
        private IBusinessSceneCameraSnapshotController _cameraController;
        private IBusinessSceneInteractionGate _interactionGate;
        private ProcessDetailResourceRuntime _activeRuntime;
        private IProcessDetailMultiBindingController _activeInstance;
        private ProcessDetailCatalogEntry _activeEntry;
        private ProcessDetailResourceRuntime _preparedRuntime;
        private IProcessDetailMultiBindingController _preparedInstance;
        private ProcessDetailCatalogEntry _preparedEntry;
        private BusinessSceneCameraPoseSnapshot _preparedReturnCameraPose;
        private string _preparedTransitionId = string.Empty;
        private BusinessSceneCameraPoseSnapshot _returnCameraPose;
        private BusinessSceneCommandResult _initializationResult;
        private readonly Dictionary<string, BusinessSceneNodeVisualState> _latestVisualStates =
            new Dictionary<string, BusinessSceneNodeVisualState>(StringComparer.Ordinal);
        private bool _interactionWasBlocked;
        private bool _initialized;
        private bool _prepareInProgress;
        private bool _released;
        private int _generation;
        private readonly Queue<string> _observedEnterTransitionOrder = new Queue<string>();
        private readonly HashSet<string> _observedEnterTransitionIds = new HashSet<string>(StringComparer.Ordinal);
        private readonly Queue<string> _processedExitTransitionOrder = new Queue<string>();
        private readonly HashSet<string> _processedExitTransitionIds = new HashSet<string>(StringComparer.Ordinal);
        private string _pendingEnterTransitionId = string.Empty;
        private string _activeEnterTransitionId = string.Empty;

        public bool IsActive => _activeInstance != null && _activeRuntime?.Root != null;
        public bool HasPreparedProcessDetail => _preparedInstance != null && _preparedRuntime?.Root != null;
        public bool BlocksBusinessSceneInteractions => !_released && IsActive;
        public string ActiveProcessDetailId => _activeEntry?.ProcessDetailId ?? string.Empty;
        public string PreparedProcessDetailId => _preparedEntry?.ProcessDetailId ?? string.Empty;
        public string ActiveEnterTransitionId => _activeEnterTransitionId;
        public ProcessDetailResourceRuntimeState ResourceState => _activeRuntime?.State ??
            _preparedRuntime?.State ?? ProcessDetailResourceRuntimeState.Idle;

        private void Awake()
        {
            Initialize();
        }

        /// <summary>只接受当前业务场景的目录项，初始化失败时不创建部分资源运行时。</summary>
        public BusinessSceneCommandResult Initialize()
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Failed("process-detail-coordinator-released", "关键环节协调器已经释放。");
            }
            if (_initialized)
            {
                return _initializationResult;
            }

            _resourceLoader = _resourceLoaderBehaviour as IProcessDetailResourceLoader;
            _cameraController = _cameraControllerBehaviour as IBusinessSceneCameraSnapshotController;
            _interactionGate = _secondLayerInteractionController as IBusinessSceneInteractionGate;
            if (!BusinessSceneCatalog.IsRequiredSceneId(_sceneId) || _catalog == null ||
                _catalog.ValidateForRuntime().Count > 0 || _resourceLoader == null || _cameraController == null ||
                _interactionGate == null || _detailMount == null || _businessSceneRoot == null)
            {
                _initializationResult = BusinessSceneCommandResult.Failed(
                    "process-detail-coordinator-binding-invalid",
                    "关键环节协调器缺少合法场景目录、加载器、挂载点、二层交互门或相机快照控制器。");
                return _initializationResult;
            }
            if (_detailMount.IsChildOf(_businessSceneRoot))
            {
                _initializationResult = BusinessSceneCommandResult.Failed(
                    "process-detail-mount-invalid",
                    "第三层挂载点不能位于第二层业务场景根节点内。");
                return _initializationResult;
            }

            _initialized = true;
            _initializationResult = BusinessSceneCommandResult.Completed("关键环节目录协调器初始化完成。");
            return _initializationResult;
        }

        /// <summary>
        /// 第一阶段仅隐藏加载、校验远端锚点并重放最新状态。当前活动环节、第二层资源和相机均保持不变。
        /// 新准备事务会取消尚未完成的旧候选，但不会影响已经提交的活动实例。
        /// </summary>
        public IEnumerator PrepareAsync(string sceneId, string processId, string stepId, string processDetailId,
            string transitionId, Action<BusinessSceneCommandResult> completed)
        {
            if (!_initialized && !Initialize().Success)
            {
                completed?.Invoke(_initializationResult);
                yield break;
            }
            if (_released)
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed("process-detail-coordinator-released", "关键环节协调器已经释放。"));
                yield break;
            }
            if (!TryResolveEntry(sceneId, processId, stepId, processDetailId, transitionId,
                    out ProcessDetailCatalogEntry entry, out BusinessSceneCommandResult mappingResult))
            {
                completed?.Invoke(mappingResult);
                yield break;
            }
            if (IsActive && string.Equals(ActiveProcessDetailId, processDetailId, StringComparison.Ordinal) &&
                string.Equals(_activeEnterTransitionId, transitionId, StringComparison.Ordinal))
            {
                completed?.Invoke(BusinessSceneCommandResult.Completed("同一事务的关键环节已经提交。"));
                yield break;
            }
            if (HasPreparedProcessDetail && string.Equals(PreparedProcessDetailId, processDetailId, StringComparison.Ordinal) &&
                string.Equals(_preparedTransitionId, transitionId, StringComparison.Ordinal))
            {
                completed?.Invoke(BusinessSceneCommandResult.Completed("同一事务的关键环节已经准备完成。"));
                yield break;
            }

            CancelPreparedInternal();
            int prepareGeneration = ++_generation;
            _prepareInProgress = true;
            _pendingEnterTransitionId = transitionId;
            RememberTransition(transitionId, _observedEnterTransitionOrder, _observedEnterTransitionIds);
            ProcessDetailResourceRuntime candidateRuntime = new ProcessDetailResourceRuntime(_sceneId);
            _preparedRuntime = candidateRuntime;
            BusinessSceneCameraPoseSnapshot candidateReturnPose = IsActive
                ? _returnCameraPose
                : _cameraController.CaptureCurrentPose();
            bool preparedSuccessfully = false;
            try
            {
                BusinessSceneCommandResult loadResult = default;
                IEnumerator loading = candidateRuntime.LoadAsync(entry, _resourceLoader, _detailMount, result => loadResult = result);
                try
                {
                    while (loading.MoveNext())
                    {
                        yield return loading.Current;
                    }
                }
                finally
                {
                    (loading as IDisposable)?.Dispose();
                }

                if (!IsCurrentPreparingTransaction(prepareGeneration, transitionId, candidateRuntime))
                {
                    completed?.Invoke(BusinessSceneCommandResult.Failed("process-detail-prepare-superseded", "关键环节准备已被新事务取代。"));
                    yield break;
                }
                if (!loadResult.Success || candidateRuntime.Root == null)
                {
                    completed?.Invoke(loadResult.Success
                        ? BusinessSceneCommandResult.Failed("process-detail-root-missing", "关键环节加载成功但缺少实例根对象。")
                        : loadResult);
                    yield break;
                }

                IProcessDetailMultiBindingController instance = ResolveSingleInstanceController(candidateRuntime.Root, out string bindingError);
                if (instance == null)
                {
                    completed?.Invoke(BusinessSceneCommandResult.Failed("process-detail-instance-binding-invalid", bindingError));
                    yield break;
                }
                BusinessSceneCommandResult validationResult = instance.ValidateBinding(entry);
                if (!validationResult.Success)
                {
                    instance.ReleaseInstance();
                    completed?.Invoke(validationResult);
                    yield break;
                }
                BusinessSceneCommandResult placementResult = ValidateRemotePlacement(instance);
                if (!placementResult.Success)
                {
                    instance.ReleaseInstance();
                    completed?.Invoke(placementResult);
                    yield break;
                }

                BusinessSceneCommandResult replayResult = instance.PrepareForActivation(_latestVisualStates);
                if (!replayResult.Success || !IsCurrentPreparingTransaction(prepareGeneration, transitionId, candidateRuntime))
                {
                    instance.ReleaseInstance();
                    completed?.Invoke(replayResult.Success
                        ? BusinessSceneCommandResult.Failed("process-detail-prepare-superseded", "状态重放完成前准备事务已失效。")
                        : replayResult);
                    yield break;
                }

                _preparedInstance = instance;
                _preparedEntry = entry;
                _preparedReturnCameraPose = candidateReturnPose;
                _preparedTransitionId = transitionId;
                _prepareInProgress = false;
                _pendingEnterTransitionId = string.Empty;
                preparedSuccessfully = true;
                completed?.Invoke(BusinessSceneCommandResult.Completed("关键环节已隐藏加载、完成状态重放并等待提交。"));
            }
            finally
            {
                if (!preparedSuccessfully && ReferenceEquals(_preparedRuntime, candidateRuntime))
                {
                    candidateRuntime.Dispose();
                    _preparedRuntime = null;
                    _preparedInstance = null;
                    _preparedEntry = null;
                    _preparedTransitionId = string.Empty;
                    _prepareInProgress = false;
                    _pendingEnterTransitionId = string.Empty;
                }
            }
        }

        /// <summary>
        /// 第二阶段只提交已完成校验的候选：保持第二层资源活动，阻断本地点击，切换可见实例和显式相机位。
        /// 同场景直接切换时旧实例在候选显示后才释放，避免返回第二层或产生空白帧。
        /// </summary>
        public BusinessSceneCommandResult CommitPrepared(string sceneId, string processDetailId, string transitionId)
        {
            if (!_initialized && !Initialize().Success)
            {
                return _initializationResult;
            }
            if (_released || !IsValidSceneAndDetail(sceneId, processDetailId) ||
                !SceneSwitchProtocolValidator.IsBoundedIdentifier(transitionId))
            {
                return _released
                    ? BusinessSceneCommandResult.Failed("process-detail-coordinator-released", "关键环节协调器已经释放。")
                    : BusinessSceneCommandResult.Failed("process-detail-commit-mismatch", "提交命令与当前场景关键环节目录不一致。");
            }
            if (IsActive && string.Equals(ActiveProcessDetailId, processDetailId, StringComparison.Ordinal) &&
                string.Equals(_activeEnterTransitionId, transitionId, StringComparison.Ordinal))
            {
                return BusinessSceneCommandResult.Completed("同一关键环节提交事务已经完成。");
            }
            if (!HasPreparedProcessDetail || !string.Equals(PreparedProcessDetailId, processDetailId, StringComparison.Ordinal) ||
                !string.Equals(_preparedTransitionId, transitionId, StringComparison.Ordinal))
            {
                return BusinessSceneCommandResult.Failed("process-detail-not-prepared", "目标关键环节尚未由同一事务准备完成。");
            }

            // 准备与提交之间可能收到新快照，提交前同步重放，随后不跨帧直接显示。
            BusinessSceneCommandResult replayResult = _preparedInstance.PrepareForActivation(_latestVisualStates);
            if (!replayResult.Success)
            {
                return replayResult;
            }

            ProcessDetailResourceRuntime previousRuntime = _activeRuntime;
            IProcessDetailMultiBindingController previousInstance = _activeInstance;
            if (!IsActive)
            {
                _returnCameraPose = _preparedReturnCameraPose;
                _interactionWasBlocked = _interactionGate.InteractionsBlocked;
            }
            else if (previousRuntime?.Root != null)
            {
                previousRuntime.Root.SetActive(false);
            }

            _interactionGate.SetInteractionsBlocked(true);
            _preparedRuntime.Root.SetActive(true);
            _cameraController.MoveToPose(_preparedInstance.CameraPose);
            _activeRuntime = _preparedRuntime;
            _activeInstance = _preparedInstance;
            _activeEntry = _preparedEntry;
            _activeEnterTransitionId = transitionId;
            _preparedRuntime = null;
            _preparedInstance = null;
            _preparedEntry = null;
            _preparedTransitionId = string.Empty;

            if (previousInstance != null)
            {
                previousInstance.StopForRelease();
                previousInstance.ReleaseInstance();
                previousRuntime?.Dispose();
            }
            return BusinessSceneCommandResult.Completed("关键环节已提交；第二层资源保持加载并已切换到专用相机位。");
        }

        public BusinessSceneCommandResult AbortPrepared(string sceneId, string processDetailId, string transitionId)
        {
            if (!_initialized && !Initialize().Success)
            {
                return _initializationResult;
            }
            if (_released || !IsValidSceneAndDetail(sceneId, processDetailId) ||
                !SceneSwitchProtocolValidator.IsBoundedIdentifier(transitionId))
            {
                return _released
                    ? BusinessSceneCommandResult.Failed("process-detail-coordinator-released", "关键环节协调器已经释放。")
                    : BusinessSceneCommandResult.Failed("process-detail-abort-mismatch", "取消命令与当前场景关键环节目录不一致。");
            }
            if (!HasPreparedProcessDetail && !_prepareInProgress)
            {
                return BusinessSceneCommandResult.Completed("当前没有待提交的关键环节候选。");
            }
            if (!string.Equals(_preparedTransitionId, transitionId, StringComparison.Ordinal) &&
                !string.Equals(_pendingEnterTransitionId, transitionId, StringComparison.Ordinal))
            {
                return BusinessSceneCommandResult.Failed("process-detail-abort-mismatch", "取消命令不属于当前准备事务。");
            }

            CancelPreparedInternal();
            return BusinessSceneCommandResult.Completed("已取消关键环节准备，当前稳定视图保持不变。");
        }

        /// <summary>旧命令兼容路径；新事务应由网页显式调用准备和提交。</summary>
        public IEnumerator EnterAsync(string sceneId, string processId, string stepId, string processDetailId,
            string transitionId, Action<BusinessSceneCommandResult> completed)
        {
            BusinessSceneCommandResult prepareResult = default;
            IEnumerator preparing = PrepareAsync(sceneId, processId, stepId, processDetailId, transitionId,
                result => prepareResult = result);
            try
            {
                while (preparing.MoveNext())
                {
                    yield return preparing.Current;
                }
            }
            finally
            {
                (preparing as IDisposable)?.Dispose();
            }
            completed?.Invoke(prepareResult.Success
                ? CommitPrepared(sceneId, processDetailId, transitionId)
                : prepareResult);
        }

        public BusinessSceneCommandResult Exit(string sceneId, string processDetailId, string transitionId)
        {
            if (!_initialized && !Initialize().Success)
            {
                return _initializationResult;
            }
            if (_released || !IsValidSceneAndDetail(sceneId, processDetailId) ||
                !SceneSwitchProtocolValidator.IsBoundedIdentifier(transitionId))
            {
                return _released
                    ? BusinessSceneCommandResult.Failed("process-detail-coordinator-released", "关键环节协调器已经释放。")
                    : BusinessSceneCommandResult.Failed("process-detail-exit-mismatch", "退出命令与当前场景关键环节目录不一致。");
            }
            if (_processedExitTransitionIds.Contains(transitionId))
            {
                return BusinessSceneCommandResult.Completed("同一第三层退出事务已经完成。");
            }

            bool isKnownEnterTransition = _observedEnterTransitionIds.Contains(transitionId);
            if (isKnownEnterTransition && !string.Equals(_pendingEnterTransitionId, transitionId, StringComparison.Ordinal) &&
                !string.Equals(_preparedTransitionId, transitionId, StringComparison.Ordinal) &&
                !string.Equals(_activeEnterTransitionId, transitionId, StringComparison.Ordinal))
            {
                RememberTransition(transitionId, _processedExitTransitionOrder, _processedExitTransitionIds);
                return BusinessSceneCommandResult.Completed("迟到关键环节退出不属于当前实例，已安全忽略。");
            }

            if ((_prepareInProgress && string.Equals(_pendingEnterTransitionId, transitionId, StringComparison.Ordinal)) ||
                (HasPreparedProcessDetail && string.Equals(PreparedProcessDetailId, processDetailId, StringComparison.Ordinal) &&
                 string.Equals(_preparedTransitionId, transitionId, StringComparison.Ordinal)))
            {
                CancelPreparedInternal();
                if (!IsActive)
                {
                    RememberTransition(transitionId, _processedExitTransitionOrder, _processedExitTransitionIds);
                    return BusinessSceneCommandResult.Completed("已取消尚未提交的关键环节准备。");
                }
            }
            if (!IsActive)
            {
                RememberTransition(transitionId, _processedExitTransitionOrder, _processedExitTransitionIds);
                return BusinessSceneCommandResult.Completed("当前没有活动的关键环节实例。");
            }
            if (!string.Equals(ActiveProcessDetailId, processDetailId, StringComparison.Ordinal))
            {
                return BusinessSceneCommandResult.Failed("process-detail-exit-mismatch", "退出命令不属于当前活动关键环节。");
            }

            CancelPreparedInternal();
            _activeInstance.StopForRelease();
            _activeRuntime.Root.SetActive(false);
            _interactionGate.SetInteractionsBlocked(_interactionWasBlocked);
            _cameraController.MoveToSnapshot(_returnCameraPose);
            _activeInstance.ReleaseInstance();
            _activeRuntime.Dispose();
            _activeRuntime = null;
            _activeInstance = null;
            _activeEntry = null;
            _activeEnterTransitionId = string.Empty;
            RememberTransition(transitionId, _processedExitTransitionOrder, _processedExitTransitionIds);
            return BusinessSceneCommandResult.Completed("已恢复业务视图相机并释放关键环节资源；第二层资源始终保持加载。");
        }

        public BusinessSceneCommandResult SetPlayback(string sceneId, string processDetailId, bool playing)
        {
            if (!_initialized && !Initialize().Success)
            {
                return _initializationResult;
            }
            if (_released || !IsValidSceneAndDetail(sceneId, processDetailId))
            {
                return _released
                    ? BusinessSceneCommandResult.Failed("process-detail-coordinator-released", "关键环节协调器已经释放。")
                    : BusinessSceneCommandResult.Failed("process-detail-playback-mismatch", "播放命令与当前场景关键环节目录不一致。");
            }
            if (!IsActive || !string.Equals(ActiveProcessDetailId, processDetailId, StringComparison.Ordinal))
            {
                return BusinessSceneCommandResult.Failed("process-detail-not-active", "目标关键环节当前未激活，无法控制播放。");
            }
            return _activeInstance.SetPlayback(playing);
        }

        /// <summary>缓存当前场景已登记节点，并同步更新活动实例与隐藏候选；不会改变动态播放许可。</summary>
        public BusinessSceneCommandResult UpdateNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState)
        {
            if (!_catalog.ContainsStateNode(_sceneId, sceneNodeId))
            {
                return BusinessSceneCommandResult.Completed("该节点没有登记第三层关键环节状态投影。");
            }
            _latestVisualStates[sceneNodeId] = visualState;
            BusinessSceneCommandResult activeResult = _activeInstance != null && _activeEntry.ContainsStateNode(sceneNodeId)
                ? _activeInstance.ApplyVisualState(sceneNodeId, visualState)
                : BusinessSceneCommandResult.Completed("活动环节无需更新该节点。");
            if (!activeResult.Success)
            {
                return activeResult;
            }
            return _preparedInstance != null && _preparedEntry.ContainsStateNode(sceneNodeId)
                ? _preparedInstance.ApplyVisualState(sceneNodeId, visualState)
                : BusinessSceneCommandResult.Completed("已缓存关键环节最新状态。");
        }

        public BusinessSceneCommandResult ClearNodeVisualState(string sceneNodeId)
        {
            if (!_catalog.ContainsStateNode(_sceneId, sceneNodeId))
            {
                return BusinessSceneCommandResult.Completed("该节点没有登记第三层关键环节状态投影。");
            }
            _latestVisualStates.Remove(sceneNodeId);
            BusinessSceneCommandResult activeResult = _activeInstance != null && _activeEntry.ContainsStateNode(sceneNodeId)
                ? _activeInstance.ClearVisualState(sceneNodeId)
                : BusinessSceneCommandResult.Completed("活动环节无需清除该节点。");
            if (!activeResult.Success)
            {
                return activeResult;
            }
            return _preparedInstance != null && _preparedEntry.ContainsStateNode(sceneNodeId)
                ? _preparedInstance.ClearVisualState(sceneNodeId)
                : BusinessSceneCommandResult.Completed("已清除关键环节缓存状态。");
        }

        public BusinessSceneCommandResult Release()
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Completed("关键环节协调器已经释放。");
            }
            _released = true;
            _generation++;
            CancelPreparedInternal();
            if (_activeInstance != null)
            {
                _activeInstance.StopForRelease();
                _activeInstance.ReleaseInstance();
            }
            _activeRuntime?.Dispose();
            _activeRuntime = null;
            _activeInstance = null;
            _activeEntry = null;
            if (_interactionGate != null)
            {
                _interactionGate.SetInteractionsBlocked(_interactionWasBlocked);
            }
            _latestVisualStates.Clear();
            _prepareInProgress = false;
            _pendingEnterTransitionId = string.Empty;
            _activeEnterTransitionId = string.Empty;
            _observedEnterTransitionOrder.Clear();
            _observedEnterTransitionIds.Clear();
            _processedExitTransitionOrder.Clear();
            _processedExitTransitionIds.Clear();
            _resourceLoader = null;
            _cameraController = null;
            _interactionGate = null;
            return BusinessSceneCommandResult.Completed("关键环节协调器已释放全部独占运行资源。");
        }

        private bool TryResolveEntry(string sceneId, string processId, string stepId, string processDetailId,
            string transitionId, out ProcessDetailCatalogEntry entry, out BusinessSceneCommandResult result)
        {
            entry = null;
            if (!string.Equals(sceneId, _sceneId, StringComparison.Ordinal) ||
                !_catalog.TryGet(sceneId, processDetailId, out entry) ||
                !string.Equals(entry.ProcessId, processId, StringComparison.Ordinal) ||
                !string.Equals(entry.StepId, stepId, StringComparison.Ordinal) ||
                !SceneSwitchProtocolValidator.IsBoundedIdentifier(transitionId))
            {
                result = BusinessSceneCommandResult.Failed("process-detail-mapping-invalid", "关键环节命令与 Unity 本地场景、流程、步骤、环节目录或事务标识不一致。");
                return false;
            }
            result = default;
            return true;
        }

        private bool IsValidSceneAndDetail(string sceneId, string processDetailId)
        {
            return string.Equals(sceneId, _sceneId, StringComparison.Ordinal) &&
                   _catalog.TryGet(sceneId, processDetailId, out _);
        }

        private bool IsCurrentPreparingTransaction(
            int generation,
            string transitionId,
            ProcessDetailResourceRuntime candidateRuntime)
        {
            return generation == _generation && _prepareInProgress &&
                   ReferenceEquals(_preparedRuntime, candidateRuntime) &&
                   string.Equals(_pendingEnterTransitionId, transitionId, StringComparison.Ordinal);
        }

        /// <summary>释放候选槽并提升代际；活动槽、二层资源和相机均不受影响。</summary>
        private void CancelPreparedInternal()
        {
            _generation++;
            _preparedInstance?.StopForRelease();
            _preparedInstance?.ReleaseInstance();
            _preparedRuntime?.Dispose();
            _preparedRuntime = null;
            _preparedInstance = null;
            _preparedEntry = null;
            _preparedTransitionId = string.Empty;
            _preparedReturnCameraPose = default;
            _prepareInProgress = false;
            _pendingEnterTransitionId = string.Empty;
        }

        /// <summary>拒绝仍位于厂区附近或相机位脱离展示区的候选，禁止依靠停用第二层掩盖空间重叠。</summary>
        private BusinessSceneCommandResult ValidateRemotePlacement(IProcessDetailInstanceController instance)
        {
            if (instance?.DisplayAnchor == null || instance.CameraPose == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "process-detail-remote-pose-invalid",
                    "关键环节缺少显式远端展示锚点或专用相机位。");
            }

            float displayDistance = Vector3.Distance(instance.DisplayAnchor.position, _businessSceneRoot.position);
            float cameraDistance = Vector3.Distance(instance.CameraPose.position, instance.DisplayAnchor.position);
            if (displayDistance < MinimumRemoteDisplayDistance || cameraDistance <= 0.01f ||
                cameraDistance > MaximumCameraDistanceFromDisplay)
            {
                return BusinessSceneCommandResult.Failed(
                    "process-detail-remote-pose-invalid",
                    "关键环节展示锚点或相机位未处于合法远端展示区。");
            }
            return BusinessSceneCommandResult.Completed("关键环节远端展示锚点与专用相机位校验完成。");
        }

        private static void RememberTransition(string transitionId, Queue<string> order, HashSet<string> identifiers)
        {
            if (!identifiers.Add(transitionId))
            {
                return;
            }
            order.Enqueue(transitionId);
            while (order.Count > MaxTrackedProcessDetailTransitions)
            {
                identifiers.Remove(order.Dequeue());
            }
        }

        private static IProcessDetailMultiBindingController ResolveSingleInstanceController(GameObject root, out string error)
        {
            error = string.Empty;
            MonoBehaviour[] behaviours = root.GetComponentsInChildren<MonoBehaviour>(true);
            IProcessDetailMultiBindingController resolved = null;
            for (int index = 0; index < behaviours.Length; index++)
            {
                if (!(behaviours[index] is IProcessDetailMultiBindingController candidate))
                {
                    continue;
                }
                if (resolved != null)
                {
                    error = "关键环节包装包含多个设备绑定器。";
                    return null;
                }
                resolved = candidate;
            }
            if (resolved == null)
            {
                error = "关键环节包装缺少设备绑定器。";
            }
            return resolved;
        }

        private void OnDestroy()
        {
            Release();
        }

#if UNITY_EDITOR
        /// <summary>仅供场景装配工具写入当前业务场景的全部显式依赖。</summary>
        public void ConfigureForEditor(string sceneId, ProcessDetailCatalog catalog, MonoBehaviour resourceLoaderBehaviour,
            Transform detailMount, Transform businessSceneRoot, Behaviour secondLayerInteractionController,
            MonoBehaviour cameraControllerBehaviour)
        {
            _sceneId = sceneId;
            _catalog = catalog;
            _resourceLoaderBehaviour = resourceLoaderBehaviour;
            _detailMount = detailMount;
            _businessSceneRoot = businessSceneRoot;
            _secondLayerInteractionController = secondLayerInteractionController;
            _cameraControllerBehaviour = cameraControllerBehaviour;
            _initialized = false;
            _released = false;
        }
#endif
    }
}

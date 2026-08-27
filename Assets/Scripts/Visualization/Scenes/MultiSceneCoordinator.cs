using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>多场景协调器的有限状态，任何时刻只允许一个活动业务场景控制器。</summary>
    public enum MultiSceneCoordinatorState
    {
        Idle,
        Unloading,
        Loading,
        Initializing,
        Restoring,
        Ready,
        Failed,
        Disposed
    }

    /// <summary>加载进度只包含稳定标识和归一化进度，不暴露 Unity AsyncOperation。</summary>
    public readonly struct SceneSwitchProgress
    {
        public string SceneId { get; }
        public string TransitionId { get; }
        public string StageCode { get; }
        public float Progress { get; }

        public SceneSwitchProgress(string sceneId, string transitionId, string stageCode, float progress)
        {
            SceneId = sceneId;
            TransitionId = transitionId;
            StageCode = stageCode;
            Progress = Mathf.Clamp01(progress);
        }
    }

    /// <summary>场景切换结果携带失败阶段和恢复结果，调用方无需解析日志文本。</summary>
    public readonly struct SceneSwitchResult
    {
        public bool Success { get; }
        public string SceneId { get; }
        public string TransitionId { get; }
        public string ErrorCode { get; }
        public string StageCode { get; }
        public string Message { get; }
        public bool Recovered { get; }
        public string RestoredSceneId { get; }
        /// <summary>
        /// 目标场景失败后自动恢复出的新物理场景实例标识。该值只在 Recovered 为 true 时存在，
        /// 调用方必须用它替换恢复前的旧标识，避免新实例对象事件被误判为迟到回调。
        /// </summary>
        public string RestoredSceneActivationId { get; }

        private SceneSwitchResult(
            bool success,
            string sceneId,
            string transitionId,
            string errorCode,
            string stageCode,
            string message,
            bool recovered,
            string restoredSceneId,
            string restoredSceneActivationId)
        {
            Success = success;
            SceneId = sceneId ?? string.Empty;
            TransitionId = transitionId ?? string.Empty;
            ErrorCode = errorCode ?? string.Empty;
            StageCode = stageCode ?? string.Empty;
            Message = message ?? string.Empty;
            Recovered = recovered;
            RestoredSceneId = restoredSceneId ?? string.Empty;
            RestoredSceneActivationId = restoredSceneActivationId ?? string.Empty;
        }

        public static SceneSwitchResult Completed(string sceneId, string transitionId)
        {
            return new SceneSwitchResult(true, sceneId, transitionId, string.Empty, "ready", "目标业务场景已就绪。", false, string.Empty, string.Empty);
        }

        public static SceneSwitchResult Failed(
            string sceneId,
            string transitionId,
            string errorCode,
            string stageCode,
            string message,
            bool recovered = false,
            string restoredSceneId = "",
            string restoredSceneActivationId = "")
        {
            return new SceneSwitchResult(
                false,
                sceneId,
                transitionId,
                errorCode,
                stageCode,
                message,
                recovered,
                restoredSceneId,
                restoredSceneActivationId);
        }
    }

    /// <summary>
    /// 单实例多场景异步协调器。它按“卸载旧场景 → 附加加载目标 → 初始化控制器 → 原子提交”执行，
    /// 所有异步阶段都核验 SceneSwitchToken；被新事务取代的迟到进度、成功和失败均不能修改活动场景。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class MultiSceneCoordinator : MonoBehaviour
    {
        private sealed class SwitchRequest
        {
            public SceneSwitchToken Token;
            public BusinessSceneCatalogEntry Entry;
            // 超时补偿会要求同场景也重建；普通拓扑切换保持 false，继续复用已就绪物理实例。
            public bool ForceReload;
            public bool Completed;
        }

        private sealed class SceneLoadAttempt
        {
            public bool Success;
            public bool Superseded;
            // 失败、取代或正常卸载时用这一稳定标识释放对应资产包租约；
            // 不保存 AssetBundle 引用，避免协调器跨场景持有重资源句柄。
            public string SceneId = string.Empty;
            public string ErrorCode = string.Empty;
            public string StageCode = string.Empty;
            public string Message = string.Empty;
            public Scene Scene;
            public IBusinessSceneController Controller;
        }

        public static MultiSceneCoordinator Instance { get; private set; }

        [SerializeField] private BusinessSceneCatalog _sceneCatalog;
        // Overview 使用独立目录，避免把全局沙盘误加入九项业务目录；运行时只在协调器入口处统一转换为受控场景条目。
        [SerializeField] private OverviewSceneCatalog _overviewSceneCatalog;
        [SerializeField] private LoadingOverlayController _loadingOverlay;
        [SerializeField] private SceneBundleRuntimeLoader _sceneBundleLoader;

        private readonly SceneSwitchTransactionGate _transactionGate = new SceneSwitchTransactionGate();
        private SwitchRequest _pendingRequest;
        private SwitchRequest _processingRequest;
        private Coroutine _worker;
        private BusinessSceneCatalogEntry _activeEntry;
        private IBusinessSceneController _activeController;
        private Scene _activeScene;
        private bool _disposed;
        // 每次真实提交（含失败后的物理恢复）都递增实例序号；同场景事务走快速完成路径时不改写，
        // 这样网页可区分 A₁→B→A₂，而不会把普通拓扑切换误判为重新加载的 Unity 场景。
        private long _sceneActivationSequence;
        // 诊断器只保存当前事务一份受限快照；不保存场景对象、AsyncOperation 或无限历史，
        // 使加载耗时、首帧、峰值内存和失败阶段可观测而不反向延长资源生命周期。
        private readonly SceneRuntimeDiagnostics _runtimeDiagnostics = new SceneRuntimeDiagnostics();

        public MultiSceneCoordinatorState State { get; private set; } = MultiSceneCoordinatorState.Idle;
        public string ActiveSceneId => _activeEntry?.SceneId ?? string.Empty;
        /// <summary>当前已提交物理场景实例的稳定标识；释放后清空，避免旧桥接回调借用已销毁场景。</summary>
        public string ActiveSceneActivationId { get; private set; } = string.Empty;
        public IBusinessSceneController ActiveController => _activeController;
        public SceneRuntimeDiagnosticsSnapshot RuntimeDiagnostics => _runtimeDiagnostics.Snapshot;

        public event Action<MultiSceneCoordinatorState> StateChanged;
        public event Action<IBusinessSceneController> ActiveControllerChanged;
        public event Action<SceneSwitchProgress> SceneLoadProgress;
        public event Action<SceneSwitchResult> SceneSwitchCompleted;
        /// <summary>诊断只在受限生命周期点通知，不订阅每帧 Update，供开发构建或测试读取当前快照。</summary>
        public event Action<SceneRuntimeDiagnosticsSnapshot> RuntimeDiagnosticsChanged;

#if UNITY_EDITOR
        /// <summary>
        /// 仅供编辑器场景生成器和编辑模式测试注入目录；运行包不暴露动态替换正式目录的入口。
        /// 注入后仍会在每次切换前执行完整目录校验。
        /// </summary>
        public void SetSceneCatalogForEditor(BusinessSceneCatalog sceneCatalog)
        {
            if (Application.isPlaying)
            {
                throw new InvalidOperationException("运行时不能替换正式场景目录。");
            }
            _sceneCatalog = sceneCatalog;
        }

        /// <summary>仅供编辑器场景生成器和编辑模式测试注入独立总览目录。</summary>
        public void SetOverviewSceneCatalogForEditor(OverviewSceneCatalog overviewSceneCatalog)
        {
            if (Application.isPlaying)
            {
                throw new InvalidOperationException("运行时不能替换正式总览目录。");
            }
            _overviewSceneCatalog = overviewSceneCatalog;
        }
#endif

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                // 协调器可能与其他启动服务位于同一根对象，重复时只销毁本组件，不能连带销毁业务控制器。
                Destroy(this);
                return;
            }

            Instance = this;
            DontDestroyOnLoad(gameObject);
            if (_loadingOverlay == null)
            {
                _loadingOverlay = GetComponent<LoadingOverlayController>();
            }
            if (_sceneBundleLoader == null)
            {
                // 旧 Bootstrap 场景在任务-020前已生成。运行时补齐加载器使其无需重写用户场景文件；
                // 新生成的 Bootstrap 也会显式挂载该组件，二者都走同一资产包边界。
                _sceneBundleLoader = GetComponent<SceneBundleRuntimeLoader>() ?? gameObject.AddComponent<SceneBundleRuntimeLoader>();
            }

            if (!TryValidateCatalog(out string validationMessage))
            {
                SetState(MultiSceneCoordinatorState.Failed);
                _loadingOverlay?.ShowError("validating-catalog", validationMessage);
            }
        }

        /// <summary>
        /// 请求切换只接受平台通过桥接层提交的正式目录场景。Bootstrap 初始化后保持 Idle，
        /// 不自行选择总览或任一业务场景；进入和返回 Overview 也必须使用同一 switchScene 事务。
        /// 新请求立即取代处理中和待处理请求的提交权，但底层 Unity 异步操作会安全收尾并卸载迟到场景，
        /// 避免留下隐藏活动场景；forceReload 为 true 时同场景也必须重建物理实例，用于清除超时动作可能遗留的未知副作用。
        /// </summary>
        public bool RequestSwitchScene(string sceneId, string transitionId, bool forceReload = false)
        {
            if (_disposed)
            {
                EmitImmediateFailure(sceneId, transitionId, "runtime-disposed", "validation", "多场景协调器已经释放。");
                return false;
            }
            if (!TryValidateCatalog(out string validationMessage))
            {
                EmitImmediateFailure(sceneId, transitionId, "scene-catalog-invalid", "validation", validationMessage);
                return false;
            }
            if (!TryGetSceneEntry(sceneId, out BusinessSceneCatalogEntry entry))
            {
                EmitImmediateFailure(sceneId, transitionId, "scene-unknown", "validation", "目标场景未在正式总览或业务目录中登记。");
                return false;
            }
            if (entry.Availability != BusinessSceneAvailability.Available)
            {
                EmitImmediateFailure(sceneId, transitionId, "scene-content-unavailable", "validation", "目标场景尚未交付正式 Unity 内容。");
                return false;
            }
            if (!_transactionGate.TryBegin(transitionId, sceneId, out SceneSwitchToken token, out _, out string transactionError))
            {
                EmitImmediateFailure(sceneId, transitionId, "transition-invalid", "validation", transactionError);
                return false;
            }

            CompleteAsSuperseded(_pendingRequest);
            CompleteAsSuperseded(_processingRequest);
            // 旧请求已先以 superseded 封口，再开始新快照；这样迟到回调无法写回当前诊断。
            _runtimeDiagnostics.BeginTransition(entry.SceneId, transitionId, ActiveSceneId);
            PublishRuntimeDiagnostics();
            _pendingRequest = new SwitchRequest { Token = token, Entry = entry, ForceReload = forceReload };
            if (_worker == null)
            {
                _worker = StartCoroutine(ProcessQueue());
            }
            return true;
        }

        /// <summary>整个 Unity 子应用释放时调用；重复释放幂等，释放后不再接受切换或产生有效进度。</summary>
        public void DisposeRuntime()
        {
            if (_disposed)
            {
                return;
            }

            string activeSceneId = ActiveSceneId;
            _disposed = true;
            // 不 StopCoroutine：加载中的协程仍需等待 Unity 异步操作收尾并卸载迟到场景；
            // 事务门已失效，协程不会再提交活动场景或发送有效进度，结束后自然释放自身句柄。
            _transactionGate.Dispose();
            CompleteAsDisposed(_pendingRequest);
            CompleteAsDisposed(_processingRequest);
            _pendingRequest = null;
            if (_activeController != null)
            {
                _activeController.ReleaseScene();
            }
            if (_activeScene.IsValid() && _activeScene.isLoaded)
            {
                SceneManager.UnloadSceneAsync(_activeScene);
            }
            _sceneBundleLoader?.ReleaseSceneBundle(activeSceneId);
            // 子应用整体释放后不再复用加载器。统一释放所有场景租约、共享依赖包和目录引用，
            // 但不强制回收仍被 Unity 场景卸载流程引用的对象，避免同步卸载造成卡顿或失效引用。
            _sceneBundleLoader?.DisposeRuntime();

            _activeController = null;
            _activeEntry = null;
            _activeScene = default;
            ActiveSceneActivationId = string.Empty;
            _runtimeDiagnostics.MarkReleased(activeSceneId);
            PublishRuntimeDiagnostics();
            ActiveControllerChanged?.Invoke(null);
            _loadingOverlay?.Hide();
            SetState(MultiSceneCoordinatorState.Disposed);

            // 最终 disposed 状态已通知完成，随后清除全部订阅者，防止常驻发布者继续持有网页桥接或测试闭包。
            StateChanged = null;
            ActiveControllerChanged = null;
            SceneLoadProgress = null;
            SceneSwitchCompleted = null;
            RuntimeDiagnosticsChanged = null;
        }

        private IEnumerator ProcessQueue()
        {
            while (!_disposed && _pendingRequest != null)
            {
                _processingRequest = _pendingRequest;
                _pendingRequest = null;
                yield return ExecuteSwitch(_processingRequest);
                _processingRequest = null;
            }

            _worker = null;
        }

        private IEnumerator ExecuteSwitch(SwitchRequest request)
        {
            if (!_transactionGate.IsCurrent(request.Token))
            {
                yield break;
            }
            // 普通同场景切换可复用当前实例；强制补偿必须进入既有卸载、释放、重载和初始化链路，
            // 这样旧动作副作用会随场景销毁，并由 CommitActiveScene 生成新的物理激活标识。
            if (!request.ForceReload &&
                _activeEntry != null &&
                string.Equals(_activeEntry.SceneId, request.Entry.SceneId, StringComparison.Ordinal))
            {
                if (_transactionGate.TryComplete(request.Token))
                {
                    SetState(MultiSceneCoordinatorState.Ready);
                    _loadingOverlay?.Hide();
                    CompleteRequest(request, SceneSwitchResult.Completed(request.Entry.SceneId, request.Token.TransitionId));
                }
                yield break;
            }

            BusinessSceneCatalogEntry previousEntry = _activeEntry;
            if (_activeScene.IsValid() && _activeScene.isLoaded)
            {
                SetState(MultiSceneCoordinatorState.Unloading);
                RecordRuntimeStage(request, "unloading-scene");
                _loadingOverlay?.Show("unloading-scene", "正在卸载上一个业务场景。");
                _activeController?.ReleaseScene();
                AsyncOperation unloadOperation = SceneManager.UnloadSceneAsync(_activeScene);
                if (unloadOperation == null)
                {
                    yield return FinishFailureWithoutRecovery(request, "scene-unload-failed", "unloading-scene", "Unity 未创建场景卸载操作。");
                    yield break;
                }
                while (!unloadOperation.isDone)
                {
                    yield return null;
                }

                /*
                 * 先断开协调器和桥接订阅持有的控制器引用，再执行资源包租约与未使用资源回收；
                 * 否则全局未使用资源回收仍会把旧控制器可达的网格、
                 * 材质和纹理判定为在用，燃煤→燃气→燃煤回切时内存峰值会持续叠加。
                 */
                _activeController = null;
                _activeEntry = null;
                _activeScene = default;
                ActiveControllerChanged?.Invoke(null);
                if (_sceneBundleLoader != null)
                {
                    yield return _sceneBundleLoader.ReleaseSceneBundleAndUnusedAssetsAsync(previousEntry.SceneId);
                }
            }

            if (!_transactionGate.IsCurrent(request.Token))
            {
                yield break;
            }

            SceneLoadAttempt targetAttempt = new SceneLoadAttempt();
            yield return LoadAndInitialize(request, request.Entry, false, targetAttempt);
            if (targetAttempt.Superseded)
            {
                yield break;
            }
            if (targetAttempt.Success)
            {
                if (!_transactionGate.TryComplete(request.Token))
                {
                    yield return UnloadAttemptScene(targetAttempt);
                    yield break;
                }

                CommitActiveScene(request.Entry, targetAttempt.Scene, targetAttempt.Controller, request.Token.TransitionId);
                _loadingOverlay?.Hide();
                SetState(MultiSceneCoordinatorState.Ready);
                CompleteRequest(request, SceneSwitchResult.Completed(request.Entry.SceneId, request.Token.TransitionId));
                yield break;
            }

            SceneLoadAttempt recoveryAttempt = null;
            if (previousEntry != null && _transactionGate.IsCurrent(request.Token))
            {
                SetState(MultiSceneCoordinatorState.Restoring);
                RecordRuntimeStage(request, "restoring-scene");
                _loadingOverlay?.Show("restoring-scene", "目标场景失败，正在恢复上一个稳定场景。");
                recoveryAttempt = new SceneLoadAttempt();
                yield return LoadAndInitialize(request, previousEntry, true, recoveryAttempt);
                if (recoveryAttempt.Superseded)
                {
                    yield break;
                }
            }

            if (!_transactionGate.TryComplete(request.Token))
            {
                if (recoveryAttempt != null && recoveryAttempt.Success)
                {
                    yield return UnloadAttemptScene(recoveryAttempt);
                }
                yield break;
            }

            bool recovered = recoveryAttempt != null && recoveryAttempt.Success;
            if (recovered)
            {
                CommitActiveScene(previousEntry, recoveryAttempt.Scene, recoveryAttempt.Controller, request.Token.TransitionId);
                _loadingOverlay?.Hide();
                SetState(MultiSceneCoordinatorState.Ready);
            }
            else
            {
                SetState(MultiSceneCoordinatorState.Failed);
                string recoverySuffix = recoveryAttempt == null ? string.Empty : $"；恢复失败：{recoveryAttempt.Message}";
                _loadingOverlay?.ShowError(targetAttempt.StageCode, targetAttempt.Message + recoverySuffix);
            }

            CompleteRequest(request, SceneSwitchResult.Failed(
                request.Entry.SceneId,
                request.Token.TransitionId,
                targetAttempt.ErrorCode,
                targetAttempt.StageCode,
                targetAttempt.Message,
                recovered,
                recovered ? previousEntry.SceneId : string.Empty,
                // 恢复提交会创建新的业务场景控制器和物理实例；失败结果必须携带该新标识，
                // 否则网页端虽恢复旧稳定场景，却会继续持有卸载前的旧实例标识。
                recovered ? ActiveSceneActivationId : string.Empty));
        }

        private IEnumerator LoadAndInitialize(
            SwitchRequest request,
            BusinessSceneCatalogEntry entry,
            bool isRecovery,
            SceneLoadAttempt attempt)
        {
            SetState(isRecovery ? MultiSceneCoordinatorState.Restoring : MultiSceneCoordinatorState.Loading);
            RecordRuntimeStage(request, isRecovery ? "restoring-scene" : "loading-scene");
            _loadingOverlay?.Show(isRecovery ? "restoring-scene" : "loading-scene", isRecovery ? "正在恢复业务场景。" : "正在加载目标业务场景。");

            attempt.SceneId = entry.SceneId;
            ReportProgress(request, isRecovery ? "restoring-scene" : "loading-scene", 0f);
            SceneBundleLoadResult loadResult = default;
            bool loadCompleted = false;
            bool supersededWhileLoading = false;
            IEnumerator loading = _sceneBundleLoader.LoadSceneAsync(entry, result =>
            {
                loadResult = result;
                loadCompleted = true;
            });
            while (loading != null && loading.MoveNext())
            {
                yield return loading.Current;
                // SceneManager.LoadSceneAsync（场景异步加载）一旦开始，不能因新事务到达就中途丢弃其枚举器。
                // 若此处直接退出，Unity 仍可能在后台完成加载，而协调器没有取得 Scene（场景）引用去卸载它，
                // 从而留下不可见的旧业务场景。仅记录令牌过期，随后把已启动加载驱动到终态再统一清理。
                if (!_transactionGate.IsCurrent(request.Token))
                {
                    supersededWhileLoading = true;
                }
            }

            // 过期事务在加载完成后必须优先清理，而不是将加载失败或成功回写为当前事务状态。
            // 成功结果先写入 attempt（尝试）以取得真实场景句柄；UnloadAttemptScene（卸载尝试场景）同时释放场景与资产包租约。
            if (supersededWhileLoading || !_transactionGate.IsCurrent(request.Token))
            {
                attempt.Superseded = true;
                if (loadCompleted && loadResult.Success)
                {
                    attempt.Scene = loadResult.Scene;
                }
                yield return UnloadAttemptScene(attempt);
                yield break;
            }

            if (!loadCompleted || !loadResult.Success || !loadResult.Scene.IsValid() || !loadResult.Scene.isLoaded)
            {
                string errorCode = loadCompleted && !string.IsNullOrWhiteSpace(loadResult.ErrorCode)
                    ? loadResult.ErrorCode
                    : "scene-load-failed";
                SetAttemptFailure(attempt, errorCode, "loading-scene", "目标场景资源未能按正式目录完成加载。");
                yield break;
            }
            ReportProgress(request, isRecovery ? "restoring-scene" : "loading-scene", 1f);
            Scene loadedScene = loadResult.Scene;
            attempt.Scene = loadedScene;
            if (!_transactionGate.IsCurrent(request.Token))
            {
                attempt.Superseded = true;
                yield return UnloadAttemptScene(attempt);
                yield break;
            }
            if (!BusinessSceneControllerRegistry.TryResolve(loadedScene, entry, out IBusinessSceneController controller, out string controllerError))
            {
                SetAttemptFailure(attempt, "scene-controller-unavailable", "initializing-scene", controllerError);
                yield return UnloadAttemptScene(attempt);
                yield break;
            }

            SetState(isRecovery ? MultiSceneCoordinatorState.Restoring : MultiSceneCoordinatorState.Initializing);
            RecordRuntimeStage(request, "initializing-scene");
            _loadingOverlay?.UpdateProgress("initializing-scene", 1f, "正在初始化业务场景控制器。");
            BusinessSceneCommandResult initializationResult = default;
            bool callbackReceived = false;
            IEnumerator initialization = null;
            Exception initializationCreationException = null;
            try
            {
                initialization = controller.InitializeAsync(
                    new BusinessSceneInitializationContext(entry.SceneId, entry.UnitySceneKey, request.Token.TransitionId, isRecovery),
                    result =>
                    {
                        initializationResult = result;
                        callbackReceived = true;
                    });
            }
            catch (Exception exception)
            {
                initializationCreationException = exception;
            }
            if (initializationCreationException != null)
            {
                SetAttemptFailure(attempt, "scene-initialize-failed", "initializing-scene", $"创建场景初始化流程失败：{initializationCreationException.GetType().Name}。");
                yield return UnloadAttemptScene(attempt);
                yield break;
            }

            while (initialization != null)
            {
                bool hasNext;
                object current = null;
                Exception initializationExecutionException = null;
                try
                {
                    hasNext = initialization.MoveNext();
                    if (hasNext)
                    {
                        current = initialization.Current;
                    }
                }
                catch (Exception exception)
                {
                    hasNext = false;
                    initializationExecutionException = exception;
                }
                if (initializationExecutionException != null)
                {
                    SetAttemptFailure(attempt, "scene-initialize-failed", "initializing-scene", $"场景初始化执行失败：{initializationExecutionException.GetType().Name}。");
                    yield return UnloadAttemptScene(attempt);
                    yield break;
                }
                if (!hasNext)
                {
                    break;
                }
                yield return current;
                if (!_transactionGate.IsCurrent(request.Token))
                {
                    controller.ReleaseScene();
                    attempt.Superseded = true;
                    yield return UnloadAttemptScene(attempt);
                    yield break;
                }
            }

            if (!callbackReceived || !initializationResult.Success)
            {
                string errorCode = callbackReceived && !string.IsNullOrWhiteSpace(initializationResult.ErrorCode)
                    ? initializationResult.ErrorCode
                    : "scene-initialize-failed";
                string message = callbackReceived ? initializationResult.Message : "场景初始化流程未返回结果。";
                SetAttemptFailure(attempt, errorCode, "initializing-scene", message);
                controller.ReleaseScene();
                yield return UnloadAttemptScene(attempt);
                yield break;
            }

            attempt.Controller = controller;
            attempt.Success = true;
        }

        private IEnumerator FinishFailureWithoutRecovery(SwitchRequest request, string errorCode, string stageCode, string message)
        {
            if (_transactionGate.TryComplete(request.Token))
            {
                SetState(MultiSceneCoordinatorState.Failed);
                _loadingOverlay?.ShowError(stageCode, message);
                CompleteRequest(request, SceneSwitchResult.Failed(request.Entry.SceneId, request.Token.TransitionId, errorCode, stageCode, message));
            }
            yield break;
        }

        private IEnumerator UnloadAttemptScene(SceneLoadAttempt attempt)
        {
            if (attempt.Scene.IsValid() && attempt.Scene.isLoaded)
            {
                AsyncOperation unloadOperation = SceneManager.UnloadSceneAsync(attempt.Scene);
                while (unloadOperation != null && !unloadOperation.isDone)
                {
                    yield return null;
                }
            }

            // 失败或被取代的尝试同样可能已经实例化大体量资源。先清空尝试对象的重引用，
            // 再在恢复上一场景前完成同一事务边界回收，避免失败恢复路径重复触发内存不足。
            attempt.Scene = default;
            attempt.Controller = null;
            attempt.Success = false;
            if (_sceneBundleLoader != null)
            {
                yield return _sceneBundleLoader.ReleaseSceneBundleAndUnusedAssetsAsync(attempt.SceneId);
            }
        }

        private void CommitActiveScene(BusinessSceneCatalogEntry entry, Scene scene, IBusinessSceneController controller, string transitionId)
        {
            _activeEntry = entry;
            _activeScene = scene;
            _activeController = controller;
            // 激活标识不复用 transitionId：恢复加载也会使用失败事务的 transitionId，而物理实例必须独立计数。
            _sceneActivationSequence++;
            ActiveSceneActivationId = $"scene-activation-{_sceneActivationSequence}";
            if (scene.IsValid() && scene.isLoaded)
            {
                SceneManager.SetActiveScene(scene);
            }
            ActiveControllerChanged?.Invoke(controller);
            _runtimeDiagnostics.MarkSceneCommitted(entry.SceneId, transitionId);
            PublishRuntimeDiagnostics();
            StartCoroutine(RecordFirstFrameAfterCommit(entry.SceneId, transitionId));
        }

        private void ReportProgress(SwitchRequest request, string stageCode, float progress)
        {
            if (!_transactionGate.IsCurrent(request.Token))
            {
                return;
            }
            _loadingOverlay?.UpdateProgress(stageCode, progress, "正在加载业务场景资源。");
            RecordRuntimeStage(request, stageCode);
            SceneLoadProgress?.Invoke(new SceneSwitchProgress(request.Entry.SceneId, request.Token.TransitionId, stageCode, progress));
        }

        private void CompleteAsSuperseded(SwitchRequest request)
        {
            if (request == null || request.Completed)
            {
                return;
            }
            CompleteRequest(request, SceneSwitchResult.Failed(
                request.Entry.SceneId,
                request.Token.TransitionId,
                "command-superseded",
                "validation",
                "切换请求已被更新的事务取代。"));
        }

        private void CompleteAsDisposed(SwitchRequest request)
        {
            if (request == null || request.Completed)
            {
                return;
            }
            CompleteRequest(request, SceneSwitchResult.Failed(
                request.Entry.SceneId,
                request.Token.TransitionId,
                "runtime-disposed",
                "disposing",
                "多场景协调器已经释放。"));
        }

        private void CompleteRequest(SwitchRequest request, SceneSwitchResult result)
        {
            if (request == null || request.Completed)
            {
                return;
            }
            request.Completed = true;
            if (result.Success)
            {
                _runtimeDiagnostics.Complete(result.TransitionId, ActiveSceneId);
            }
            else
            {
                _runtimeDiagnostics.Fail(result.TransitionId, ActiveSceneId, result.StageCode, result.ErrorCode);
            }
            PublishRuntimeDiagnostics();
            SceneSwitchCompleted?.Invoke(result);
        }

        private void EmitImmediateFailure(string sceneId, string transitionId, string errorCode, string stageCode, string message)
        {
            // 即时校验失败没有可用令牌，不能走依赖令牌匹配的异步失败写入；
            // 使用专用入口确保空令牌等输入同样可追踪失败阶段。
            _runtimeDiagnostics.RecordImmediateFailure(sceneId, transitionId, ActiveSceneId, stageCode, errorCode);
            PublishRuntimeDiagnostics();
            SceneSwitchCompleted?.Invoke(SceneSwitchResult.Failed(sceneId, transitionId, errorCode, stageCode, message));
        }

        /// <summary>
        /// 仅在切换阶段变化时采样并发布一次诊断。加载进度可能每帧触发，
        /// 因此由诊断器去重后再通知订阅方，避免资源观测本身形成每帧开销。
        /// </summary>
        private void RecordRuntimeStage(SwitchRequest request, string stageCode)
        {
            if (request != null && _runtimeDiagnostics.RecordStage(request.Token.TransitionId, stageCode, ActiveSceneId))
            {
                PublishRuntimeDiagnostics();
            }
        }

        private bool TryGetSceneEntry(string sceneId, out BusinessSceneCatalogEntry entry)
        {
            if (_sceneCatalog != null && _sceneCatalog.TryGetBySceneId(sceneId, out entry))
            {
                return true;
            }

            if (_overviewSceneCatalog != null &&
                _overviewSceneCatalog.TryCreateRuntimeEntry(out entry, out _))
            {
                return string.Equals(sceneId, entry.SceneId, StringComparison.Ordinal);
            }

            entry = null;
            return false;
        }

        private bool TryValidateCatalog(out string message)
        {
            if (_sceneCatalog == null)
            {
                message = "未配置正式九场景目录资产。";
                return false;
            }
            IReadOnlyList<BusinessSceneCatalogValidationIssue> businessIssues = _sceneCatalog.ValidateForRuntime();
            if (businessIssues.Count > 0)
            {
                message = businessIssues[0].Message;
                return false;
            }
            if (_overviewSceneCatalog == null)
            {
                message = "未配置独立总览场景目录资产。";
                return false;
            }
            IReadOnlyList<OverviewSceneCatalogValidationIssue> overviewIssues = _overviewSceneCatalog.ValidateForRuntime();
            if (overviewIssues.Count > 0)
            {
                message = overviewIssues[0].Message;
                return false;
            }

            message = string.Empty;
            return true;
        }

        private static void SetAttemptFailure(SceneLoadAttempt attempt, string errorCode, string stageCode, string message)
        {
            attempt.Success = false;
            attempt.ErrorCode = errorCode;
            attempt.StageCode = stageCode;
            attempt.Message = message;
        }

        private void SetState(MultiSceneCoordinatorState nextState)
        {
            if (State == nextState)
            {
                return;
            }
            State = nextState;
            StateChanged?.Invoke(nextState);
        }

        /// <summary>
        /// 场景提交后的下一个渲染帧才代表用户可见的首帧。协程只执行一次且按事务标识写入，
        /// 释放、取代或新事务开始后诊断器会拒绝迟到写入，不会常驻占用更新循环。
        /// </summary>
        private IEnumerator RecordFirstFrameAfterCommit(string sceneId, string transitionId)
        {
            yield return new WaitForEndOfFrame();
            // 被新事务替代或运行时释放后，诊断器会返回 false；此时不再发出多余事件，
            // 既避免已失效协程扰动当前快照，也保证首帧观测始终只有一次。
            if (_runtimeDiagnostics.MarkFirstFrame(sceneId, transitionId))
            {
                PublishRuntimeDiagnostics();
            }
        }

        /// <summary>统一发布当前唯一快照，订阅者只获得值类型诊断，不会取得场景对象或资源引用。</summary>
        private void PublishRuntimeDiagnostics()
        {
            RuntimeDiagnosticsChanged?.Invoke(_runtimeDiagnostics.Snapshot);
        }

        private void OnDestroy()
        {
            // 直接销毁协调器时同样封口场景控制器、事务和诊断；正常 DisposeRuntime 已幂等处理，
            // 不会因 OnDestroy 再次调用而重复卸载或重复发送回调。
            DisposeRuntime();
            if (Instance == this)
            {
                Instance = null;
            }
        }
    }
}

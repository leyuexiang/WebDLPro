using System;
using System.Collections;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 单个业务场景的显式厂房内部入口。入口只接受属性面板登记的专用 Collider，
    /// 不从对象名称、父级路径或点击坐标推导 interiorId（内部入口标识）和设备资源。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class BusinessSceneInteriorEntryController : MonoBehaviour, IBusinessScenePointerConsumer
    {
        private const float MaximumPickDistance = 5000f;

        [Header("稳定标识与资源目录")]
        [SerializeField] private string _sceneId;
        [SerializeField] private string _interiorId;
        [SerializeField] private BusinessSceneDetailCatalog _detailCatalog;

        [Header("显式场景引用")]
        [SerializeField] private Collider _interactionCollider;
        [SerializeField] private Transform _detailMount;
        [SerializeField] private MonoBehaviour _detailLoaderBehaviour;
        [SerializeField] private MonoBehaviour _stateReplayerBehaviour;

        [Header("厂房壳体整体视觉")]
        [SerializeField] private Renderer[] _shellRenderers = Array.Empty<Renderer>();
        [SerializeField] private BusinessSceneShellMaterialVariant[] _shellMaterialVariants =
            Array.Empty<BusinessSceneShellMaterialVariant>();
        [SerializeField, Range(0.01f, 0.99f)] private float _translucentOpacity = 0.3f;
        [SerializeField] private BusinessSceneInteriorShellMode _interiorShellMode =
            BusinessSceneInteriorShellMode.Translucent;
        [SerializeField] private BusinessSceneExteriorShellMode _exteriorShellMode =
            BusinessSceneExteriorShellMode.Opaque;

        private IBusinessSceneDetailLoader _detailLoader;
        private IBusinessSceneDetailStateReplayer _stateReplayer;
        private BusinessSceneDetailCatalogEntry _detailEntry;
        private BusinessSceneShellVisualRuntime _shellRuntime;
        private BusinessSceneDetailRuntime _detailRuntime;
        private BusinessSceneInteriorRuntime _interiorRuntime;
        private BusinessSceneCommandResult _initializationResult;
        private Coroutine _enterCoroutine;
        private bool _entryRoutineActive;
        private bool _originalColliderEnabled;
        private bool _initialized;
        private bool _released;

        public string SceneId => _sceneId ?? string.Empty;
        public string InteriorId => _interiorId ?? string.Empty;
        public BusinessSceneInteriorRuntimeState State =>
            _interiorRuntime?.State ?? (_released
                ? BusinessSceneInteriorRuntimeState.Released
                : BusinessSceneInteriorRuntimeState.Exterior);
        public bool IsInitialized => _initialized;
        public BusinessSceneCommandResult InitializationResult => _initializationResult;

        private void Start()
        {
            Initialize();
        }

        /// <summary>
        /// 一次性建立目录、加载器、状态重放器和壳体运行时。任一引用不完整时整体拒绝，
        /// 不会留下部分可点击、部分可加载的下钻入口。
        /// </summary>
        public BusinessSceneCommandResult Initialize()
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Failed(
                    "scene-interior-entry-released",
                    "厂房内部入口已经释放。");
            }
            if (_initialized)
            {
                return _initializationResult;
            }
            if (!BusinessSceneCatalog.IsRequiredSceneId(_sceneId) ||
                !SceneSwitchProtocolValidator.IsBoundedIdentifier(_interiorId))
            {
                return FailInitialization(
                    "scene-interior-entry-id-invalid",
                    "厂房内部入口缺少合法 sceneId 或 interiorId。");
            }
            if (_interactionCollider == null || _detailMount == null || _detailCatalog == null)
            {
                return FailInitialization(
                    "scene-interior-entry-binding-invalid",
                    "厂房内部入口缺少交互碰撞体、设备挂载节点或设备资源目录。");
            }

            _detailLoader = _detailLoaderBehaviour as IBusinessSceneDetailLoader;
            _stateReplayer = _stateReplayerBehaviour as IBusinessSceneDetailStateReplayer;
            if (_detailLoader == null || _stateReplayer == null)
            {
                return FailInitialization(
                    "scene-interior-entry-adapter-invalid",
                    "厂房内部入口的加载器或最新状态重放器未实现规定接口。");
            }

            if (_detailCatalog.ValidateForRuntime().Count > 0 ||
                !_detailCatalog.TryGetBySceneId(_sceneId, out _detailEntry) ||
                _detailEntry.Availability != BusinessSceneAvailability.Available)
            {
                return FailInitialization(
                    "scene-interior-entry-catalog-invalid",
                    "厂房内部入口找不到当前业务场景的正式设备细节目录项。");
            }

            if (!BusinessSceneShellVisualRuntime.TryCreate(
                    _interiorId,
                    _shellRenderers,
                    _shellMaterialVariants,
                    _translucentOpacity,
                    out _shellRuntime,
                    out string shellError))
            {
                return FailInitialization(
                    "scene-interior-entry-shell-invalid",
                    shellError);
            }

            _originalColliderEnabled = _interactionCollider.enabled;
            _detailRuntime = new BusinessSceneDetailRuntime(_sceneId);
            _interiorRuntime = new BusinessSceneInteriorRuntime(
                _detailRuntime,
                _shellRuntime,
                _interiorShellMode,
                _exteriorShellMode);
            _initialized = true;
            _initializationResult = BusinessSceneCommandResult.Completed(
                $"厂房内部入口 {_interiorId} 已完成显式绑定。");
            return _initializationResult;
        }

        /// <summary>
        /// 精确交互 Collider 是厂房点击的唯一事实来源。前方其它碰撞体会保留遮挡语义；
        /// 命中入口后始终消费点击，普通节点选择不得继续执行。
        /// </summary>
        public bool TryConsumePointer(Ray ray)
        {
            if (!_initialized && !Initialize().Success || _released ||
                !Physics.Raycast(ray, out RaycastHit hit, MaximumPickDistance, ~0, QueryTriggerInteraction.Ignore) ||
                hit.collider != _interactionCollider)
            {
                return false;
            }

            if (!_entryRoutineActive &&
                _interiorRuntime.State != BusinessSceneInteriorRuntimeState.DetailVisible &&
                Application.isPlaying)
            {
                _enterCoroutine = StartCoroutine(EnterAsync(null));
            }

            return true;
        }

        /// <summary>
        /// 公开异步入口供场景按钮、自动化测试或同一点击消费者复用。
        /// 重复调用不会启动第二个设备加载事务。
        /// </summary>
        public IEnumerator EnterAsync(Action<BusinessSceneCommandResult> completed)
        {
            if (!_initialized && !Initialize().Success)
            {
                completed?.Invoke(_initializationResult);
                yield break;
            }
            if (_released)
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-interior-entry-released",
                    "厂房内部入口已经释放。"));
                yield break;
            }
            if (_entryRoutineActive)
            {
                completed?.Invoke(BusinessSceneCommandResult.Completed("厂房内部进入请求正在处理中。"));
                yield break;
            }

            _entryRoutineActive = true;
            BusinessSceneCommandResult enterResult = default;
            IEnumerator entering = _interiorRuntime.EnterAsync(
                _detailEntry,
                _detailLoader,
                _detailMount,
                _stateReplayer,
                result => enterResult = result);
            try
            {
                while (entering.MoveNext())
                {
                    yield return entering.Current;
                }
            }
            finally
            {
                (entering as IDisposable)?.Dispose();
                _entryRoutineActive = false;
                _enterCoroutine = null;
                UpdateInteractionCollider();
            }

            completed?.Invoke(enterResult);
        }

        /// <summary>
        /// 返回厂房属于当前业务场景内部操作，不切换 Unity 场景，也不发送 objectSelected（对象选择事件）。
        /// </summary>
        public BusinessSceneCommandResult ReturnToExterior()
        {
            if (!_initialized && !Initialize().Success)
            {
                return _initializationResult;
            }
            if (_released)
            {
                return BusinessSceneCommandResult.Failed(
                    "scene-interior-entry-released",
                    "厂房内部入口已经释放。");
            }

            BusinessSceneCommandResult result = _interiorRuntime.ReturnToExterior();
            UpdateInteractionCollider();
            return result;
        }

        /// <summary>
        /// 释放时停止入口协程；BusinessSceneDetailRuntime 的 finally 会 Dispose（释放）底层加载枚举器，
        /// 正式加载器必须据此取消未完成资源操作。随后恢复壳体并释放设备独占资源。
        /// </summary>
        public BusinessSceneCommandResult Release()
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Completed("厂房内部入口已经释放。");
            }

            _released = true;
            if (_enterCoroutine != null)
            {
                StopCoroutine(_enterCoroutine);
                _enterCoroutine = null;
            }
            _entryRoutineActive = false;
            _interiorRuntime?.Dispose();
            _interiorRuntime = null;
            _detailRuntime = null;
            _shellRuntime = null;
            if (_interactionCollider != null)
            {
                _interactionCollider.enabled = _originalColliderEnabled;
            }

            return BusinessSceneCommandResult.Completed("厂房内部入口已恢复壳体并释放运行资源。");
        }

        private void OnDestroy()
        {
            Release();
        }

        private BusinessSceneCommandResult FailInitialization(string errorCode, string message)
        {
            _initializationResult = BusinessSceneCommandResult.Failed(errorCode, message);
            return _initializationResult;
        }

        private void UpdateInteractionCollider()
        {
            if (_interactionCollider == null)
            {
                return;
            }

            // 内部设备可见时关闭专用厂房入口碰撞体，避免透明/隐藏壳体继续遮挡内部设备射线。
            _interactionCollider.enabled = _originalColliderEnabled &&
                _interiorRuntime != null &&
                _interiorRuntime.State != BusinessSceneInteriorRuntimeState.DetailVisible;
        }

#if UNITY_EDITOR
        /// <summary>仅供编辑器生成器和编辑模式测试写入显式场景绑定。</summary>
        public void ConfigureForEditor(
            string sceneId,
            string interiorId,
            BusinessSceneDetailCatalog detailCatalog,
            Collider interactionCollider,
            Transform detailMount,
            MonoBehaviour detailLoaderBehaviour,
            MonoBehaviour stateReplayerBehaviour,
            Renderer[] shellRenderers,
            BusinessSceneShellMaterialVariant[] shellMaterialVariants,
            float translucentOpacity,
            BusinessSceneInteriorShellMode interiorShellMode,
            BusinessSceneExteriorShellMode exteriorShellMode)
        {
            if (Application.isPlaying)
            {
                throw new InvalidOperationException("运行时不能修改厂房内部入口配置。");
            }

            _sceneId = sceneId;
            _interiorId = interiorId;
            _detailCatalog = detailCatalog;
            _interactionCollider = interactionCollider;
            _detailMount = detailMount;
            _detailLoaderBehaviour = detailLoaderBehaviour;
            _stateReplayerBehaviour = stateReplayerBehaviour;
            _shellRenderers = shellRenderers ?? Array.Empty<Renderer>();
            _shellMaterialVariants = shellMaterialVariants ?? Array.Empty<BusinessSceneShellMaterialVariant>();
            _translucentOpacity = translucentOpacity;
            _interiorShellMode = interiorShellMode;
            _exteriorShellMode = exteriorShellMode;
        }
#endif
    }
}

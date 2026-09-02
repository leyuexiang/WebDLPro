using System;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 已在当前场景中预加载内部设备时使用的厂房下钻入口。
    /// 它只负责精确点击代理、壳体整体半透明和显式镜头位切换，不承担设备资源加载与状态重放；
    /// 正式按需加载接通后应改用 BusinessSceneInteriorEntryController。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class BusinessScenePreloadedInteriorEntryController : MonoBehaviour, IBusinessScenePointerConsumer
    {
        private const float MaximumPickDistance = 5000f;

        [Header("稳定标识")]
        [SerializeField] private string _interiorId;

        [Header("显式场景引用")]
        [SerializeField] private Collider _interactionCollider;
        [SerializeField] private MonoBehaviour _cameraControllerBehaviour;
        [SerializeField] private Transform _interiorCameraPose;

        [Header("厂房壳体整体视觉")]
        [SerializeField] private Renderer[] _shellRenderers = Array.Empty<Renderer>();
        [SerializeField] private BusinessSceneShellMaterialVariant[] _shellMaterialVariants =
            Array.Empty<BusinessSceneShellMaterialVariant>();
        [SerializeField, Range(0.01f, 0.99f)] private float _translucentOpacity = 0.3f;

        private BusinessSceneShellVisualRuntime _shellRuntime;
        private IBusinessSceneCameraPoseController _cameraController;
        private BusinessSceneCommandResult _initializationResult;
        private bool _originalColliderEnabled;
        private bool _initialized;
        private bool _inside;
        private bool _released;

        public string InteriorId => _interiorId ?? string.Empty;
        public bool IsInside => _inside;
        public bool IsInitialized => _initialized;
        public BusinessSceneCommandResult InitializationResult => _initializationResult;

        private void Start()
        {
            Initialize();
        }

        /// <summary>
        /// 一次性校验点击代理、显式镜头位与壳体材质映射。任一配置缺失时整体拒绝，
        /// 避免出现镜头已进入但外壳未透明，或外壳透明后无法继续操作的半完成状态。
        /// </summary>
        public BusinessSceneCommandResult Initialize()
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Failed(
                    "scene-preloaded-interior-entry-released",
                    "场景内置厂房入口已经释放。");
            }
            if (_initialized)
            {
                return _initializationResult;
            }
            if (!SceneSwitchProtocolValidator.IsBoundedIdentifier(_interiorId))
            {
                return FailInitialization(
                    "scene-preloaded-interior-entry-id-invalid",
                    "场景内置厂房入口缺少合法 interiorId。");
            }
            _cameraController = _cameraControllerBehaviour as IBusinessSceneCameraPoseController;
            if (_interactionCollider == null || _cameraController == null || _interiorCameraPose == null)
            {
                return FailInitialization(
                    "scene-preloaded-interior-entry-binding-invalid",
                    "场景内置厂房入口缺少点击代理、自由相机控制器或镜头占位点。");
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
                    "scene-preloaded-interior-entry-shell-invalid",
                    shellError);
            }

            _originalColliderEnabled = _interactionCollider.enabled;
            _initialized = true;
            _initializationResult = BusinessSceneCommandResult.Completed(
                $"场景内置厂房入口 {_interiorId} 已完成显式绑定。");
            return _initializationResult;
        }

        /// <summary>
        /// 只接受射线首次命中的专用碰撞体。命中后消费本次点击，阻止普通设备选择继续执行。
        /// </summary>
        public bool TryConsumePointer(Ray ray)
        {
            if (!_initialized && !Initialize().Success || _released ||
                !Physics.Raycast(ray, out RaycastHit hit, MaximumPickDistance, ~0, QueryTriggerInteraction.Ignore) ||
                hit.collider != _interactionCollider)
            {
                return false;
            }

            if (!_inside && Application.isPlaying)
            {
                EnterInterior();
            }

            return true;
        }

        /// <summary>
        /// 进入当前场景已存在的内部设备视图：先原子切换壳体半透明材质，再启动显式镜头补间。
        /// 点击代理随后关闭，避免半透明外壳继续截断内部设备的射线选择。
        /// </summary>
        public BusinessSceneCommandResult EnterInterior()
        {
            if (!_initialized && !Initialize().Success)
            {
                return _initializationResult;
            }
            if (_released)
            {
                return BusinessSceneCommandResult.Failed(
                    "scene-preloaded-interior-entry-released",
                    "场景内置厂房入口已经释放。");
            }
            if (_inside)
            {
                return BusinessSceneCommandResult.Completed("当前镜头已经处于厂房内部视图。");
            }

            BusinessSceneCommandResult shellResult = _shellRuntime.ShowTranslucent();
            if (!shellResult.Success)
            {
                return shellResult;
            }

            _cameraController.MoveToPose(_interiorCameraPose);
            _inside = true;
            _interactionCollider.enabled = false;
            return BusinessSceneCommandResult.Completed("厂房外壳已半透明，镜头正在进入内部观察位。");
        }

        /// <summary>
        /// 为后续网页按钮或场景命令保留统一返回入口。恢复不透明壳体、初始镜头和原始点击代理状态。
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
                    "scene-preloaded-interior-entry-released",
                    "场景内置厂房入口已经释放。");
            }
            if (!_inside)
            {
                return BusinessSceneCommandResult.Completed("当前镜头已经处于厂房外部视图。");
            }

            BusinessSceneCommandResult shellResult = _shellRuntime.ShowOpaque();
            if (!shellResult.Success)
            {
                return shellResult;
            }

            _cameraController.ResetToInitialTransform();
            _inside = false;
            _interactionCollider.enabled = _originalColliderEnabled;
            return BusinessSceneCommandResult.Completed("已恢复厂房外壳与场景初始镜头。");
        }

        /// <summary>释放前恢复壳体基线与点击代理，避免退出场景时遗留材质属性块状态。</summary>
        public BusinessSceneCommandResult Release()
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Completed("场景内置厂房入口已经释放。");
            }

            _released = true;
            _inside = false;
            _shellRuntime?.Release();
            _shellRuntime = null;
            if (_interactionCollider != null)
            {
                _interactionCollider.enabled = _originalColliderEnabled;
            }

            return BusinessSceneCommandResult.Completed("场景内置厂房入口已恢复壳体并释放运行缓存。");
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

#if UNITY_EDITOR
        /// <summary>仅供编辑器场景装配写入显式引用，运行时禁止改变绑定关系。</summary>
        public void ConfigureForEditor(
            string interiorId,
            Collider interactionCollider,
            MonoBehaviour cameraControllerBehaviour,
            Transform interiorCameraPose,
            Renderer[] shellRenderers,
            BusinessSceneShellMaterialVariant[] shellMaterialVariants,
            float translucentOpacity)
        {
            if (Application.isPlaying)
            {
                throw new InvalidOperationException("运行时不能修改场景内置厂房入口配置。");
            }

            _interiorId = interiorId;
            _interactionCollider = interactionCollider;
            _cameraControllerBehaviour = cameraControllerBehaviour;
            _cameraController = cameraControllerBehaviour as IBusinessSceneCameraPoseController;
            _interiorCameraPose = interiorCameraPose;
            _shellRenderers = shellRenderers ?? Array.Empty<Renderer>();
            _shellMaterialVariants = shellMaterialVariants ?? Array.Empty<BusinessSceneShellMaterialVariant>();
            _translucentOpacity = translucentOpacity;
        }
#endif
    }
}

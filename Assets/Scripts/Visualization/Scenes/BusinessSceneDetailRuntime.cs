using System;
using System.Collections;
using UnityEngine;
using UnityObject = UnityEngine.Object;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>设备细节加载状态。壳体生命周期不属于本状态机，始终由业务场景本体持有。</summary>
    public enum BusinessSceneDetailRuntimeState
    {
        Idle,
        Loading,
        Loaded,
        Failed,
        Released
    }

    /// <summary>
    /// 设备细节资源的一次独占加载句柄。销毁实例后再释放底层资源租约，
    /// 保证预制体仍引用网格、材质和纹理时不会提前卸载资源包。
    /// </summary>
    public sealed class BusinessSceneDetailLoadHandle : IDisposable
    {
        private IDisposable _resourceLease;
        private bool _released;

        public GameObject DetailRoot { get; private set; }
        public bool IsValid => !_released && DetailRoot != null && _resourceLease != null;
        public bool IsReleased => _released;

        public BusinessSceneDetailLoadHandle(GameObject detailRoot, IDisposable resourceLease)
        {
            DetailRoot = detailRoot;
            _resourceLease = resourceLease;
        }

        public void Dispose()
        {
            if (_released)
            {
                return;
            }

            _released = true;
            try
            {
                if (DetailRoot != null)
                {
                    if (Application.isPlaying)
                    {
                        UnityObject.Destroy(DetailRoot);
                    }
                    else
                    {
                        UnityObject.DestroyImmediate(DetailRoot);
                    }
                }
            }
            finally
            {
                DetailRoot = null;
                IDisposable resourceLease = _resourceLease;
                _resourceLease = null;
                resourceLease?.Dispose();
            }
        }
    }

    /// <summary>加载器只返回有限结果和独占句柄，不向业务控制器暴露资源包地址或异步操作对象。</summary>
    public readonly struct BusinessSceneDetailLoadResult
    {
        public bool Success { get; }
        public string ErrorCode { get; }
        public string Message { get; }
        public BusinessSceneDetailLoadHandle Handle { get; }

        private BusinessSceneDetailLoadResult(
            bool success,
            string errorCode,
            string message,
            BusinessSceneDetailLoadHandle handle)
        {
            Success = success;
            ErrorCode = errorCode ?? string.Empty;
            Message = message ?? string.Empty;
            Handle = handle;
        }

        public static BusinessSceneDetailLoadResult Completed(BusinessSceneDetailLoadHandle handle)
        {
            return new BusinessSceneDetailLoadResult(true, string.Empty, "设备细节资源加载完成。", handle);
        }

        public static BusinessSceneDetailLoadResult Failed(string errorCode, string message)
        {
            return new BusinessSceneDetailLoadResult(false, errorCode, message, null);
        }
    }

    /// <summary>
    /// 设备细节资源加载边界。具体实现可以读取本地资源包、附加场景或预制体，
    /// 但必须从实例创建开始保持根对象未激活，并将实例和底层资源租约封装为同一个独占句柄；
    /// 只有下钻编排器完成最新状态重放和壳体切换后才能激活设备。
    /// </summary>
    public interface IBusinessSceneDetailLoader
    {
        IEnumerator LoadAsync(
            BusinessSceneDetailCatalogEntry entry,
            Action<BusinessSceneDetailLoadResult> completed);
    }

    /// <summary>
    /// 单个业务场景的设备细节运行时。它只管理按需细节资源，不修改、隐藏或释放厂区壳体；
    /// 进入内部后的壳体透明和状态重放由后续下钻编排层在加载成功后执行。
    /// </summary>
    public sealed class BusinessSceneDetailRuntime : IDisposable
    {
        private readonly string _sceneId;
        private BusinessSceneResourceScope _detailScope;
        private GameObject _detailRoot;
        private BusinessSceneDetailRuntimeState _state;
        private int _generation;

        public string SceneId => _sceneId;
        public GameObject DetailRoot => _detailRoot;
        public BusinessSceneDetailRuntimeState State => _state;

        public BusinessSceneDetailRuntime(string sceneId)
        {
            _sceneId = sceneId;
            _state = BusinessSceneDetailRuntimeState.Idle;
        }

        /// <summary>
        /// 按显式目录项加载当前场景的设备细节。重复点击已加载资源时直接幂等成功；
        /// 加载中拒绝第二个并发请求，释放产生的代际变化会让迟到结果立即自清理。
        /// </summary>
        public IEnumerator LoadAsync(
            BusinessSceneDetailCatalogEntry entry,
            IBusinessSceneDetailLoader loader,
            Transform mount,
            Action<BusinessSceneCommandResult> completed)
        {
            if (_state == BusinessSceneDetailRuntimeState.Released)
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-detail-runtime-released",
                    "设备细节运行时已经释放。"));
                yield break;
            }
            if (entry == null ||
                !string.Equals(entry.SceneId, _sceneId, StringComparison.Ordinal) ||
                entry.Availability != BusinessSceneAvailability.Available ||
                !SceneSwitchProtocolValidator.IsBoundedIdentifier(entry.DetailResourceId))
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-detail-entry-invalid",
                    "设备细节目录项为空、未解析或不属于当前业务场景。"));
                yield break;
            }
            if (loader == null || mount == null)
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-detail-loader-invalid",
                    "设备细节加载器或挂载节点不可用。"));
                yield break;
            }
            if (_state == BusinessSceneDetailRuntimeState.Loaded && _detailRoot != null)
            {
                completed?.Invoke(BusinessSceneCommandResult.Completed("设备细节资源已经加载。"));
                yield break;
            }
            if (_state == BusinessSceneDetailRuntimeState.Loading)
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-detail-load-in-progress",
                    "设备细节资源正在加载，已拒绝并发重复请求。"));
                yield break;
            }

            int loadGeneration = ++_generation;
            _state = BusinessSceneDetailRuntimeState.Loading;
            bool loaderCompleted = false;
            BusinessSceneDetailLoadResult loadResult = default;
            IEnumerator loading;
            try
            {
                loading = loader.LoadAsync(entry, result =>
                {
                    // 加载器错误地重复回调时只接受第一份结果，避免后续句柄覆盖已提交实例。
                    if (!loaderCompleted)
                    {
                        loaderCompleted = true;
                        loadResult = result;
                    }
                    else
                    {
                        result.Handle?.Dispose();
                    }
                });
            }
            catch (Exception)
            {
                CompleteFailure(loadGeneration, "scene-detail-load-failed", "设备细节加载器启动失败。", completed);
                yield break;
            }

            if (loading == null)
            {
                CompleteFailure(loadGeneration, "scene-detail-load-failed", "设备细节加载器未返回有效异步流程。", completed);
                yield break;
            }

            bool moveNextFailed = false;
            try
            {
                while (true)
                {
                    bool hasNext;
                    object current = null;
                    try
                    {
                        hasNext = loading.MoveNext();
                        if (hasNext)
                        {
                            current = loading.Current;
                        }
                    }
                    catch (Exception)
                    {
                        hasNext = false;
                        moveNextFailed = true;
                    }

                    if (!hasNext)
                    {
                        break;
                    }

                    yield return current;
                }
            }
            finally
            {
                // 外层进入协程被场景释放或显式停止时仍会进入 finally；正式加载器必须在 Dispose 中
                // 取消尚未提交的异步操作并释放临时句柄，避免场景卸载后留下孤儿资源。
                (loading as IDisposable)?.Dispose();
            }
            if (moveNextFailed)
            {
                loadResult.Handle?.Dispose();
                CompleteFailure(loadGeneration, "scene-detail-load-failed", "设备细节资源加载过程失败。", completed);
                yield break;
            }
            if (!loaderCompleted)
            {
                CompleteFailure(loadGeneration, "scene-detail-load-incomplete", "设备细节加载流程结束但未返回结果。", completed);
                yield break;
            }
            if (loadGeneration != _generation || _state != BusinessSceneDetailRuntimeState.Loading)
            {
                // 返回厂房或退出场景后到达的旧结果没有提交权，必须立即释放实例和资源包租约。
                loadResult.Handle?.Dispose();
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-detail-load-superseded",
                    "设备细节加载结果已被新的释放或加载事务取代。"));
                yield break;
            }
            if (!loadResult.Success || loadResult.Handle == null || !loadResult.Handle.IsValid)
            {
                loadResult.Handle?.Dispose();
                _state = BusinessSceneDetailRuntimeState.Failed;
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    string.IsNullOrWhiteSpace(loadResult.ErrorCode) ? "scene-detail-load-failed" : loadResult.ErrorCode,
                    string.IsNullOrWhiteSpace(loadResult.Message) ? "设备细节资源加载失败。" : loadResult.Message));
                yield break;
            }

            GameObject detailRoot = loadResult.Handle.DetailRoot;
            // 即使加载器违反未激活实例契约，也要在提交到当前业务场景前立即隐藏；
            // R-013 下钻编排器完成最新状态重放和壳体切换后才会显式激活。
            detailRoot.SetActive(false);
            detailRoot.transform.SetParent(mount, false);
            BusinessSceneResourceScope detailScope = new BusinessSceneResourceScope();
            if (!detailScope.TrackDisposable(loadResult.Handle))
            {
                loadResult.Handle.Dispose();
                _state = BusinessSceneDetailRuntimeState.Failed;
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-detail-handle-invalid",
                    "设备细节资源句柄无法登记到独立作用域。"));
                yield break;
            }

            _detailScope = detailScope;
            _detailRoot = detailRoot;
            _state = BusinessSceneDetailRuntimeState.Loaded;
            completed?.Invoke(BusinessSceneCommandResult.Completed("设备细节资源加载完成。"));
        }

        /// <summary>
        /// 只释放设备细节实例和对应资源租约，厂区壳体及业务场景本体保持不变。
        /// 加载期间调用会提升代际，使迟到结果失效并在到达时自清理。
        /// </summary>
        public BusinessSceneCommandResult ReleaseDetails()
        {
            if (_state == BusinessSceneDetailRuntimeState.Released)
            {
                return BusinessSceneCommandResult.Failed(
                    "scene-detail-runtime-released",
                    "设备细节运行时已经释放。");
            }

            _generation++;
            BusinessSceneResourceReleaseReport report = ReleaseCurrentScope();
            _state = BusinessSceneDetailRuntimeState.Idle;
            return report.FailureCount > 0
                ? BusinessSceneCommandResult.Failed(
                    "scene-detail-release-failed",
                    $"设备细节资源释放存在 {report.FailureCount} 项失败。")
                : BusinessSceneCommandResult.Completed("设备细节资源已释放，厂区壳体保持加载。");
        }

        public void Dispose()
        {
            if (_state == BusinessSceneDetailRuntimeState.Released)
            {
                return;
            }

            _generation++;
            ReleaseCurrentScope();
            _state = BusinessSceneDetailRuntimeState.Released;
        }

        private BusinessSceneResourceReleaseReport ReleaseCurrentScope()
        {
            BusinessSceneResourceScope detailScope = _detailScope;
            _detailScope = null;
            _detailRoot = null;
            return detailScope != null
                ? detailScope.ReleaseAll()
                : new BusinessSceneResourceReleaseReport(0, 0, 0, true);
        }

        private void CompleteFailure(
            int loadGeneration,
            string errorCode,
            string message,
            Action<BusinessSceneCommandResult> completed)
        {
            if (loadGeneration == _generation && _state == BusinessSceneDetailRuntimeState.Loading)
            {
                _state = BusinessSceneDetailRuntimeState.Failed;
            }

            completed?.Invoke(BusinessSceneCommandResult.Failed(errorCode, message));
        }
    }
}

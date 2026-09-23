using System;
using System.Collections;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>独立关键环节资源状态；相机和业务场景可见性由上层协调器原子提交。</summary>
    public enum ProcessDetailResourceRuntimeState
    {
        Idle,
        Loading,
        Loaded,
        Failed,
        Released
    }

    /// <summary>
    /// 只管理一个活动关键环节实例及其资源句柄。加载期间取消会提升代际，迟到实例到达后立即自清理；
    /// 任意时刻最多持有一个已提交实例，不管理第二层场景对象和相机。
    /// </summary>
    public sealed class ProcessDetailResourceRuntime : IDisposable
    {
        private readonly string _sceneId;
        private ProcessDetailLoadHandle _handle;
        private ProcessDetailResourceRuntimeState _state;
        private int _generation;

        public ProcessDetailResourceRuntime(string sceneId)
        {
            _sceneId = sceneId;
            _state = ProcessDetailResourceRuntimeState.Idle;
        }

        public ProcessDetailResourceRuntimeState State => _state;
        public GameObject Root => _handle?.Root;

        public IEnumerator LoadAsync(
            ProcessDetailCatalogEntry entry,
            IProcessDetailResourceLoader loader,
            Transform mount,
            Action<BusinessSceneCommandResult> completed)
        {
            if (_state == ProcessDetailResourceRuntimeState.Released)
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "process-detail-runtime-released",
                    "关键环节资源运行时已经释放。"));
                yield break;
            }
            if (entry == null || !string.Equals(entry.SceneId, _sceneId, StringComparison.Ordinal) ||
                entry.Availability != BusinessSceneAvailability.Available)
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "process-detail-entry-invalid",
                    "关键环节目录项为空、未解析或不属于当前业务场景。"));
                yield break;
            }
            if (loader == null || mount == null)
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "process-detail-loader-invalid",
                    "关键环节加载器或挂载节点不可用。"));
                yield break;
            }
            if (_state == ProcessDetailResourceRuntimeState.Loaded && Root != null)
            {
                completed?.Invoke(BusinessSceneCommandResult.Completed("关键环节资源已经加载。"));
                yield break;
            }
            if (_state == ProcessDetailResourceRuntimeState.Loading)
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "process-detail-load-in-progress",
                    "关键环节资源正在加载，已拒绝并发重复请求。"));
                yield break;
            }

            int loadGeneration = ++_generation;
            _state = ProcessDetailResourceRuntimeState.Loading;
            bool callbackReceived = false;
            ProcessDetailLoadResult loadResult = default;
            IEnumerator loading;
            try
            {
                loading = loader.LoadAsync(entry, result =>
                {
                    if (!callbackReceived)
                    {
                        callbackReceived = true;
                        loadResult = result;
                    }
                    else
                    {
                        // 错误加载器重复回调时，后续结果永远没有提交权。
                        result.Handle?.Dispose();
                    }
                });
            }
            catch (Exception)
            {
                CompleteFailure(loadGeneration, "process-detail-load-failed", "关键环节加载器启动失败。", completed);
                yield break;
            }

            if (loading == null)
            {
                CompleteFailure(loadGeneration, "process-detail-load-failed", "关键环节加载器未返回异步流程。", completed);
                yield break;
            }

            bool iterationFailed = false;
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
                        iterationFailed = true;
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
                // 场景释放或上层停止协程时，正式加载器可通过枚举器释放取消下载并清理临时资源。
                (loading as IDisposable)?.Dispose();
            }

            if (iterationFailed)
            {
                loadResult.Handle?.Dispose();
                CompleteFailure(loadGeneration, "process-detail-load-failed", "关键环节资源加载过程失败。", completed);
                yield break;
            }
            if (!callbackReceived)
            {
                CompleteFailure(loadGeneration, "process-detail-load-incomplete", "关键环节加载结束但未返回结果。", completed);
                yield break;
            }
            if (loadGeneration != _generation || _state != ProcessDetailResourceRuntimeState.Loading)
            {
                loadResult.Handle?.Dispose();
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "process-detail-load-superseded",
                    "关键环节加载结果已被退出或新事务取代。"));
                yield break;
            }
            if (!loadResult.Success || loadResult.Handle == null || !loadResult.Handle.IsValid)
            {
                loadResult.Handle?.Dispose();
                _state = ProcessDetailResourceRuntimeState.Failed;
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    string.IsNullOrWhiteSpace(loadResult.ErrorCode) ? "process-detail-load-failed" : loadResult.ErrorCode,
                    string.IsNullOrWhiteSpace(loadResult.Message) ? "关键环节资源加载失败。" : loadResult.Message));
                yield break;
            }

            GameObject root = loadResult.Handle.Root;
            root.SetActive(false);
            root.transform.SetParent(mount, false);
            _handle = loadResult.Handle;
            _state = ProcessDetailResourceRuntimeState.Loaded;
            completed?.Invoke(BusinessSceneCommandResult.Completed("关键环节资源已隐藏加载并提交独占句柄。"));
        }

        /// <summary>取消未完成加载并释放当前实例；重复退出保持幂等。</summary>
        public BusinessSceneCommandResult ReleaseCurrent()
        {
            if (_state == ProcessDetailResourceRuntimeState.Released)
            {
                return BusinessSceneCommandResult.Failed(
                    "process-detail-runtime-released",
                    "关键环节资源运行时已经释放。");
            }

            _generation++;
            ProcessDetailLoadHandle handle = _handle;
            _handle = null;
            handle?.Dispose();
            _state = ProcessDetailResourceRuntimeState.Idle;
            return BusinessSceneCommandResult.Completed("关键环节实例和资源句柄已释放。");
        }

        public void Dispose()
        {
            if (_state == ProcessDetailResourceRuntimeState.Released)
            {
                return;
            }

            _generation++;
            ProcessDetailLoadHandle handle = _handle;
            _handle = null;
            handle?.Dispose();
            _state = ProcessDetailResourceRuntimeState.Released;
        }

        private void CompleteFailure(
            int loadGeneration,
            string errorCode,
            string message,
            Action<BusinessSceneCommandResult> completed)
        {
            if (loadGeneration == _generation && _state == ProcessDetailResourceRuntimeState.Loading)
            {
                _state = ProcessDetailResourceRuntimeState.Failed;
            }

            completed?.Invoke(BusinessSceneCommandResult.Failed(errorCode, message));
        }
    }
}

using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>厂房内部下钻状态。设备状态应用和壳体视觉提交均在 DetailVisible 前完成。</summary>
    public enum BusinessSceneInteriorRuntimeState
    {
        Exterior,
        Loading,
        ApplyingState,
        DetailVisible,
        Returning,
        Failed,
        Released
    }

    /// <summary>进入内部后壳体只允许整体半透明或整体隐藏，不支持局部墙体状态。</summary>
    public enum BusinessSceneInteriorShellMode
    {
        Translucent,
        Hidden
    }

    /// <summary>返回厂房时可强制完整不透明，也可恢复场景登记时的启用基线。</summary>
    public enum BusinessSceneExteriorShellMode
    {
        Opaque,
        Baseline
    }

    /// <summary>完整状态快照中单个设备细节节点的设置或清除操作。</summary>
    public readonly struct BusinessSceneDetailNodeStateUpdate
    {
        public string SceneNodeId { get; }
        public bool HasVisualState { get; }
        public BusinessSceneNodeVisualState VisualState { get; }

        private BusinessSceneDetailNodeStateUpdate(
            string sceneNodeId,
            bool hasVisualState,
            BusinessSceneNodeVisualState visualState)
        {
            SceneNodeId = sceneNodeId;
            HasVisualState = hasVisualState;
            VisualState = visualState;
        }

        public static BusinessSceneDetailNodeStateUpdate Set(
            string sceneNodeId,
            BusinessSceneNodeVisualState visualState)
        {
            return new BusinessSceneDetailNodeStateUpdate(sceneNodeId, true, visualState);
        }

        public static BusinessSceneDetailNodeStateUpdate Clear(string sceneNodeId)
        {
            return new BusinessSceneDetailNodeStateUpdate(sceneNodeId, false, default);
        }
    }

    /// <summary>
    /// 设备细节状态重放目标。正式实现应绑定 Detail 实例自己的节点注册表，
    /// 不能复用已经释放的旧实例 Renderer，也不能按对象名称查找节点。
    /// </summary>
    public interface IBusinessSceneDetailStateTarget
    {
        BusinessSceneCommandResult UpdateNodeVisualState(
            string sceneNodeId,
            BusinessSceneNodeVisualState visualState);
        BusinessSceneCommandResult ClearNodeVisualState(string sceneNodeId);
    }

    /// <summary>
    /// 当前业务场景范围的有限状态投影镜像。网页仍是权威来源；镜像只保存已声明 Detail 节点的最新完整快照，
    /// 使返回后重新创建的设备实例即使没有新快照序号，也能在首次显示前恢复相同状态。
    /// </summary>
    public sealed class BusinessSceneDetailStateSnapshotMirror
    {
        public const int MaximumNodeCount = 500;
        private const long MaximumJavaScriptSafeInteger = 9007199254740991L;

        private readonly string[] _declaredSceneNodeIds;
        private readonly HashSet<string> _declaredSceneNodeIdSet;
        private Dictionary<string, BusinessSceneDetailNodeStateUpdate> _latestUpdates =
            new Dictionary<string, BusinessSceneDetailNodeStateUpdate>(StringComparer.Ordinal);
        private long _snapshotSequence;
        private bool _released;

        private BusinessSceneDetailStateSnapshotMirror(
            string[] declaredSceneNodeIds,
            HashSet<string> declaredSceneNodeIdSet)
        {
            _declaredSceneNodeIds = declaredSceneNodeIds;
            _declaredSceneNodeIdSet = declaredSceneNodeIdSet;
        }

        public long SnapshotSequence => _snapshotSequence;
        public int DeclaredNodeCount => _declaredSceneNodeIds.Length;
        public bool IsReleased => _released;

        /// <summary>节点清单只在场景初始化时登记一次，未知和重复标识整体拒绝，避免无限缓存拼写错误。</summary>
        public static bool TryCreate(
            IReadOnlyList<string> declaredSceneNodeIds,
            out BusinessSceneDetailStateSnapshotMirror mirror,
            out string error)
        {
            mirror = null;
            error = string.Empty;
            if (declaredSceneNodeIds == null ||
                declaredSceneNodeIds.Count == 0 ||
                declaredSceneNodeIds.Count > MaximumNodeCount)
            {
                error = $"设备细节状态镜像必须登记 1 到 {MaximumNodeCount} 个节点。";
                return false;
            }

            string[] orderedIds = new string[declaredSceneNodeIds.Count];
            HashSet<string> uniqueIds = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < declaredSceneNodeIds.Count; index++)
            {
                string sceneNodeId = declaredSceneNodeIds[index];
                if (!SceneActionProtocolValidator.IsValidSceneNodeId(sceneNodeId) || !uniqueIds.Add(sceneNodeId))
                {
                    error = "设备细节状态镜像存在空值、非法或重复 sceneNodeId。";
                    return false;
                }

                orderedIds[index] = sceneNodeId;
            }

            mirror = new BusinessSceneDetailStateSnapshotMirror(orderedIds, uniqueIds);
            return true;
        }

        /// <summary>
        /// 原子提交一份完整快照。先验证全部节点和重复项，再交换有限字典；
        /// 相同或更小序号按幂等迟到处理，不覆盖当前最新快照。
        /// </summary>
        public BusinessSceneCommandResult ApplySnapshot(
            long snapshotSequence,
            IReadOnlyList<BusinessSceneDetailNodeStateUpdate> updates)
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Failed(
                    "scene-detail-state-mirror-released",
                    "设备细节状态镜像已经释放。");
            }
            if (snapshotSequence <= 0 || snapshotSequence > MaximumJavaScriptSafeInteger || updates == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "scene-detail-state-snapshot-invalid",
                    "设备细节状态快照缺少合法序号或更新集合。");
            }
            if (snapshotSequence <= _snapshotSequence)
            {
                return BusinessSceneCommandResult.Completed("重复或迟到的设备细节状态快照已幂等忽略。");
            }
            if (updates.Count > _declaredSceneNodeIds.Length)
            {
                return BusinessSceneCommandResult.Failed(
                    "scene-detail-state-snapshot-capacity",
                    "设备细节状态快照超过当前场景显式节点容量。");
            }

            Dictionary<string, BusinessSceneDetailNodeStateUpdate> candidate =
                new Dictionary<string, BusinessSceneDetailNodeStateUpdate>(updates.Count, StringComparer.Ordinal);
            for (int updateIndex = 0; updateIndex < updates.Count; updateIndex++)
            {
                BusinessSceneDetailNodeStateUpdate update = updates[updateIndex];
                if (!_declaredSceneNodeIdSet.Contains(update.SceneNodeId) ||
                    !candidate.TryAdd(update.SceneNodeId, update))
                {
                    return BusinessSceneCommandResult.Failed(
                        "scene-detail-state-node-invalid",
                        "设备细节状态快照包含未知或重复 sceneNodeId。");
                }
            }

            _latestUpdates = candidate;
            _snapshotSequence = snapshotSequence;
            return BusinessSceneCommandResult.Completed("设备细节最新完整状态快照已提交。");
        }

        /// <summary>
        /// 按显式节点顺序同步重放最新快照。快照中缺失的已声明节点执行 Clear，
        /// 确保新实例不会继承旧实例的动态覆盖；任一失败立即停止，调用方必须保持 Detail 不可见并整体释放。
        /// </summary>
        public BusinessSceneCommandResult ReplayLatest(IBusinessSceneDetailStateTarget target)
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Failed(
                    "scene-detail-state-mirror-released",
                    "设备细节状态镜像已经释放。");
            }
            if (target == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "scene-detail-state-target-invalid",
                    "设备细节状态重放缺少有效目标。");
            }

            for (int nodeIndex = 0; nodeIndex < _declaredSceneNodeIds.Length; nodeIndex++)
            {
                string sceneNodeId = _declaredSceneNodeIds[nodeIndex];
                BusinessSceneCommandResult result =
                    _latestUpdates.TryGetValue(sceneNodeId, out BusinessSceneDetailNodeStateUpdate update) &&
                    update.HasVisualState
                        ? target.UpdateNodeVisualState(sceneNodeId, update.VisualState)
                        : target.ClearNodeVisualState(sceneNodeId);
                if (!result.Success)
                {
                    return result;
                }
            }

            return BusinessSceneCommandResult.Completed(
                $"设备细节已重放快照序号 {_snapshotSequence} 的最新状态。");
        }

        public void Release()
        {
            if (_released)
            {
                return;
            }

            _released = true;
            _latestUpdates.Clear();
            _snapshotSequence = 0;
        }
    }

    /// <summary>
    /// 加载完成后的同步状态重放边界。实现必须在调用时读取最新镜像，不能在点击时提前捕获旧快照。
    /// </summary>
    public interface IBusinessSceneDetailStateReplayer
    {
        BusinessSceneCommandResult ReplayLatest(GameObject detailRoot);
    }

    /// <summary>
    /// 厂房内部下钻编排器。固定顺序为：保持壳体、加载未激活设备、同步重放最新状态、
    /// 切换壳体、最后激活设备；任何失败都不会把未完成状态的设备暴露给用户。
    /// </summary>
    public sealed class BusinessSceneInteriorRuntime : IDisposable
    {
        private readonly BusinessSceneDetailRuntime _detailRuntime;
        private readonly BusinessSceneShellVisualRuntime _shellRuntime;
        private readonly BusinessSceneInteriorShellMode _interiorShellMode;
        private readonly BusinessSceneExteriorShellMode _exteriorShellMode;
        private BusinessSceneInteriorRuntimeState _state;
        private int _generation;
        private bool _enterRoutineActive;

        public BusinessSceneInteriorRuntime(
            BusinessSceneDetailRuntime detailRuntime,
            BusinessSceneShellVisualRuntime shellRuntime,
            BusinessSceneInteriorShellMode interiorShellMode,
            BusinessSceneExteriorShellMode exteriorShellMode)
        {
            _detailRuntime = detailRuntime;
            _shellRuntime = shellRuntime;
            _interiorShellMode = interiorShellMode;
            _exteriorShellMode = exteriorShellMode;
            _state = BusinessSceneInteriorRuntimeState.Exterior;
        }

        public BusinessSceneInteriorRuntimeState State => _state;
        public GameObject DetailRoot => _detailRuntime?.DetailRoot;

        /// <summary>
        /// 进入厂房内部。处理中重复点击只返回已在处理，不启动第二个加载器；
        /// 返回尚未完成时拒绝重新进入，确保旧底层加载完全结束后才允许下一次加载。
        /// </summary>
        public IEnumerator EnterAsync(
            BusinessSceneDetailCatalogEntry entry,
            IBusinessSceneDetailLoader loader,
            Transform mount,
            IBusinessSceneDetailStateReplayer stateReplayer,
            Action<BusinessSceneCommandResult> completed)
        {
            if (_state == BusinessSceneInteriorRuntimeState.Released ||
                _detailRuntime == null ||
                _shellRuntime == null)
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-interior-runtime-released",
                    "厂房内部下钻运行时不可用或已经释放。"));
                yield break;
            }
            if (stateReplayer == null)
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-interior-state-replayer-invalid",
                    "厂房内部下钻缺少最新状态重放器。"));
                yield break;
            }
            if (_state == BusinessSceneInteriorRuntimeState.DetailVisible)
            {
                completed?.Invoke(BusinessSceneCommandResult.Completed("厂房内部设备已经显示。"));
                yield break;
            }
            if (_state == BusinessSceneInteriorRuntimeState.Loading ||
                _state == BusinessSceneInteriorRuntimeState.ApplyingState)
            {
                completed?.Invoke(BusinessSceneCommandResult.Completed("厂房内部设备进入请求正在处理中。"));
                yield break;
            }
            if (_state == BusinessSceneInteriorRuntimeState.Returning || _enterRoutineActive)
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-interior-return-in-progress",
                    "厂房内部设备正在返回和清理，完成后才能再次进入。"));
                yield break;
            }

            int enterGeneration = ++_generation;
            _enterRoutineActive = true;
            _state = BusinessSceneInteriorRuntimeState.Loading;
            BusinessSceneCommandResult loadResult = default;
            IEnumerator loading = _detailRuntime.LoadAsync(
                entry,
                loader,
                mount,
                result => loadResult = result);
            while (loading.MoveNext())
            {
                yield return loading.Current;
            }

            if (enterGeneration != _generation || _state == BusinessSceneInteriorRuntimeState.Returning)
            {
                _enterRoutineActive = false;
                if (_state == BusinessSceneInteriorRuntimeState.Returning)
                {
                    _state = BusinessSceneInteriorRuntimeState.Exterior;
                }

                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-interior-enter-superseded",
                    "厂房内部进入已被返回操作取代。"));
                yield break;
            }
            if (!loadResult.Success || _detailRuntime.DetailRoot == null)
            {
                _enterRoutineActive = false;
                _state = BusinessSceneInteriorRuntimeState.Failed;
                completed?.Invoke(loadResult.Success
                    ? BusinessSceneCommandResult.Failed(
                        "scene-interior-detail-missing",
                        "设备细节加载成功但未提供有效根对象。")
                    : loadResult);
                yield break;
            }

            GameObject detailRoot = _detailRuntime.DetailRoot;
            detailRoot.SetActive(false);
            _state = BusinessSceneInteriorRuntimeState.ApplyingState;
            BusinessSceneCommandResult replayResult;
            try
            {
                // 此处不跨帧，保证读取、应用、壳体提交和设备激活形成同一主线程提交区间。
                replayResult = stateReplayer.ReplayLatest(detailRoot);
            }
            catch (Exception)
            {
                replayResult = BusinessSceneCommandResult.Failed(
                    "scene-interior-state-replay-failed",
                    "设备细节最新状态重放过程失败。");
            }

            if (!replayResult.Success)
            {
                _detailRuntime.ReleaseDetails();
                _enterRoutineActive = false;
                _state = BusinessSceneInteriorRuntimeState.Failed;
                completed?.Invoke(replayResult);
                yield break;
            }
            if (enterGeneration != _generation)
            {
                _detailRuntime.ReleaseDetails();
                _enterRoutineActive = false;
                _state = BusinessSceneInteriorRuntimeState.Exterior;
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-interior-enter-superseded",
                    "状态重放完成前厂房内部进入已被取代。"));
                yield break;
            }

            BusinessSceneCommandResult shellResult = ApplyInteriorShellMode();
            if (!shellResult.Success)
            {
                _detailRuntime.ReleaseDetails();
                ApplyExteriorShellMode();
                _enterRoutineActive = false;
                _state = BusinessSceneInteriorRuntimeState.Failed;
                completed?.Invoke(shellResult);
                yield break;
            }

            detailRoot.SetActive(true);
            _enterRoutineActive = false;
            _state = BusinessSceneInteriorRuntimeState.DetailVisible;
            completed?.Invoke(BusinessSceneCommandResult.Completed("设备细节已应用最新状态并完成显示。"));
        }

        /// <summary>
        /// 返回厂房时先隐藏设备，再恢复壳体并释放设备独占资源。加载中返回会进入 Returning，
        /// 在旧加载协程真正结束前拒绝新进入，避免底层资源加载并发重叠。
        /// </summary>
        public BusinessSceneCommandResult ReturnToExterior()
        {
            if (_state == BusinessSceneInteriorRuntimeState.Released ||
                _detailRuntime == null ||
                _shellRuntime == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "scene-interior-runtime-released",
                    "厂房内部下钻运行时不可用或已经释放。");
            }
            if (_state == BusinessSceneInteriorRuntimeState.Exterior)
            {
                return BusinessSceneCommandResult.Completed("当前已经处于厂房壳体视图。");
            }
            if (_state == BusinessSceneInteriorRuntimeState.Returning)
            {
                return BusinessSceneCommandResult.Completed("厂房内部设备正在返回和清理。");
            }

            _generation++;
            _state = BusinessSceneInteriorRuntimeState.Returning;
            GameObject detailRoot = _detailRuntime.DetailRoot;
            if (detailRoot != null)
            {
                detailRoot.SetActive(false);
            }

            BusinessSceneCommandResult shellResult = ApplyExteriorShellMode();
            BusinessSceneCommandResult detailResult = _detailRuntime.ReleaseDetails();
            if (!_enterRoutineActive)
            {
                _state = BusinessSceneInteriorRuntimeState.Exterior;
            }

            if (!shellResult.Success)
            {
                return shellResult;
            }
            return detailResult.Success
                ? BusinessSceneCommandResult.Completed("已恢复厂房壳体并释放设备细节资源。")
                : detailResult;
        }

        public void Dispose()
        {
            if (_state == BusinessSceneInteriorRuntimeState.Released)
            {
                return;
            }

            _generation++;
            _enterRoutineActive = false;
            GameObject detailRoot = _detailRuntime?.DetailRoot;
            if (detailRoot != null)
            {
                detailRoot.SetActive(false);
            }

            _detailRuntime?.Dispose();
            _shellRuntime?.Release();
            _state = BusinessSceneInteriorRuntimeState.Released;
        }

        private BusinessSceneCommandResult ApplyInteriorShellMode()
        {
            return _interiorShellMode == BusinessSceneInteriorShellMode.Hidden
                ? _shellRuntime.Hide()
                : _shellRuntime.ShowTranslucent();
        }

        private BusinessSceneCommandResult ApplyExteriorShellMode()
        {
            return _exteriorShellMode == BusinessSceneExteriorShellMode.Baseline
                ? _shellRuntime.RestoreBaseline()
                : _shellRuntime.ShowOpaque();
        }
    }
}

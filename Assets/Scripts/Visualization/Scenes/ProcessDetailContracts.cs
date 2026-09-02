using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityObject = UnityEngine.Object;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>第三层资源的一次独占加载句柄；实例必须先销毁，再释放底层资源租约。</summary>
    public sealed class ProcessDetailLoadHandle : IDisposable
    {
        private IDisposable _resourceLease;
        private bool _released;

        public GameObject Root { get; private set; }
        public bool IsValid => !_released && Root != null && _resourceLease != null;
        public bool IsReleased => _released;

        public ProcessDetailLoadHandle(GameObject root, IDisposable resourceLease)
        {
            Root = root;
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
                if (Root != null)
                {
                    if (Application.isPlaying)
                    {
                        UnityObject.Destroy(Root);
                    }
                    else
                    {
                        UnityObject.DestroyImmediate(Root);
                    }
                }
            }
            finally
            {
                Root = null;
                IDisposable lease = _resourceLease;
                _resourceLease = null;
                lease?.Dispose();
            }
        }
    }

    /// <summary>第三层资源加载器的有限返回值，不向业务层暴露资源地址或下载对象。</summary>
    public readonly struct ProcessDetailLoadResult
    {
        public bool Success { get; }
        public string ErrorCode { get; }
        public string Message { get; }
        public ProcessDetailLoadHandle Handle { get; }

        private ProcessDetailLoadResult(bool success, string errorCode, string message, ProcessDetailLoadHandle handle)
        {
            Success = success;
            ErrorCode = errorCode ?? string.Empty;
            Message = message ?? string.Empty;
            Handle = handle;
        }

        public static ProcessDetailLoadResult Completed(ProcessDetailLoadHandle handle)
        {
            return new ProcessDetailLoadResult(true, string.Empty, "关键环节资源加载完成。", handle);
        }

        public static ProcessDetailLoadResult Failed(string errorCode, string message)
        {
            return new ProcessDetailLoadResult(false, errorCode, message, null);
        }
    }

    /// <summary>独立关键环节预制体加载边界。实现必须返回未激活实例和独占资源租约。</summary>
    public interface IProcessDetailResourceLoader
    {
        IEnumerator LoadAsync(ProcessDetailCatalogEntry entry, Action<ProcessDetailLoadResult> completed);
    }

    /// <summary>
    /// 包装预制体内的动态目标适配器。播放许可由独立命令控制，设备四态不得隐式改变动画、粒子或气流。
    /// </summary>
    public interface IProcessDetailDynamicTarget
    {
        void SetPlayback(bool playing);
        void StopForRelease();
        void Release();
    }

    /// <summary>包装预制体内的四态视觉适配器，渲染目标必须在编辑期显式序列化。</summary>
    public interface IProcessDetailVisualStateTarget
    {
        BusinessSceneCommandResult ApplyVisualState(BusinessSceneNodeVisualState visualState);
        BusinessSceneCommandResult ClearVisualState();
        void Release();
    }

    /// <summary>
    /// 关键环节包装实例统一入口。运行时只识别该接口，不读取模型名称，也不直接引用具体燃机控制器。
    /// </summary>
    public interface IProcessDetailInstanceController
    {
        string ProcessDetailId { get; }
        string ResourceId { get; }
        string CameraPoseId { get; }
        string StateNodeId { get; }
        Transform DisplayAnchor { get; }
        Transform CameraPose { get; }

        BusinessSceneCommandResult ValidateBinding(ProcessDetailCatalogEntry entry);
        BusinessSceneCommandResult PrepareForActivation(bool hasVisualState, BusinessSceneNodeVisualState visualState);
        BusinessSceneCommandResult ApplyVisualState(BusinessSceneNodeVisualState visualState);
        BusinessSceneCommandResult ClearVisualState();
        BusinessSceneCommandResult SetPlayback(bool playing);
        void StopForRelease();
        void ReleaseInstance();
    }

    /// <summary>
    /// R-015 通用目录扩展接口。保留旧单节点接口用于历史兼容，新协调器只消费此多节点契约。
    /// </summary>
    public interface IProcessDetailMultiBindingController : IProcessDetailInstanceController
    {
        IReadOnlyList<string> StateNodeIds { get; }
        IReadOnlyList<string> DynamicTargetIds { get; }
        BusinessSceneCommandResult PrepareForActivation(IReadOnlyDictionary<string, BusinessSceneNodeVisualState> visualStates);
        BusinessSceneCommandResult ApplyVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState);
        BusinessSceneCommandResult ClearVisualState(string sceneNodeId);
    }

    /// <summary>
    /// 业务场景可选的第三层能力。它与第二层流程步骤接口分离，禁止新命令降级调用 EnterProcessStep。
    /// </summary>
    public interface IBusinessSceneProcessDetailController
    {
        /// <summary>隐藏加载并完成最新状态重放；不得显示资源、移动相机或释放当前活动环节。</summary>
        IEnumerator PrepareProcessDetailAsync(
            string sceneId,
            string processId,
            string stepId,
            string processDetailId,
            string transitionId,
            Action<BusinessSceneCommandResult> completed);

        /// <summary>提交已准备环节；同场景切换时先显示新实例，再释放旧实例。</summary>
        BusinessSceneCommandResult CommitPreparedProcessDetail(
            string sceneId,
            string processDetailId,
            string transitionId);

        /// <summary>取消尚未提交的候选实例，当前活动视图保持不变。</summary>
        BusinessSceneCommandResult AbortPreparedProcessDetail(
            string sceneId,
            string processDetailId,
            string transitionId);

        /// <summary>兼容旧调用：内部依次执行准备和提交，新前端应使用显式两阶段命令。</summary>
        IEnumerator EnterProcessDetailAsync(
            string sceneId,
            string processId,
            string stepId,
            string processDetailId,
            string transitionId,
            Action<BusinessSceneCommandResult> completed);

        BusinessSceneCommandResult ExitProcessDetail(string sceneId, string processDetailId, string transitionId);

        /// <summary>直接控制当前活动关键环节的动画、粒子和气流，不改变设备视觉状态。</summary>
        BusinessSceneCommandResult SetProcessDetailPlayback(string sceneId, string processDetailId, bool playing);
    }
}

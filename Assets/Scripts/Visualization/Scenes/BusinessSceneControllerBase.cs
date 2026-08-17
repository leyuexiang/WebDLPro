using System;
using System.Collections;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 业务场景控制器基类统一实现能力拒绝和幂等释放。
    /// 派生类只覆盖真正支持的能力；未覆盖方法永远返回 capability-unsupported，不会静默成功。
    /// </summary>
    public abstract class BusinessSceneControllerBase : MonoBehaviour, IBusinessSceneController
    {
        private bool _released;

        public abstract string SceneId { get; }
        public abstract BusinessSceneCapability Capabilities { get; }

        public virtual IEnumerator InitializeAsync(BusinessSceneInitializationContext context, Action<BusinessSceneCommandResult> completed)
        {
            if (!Supports(BusinessSceneCapability.Initialize))
            {
                completed?.Invoke(BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.Initialize));
                yield break;
            }
            if (!string.Equals(context.SceneId, SceneId, StringComparison.Ordinal))
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed("scene-controller-mismatch", "控制器场景标识与初始化目标不一致。"));
                yield break;
            }

            // 初始化属于会改变业务场景状态的能力。基类不了解具体资源、流程和映射，
            // 因此不能在派生类只声明能力却未提供实现时伪造成功；真实控制器必须覆写本方法。
            completed?.Invoke(BusinessSceneCommandResult.Failed(
                "capability-not-implemented",
                "场景控制器声明支持初始化，但未提供具体初始化实现。"));
            }

        public virtual BusinessSceneCommandResult EnterProcessStep(string processId, string stepId, string unitId, bool isolate)
        {
            return NotImplementedOrUnsupported(BusinessSceneCapability.EnterProcessStep);
        }

        public virtual BusinessSceneCommandResult FocusNode(string sceneNodeId, bool isolate)
        {
            return NotImplementedOrUnsupported(BusinessSceneCapability.FocusNode);
        }

        /// <summary>
        /// 默认拒绝清除选择能力。派生控制器只有在能够只撤销交互描边、且不重置场景上下文时才应声明并覆写该能力。
        /// </summary>
        public virtual BusinessSceneCommandResult ClearSelection()
        {
            return NotImplementedOrUnsupported(BusinessSceneCapability.ClearSelection);
        }

        public virtual BusinessSceneCommandResult UpdateNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState)
        {
            return NotImplementedOrUnsupported(BusinessSceneCapability.UpdateNodeVisualState);
        }

        /// <summary>默认拒绝恢复节点基础视觉；派生控制器必须通过显式登记的模型基线实现，不能将其转换为正常态。</summary>
        public virtual BusinessSceneCommandResult ClearNodeVisualState(string sceneNodeId)
        {
            return NotImplementedOrUnsupported(BusinessSceneCapability.ClearNodeVisualState);
        }

        public virtual BusinessSceneCommandResult SetRouteFlow(string routeId, bool enabled, float speedMultiplier)
        {
            return NotImplementedOrUnsupported(BusinessSceneCapability.SetRouteFlow);
        }

        public virtual BusinessSceneCommandResult SetNodeVisibility(string sceneNodeId, bool visible)
        {
            return NotImplementedOrUnsupported(BusinessSceneCapability.SetNodeVisibility);
        }

        public virtual BusinessSceneCommandResult ResetScene()
        {
            return NotImplementedOrUnsupported(BusinessSceneCapability.ResetScene);
        }

        public virtual BusinessSceneCommandResult ReleaseScene()
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Completed("业务场景控制器已释放。");
            }
            if (!Supports(BusinessSceneCapability.Release))
            {
                return BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.Release);
            }

            _released = true;
            StopAllCoroutines();
            return BusinessSceneCommandResult.Completed("业务场景控制器已释放。");
        }

        public virtual string GetStateDescription()
        {
            return _released ? "released" : "ready";
        }

        protected bool Supports(BusinessSceneCapability capability)
        {
            return (Capabilities & capability) == capability;
        }

        /// <summary>
        /// 默认命令实现同时校验释放状态、能力位和覆写责任。
        /// 已声明但未覆写时返回 capability-not-implemented，而非 capability-unsupported，
        /// 让目录、控制器和实现之间的配置漂移在首次调用时可观测，绝不返回伪成功。
        /// </summary>
        protected BusinessSceneCommandResult NotImplementedOrUnsupported(BusinessSceneCapability capability)
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Failed("scene-controller-released", "业务场景控制器已经释放。");
            }
            if (!Supports(capability))
            {
                return BusinessSceneCommandResult.Unsupported(capability);
            }

            return BusinessSceneCommandResult.Failed(
                "capability-not-implemented",
                $"场景控制器声明支持能力 {capability}，但未提供具体实现。");
        }
    }
}

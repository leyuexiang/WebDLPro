using System;
using System.Collections;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 资源型业务场景的最小浏览控制器。
    /// 该控制器只负责场景生命周期，不猜测未提供的设备拓扑、状态或流程映射。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class ModelBusinessSceneController : BusinessSceneControllerBase
    {
        [SerializeField] private string _sceneId;

        public override string SceneId => _sceneId;

        public override BusinessSceneCapability Capabilities =>
            BusinessSceneCapability.Initialize |
            BusinessSceneCapability.ResetScene |
            BusinessSceneCapability.Release;

        public override IEnumerator InitializeAsync(
            BusinessSceneInitializationContext context,
            Action<BusinessSceneCommandResult> completed)
        {
            if (!string.Equals(context.SceneId, _sceneId, StringComparison.Ordinal))
            {
                completed?.Invoke(BusinessSceneCommandResult.Failed(
                    "scene-controller-mismatch",
                    "资源型场景控制器的 sceneId 与初始化目标不一致。"));
                yield break;
            }

            completed?.Invoke(BusinessSceneCommandResult.Completed("资源型业务场景已就绪。"));
        }

        public override BusinessSceneCommandResult ResetScene()
        {
            return BusinessSceneCommandResult.Completed("资源型业务场景已复位。 ");
        }

#if UNITY_EDITOR
        /// <summary>仅供编辑器场景构建脚本写入固定场景标识。</summary>
        public void ConfigureForEditor(string sceneId)
        {
            if (Application.isPlaying)
            {
                throw new InvalidOperationException("运行时不能修改资源型场景标识。");
            }

            _sceneId = sceneId;
        }
#endif
    }
}

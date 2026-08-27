using System;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 总览场景中的模型占位节点。正式美术模型到位后，只需替换模型并重新绑定 Renderer、Collider 和呈现器，
    /// overviewBuildingId 与 targetSceneId 等显式业务映射保持不变，不改变总览场景控制器的加载边界。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class OverviewBuildingPlaceholder : MonoBehaviour
    {
        [SerializeField] private string _overviewBuildingId;
        // 建筑点击后的目标业务场景由资产显式登记；运行时不从建筑名称、层级或标识字符串推导。
        [SerializeField] private string _targetSceneId;
        [SerializeField] private Renderer _targetRenderer;
        [SerializeField] private Collider _interactionCollider;
        // 该引用只使用运行时层的接口；具体实现可位于默认程序集并复用 Highlight Plus（高亮插件）。
        [SerializeField] private MonoBehaviour _visualStatePresenter;

        public string OverviewBuildingId => _overviewBuildingId;
        public string TargetSceneId => _targetSceneId;
        public Renderer TargetRenderer => _targetRenderer;
        public Collider InteractionCollider => _interactionCollider;
        public IOverviewBuildingVisualStatePresenter VisualStatePresenter =>
            _visualStatePresenter as IOverviewBuildingVisualStatePresenter;

#if UNITY_EDITOR
        /// <summary>
        /// 仅供编辑器场景生成器写入稳定建筑标识、目标业务场景、渲染器和交互碰撞体。
        /// 正式模型替换后可以让交互碰撞体位于子节点，但业务选择始终使用显式登记的两个标识。
        /// </summary>
        public void ConfigureForEditor(
            string overviewBuildingId,
            string targetSceneId,
            Renderer targetRenderer,
            Collider interactionCollider,
            MonoBehaviour visualStatePresenter)
        {
            if (Application.isPlaying)
            {
                throw new InvalidOperationException("运行时不能修改总览建筑占位配置。");
            }

            _overviewBuildingId = overviewBuildingId;
            _targetSceneId = targetSceneId;
            _targetRenderer = targetRenderer;
            _interactionCollider = interactionCollider;
            _visualStatePresenter = visualStatePresenter;
        }
#endif
    }
}

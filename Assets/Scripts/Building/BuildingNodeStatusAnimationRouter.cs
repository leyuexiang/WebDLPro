using System;
using System.Collections.Generic;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 楼宇场景的节点动画路由器。
/// 只维护明确登记的节点动画组件；未登记动画的节点仍可正常更新 PowerPlantProcessController 的颜色和闪烁效果。
/// </summary>
[DisallowMultipleComponent]
public sealed class BuildingNodeStatusAnimationRouter : MonoBehaviour
{
    [Header("需要响应状态动画的节点")]
    [Tooltip("仅登记需要播放额外动画的节点组件，不需要动画的节点无需添加到列表。")]
    [SerializeField] private BuildingNodeStatusAnimation[] _nodeAnimations = Array.Empty<BuildingNodeStatusAnimation>();

    private readonly Dictionary<string, BuildingNodeStatusAnimation> _animationsByNodeId =
        new Dictionary<string, BuildingNodeStatusAnimation>(StringComparer.Ordinal);
    private bool _indexInitialized;

    /// <summary>当前已成功登记的动画节点数量。</summary>
    public int RegisteredNodeCount => _animationsByNodeId.Count;

    /// <summary>对象启用时建立一次索引，运行时按节点标识进行常数时间查找。</summary>
    private void Awake()
    {
        RebuildIndex();
    }

    /// <summary>
    /// 从检查器绑定的组件数组重建节点索引。
    /// 此方法也由场景控制器在初始化时显式调用，确保 Unity 生命周期先后顺序不会影响首次状态消息。
    /// </summary>
    public void RebuildIndex()
    {
        _animationsByNodeId.Clear();
        BuildingNodeStatusAnimation[] bindings = _nodeAnimations ?? Array.Empty<BuildingNodeStatusAnimation>();
        for (int bindingIndex = 0; bindingIndex < bindings.Length; bindingIndex++)
        {
            BuildingNodeStatusAnimation animation = bindings[bindingIndex];
            if (animation == null)
            {
                continue;
            }

            string nodeId = animation.SceneNodeId;
            if (string.IsNullOrWhiteSpace(nodeId))
            {
                Debug.LogWarning($"楼宇节点动画“{animation.name}”没有填写拓扑节点标识，已跳过登记。", animation);
                continue;
            }

            if (_animationsByNodeId.ContainsKey(nodeId))
            {
                Debug.LogWarning($"拓扑节点标识“{nodeId}”登记了多个楼宇动画组件；保留列表中的第一个组件。", this);
                continue;
            }

            _animationsByNodeId.Add(nodeId, animation);
        }

        _indexInitialized = true;
    }

    /// <summary>
    /// 将已成功应用到模型视觉的节点状态转发给对应动画组件。
    /// 未登记的节点返回 false，但这不会改变上游设备状态命令本身的成功结果。
    /// </summary>
    public bool ApplyNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState)
    {
        EnsureIndexInitialized();
        return !string.IsNullOrWhiteSpace(sceneNodeId) &&
               _animationsByNodeId.TryGetValue(sceneNodeId, out BuildingNodeStatusAnimation animation) &&
               animation != null && animation.ApplyState(visualState);
    }

    /// <summary>清除已登记节点的动画状态；未登记节点无需额外处理。</summary>
    public bool ClearNodeVisualState(string sceneNodeId)
    {
        EnsureIndexInitialized();
        if (string.IsNullOrWhiteSpace(sceneNodeId) ||
            !_animationsByNodeId.TryGetValue(sceneNodeId, out BuildingNodeStatusAnimation animation) ||
            animation == null)
        {
            return false;
        }

        animation.ClearState();
        return true;
    }

    /// <summary>清除所有登记组件的待处理状态触发器，供场景复位和释放时调用。</summary>
    public void ClearAllNodeVisualStates()
    {
        EnsureIndexInitialized();
        foreach (KeyValuePair<string, BuildingNodeStatusAnimation> pair in _animationsByNodeId)
        {
            if (pair.Value != null)
            {
                pair.Value.ClearState();
            }
        }
    }

    /// <summary>惰性兜底：若场景控制器早于本组件的 Awake 执行，也先建立一次索引。</summary>
    private void EnsureIndexInitialized()
    {
        if (!_indexInitialized)
        {
            RebuildIndex();
        }
    }
}

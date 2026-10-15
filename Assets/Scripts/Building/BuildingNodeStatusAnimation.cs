using System.Collections.Generic;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 单个楼宇拓扑节点的动画状态接收器。
/// 每个需要响应设备状态的模型对象挂载一个组件，并在检查器中填写与拓扑完全一致的节点标识、动画控制器和触发器名称。
/// </summary>
[DisallowMultipleComponent]
public sealed class BuildingNodeStatusAnimation : MonoBehaviour
{
    [Header("节点与动画引用")]
    [Tooltip("必须与平台拓扑下发的稳定节点标识完全一致；不要填写模型名称或层级路径。")]
    [SerializeField] private string _sceneNodeId;
    [Tooltip("负责播放该节点动画的动画控制器（Animator）组件。")]
    [SerializeField] private Animator _animator;

    [Header("四态动画触发器")]
    [Tooltip("正常状态（Normal）对应的动画控制器触发器参数名；不使用该动画时可留空。")]
    [SerializeField] private string _normalTrigger = "Normal";
    [Tooltip("告警状态（Alarm）对应的动画控制器触发器参数名；不使用该动画时可留空。")]
    [SerializeField] private string _alarmTrigger = "Alarm";
    [Tooltip("故障状态（Fault）对应的动画控制器触发器参数名；不使用该动画时可留空。")]
    [SerializeField] private string _faultTrigger = "Fault";
    [Tooltip("离线状态（Offline）对应的动画控制器触发器参数名；不使用该动画时可留空。")]
    [SerializeField] private string _offlineTrigger = "Offline";
    [Tooltip("清除设备状态时可选播放的恢复触发器；留空时只清除待处理触发器，让当前动画自然结束。")]
    [SerializeField] private string _clearTrigger;

    private readonly HashSet<int> _validTriggerHashes = new HashSet<int>();
    private int _normalTriggerHash;
    private int _alarmTriggerHash;
    private int _faultTriggerHash;
    private int _offlineTriggerHash;
    private int _clearTriggerHash;
    private bool _hasAppliedState;
    private BusinessSceneNodeVisualState _lastAppliedState;

    /// <summary>供路由器读取的稳定拓扑节点标识。</summary>
    public string SceneNodeId => _sceneNodeId;

    /// <summary>
    /// Unity 在对象启用时缓存触发器参数哈希，并核验动画控制器中确实存在对应触发器（Trigger）参数。
    /// 后续状态更新不再枚举动画参数或重复转换字符串，减少高频消息下的重复开销。
    /// </summary>
    private void Awake()
    {
        CacheTriggerParameters();
    }

    /// <summary>
    /// 播放指定设备状态对应的动画。
    /// 同一节点连续收到相同状态时不重复触发，避免平台周期性重发状态导致动画被反复打断。
    /// </summary>
    public bool ApplyState(BusinessSceneNodeVisualState visualState)
    {
        if (_animator == null || !_animator.isActiveAndEnabled)
        {
            return false;
        }

        if (_hasAppliedState && _lastAppliedState == visualState)
        {
            return true;
        }

        ResetConfiguredTriggers();
        int triggerHash = GetTriggerHash(visualState);
        if (triggerHash == 0 || !_validTriggerHashes.Contains(triggerHash))
        {
            return false;
        }

        _animator.SetTrigger(triggerHash);
        _hasAppliedState = true;
        _lastAppliedState = visualState;
        return true;
    }

    /// <summary>
    /// 清除节点状态对应的待处理动画触发器。
    /// 若配置了专用恢复触发器则播放它；否则不强行切断正在播放的动画。
    /// </summary>
    public void ClearState()
    {
        ResetConfiguredTriggers();
        if (_animator != null && _animator.isActiveAndEnabled &&
            _clearTriggerHash != 0 && _validTriggerHashes.Contains(_clearTriggerHash))
        {
            _animator.SetTrigger(_clearTriggerHash);
        }

        _hasAppliedState = false;
    }

    /// <summary>
    /// 读取动画控制器（Animator）的参数一次并缓存有效触发器（Trigger）哈希。
    /// 使用参数类型校验可在配置错误时尽早给出明确提示，不让无效触发器悄悄失效。
    /// </summary>
    private void CacheTriggerParameters()
    {
        _validTriggerHashes.Clear();
        _normalTriggerHash = CacheTriggerParameter(_normalTrigger, "正常");
        _alarmTriggerHash = CacheTriggerParameter(_alarmTrigger, "告警");
        _faultTriggerHash = CacheTriggerParameter(_faultTrigger, "故障");
        _offlineTriggerHash = CacheTriggerParameter(_offlineTrigger, "离线");
        _clearTriggerHash = CacheTriggerParameter(_clearTrigger, "清除状态");
    }

    /// <summary>按名称查找并缓存一个动画控制器触发器参数；空名称表示该状态不配置动画。</summary>
    private int CacheTriggerParameter(string parameterName, string stateLabel)
    {
        if (string.IsNullOrWhiteSpace(parameterName))
        {
            return 0;
        }

        int parameterHash = Animator.StringToHash(parameterName);
        if (_animator == null)
        {
            Debug.LogWarning($"节点“{_sceneNodeId}”的{stateLabel}动画未配置 Animator。", this);
            return parameterHash;
        }

        AnimatorControllerParameter[] parameters = _animator.parameters;
        for (int parameterIndex = 0; parameterIndex < parameters.Length; parameterIndex++)
        {
            AnimatorControllerParameter parameter = parameters[parameterIndex];
            if (parameter.nameHash != parameterHash)
            {
                continue;
            }

            if (parameter.type != AnimatorControllerParameterType.Trigger)
            {
                Debug.LogWarning($"节点“{_sceneNodeId}”的动画参数“{parameterName}”不是触发器（Trigger）类型。", this);
                return parameterHash;
            }

            _validTriggerHashes.Add(parameterHash);
            return parameterHash;
        }

        Debug.LogWarning($"节点“{_sceneNodeId}”的动画控制器中找不到{stateLabel}触发器“{parameterName}”。", this);
        return parameterHash;
    }

    /// <summary>撤销本组件使用的所有有效触发器，避免前一状态的触发信号串入新状态。</summary>
    private void ResetConfiguredTriggers()
    {
        if (_animator == null || !_animator.isActiveAndEnabled)
        {
            return;
        }

        foreach (int triggerHash in _validTriggerHashes)
        {
            _animator.ResetTrigger(triggerHash);
        }
    }

    /// <summary>把四态枚举映射到检查器中配置的触发器哈希。</summary>
    private int GetTriggerHash(BusinessSceneNodeVisualState visualState)
    {
        switch (visualState)
        {
            case BusinessSceneNodeVisualState.Normal:
                return _normalTriggerHash;
            case BusinessSceneNodeVisualState.Alarm:
                return _alarmTriggerHash;
            case BusinessSceneNodeVisualState.Fault:
                return _faultTriggerHash;
            case BusinessSceneNodeVisualState.Offline:
                return _offlineTriggerHash;
            default:
                return 0;
        }
    }
}

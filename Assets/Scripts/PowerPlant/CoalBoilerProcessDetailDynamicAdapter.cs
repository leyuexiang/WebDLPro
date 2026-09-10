using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Scripting;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 燃煤锅炉第三层动态目标适配器。
/// 默认控制当前环节内全部控制阀特效；故障时暂停，正常、告警、离线和无状态时循环播放。
/// </summary>
[Preserve]
[DisallowMultipleComponent]
public sealed class CoalBoilerProcessDetailDynamicAdapter : ProcessDetailDynamicTargetBase
{
    [Header("燃煤特效绑定")]
    [Tooltip("当前关键环节需要统一控制的全部控制阀特效。由包装生成器在制作期扫描并固化，运行时不搜索层级。")]
    [SerializeField] private ControlValveEffectController[] _controlledEffects =
        Array.Empty<ControlValveEffectController>();

    [Tooltip("不纳入关键环节状态控制的特效。排除后由特效自身配置决定是否播放，适合后续保留常驻环境效果。")]
    [SerializeField] private ControlValveEffectController[] _excludedEffects =
        Array.Empty<ControlValveEffectController>();

    private ControlValveEffectController[] _runtimeControlledEffects;

    /// <summary>统一状态只下发给未排除的燃煤特效，排除项不会被故障或退出播放许可改写。</summary>
    protected override void ApplyPlayback(bool playing, bool faultStop)
    {
        EnsureRuntimeControlledEffects();
        bool shouldPlay = playing && !faultStop;
        for (int index = 0; index < _runtimeControlledEffects.Length; index++)
        {
            _runtimeControlledEffects[index].SetPlayback(shouldPlay);
        }
    }

    protected override void OnReleased()
    {
        _runtimeControlledEffects = null;
    }

    /// <summary>
    /// 首次状态下发时构建一次无重复的有效控制数组。
    /// 后续状态更新只遍历紧凑数组，不扫描模型层级，也不重复检查排除列表。
    /// </summary>
    private void EnsureRuntimeControlledEffects()
    {
        if (_runtimeControlledEffects != null)
        {
            return;
        }

        int controlledCount = _controlledEffects?.Length ?? 0;
        if (controlledCount == 0)
        {
            _runtimeControlledEffects = Array.Empty<ControlValveEffectController>();
            return;
        }

        HashSet<ControlValveEffectController> excluded = new HashSet<ControlValveEffectController>();
        for (int index = 0; _excludedEffects != null && index < _excludedEffects.Length; index++)
        {
            ControlValveEffectController effect = _excludedEffects[index];
            if (effect != null)
            {
                excluded.Add(effect);
            }
        }

        HashSet<ControlValveEffectController> added = new HashSet<ControlValveEffectController>();
        List<ControlValveEffectController> result = new List<ControlValveEffectController>(controlledCount);
        for (int index = 0; index < controlledCount; index++)
        {
            ControlValveEffectController effect = _controlledEffects[index];
            if (effect != null && !excluded.Contains(effect) && added.Add(effect))
            {
                result.Add(effect);
            }
        }
        _runtimeControlledEffects = result.Count == 0
            ? Array.Empty<ControlValveEffectController>()
            : result.ToArray();
    }

#if UNITY_EDITOR
    /// <summary>仅供燃煤关键环节包装生成器写入全部特效和预留排除项。</summary>
    public void ConfigureForEditor(
        ControlValveEffectController[] controlledEffects,
        ControlValveEffectController[] excludedEffects)
    {
        _controlledEffects = controlledEffects ?? Array.Empty<ControlValveEffectController>();
        _excludedEffects = excludedEffects ?? Array.Empty<ControlValveEffectController>();
        _runtimeControlledEffects = null;
        ResetPlaybackStateForEditor();
    }
#endif
}

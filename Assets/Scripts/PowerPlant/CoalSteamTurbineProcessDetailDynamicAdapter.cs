using System;
using UnityEngine;
using UnityEngine.Scripting;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 燃煤汽轮机第三层动态目标适配器。
/// 统一控制 RanMeiManager 的蒸汽/阀门/能量/电子流总控与轴旋转；
/// 故障保留进气和控制线路，轴及能量延迟减速；退出时全部停止。
/// </summary>
[Preserve]
[DisallowMultipleComponent]
public sealed class CoalSteamTurbineProcessDetailDynamicAdapter : ProcessDetailDynamicTargetBase
{
    [Header("燃煤动态绑定")]
    [Tooltip("RanMeiManager 内统一控制蒸汽、阀门、轴能量和控制线路的特效总控。")]
    [SerializeField] private CoalPowerSteamEffectsController[] _effectControllers =
        Array.Empty<CoalPowerSteamEffectsController>();

    [Tooltip("RanMeiManager 内需要与关键环节播放许可同步的轴旋转控制器。")]
    [SerializeField] private CoalPowerShaftRotationController[] _shaftRotationControllers =
        Array.Empty<CoalPowerShaftRotationController>();

    [Header("故障惯性停机")]
    [SerializeField, Min(0f)] private float _faultStopDelay = 1f;
    [SerializeField, Min(0.01f)] private float _faultSlowdownDuration = 3f;

    /// <summary>区分故障惯性停机与退出立即停播。</summary>
    protected override void ApplyPlayback(bool playing, bool faultStop)
    {
        bool shouldPlay = playing && !faultStop;
        for (int index = 0; _effectControllers != null && index < _effectControllers.Length; index++)
        {
            CoalPowerSteamEffectsController controller = _effectControllers[index];
            if (controller != null)
            {
                if (faultStop) controller.SetFaultStopped();
                else controller.SetEffectsRunning(shouldPlay);
            }
        }

        for (int index = 0; _shaftRotationControllers != null && index < _shaftRotationControllers.Length; index++)
        {
            CoalPowerShaftRotationController controller = _shaftRotationControllers[index];
            if (controller == null)
            {
                continue;
            }

            if (shouldPlay)
            {
                controller.enabled = true;
                controller.Play();
            }
            else if (faultStop)
            {
                controller.enabled = true;
                controller.StopGradually(_faultStopDelay, _faultSlowdownDuration);
            }
            else
            {
                controller.Pause();
                // PrepareForActivation 会在包装根激活前下发故障状态；禁用组件可防止 OnEnable
                // 按 playOnEnable 重新启动旋转，并确保退出后的迟到激活也不会恢复运动。
                controller.enabled = false;
            }
        }
    }

#if UNITY_EDITOR
    /// <summary>仅供燃煤关键环节包装生成器固化 RanMeiManager 的动态控制引用。</summary>
    public void ConfigureForEditor(
        CoalPowerSteamEffectsController[] effectControllers,
        CoalPowerShaftRotationController[] shaftRotationControllers)
    {
        _effectControllers = effectControllers ?? Array.Empty<CoalPowerSteamEffectsController>();
        _shaftRotationControllers = shaftRotationControllers ?? Array.Empty<CoalPowerShaftRotationController>();
        ResetPlaybackStateForEditor();
    }
#endif
}

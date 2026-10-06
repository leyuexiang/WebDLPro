using System;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 偏航系统关键环节的动态播放适配器：统一控制源模型自带的齿轮旋转 Animator。
/// 播放许可关闭或故障停止时把动画速度压为零，恢复时还原制作期速度；
/// 不修改动画状态机参数或运行时状态，退出释放后迟到的播放状态不会重新启动齿轮。
/// </summary>
[DisallowMultipleComponent]
public sealed class YawSystemProcessDetailDynamicAdapter : ProcessDetailDynamicTargetBase
{
    [SerializeField] private Animator[] _gearAnimators = Array.Empty<Animator>();
    // 制作期动画速度在生成器配置阶段缓存；播放恢复必须回到资产原始节奏，不得沿用运行时改写值。
    [SerializeField] private float[] _authoredSpeeds = Array.Empty<float>();

    protected override void ApplyPlayback(bool playing, bool faultStop)
    {
        bool shouldPlay = playing && !faultStop;
        for (int index = 0; _gearAnimators != null && index < _gearAnimators.Length; index++)
        {
            Animator animator = _gearAnimators[index];
            if (animator == null)
            {
                continue;
            }
            if (index < _authoredSpeeds.Length)
            {
                animator.speed = shouldPlay ? _authoredSpeeds[index] : 0f;
            }
        }
    }

#if UNITY_EDITOR
    public void ConfigureForEditor(Animator[] gearAnimators)
    {
        _gearAnimators = gearAnimators ?? Array.Empty<Animator>();
        _authoredSpeeds = new float[_gearAnimators.Length];
        for (int index = 0; index < _gearAnimators.Length; index++)
        {
            // 缓存制作期速度：缺失 Animator 或未初始化速度时按 1 兜底，避免恢复播放时齿轮停摆。
            _authoredSpeeds[index] = _gearAnimators[index] != null && _gearAnimators[index].speed > 0f
                ? _gearAnimators[index].speed
                : 1f;
        }
        ResetPlaybackStateForEditor();
    }
#endif
}

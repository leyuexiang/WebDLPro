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
    /// <summary>箭头流光材质（LYDS/GuanDaoLight）的流速属性名；故障与退出停播时压为零。</summary>
    private const string FlowSpeedShaderProperty = "_FlowSpeed";

    [Header("燃煤动态绑定")]
    [Tooltip("RanMeiManager 内统一控制蒸汽、阀门、轴能量和控制线路的特效总控。")]
    [SerializeField] private CoalPowerSteamEffectsController[] _effectControllers =
        Array.Empty<CoalPowerSteamEffectsController>();

    [Tooltip("RanMeiManager 内需要与关键环节播放许可同步的轴旋转控制器。")]
    [SerializeField] private CoalPowerShaftRotationController[] _shaftRotationControllers =
        Array.Empty<CoalPowerShaftRotationController>();

    [Header("故障停流")]
    [Tooltip("故障时停止流光的关键指示箭头；流光速度经属性块按渲染器覆盖（不实例化材质、不改动共享材质资产），恢复播放时还原材质自身流速。")]
    [SerializeField] private ParticleSystemRenderer[] _flowArrowRenderers =
        Array.Empty<ParticleSystemRenderer>();

    [Header("故障惯性停机")]
    [SerializeField, Min(0f)] private float _faultStopDelay = 1f;
    [SerializeField, Min(0.01f)] private float _faultSlowdownDuration = 3f;

    // 属性块按渲染器覆盖 _FlowSpeed：粒子渲染器的 material getter 会重复实例化导致缓存失效，
    // 因此不实例化材质，直接以属性块下发，共享材质资产全程保持原值。
    private MaterialPropertyBlock _flowPropertyBlock;

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

        ApplyArrowFlowSpeed(shouldPlay);
    }

    /// <summary>
    /// 故障与退出停播时通过属性块把指示箭头的流光速度压为零，恢复播放时还原材质自身流速；
    /// 属性块按渲染器覆盖，全程不实例化材质、不触碰共享材质资产。
    /// </summary>
    private void ApplyArrowFlowSpeed(bool shouldPlay)
    {
        if (_flowArrowRenderers == null || _flowArrowRenderers.Length == 0)
        {
            return;
        }
        if (_flowPropertyBlock == null)
        {
            _flowPropertyBlock = new MaterialPropertyBlock();
        }

        for (int index = 0; index < _flowArrowRenderers.Length; index++)
        {
            ParticleSystemRenderer arrowRenderer = _flowArrowRenderers[index];
            if (arrowRenderer == null || arrowRenderer.sharedMaterial == null ||
                !arrowRenderer.sharedMaterial.HasProperty(FlowSpeedShaderProperty))
            {
                continue;
            }

            _flowPropertyBlock.Clear();
            if (shouldPlay)
            {
                // 恢复制作期流速（箭头.mat 为 -1 的反向流动）；读共享材质是安全的，不会触发实例化。
                _flowPropertyBlock.SetFloat(FlowSpeedShaderProperty,
                    arrowRenderer.sharedMaterial.GetFloat(FlowSpeedShaderProperty));
            }
            else
            {
                _flowPropertyBlock.SetFloat(FlowSpeedShaderProperty, 0f);
            }
            arrowRenderer.SetPropertyBlock(_flowPropertyBlock);
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

    /// <summary>
    /// 固化故障停流箭头渲染器引用；流光速度运行时经属性块下发，编辑器只登记渲染器本身。
    /// </summary>
    public void ConfigureFlowArrowsForEditor(ParticleSystemRenderer[] flowArrowRenderers)
    {
        _flowArrowRenderers = flowArrowRenderers ?? Array.Empty<ParticleSystemRenderer>();
    }
#endif
}

using HighlightPlus;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 总览代表建筑的四态视觉呈现器。
/// 仅在播放模式首次收到异常状态时创建一个 HighlightEffect（高亮效果）组件；
/// 正常态和清除态只关闭效果，绝不复制材质、修改共享材质或为每次状态更新创建组件。
/// </summary>
[DisallowMultipleComponent]
public sealed class OverviewBuildingVisualStatePresenter : MonoBehaviour, IOverviewBuildingVisualStatePresenter
{
    private const float PulseAngularFrequencyMultiplier = Mathf.PI * 2f;

    [SerializeField] private Renderer _targetRenderer;
    [SerializeField] private PowerPlantVisualStateConfig _visualStateConfig;

    private HighlightEffect _highlightEffect;
    private BusinessSceneNodeVisualState _activeState = BusinessSceneNodeVisualState.Normal;
    private bool _released;

    /// <summary>
    /// 切换异常显示。告警和故障使用共享配置的颜色、描边和低频透明覆盖；
    /// 离线尊重现有全局开关，关闭时仅保存状态而不改变建筑外观。
    /// </summary>
    public void ApplyVisualState(BusinessSceneNodeVisualState visualState)
    {
        if (_released)
        {
            return;
        }

        _activeState = visualState;
        if (visualState == BusinessSceneNodeVisualState.Normal ||
            visualState == BusinessSceneNodeVisualState.Offline &&
            (_visualStateConfig == null || !_visualStateConfig.ShowOfflineState))
        {
            SetHighlightVisible(false);
            return;
        }

        if (_targetRenderer == null || _visualStateConfig == null || !Application.isPlaying)
        {
            return;
        }

        EnsureHighlightEffect();
        Color stateColor = ResolveColor(visualState);
        _highlightEffect.outlineColor = stateColor;
        _highlightEffect.overlayColor = stateColor;
        _highlightEffect.overlay = _visualStateConfig.OverlayOpacity;
        _highlightEffect.SetHighlighted(true);
    }

    /// <summary>清除动态状态并恢复建筑的基础视觉，不修改 Renderer 的材质槽和属性块。</summary>
    public void ClearVisualState()
    {
        if (_released)
        {
            return;
        }

        _activeState = BusinessSceneNodeVisualState.Normal;
        SetHighlightVisible(false);
    }

    private void Update()
    {
        if (_highlightEffect == null || !_highlightEffect.highlighted || _visualStateConfig == null)
        {
            return;
        }

        // 仅异常建筑执行闪烁；使用状态配置中的低频参数，避免总览出现高频全屏动画。
        float frequency = _activeState == BusinessSceneNodeVisualState.Fault
            ? _visualStateConfig.FaultFillPulseFrequency
            : _activeState == BusinessSceneNodeVisualState.Alarm
                ? _visualStateConfig.AlarmFillPulseFrequency
                : 0f;
        if (frequency <= 0f)
        {
            return;
        }

        float pulse = 0.5f + 0.5f * Mathf.Sin(Time.time * frequency * PulseAngularFrequencyMultiplier);
        _highlightEffect.overlay = Mathf.Lerp(
            _visualStateConfig.FillPulseMinimumOpacity,
            _visualStateConfig.OverlayOpacity,
            pulse);
    }

    /// <summary>
    /// 释放仅销毁本组件创建的运行时高亮效果，保留目标 Renderer、Collider 和共享配置资产。
    /// </summary>
    public void ReleaseVisualState()
    {
        if (_released)
        {
            return;
        }

        _released = true;
        if (_highlightEffect != null)
        {
            _highlightEffect.SetHighlighted(false);
            if (Application.isPlaying)
            {
                Destroy(_highlightEffect);
            }
            else
            {
                DestroyImmediate(_highlightEffect);
            }

            _highlightEffect = null;
        }
    }

    private void EnsureHighlightEffect()
    {
        if (_highlightEffect != null)
        {
            return;
        }

        _highlightEffect = gameObject.AddComponent<HighlightEffect>();
        _highlightEffect.hideFlags = HideFlags.DontSave;
        _highlightEffect.profile = null;
        _highlightEffect.profileSync = false;
        _highlightEffect.previewInEditor = false;
        _highlightEffect.camerasLayerMask = -1;
        _highlightEffect.cullBackFaces = true;
        _highlightEffect.constantWidth = true;
        _highlightEffect.fadeInDuration = 0f;
        _highlightEffect.fadeOutDuration = 0f;
        _highlightEffect.outline = 1f;
        _highlightEffect.outlineWidth = _visualStateConfig.OutlineWidth;
        _highlightEffect.outlineQuality = HighlightPlus.QualityLevel.High;
        _highlightEffect.outlineDownsampling = 1;
        _highlightEffect.outlineVisibility = Visibility.Normal;
        _highlightEffect.glow = 0f;
        _highlightEffect.innerGlow = 0f;
        _highlightEffect.overlayAnimationSpeed = 0f;
        _highlightEffect.overlayMinIntensity = 1f;
        _highlightEffect.overlayBlending = 1f;
        _highlightEffect.seeThrough = SeeThroughMode.Never;
        _highlightEffect.SetTargets(transform, new[] { _targetRenderer });
        _highlightEffect.SetHighlighted(false);
        _highlightEffect.Refresh();
    }

    private void SetHighlightVisible(bool visible)
    {
        if (_highlightEffect != null)
        {
            _highlightEffect.SetHighlighted(visible);
        }
    }

    private Color ResolveColor(BusinessSceneNodeVisualState visualState)
    {
        switch (visualState)
        {
            case BusinessSceneNodeVisualState.Fault:
                return _visualStateConfig.FaultColor;
            case BusinessSceneNodeVisualState.Offline:
                return _visualStateConfig.OfflineColor;
            default:
                return _visualStateConfig.AlarmColor;
        }
    }

#if UNITY_EDITOR
    /// <summary>仅供总览生成器绑定既有渲染器和共享状态配置资产。</summary>
    public void ConfigureForEditor(Renderer targetRenderer, PowerPlantVisualStateConfig visualStateConfig)
    {
        if (Application.isPlaying)
        {
            throw new System.InvalidOperationException("运行时不能修改总览建筑状态呈现配置。");
        }

        _targetRenderer = targetRenderer;
        _visualStateConfig = visualStateConfig;
    }
#endif
}

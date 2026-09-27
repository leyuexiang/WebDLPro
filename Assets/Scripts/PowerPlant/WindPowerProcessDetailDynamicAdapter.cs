using System;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// Dynamic playback adapter for wind-power process-detail prefabs.
/// It controls explicitly serialized turbine rotation controllers. Gearbox exploded-view
/// animation is intentionally left at its own configured presentation state.
/// </summary>
[DisallowMultipleComponent]
public sealed class WindPowerProcessDetailDynamicAdapter : ProcessDetailDynamicTargetBase
{
    [SerializeField] private WindTurbineRotationController[] _rotationControllers = Array.Empty<WindTurbineRotationController>();
    [SerializeField] private GearboxExplodedView[] _gearboxViews = Array.Empty<GearboxExplodedView>();

    protected override void ApplyPlayback(bool playing, bool faultStop)
    {
        bool shouldPlay = playing && !faultStop;
        for (int index = 0; _rotationControllers != null && index < _rotationControllers.Length; index++)
        {
            WindTurbineRotationController controller = _rotationControllers[index];
            if (controller != null)
            {
                controller.SetPlaying(shouldPlay);
            }
        }

        for (int index = 0; _gearboxViews != null && index < _gearboxViews.Length; index++)
        {
            GearboxExplodedView view = _gearboxViews[index];
            if (view != null)
            {
                view.SetPlayback(shouldPlay);
            }
        }
    }

#if UNITY_EDITOR
    public void ConfigureForEditor(
        WindTurbineRotationController[] rotationControllers,
        GearboxExplodedView[] gearboxViews)
    {
        _rotationControllers = rotationControllers ?? Array.Empty<WindTurbineRotationController>();
        _gearboxViews = gearboxViews ?? Array.Empty<GearboxExplodedView>();
        ResetPlaybackStateForEditor();
    }
#endif
}

using System;
using UnityEngine;

/// <summary>
/// Drives configured shaft transforms with a continuous local X-axis rotation.
/// </summary>
[DisallowMultipleComponent]
public sealed class CoalPowerShaftRotationController : MonoBehaviour
{
    [Header("Rotation Targets")]
    [Tooltip("Shaft transforms to rotate around their local X axis.")]
    [SerializeField] private Transform[] _rotationTargets = Array.Empty<Transform>();

    [Header("Animation")]
    [Tooltip("Rotation speed in degrees per second. Positive values rotate in the local positive X direction.")]
    [SerializeField, Min(0f)] private float _speedDegreesPerSecond = 360f;
    [Tooltip("Start with the animation enabled when this component becomes enabled.")]
    [SerializeField] private bool _playOnEnable = true;
    [Tooltip("Runtime animation switch. Change this checkbox during Play Mode to start or pause the rotation immediately.")]
    [SerializeField] private bool _animationEnabled = true;

    private bool _coasting;
    private float _stopElapsed;
    private float _stopDelay;
    private float _stopDuration;
    private float _speedFactor = 1f;
    private float _stopStartFactor;

    /// <summary>Actual playback speed, also used to synchronise the shaft energy animation.</summary>
    public float CurrentSpeedDegreesPerSecond => isActiveAndEnabled && _animationEnabled
        ? _speedDegreesPerSecond * _speedFactor : 0f;

    /// <summary>
    /// Configures the target shafts and stores the references on the owning prefab.
    /// </summary>
    public void Configure(Transform[] rotationTargets)
    {
        _rotationTargets = rotationTargets ?? Array.Empty<Transform>();
    }

    /// <summary>
    /// Starts the shaft rotation.
    /// </summary>
    public void Play()
    {
        _coasting = false;
        _speedFactor = 1f;
        _animationEnabled = true;
    }

    /// <summary>
    /// Pauses the shaft rotation while preserving the current angles.
    /// </summary>
    public void Pause()
    {
        _coasting = false;
        _speedFactor = 0f;
        _animationEnabled = false;
    }

    /// <summary>Keep the current speed for a delay, then smoothly coast to rest.</summary>
    public void StopGradually(float delay, float duration)
    {
        if (_coasting || !_animationEnabled) return;
        _stopElapsed = 0f;
        _stopDelay = Mathf.Max(0f, delay);
        _stopDuration = Mathf.Max(0.01f, duration);
        _stopStartFactor = _speedFactor;
        _coasting = true;
    }

    private void OnEnable()
    {
        // A fault can be prepared before the wrapper is activated.
        if (_coasting) return;
        _animationEnabled = _playOnEnable;
        _speedFactor = 1f;
    }

    private void Update()
    {
        if (!_animationEnabled || _speedDegreesPerSecond <= 0f)
            return;

        if (_coasting)
        {
            _stopElapsed += Time.deltaTime;
            float progress = Mathf.Clamp01((_stopElapsed - _stopDelay) / _stopDuration);
            _speedFactor = _stopStartFactor * (1f - Mathf.SmoothStep(0f, 1f, progress));
            if (progress >= 1f) Pause();
        }
        float angle = CurrentSpeedDegreesPerSecond * Time.deltaTime;
        for (int i = 0; i < _rotationTargets.Length; i++)
        {
            Transform target = _rotationTargets[i];
            if (target != null)
                target.Rotate(Vector3.right, angle, Space.Self);
        }
    }
}

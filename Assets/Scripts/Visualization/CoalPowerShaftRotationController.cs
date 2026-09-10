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

    /// <summary>Actual playback speed, also used to synchronise the shaft energy animation.</summary>
    public float CurrentSpeedDegreesPerSecond => isActiveAndEnabled && _animationEnabled
        ? _speedDegreesPerSecond : 0f;

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
        _animationEnabled = true;
    }

    /// <summary>
    /// Pauses the shaft rotation while preserving the current angles.
    /// </summary>
    public void Pause()
    {
        _animationEnabled = false;
    }

    private void OnEnable()
    {
        _animationEnabled = _playOnEnable;
    }

    private void Update()
    {
        if (!_animationEnabled || _speedDegreesPerSecond <= 0f)
            return;

        float angle = _speedDegreesPerSecond * Time.deltaTime;
        for (int i = 0; i < _rotationTargets.Length; i++)
        {
            Transform target = _rotationTargets[i];
            if (target != null)
                target.Rotate(Vector3.right, angle, Space.Self);
        }
    }
}

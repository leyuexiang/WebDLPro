using UnityEngine;
using UnityEngine.InputSystem;

[DisallowMultipleComponent]
[RequireComponent(typeof(Camera))]
public sealed class DeviceShowcaseCameraController : MonoBehaviour
{
    [Header("旋转")]
    [SerializeField, Min(0.01f)] private float _rotationSensitivity = 0.18f;
    [SerializeField, Range(-89f, 0f)] private float _minPitch = -75f;
    [SerializeField, Range(0f, 89f)] private float _maxPitch = 75f;

    [Header("平移")]
    [SerializeField] private bool _enablePan;

    [Header("缩放")]
    [SerializeField, Min(0.01f)] private float _zoomSensitivity = 0.035f;
    [SerializeField, Min(0.1f)] private float _minDistance = 4f;
    [SerializeField, Min(0.1f)] private float _maxDistance = 120f;

    private Camera _camera;
    private Vector3 _pivot;
    private float _yaw;
    private float _pitch;
    private float _distance;
    private bool _initialized;

    private void Awake()
    {
        _camera = GetComponent<Camera>();
        InitializeFromCurrentTransform();
    }

    private void OnEnable()
    {
        InitializeFromCurrentTransform();
    }

    private void LateUpdate()
    {
        Mouse mouse = Mouse.current;
        if (mouse == null)
        {
            return;
        }

        Vector2 pointerDelta = mouse.delta.ReadValue();
        if (mouse.rightButton.isPressed && pointerDelta.sqrMagnitude > 0.0001f)
        {
            _yaw += pointerDelta.x * _rotationSensitivity;
            _pitch = Mathf.Clamp(_pitch - pointerDelta.y * _rotationSensitivity, _minPitch, _maxPitch);
        }

        if (_enablePan && mouse.leftButton.isPressed && pointerDelta.sqrMagnitude > 0.0001f)
        {
            Quaternion rotation = Quaternion.Euler(_pitch, _yaw, 0f);
            float panScale = _distance * 0.035f * 0.01f;
            Vector3 right = rotation * Vector3.right;
            Vector3 up = rotation * Vector3.up;
            _pivot += (-right * pointerDelta.x - up * pointerDelta.y) * panScale;
        }

        float scroll = mouse.scroll.ReadValue().y;
        if (Mathf.Abs(scroll) > 0.0001f)
        {
            float zoomFactor = 1f - scroll * _zoomSensitivity * 0.01f;
            _distance = Mathf.Clamp(_distance * zoomFactor, _minDistance, _maxDistance);
        }

        ApplyTransform();
    }

    public void Focus(Bounds bounds)
    {
        SyncAnglesFromCurrentTransform();
        _pivot = bounds.center;
        float radius = Mathf.Max(bounds.extents.magnitude, 1f);
        float fovRadians = (_camera != null ? _camera.fieldOfView : 50f) * Mathf.Deg2Rad;
        _distance = Mathf.Clamp(radius / Mathf.Tan(fovRadians * 0.5f) * 1.35f, _minDistance, _maxDistance);
        ApplyTransform();
    }

    private void InitializeFromCurrentTransform()
    {
        if (_initialized)
        {
            return;
        }

        SyncAnglesFromCurrentTransform();
        _distance = Mathf.Clamp(Mathf.Max(transform.position.magnitude, _minDistance), _minDistance, _maxDistance);
        _pivot = transform.position + transform.forward * _distance;
        _initialized = true;
    }

    private void SyncAnglesFromCurrentTransform()
    {
        Vector3 eulerAngles = transform.rotation.eulerAngles;
        _yaw = eulerAngles.y;
        _pitch = NormalizePitch(eulerAngles.x);
    }

    private void ApplyTransform()
    {
        Quaternion rotation = Quaternion.Euler(_pitch, _yaw, 0f);
        transform.SetPositionAndRotation(_pivot - rotation * Vector3.forward * _distance, rotation);
    }

    private static float NormalizePitch(float angle)
    {
        return angle > 180f ? angle - 360f : angle;
    }
}

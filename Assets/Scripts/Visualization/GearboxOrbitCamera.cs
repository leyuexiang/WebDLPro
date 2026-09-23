using UnityEngine;
using UnityEngine.EventSystems;
using System.Collections.Generic;
using UnityEngine.InputSystem;

/// <summary>围绕目标的轨道相机。只控制相机 Transform，不修改齿轮箱和既有材质。</summary>
[DisallowMultipleComponent]
public sealed class GearboxOrbitCamera : MonoBehaviour
{
    [SerializeField] private Camera _camera;
    [SerializeField] private Transform _target;
    [SerializeField] private Vector3 _targetLocalOffset;
    [SerializeField, Min(.01f)] private float _distance = 16f;
    [SerializeField, Range(-80f, 80f)] private float _pitch = 12f;
    [SerializeField] private float _yaw = 0f;
    [SerializeField, Min(.01f)] private float _orbitSensitivity = .2f;
    [SerializeField, Min(.01f)] private float _zoomSensitivity = .04f;
    [SerializeField, Min(.01f)] private float _minDistance = 5f;
    [SerializeField, Min(.01f)] private float _maxDistance = 60f;
    [SerializeField] private bool _orbitOnRightMouse = true;
    [SerializeField] private bool _orbitOnLeftMouseDrag = true;
    [SerializeField] private bool _autoOrbit;
    [SerializeField, Min(0f)] private float _autoOrbitSpeed = 5f;
    [SerializeField] private bool _enabledOnStart = true;

    private readonly List<RaycastResult> _uiHits = new List<RaycastResult>();
    private PointerEventData _pointerData;
    private EventSystem _eventSystem;
    private bool _dragging;
    private Vector2 _lastPointer;
    private Vector2 _pressPointer;
    private int _touchCount;
    private int _touchId = -1;
    private float _touchDistance;
    private bool _touchAllowed;
    private float _initialDistance;
    private float _initialOrthoSize;
    private Vector3 _initialPosition;
    private Quaternion _initialRotation;
    private bool _initialized;
    private bool _ownsCamera;
    private PowerPlantFreeCameraController _freeController;
    private static readonly Dictionary<Camera, GearboxOrbitCamera> Owners = new Dictionary<Camera, GearboxOrbitCamera>();

    public bool OrbitEnabled { get; private set; }
    public Transform Target => _target;

    public void Configure(Transform target, Vector3 localOffset, float distance)
    {
        _target = target;
        _targetLocalOffset = localOffset;
        _distance = Mathf.Clamp(distance, _minDistance, _maxDistance);
        ApplyTransform();
    }

    private void Awake()
    {
        OrbitEnabled = _enabledOnStart;
    }

    private void Start() { AcquireCamera(); }

    private void OnEnable()
    {
        if (_initialized) AcquireCamera();
    }

    private void AcquireCamera()
    {
        if (_ownsCamera || !OrbitEnabled || _target == null) return;
        if (_camera == null) _camera = Camera.main;
        if (_camera == null) return;
        if (Owners.TryGetValue(_camera, out var owner) && owner != null && owner != this) return;
        Owners[_camera] = this;
        _ownsCamera = _initialized = true;
        _initialPosition = _camera.transform.position;
        _initialRotation = _camera.transform.rotation;
        _initialOrthoSize = _camera.orthographicSize;
        _freeController = _camera.GetComponent<PowerPlantFreeCameraController>();
        if (_freeController != null && _freeController.enabled) _freeController.enabled = false;
        else _freeController = null;
        Vector3 center = _target.TransformPoint(_targetLocalOffset);
        Vector3 direction = _camera.transform.position - center;
        _distance = _initialDistance = Mathf.Max(.01f, direction.magnitude);
        if (direction.sqrMagnitude > .001f)
        {
            // 相机 forward 指向中心，而不是从中心指向相机。
            Vector3 forward = -direction.normalized;
            _yaw = Mathf.Atan2(forward.x, forward.z) * Mathf.Rad2Deg;
            _pitch = Mathf.Asin(-forward.y) * Mathf.Rad2Deg;
        }
        // 不在初始化时跳转镜头。首次轨道输入才对准目标。
    }

    private void OnDisable()
    {
        ReleaseCamera();
    }

    private void ReleaseCamera()
    {
        _dragging = _touchAllowed = false;
        _touchCount = 0;
        if (!_ownsCamera) return;
        if (_camera != null)
        {
            Owners.Remove(_camera);
            _camera.transform.SetPositionAndRotation(_initialPosition, _initialRotation);
            _camera.orthographicSize = _initialOrthoSize;
        }
        if (_freeController != null) _freeController.enabled = true;
        _ownsCamera = false;
    }

    private bool CanBegin(Vector2 position)
    {
        if (!_camera.pixelRect.Contains(position)) return false;
        EventSystem system = EventSystem.current;
        if (system == null) return true;
        if (_eventSystem != system)
        {
            _eventSystem = system;
            _pointerData = new PointerEventData(system);
        }
        _pointerData.Reset();
        _pointerData.position = position;
        _uiHits.Clear();
        system.RaycastAll(_pointerData, _uiHits);
        for (int i = 0; i < _uiHits.Count; i++)
            if (_uiHits[i].module is UnityEngine.UI.GraphicRaycaster) return false;
        return true;
    }

    private void Update()
    {
        if (!OrbitEnabled || _target == null) return;
        if (!_ownsCamera) AcquireCamera();
        if (!_ownsCamera || _camera == null) return;
        bool changed = false;
        var screen = Touchscreen.current;
        UnityEngine.InputSystem.Controls.TouchControl first = null, second = null;
        int count = 0;
        if (screen != null)
            foreach (var touch in screen.touches)
                if (touch.press.isPressed) { if (count == 0) first = touch; else if (count == 1) second = touch; count++; }
        if (count > 0)
        {
            _dragging = false;
            Vector2 point = first.position.ReadValue();
            if (_touchCount == 0) _touchAllowed = CanBegin(point);
            if (count != _touchCount || _touchId != first.touchId.ReadValue())
            {
                if (count > 1) _touchAllowed &= CanBegin(second.position.ReadValue());
                _lastPointer = _pressPointer = point;
                _touchDistance = count > 1 ? Vector2.Distance(point, second.position.ReadValue()) : 0f;
            }
            else if (_touchAllowed)
            {
                if (count == 1 && Vector2.Distance(point, _pressPointer) > 5f)
                {
                    OrbitDelta(point - _lastPointer); changed = true;
                }
                else if (count == 2)
                {
                    float distance = Vector2.Distance(point, second.position.ReadValue());
                    if (distance > 1f && _touchDistance > 1f)
                    {
                        _distance = Mathf.Clamp(_distance * _touchDistance / distance, _minDistance, _maxDistance);
                        changed = true;
                    }
                    _touchDistance = distance;
                }
            }
            _lastPointer = point;
            _touchId = first.touchId.ReadValue();
        }
        else
        {
            Mouse mouse = Mouse.current;
            if (mouse != null && _touchCount == 0)
            {
                Vector2 point = mouse.position.ReadValue();
                bool pressed = (_orbitOnRightMouse && mouse.rightButton.wasPressedThisFrame) || (_orbitOnLeftMouseDrag && mouse.leftButton.wasPressedThisFrame);
                bool held = (_orbitOnRightMouse && mouse.rightButton.isPressed) || (_orbitOnLeftMouseDrag && mouse.leftButton.isPressed);
                if (pressed) { _dragging = CanBegin(point); _lastPointer = _pressPointer = point; }
                if (!held) _dragging = false;
                if (_dragging && Vector2.Distance(point, _pressPointer) > 5f)
                {
                    OrbitDelta(point - _lastPointer); changed = true;
                }
                _lastPointer = point;
                float scroll = mouse.scroll.ReadValue().y;
                if (Mathf.Abs(scroll) > .01f && CanBegin(point))
                {
                    _distance = Mathf.Clamp(_distance - Mathf.Clamp(scroll * _zoomSensitivity, -_distance * .25f, _distance * .25f), _minDistance, _maxDistance);
                    changed = true;
                }
            }
        }
        _touchCount = count;
        if (_autoOrbit && !_dragging && count == 0)
        {
            _yaw += _autoOrbitSpeed * Time.unscaledDeltaTime;
            changed = true;
        }
        if (changed) ApplyTransform();
    }

    private void OrbitDelta(Vector2 delta)
    {
        _yaw += delta.x * _orbitSensitivity;
        _pitch = Mathf.Clamp(_pitch - delta.y * _orbitSensitivity, -80f, 80f);
    }

    private void ApplyTransform()
    {
        if (_target == null || _camera == null || !_ownsCamera) return;
        Vector3 center = _target.TransformPoint(_targetLocalOffset);
        Quaternion rotation = Quaternion.Euler(_pitch, _yaw, 0f);
        _camera.transform.SetPositionAndRotation(center - rotation * Vector3.forward * _distance, rotation);
        if (_camera.orthographic) _camera.orthographicSize = _initialOrthoSize * _distance / _initialDistance;
    }

    public void SetOrbitEnabled(bool enabled)
    {
        OrbitEnabled = enabled;
        if (!enabled) ReleaseCamera(); else AcquireCamera();
    }
    public void SetAutoOrbit(bool enabled) { _autoOrbit = enabled; }
    public void FocusTarget() { ApplyTransform(); }
    public void SetDistance(float distance) { _distance = Mathf.Clamp(distance, _minDistance, _maxDistance); ApplyTransform(); }
}

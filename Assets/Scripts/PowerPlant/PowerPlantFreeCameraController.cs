using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// WebGL 运行时的自由相机控制。
/// WASD：前后左右，Q/E：下降/上升，Shift：加速，按住鼠标左键拖拽：平移，按住鼠标右键：旋转视角，鼠标滚轮：沿画面中心方向推拉镜头。
/// 流程和总览保持当前视角；拓扑节点选择会平滑移动到目标模型的轻微俯视取景，任意手动相机输入都会立即取消该取景。
/// </summary>
[DisallowMultipleComponent]
[RequireComponent(typeof(Camera))]
[DefaultExecutionOrder(100)]
public sealed class PowerPlantFreeCameraController : MonoBehaviour
{
    [Header("移动")]
    [SerializeField, Min(0.1f)] private float _moveSpeed = 24f;
    [SerializeField, Min(1f)] private float _shiftMultiplier = 3f;

    [Header("左键拖拽平移")]
    [Tooltip("鼠标左键拖拽每移动一个屏幕像素对应的世界空间平移距离。")]
    [SerializeField, Min(0.001f)] private float _panSensitivity = 0.08f;
    [Tooltip("累计移动超过该屏幕像素值后才开始平移，避免普通左键点击造成镜头抖动。")]
    [SerializeField, Min(0f)] private float _panStartDistance = 6f;

    [Header("视角")]
    [SerializeField, Min(0.01f)] private float _lookSensitivity = 0.13f;
    [SerializeField, Range(-89f, 89f)] private float _minPitch = -80f;
    [SerializeField, Range(-89f, 89f)] private float _maxPitch = 80f;
    [SerializeField] private bool _invertLookY;

    [Header("滚轮推拉")]
    [Tooltip("将输入系统上报的滚轮像素增量换算为世界空间位移；普通鼠标单格通常约产生 120 的增量。")]
    [SerializeField, Min(0.001f)] private float _scrollMoveSensitivity = 0.05f;
    [Tooltip("限制滚轮在单帧内造成的最大位移，防止高精度触控板或浏览器累积事件使镜头瞬间穿过场景。")]
    [SerializeField, Min(0.1f)] private float _maxScrollMovePerFrame = 30f;

    [Header("拓扑节点聚焦")]
    [Tooltip("聚焦镜头相对目标中心的俯视角；该角度只改变高度，不改变当前观察方向所在的水平侧。")]
    [SerializeField, Range(5f, 80f)] private float _focusPitch = 28f;
    [Tooltip("依据相机视野计算出完整容纳模型的距离后额外增加的留白倍率。")]
    [SerializeField, Min(1f)] private float _focusDistancePadding = 1.25f;
    [Tooltip("小型模型聚焦时采用的最小镜头距离，避免镜头贴近模型表面。")]
    [SerializeField, Min(0.1f)] private float _focusMinimumDistance = 18f;
    [Tooltip("拓扑节点选择后镜头移动至目标取景位置所用的非缩放时间。")]
    [SerializeField, Min(0f)] private float _focusDuration = 0.45f;

    private float _yaw;
    private float _pitch;
    private float _panStartDistanceSquared;
    private Vector2 _leftPressPosition;
    private bool _isPanning;
    private bool _isAutoFocusing;
    private float _focusElapsed;
    private Vector3 _focusStartPosition;
    private Vector3 _focusTargetPosition;
    private Quaternion _focusStartRotation;
    private Quaternion _focusTargetRotation;

    private void Awake()
    {
        Vector3 eulerAngles = transform.rotation.eulerAngles;
        _yaw = eulerAngles.y;
        _pitch = NormalizePitch(eulerAngles.x);
        UpdatePanThreshold();
    }

    private void OnValidate()
    {
        // 检视面板修改阈值后立即同步平方缓存，运行时无需重复计算平方值。
        UpdatePanThreshold();
    }

    private void UpdatePanThreshold()
    {
        _panStartDistanceSquared = _panStartDistance * _panStartDistance;
    }

    private void Update()
    {
        Keyboard keyboard = Keyboard.current;
        Mouse mouse = Mouse.current;
        Vector2 lookDelta = mouse != null ? mouse.delta.ReadValue() : Vector2.zero;
        bool beganPanning = mouse != null && mouse.leftButton.wasPressedThisFrame;
        bool isPanningButtonHeld = mouse != null && mouse.leftButton.isPressed;
        if (beganPanning)
        {
            // 首帧只记录按下位置，不读取旧的鼠标增量，避免刚按下左键时镜头跳动。
            _leftPressPosition = mouse.position.ReadValue();
            _isPanning = false;
        }

        bool hasPanInput = false;
        if (isPanningButtonHeld && !beganPanning)
        {
            if (!_isPanning)
            {
                Vector2 totalPointerDelta = mouse.position.ReadValue() - _leftPressPosition;
                _isPanning = totalPointerDelta.sqrMagnitude >= _panStartDistanceSquared;
            }

            hasPanInput = _isPanning && lookDelta.sqrMagnitude > 0.0001f;
        }
        else if (!isPanningButtonHeld)
        {
            _isPanning = false;
        }

        bool isRotating = mouse != null && mouse.rightButton.isPressed;
        bool beganRotating = mouse != null && mouse.rightButton.wasPressedThisFrame;
        if (beganRotating)
        {
            SyncLookAngles();
        }

        bool hasLookInput = isRotating && !beganRotating && lookDelta.sqrMagnitude > 0.0001f;
        float scrollDelta = mouse != null ? mouse.scroll.ReadValue().y : 0f;
        bool hasScrollInput = Mathf.Abs(scrollDelta) > 0.01f;
        Vector3 localMove = keyboard != null ? ReadMoveInput(keyboard) : Vector3.zero;
        bool hasMoveInput = localMove.sqrMagnitude > 0.0001f;
        bool hasManualInput = hasPanInput || hasLookInput || hasScrollInput || hasMoveInput;

        // 聚焦期间只要用户开始操作相机，就立刻让出控制权；左键普通点击不算相机输入，仍可正常触发节点选中。
        if (hasManualInput)
        {
            CancelFocus();
        }
        else if (_isAutoFocusing)
        {
            UpdateFocus();
            return;
        }

        if (hasPanInput)
        {
            MoveByPointerDrag(lookDelta);
        }

        if (hasLookInput)
        {
            _yaw += lookDelta.x * _lookSensitivity;
            float verticalSign = _invertLookY ? 1f : -1f;
            _pitch = Mathf.Clamp(_pitch + lookDelta.y * _lookSensitivity * verticalSign, _minPitch, _maxPitch);
            transform.rotation = Quaternion.Euler(_pitch, _yaw, 0f);
        }

        if (hasScrollInput)
        {
            MoveAlongCameraCenter(scrollDelta);
        }

        if (hasMoveInput)
        {
            float speed = _moveSpeed * (IsShiftPressed(keyboard) ? _shiftMultiplier : 1f);
            Vector3 forward = Vector3.ProjectOnPlane(transform.forward, Vector3.up).normalized;
            Vector3 right = Vector3.ProjectOnPlane(transform.right, Vector3.up).normalized;
            Vector3 worldMove = forward * localMove.z + right * localMove.x + Vector3.up * localMove.y;
            if (worldMove.sqrMagnitude > 1f)
            {
                worldMove.Normalize();
            }

            transform.position += worldMove * speed * Time.unscaledDeltaTime;
        }
    }

    /// <summary>
    /// 以模型渲染包围盒生成保持当前水平观察侧的轻微俯视镜位。
    /// 距离由相机垂直与水平视野中较窄的一侧决定，确保宽屏和窄屏都能完整容纳目标；
    /// 本方法不扫描场景、不分配集合，只在拓扑节点实际选中时调用一次。
    /// </summary>
    public void FocusBounds(Bounds bounds)
    {
        Camera camera = GetComponent<Camera>();
        float verticalHalfFieldOfView = camera.fieldOfView * Mathf.Deg2Rad * 0.5f;
        float horizontalHalfFieldOfView = Mathf.Atan(Mathf.Tan(verticalHalfFieldOfView) * camera.aspect);
        float limitingHalfFieldOfView = Mathf.Min(verticalHalfFieldOfView, horizontalHalfFieldOfView);
        float boundingRadius = Mathf.Max(bounds.extents.magnitude, 0.01f);
        float distance = Mathf.Max(
            _focusMinimumDistance,
            boundingRadius / Mathf.Sin(limitingHalfFieldOfView) * _focusDistancePadding);

        Vector3 horizontalDirection = Vector3.ProjectOnPlane(transform.position - bounds.center, Vector3.up);
        if (horizontalDirection.sqrMagnitude < 0.0001f)
        {
            horizontalDirection = -Vector3.ProjectOnPlane(transform.forward, Vector3.up);
        }
        horizontalDirection.Normalize();

        float pitchRadians = _focusPitch * Mathf.Deg2Rad;
        _focusTargetPosition = bounds.center
            + horizontalDirection * (Mathf.Cos(pitchRadians) * distance)
            + Vector3.up * (Mathf.Sin(pitchRadians) * distance);
        _focusTargetRotation = Quaternion.LookRotation(bounds.center - _focusTargetPosition, Vector3.up);
        _focusStartPosition = transform.position;
        _focusStartRotation = transform.rotation;
        _focusElapsed = 0f;
        _isAutoFocusing = _focusDuration > 0f;

        if (!_isAutoFocusing)
        {
            transform.SetPositionAndRotation(_focusTargetPosition, _focusTargetRotation);
            SyncLookAngles();
        }
    }

    private void UpdateFocus()
    {
        _focusElapsed += Time.unscaledDeltaTime;
        float normalizedTime = Mathf.Clamp01(_focusElapsed / _focusDuration);
        float easedTime = normalizedTime * normalizedTime * (3f - 2f * normalizedTime);
        transform.SetPositionAndRotation(
            Vector3.Lerp(_focusStartPosition, _focusTargetPosition, easedTime),
            Quaternion.Slerp(_focusStartRotation, _focusTargetRotation, easedTime));

        if (normalizedTime >= 1f)
        {
            _isAutoFocusing = false;
            SyncLookAngles();
        }
    }

    /// <summary>
    /// 停止尚未完成的拓扑自动取景，并保留当前已插值到的镜头位置。
    /// 选择清空和场景卸载通过此入口终止补间，避免镜头在交互目标已失效后继续移动。
    /// </summary>
    public void CancelFocus()
    {
        _isAutoFocusing = false;
    }

    /// <summary>
    /// 在世界水平面（XZ 平面）内平移相机，使拖拽过程中相机高度保持不变。
    /// 鼠标横向位移映射到相机水平右轴，鼠标纵向位移映射到相机水平前后轴；
    /// 两个方向都会先投影到 Vector3.up 的垂直平面，避免相机俯仰角导致世界 Y 轴发生位移。
    /// </summary>
    private void MoveByPointerDrag(Vector2 pointerDelta)
    {
        Vector3 horizontalRight = Vector3.ProjectOnPlane(transform.right, Vector3.up).normalized;
        Vector3 horizontalForward = Vector3.ProjectOnPlane(transform.forward, Vector3.up).normalized;
        Vector3 worldMove = (-horizontalRight * pointerDelta.x - horizontalForward * pointerDelta.y) * _panSensitivity;
        transform.position += worldMove;
    }

    /// <summary>
    /// 沿相机画面中心射线方向移动镜头，实现透视相机的推拉式缩放。
    /// 滚轮输入本身已是当前帧累计增量，因此不能再乘时间步长，否则不同帧率下手感会明显不一致。
    /// </summary>
    private void MoveAlongCameraCenter(float scrollDelta)
    {
        float requestedDistance = scrollDelta * _scrollMoveSensitivity;
        float moveDistance = Mathf.Clamp(
            requestedDistance,
            -_maxScrollMovePerFrame,
            _maxScrollMovePerFrame);

        // transform.forward 始终对应相机视口中心方向；滚轮向上为靠近画面中心，向下为远离。
        transform.position += transform.forward * moveDistance;
    }

    private void SyncLookAngles()
    {
        Vector3 eulerAngles = transform.rotation.eulerAngles;
        _yaw = eulerAngles.y;
        _pitch = NormalizePitch(eulerAngles.x);
    }

    private static Vector3 ReadMoveInput(Keyboard keyboard)
    {
        float horizontal = (keyboard.dKey.isPressed ? 1f : 0f) - (keyboard.aKey.isPressed ? 1f : 0f);
        float vertical = (keyboard.eKey.isPressed ? 1f : 0f) - (keyboard.qKey.isPressed ? 1f : 0f);
        float forward = (keyboard.wKey.isPressed ? 1f : 0f) - (keyboard.sKey.isPressed ? 1f : 0f);
        return new Vector3(horizontal, vertical, forward);
    }

    private static bool IsShiftPressed(Keyboard keyboard)
    {
        return keyboard.leftShiftKey.isPressed || keyboard.rightShiftKey.isPressed;
    }

    private static float NormalizePitch(float angle)
    {
        return angle > 180f ? angle - 360f : angle;
    }
}

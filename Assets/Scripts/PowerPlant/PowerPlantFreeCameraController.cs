using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// WebGL 运行时的自由相机控制。
/// WASD：前后左右，Q/E：下降/上升，Shift：加速，按住鼠标右键：旋转视角，鼠标滚轮：沿画面中心方向推拉镜头。
/// </summary>
[DisallowMultipleComponent]
[RequireComponent(typeof(Camera))]
[DefaultExecutionOrder(100)]
public sealed class PowerPlantFreeCameraController : MonoBehaviour
{
    [Header("移动")]
    [SerializeField, Min(0.1f)] private float _moveSpeed = 24f;
    [SerializeField, Min(1f)] private float _shiftMultiplier = 3f;

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

    [Header("流程镜头")]
    [SerializeField] private PowerPlantProcessController _processController;

    private float _yaw;
    private float _pitch;

    private void Awake()
    {
        if (_processController == null)
        {
            _processController = FindFirstObjectByType<PowerPlantProcessController>();
        }

        Vector3 eulerAngles = transform.rotation.eulerAngles;
        _yaw = eulerAngles.y;
        _pitch = NormalizePitch(eulerAngles.x);
    }

    private void Update()
    {
        Keyboard keyboard = Keyboard.current;
        Mouse mouse = Mouse.current;
        if (keyboard == null || mouse == null)
        {
            return;
        }

        Vector2 lookDelta = mouse.delta.ReadValue();
        bool isRotating = mouse.rightButton.isPressed;
        bool beganRotating = mouse.rightButton.wasPressedThisFrame;
        if (beganRotating)
        {
            SyncLookAngles();
        }

        bool hasLookInput = isRotating && !beganRotating && lookDelta.sqrMagnitude > 0.0001f;
        float scrollDelta = mouse.scroll.ReadValue().y;
        bool hasScrollInput = Mathf.Abs(scrollDelta) > 0.01f;

        Vector3 localMove = ReadMoveInput(keyboard);
        bool hasMoveInput = localMove.sqrMagnitude > 0.0001f;
        if (hasLookInput || hasMoveInput || hasScrollInput)
        {
            _processController?.CancelCameraTransition();
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

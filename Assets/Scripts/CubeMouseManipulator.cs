using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// 为当前立方体提供鼠标旋转、缩放和单击判定。
/// 左键按住并拖拽可旋转，鼠标悬停在物体上滚动滚轮可缩放；
/// 只有未达到拖拽距离且按住时间较短的操作才会被视为单击，避免旋转时误触发设备点击事件。
/// </summary>
[DisallowMultipleComponent]
public sealed class CubeMouseManipulator : MonoBehaviour
{
    [Header("相机与射线检测")]
    [Tooltip("用于将鼠标屏幕坐标转换为三维射线的相机。未指定时自动使用带有 MainCamera 标签的相机。")]
    [SerializeField] private Camera interactionCamera;
    [Tooltip("参与鼠标命中检测的物理层。默认检测所有可射线命中的层。")]
    [SerializeField] private LayerMask raycastLayers = Physics.DefaultRaycastLayers;
    [Tooltip("是否忽略触发器碰撞体，避免不可见的交互区域拦截立方体。")]
    [SerializeField] private bool ignoreTriggerColliders = true;

    [Header("旋转参数")]
    [Tooltip("鼠标每移动一个屏幕像素对应的旋转角度。")]
    [SerializeField, Min(0.01f)] private float rotationSensitivity = 0.25f;
    [Tooltip("判定为拖拽所需的最小累计移动距离（屏幕像素）。")]
    [SerializeField, Min(0f)] private float dragStartDistance = 6f;

    [Header("缩放参数")]
    [Tooltip("一次标准鼠标滚轮刻度对应的缩放倍率。指数缩放可使放大与缩小的手感对称。")]
    [SerializeField, Range(1.01f, 2f)] private float zoomFactorPerStep = 1.1f;
    [Tooltip("相对于初始缩放的最小倍率。")]
    [SerializeField, Min(0.01f)] private float minimumScaleMultiplier = 0.5f;
    [Tooltip("相对于初始缩放的最大倍率。")]
    [SerializeField, Min(0.01f)] private float maximumScaleMultiplier = 3f;

    [Header("单击判定")]
    [Tooltip("按住时间不超过该值且未拖拽时，才向低代码平台上报对象点击。")]
    [SerializeField, Min(0.01f)] private float maximumClickDuration = 0.35f;

    // 初始化时缓存依赖，避免逐帧执行相机或组件查找。
    private Camera _interactionCamera;
    private Collider _rootCollider;
    private UnityIframeTestObject _clickReporter;
    private Vector3 _initialScale;
    private float _scaleMultiplier = 1f;
    private float _dragStartDistanceSquared;
    private Vector2 _pressPointerPosition;
    private float _pressTime;
    private bool _isPointerCaptured;
    private bool _isDragging;
    // 记录本次按住期间是否已真正执行旋转，用于兼容浏览器中鼠标位置事件与增量事件不同步的情况。
    private bool _hasRotatedDuringCapture;
    private bool _hasApplicationFocus = true;

    private void Awake()
    {
        // 优先使用检视面板显式指定的相机；未配置时只回退查询一次主相机。
        _interactionCamera = interactionCamera != null ? interactionCamera : Camera.main;
        bool hasRootCollider = TryGetComponent(out _rootCollider);
        TryGetComponent(out _clickReporter);
        _initialScale = transform.localScale;
        NormalizeConfiguration();

        if (_interactionCamera == null)
        {
            // 配置错误仅在初始化时记录一次，避免帧循环中重复输出日志。
            Debug.LogError($"[{nameof(CubeMouseManipulator)}] 未找到交互相机。请在检视面板指定相机，或为场景相机设置 MainCamera 标签。", this);
            enabled = false;
            return;
        }

        if (!hasRootCollider)
        {
            Debug.LogError($"[{nameof(CubeMouseManipulator)}] 当前对象缺少 Collider，无法识别鼠标命中。", this);
            enabled = false;
        }
    }

    private void OnValidate()
    {
        // 编辑器中调整参数时同步修正边界和缓存值，保证运行时判定稳定。
        NormalizeConfiguration();
    }

    private void Update()
    {
        Mouse mouse = Mouse.current;
        if (!_hasApplicationFocus || mouse == null || _interactionCamera == null)
        {
            // 内嵌框架失焦时，浏览器可能不会把鼠标松开事件交给 Unity；此处强制释放状态，防止持续旋转。
            CancelPointerInteraction();
            return;
        }

        Vector2 pointerPosition = mouse.position.ReadValue();

        if (mouse.leftButton.wasPressedThisFrame)
        {
            BeginPointerInteraction(pointerPosition);
        }
        else if (mouse.leftButton.wasReleasedThisFrame)
        {
            CompletePointerInteraction(pointerPosition);
        }
        else if (_isPointerCaptured && !mouse.leftButton.isPressed)
        {
            // 兜底处理：焦点切换或鼠标在画布外松开，导致未收到 wasReleasedThisFrame 的情况。
            CancelPointerInteraction();
        }
        else if (_isPointerCaptured)
        {
            UpdatePointerRotation(mouse, pointerPosition);
        }

        // 仅在鼠标悬停当前对象时缩放，射线检测只在滚轮有输入时执行，避免无效物理查询。
        float scrollY = mouse.scroll.ReadValue().y;
        if (!Mathf.Approximately(scrollY, 0f) && IsPointerOverTarget(pointerPosition))
        {
            Scale(scrollY);
        }
    }

    private void OnApplicationFocus(bool hasFocus)
    {
        _hasApplicationFocus = hasFocus;
        if (!hasFocus)
        {
            // 失焦不是一次有效单击，不应向父页面发送 object-click。
            CancelPointerInteraction();
        }
    }

    private void OnDisable()
    {
        // 对象被禁用或销毁时清理瞬态输入状态，避免重新启用后沿用旧的拖拽状态。
        CancelPointerInteraction();
    }

    /// <summary>
    /// 仅在左键按下位置命中当前对象或其子节点碰撞体时捕获鼠标。
    /// 首帧只记录按下位置，不读取旧的鼠标增量，避免首次按下时产生跳转旋转。
    /// </summary>
    private void BeginPointerInteraction(Vector2 pointerPosition)
    {
        _isPointerCaptured = IsPointerOverTarget(pointerPosition);
        _isDragging = false;
        _hasRotatedDuringCapture = false;
        _pressPointerPosition = pointerPosition;
        _pressTime = Time.unscaledTime;
    }

    /// <summary>
    /// 依据累计位移判定拖拽，只有达到阈值后才开始旋转。
    /// 这会让普通单击保持物体姿态不变，并与设备点击事件准确区分。
    /// </summary>
    private void UpdatePointerRotation(Mouse mouse, Vector2 pointerPosition)
    {
        if (!_isDragging)
        {
            Vector2 totalPointerDelta = pointerPosition - _pressPointerPosition;
            _isDragging = totalPointerDelta.sqrMagnitude >= _dragStartDistanceSquared;
        }

        if (_isDragging)
        {
            Rotate(mouse.delta.ReadValue());
            // 一旦已经产生实际旋转，就绝不能在松开时再当作普通单击上报。
            // 该标记可抵御部分浏览器将拖拽过程压缩为少量输入帧时的位置同步差异。
            _hasRotatedDuringCapture = true;
        }
    }

    /// <summary>
    /// 在鼠标正常松开时完成交互。只有短时、未拖拽的操作才上报设备点击。
    /// </summary>
    private void CompletePointerInteraction(Vector2 pointerPosition)
    {
        if (!_isPointerCaptured)
        {
            return;
        }

        Vector2 totalPointerDelta = pointerPosition - _pressPointerPosition;
        // 实际旋转标记作为最终兜底判据，确保“已旋转”与“设备单击”在语义上互斥。
        bool wasDragged = _isDragging || _hasRotatedDuringCapture || totalPointerDelta.sqrMagnitude >= _dragStartDistanceSquared;
        bool isShortClick = Time.unscaledTime - _pressTime <= maximumClickDuration;

        if (!wasDragged && isShortClick)
        {
            // 上报组件为可选依赖：纯三维项目可单独使用本脚本，不会因缺少桥接组件报错。
            _clickReporter?.ReportClick();
        }

        CancelPointerInteraction();
    }

    /// <summary>
    /// 通过相机射线判断命中对象是否为当前对象或其子节点，兼容真实模型的多碰撞体层级。
    /// </summary>
    private bool IsPointerOverTarget(Vector2 pointerPosition)
    {
        Ray ray = _interactionCamera.ScreenPointToRay(pointerPosition);
        QueryTriggerInteraction triggerMode = ignoreTriggerColliders
            ? QueryTriggerInteraction.Ignore
            : QueryTriggerInteraction.Collide;

        if (!Physics.Raycast(ray, out RaycastHit hit, float.PositiveInfinity, raycastLayers, triggerMode))
        {
            return false;
        }

        // 根碰撞体走快速引用比较；子节点碰撞体使用层级判断，支持复杂设备模型。
        return hit.collider == _rootCollider || hit.collider.transform.IsChildOf(transform);
    }

    /// <summary>
    /// 水平移动绕世界 Y 轴旋转，垂直移动绕相机右轴旋转，保持直观稳定的查看方向。
    /// </summary>
    private void Rotate(Vector2 pointerDelta)
    {
        float yaw = pointerDelta.x * rotationSensitivity;
        float pitch = -pointerDelta.y * rotationSensitivity;
        transform.Rotate(Vector3.up, yaw, Space.World);
        transform.Rotate(_interactionCamera.transform.right, pitch, Space.World);
    }

    /// <summary>
    /// 使用指数倍率进行均匀缩放，并限制在安全范围内。
    /// 单帧滚轮输入会先限幅，防止高灵敏度触控板产生突兀的大幅缩放。
    /// </summary>
    private void Scale(float scrollY)
    {
        const float standardScrollStep = 120f;
        float normalizedScroll = Mathf.Clamp(scrollY / standardScrollStep, -1f, 1f);
        float zoomFactor = Mathf.Pow(zoomFactorPerStep, normalizedScroll);

        _scaleMultiplier = Mathf.Clamp(
            _scaleMultiplier * zoomFactor,
            minimumScaleMultiplier,
            maximumScaleMultiplier);
        transform.localScale = _initialScale * _scaleMultiplier;
    }

    /// <summary>
    /// 统一修正可配置参数，并预计算拖拽阈值的平方值，避免在帧循环中重复平方计算。
    /// </summary>
    private void NormalizeConfiguration()
    {
        minimumScaleMultiplier = Mathf.Max(0.01f, minimumScaleMultiplier);
        maximumScaleMultiplier = Mathf.Max(minimumScaleMultiplier, maximumScaleMultiplier);
        zoomFactorPerStep = Mathf.Clamp(zoomFactorPerStep, 1.01f, 2f);
        maximumClickDuration = Mathf.Max(0.01f, maximumClickDuration);
        dragStartDistance = Mathf.Max(0f, dragStartDistance);
        _dragStartDistanceSquared = dragStartDistance * dragStartDistance;
    }

    /// <summary>
    /// 取消当前鼠标捕获状态。该方法不会发送任何消息，适用于失焦、禁用和异常松开场景。
    /// </summary>
    private void CancelPointerInteraction()
    {
        _isPointerCaptured = false;
        _isDragging = false;
        _hasRotatedDuringCapture = false;
    }
}

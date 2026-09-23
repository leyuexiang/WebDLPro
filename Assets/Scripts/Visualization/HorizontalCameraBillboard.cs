using UnityEngine;

/// <summary>
/// 使物体仅更新世界 Y 轴朝向，并持续朝向指定相机。
/// 会保留物体当前的 X、Z 轴旋转，适用于需要保留模型轴向修正的世界空间画布和广告牌。
/// </summary>
[DisallowMultipleComponent]
[AddComponentMenu("Visualization/Horizontal Camera Billboard")]
public sealed class HorizontalCameraBillboard : MonoBehaviour
{
    [Header("目标相机")]
    [Tooltip("优先使用此相机。留空时会在 Start 中仅查询一次带有 MainCamera 标签的相机。")]
    [SerializeField] private Camera _targetCamera;

    [Header("朝向")]
    [Tooltip("启用后使物体背面朝向相机。用于正面模型朝向本地负 Z 轴的情况。")]
    [SerializeField] private bool _faceCameraBackwards;

    // 缓存自身和相机的 Transform，避免逐帧通过组件属性或 Camera.main 查询场景对象。
    private Transform _selfTransform;
    private Transform _targetCameraTransform;

    /// <summary>
    /// 缓存自身 Transform；此时仅处理检视器中显式配置的相机，
    /// 不在 Awake 中查询主相机，以确保所有对象初始化完成后再统一解析。
    /// </summary>
    private void Awake()
    {
        _selfTransform = transform;
        CacheTargetCamera(_targetCamera);
    }

    /// <summary>
    /// 所有场景对象的 Awake 执行完毕后，解析一次未显式指定的主相机。
    /// 只在初始化阶段查找，避免多个广告牌在每帧重复执行 Camera.main 查询。
    /// </summary>
    private void Start()
    {
        if (_targetCameraTransform != null)
        {
            return;
        }

        CacheTargetCamera(Camera.main);

        if (_targetCameraTransform == null)
        {
            Debug.LogWarning(
                $"[{nameof(HorizontalCameraBillboard)}] 未找到目标相机。请在检视器中指定相机，或为场景相机设置 MainCamera 标签。",
                this);
        }
    }

    /// <summary>
    /// 在当前帧全部 Update 执行完毕后再更新朝向，确保广告牌使用相机移动后的最终位置。
    /// 水平方向会清除高度差；仅覆盖 Y 轴欧拉角，保留模型原有的 X、Z 轴修正值。
    /// </summary>
    private void LateUpdate()
    {
        if (_targetCameraTransform == null)
        {
            return;
        }

        Vector3 horizontalDirection = _targetCameraTransform.position - _selfTransform.position;
        horizontalDirection.y = 0f;

        // 相机与广告牌在 XZ 平面重合时没有有效朝向，保留上一帧旋转以规避零向量计算。
        if (horizontalDirection.sqrMagnitude < 0.0001f)
        {
            return;
        }

        // 将相机在 XZ 平面的方位转换为 Y 轴角度，避免 LookRotation 覆写模型原有的 X、Z 轴旋转。
        float yaw = Mathf.Atan2(horizontalDirection.x, horizontalDirection.z) * Mathf.Rad2Deg;

        // 正面朝向本地负 Z 轴的模型需额外旋转 180 度；此处仍只修改 Y 轴。
        if (_faceCameraBackwards)
        {
            yaw += 180f;
        }

        // 每帧读取当前欧拉角并仅写回 Y 轴：例如模型预设 X = -90 度时，该值会被完整保留。
        Vector3 currentEulerAngles = _selfTransform.eulerAngles;
        currentEulerAngles.y = yaw;
        _selfTransform.rotation = Quaternion.Euler(currentEulerAngles);
    }

    /// <summary>
    /// 供运行时生成广告牌或切换相机的业务逻辑调用。
    /// 方法同时更新序列化引用与缓存，后续帧无需额外查找即可立即生效。
    /// </summary>
    /// <param name="targetCamera">要朝向的相机；传入空值会停止自动旋转。</param>
    public void SetTargetCamera(Camera targetCamera)
    {
        _targetCamera = targetCamera;
        CacheTargetCamera(targetCamera);
    }

    /// <summary>
    /// 将相机组件转换为 Transform 缓存。使用独立方法集中处理空值，
    /// 让每帧逻辑只需进行一次轻量级空引用判断。
    /// </summary>
    /// <param name="targetCamera">需要缓存的相机组件。</param>
    private void CacheTargetCamera(Camera targetCamera)
    {
        _targetCameraTransform = targetCamera != null ? targetCamera.transform : null;
    }
}

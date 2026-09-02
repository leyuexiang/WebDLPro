using UnityEngine;

/// <summary>
/// 根据目标相机与广告牌的距离，按初始缩放等比调整广告牌尺寸。
/// 相机位于初始距离时保持原始大小；远离时放大、靠近时缩小，并受缩放倍数上下限约束。
/// </summary>
[DisallowMultipleComponent]
[AddComponentMenu("Visualization/Distance Compensated Billboard Scale")]
public sealed class DistanceCompensatedBillboardScale : MonoBehaviour
{
    private const float MinimumValidDistance = 0.0001f;
    private const float ScaleComparisonTolerance = 0.000001f;

    [Header("目标相机")]
    [Tooltip("优先使用此相机。留空时会在 Start 中仅查询一次带有 MainCamera 标签的相机。")]
    [SerializeField] private Camera _targetCamera;

    [Header("缩放限制")]
    [Tooltip("相对于初始缩放允许的最小倍数。")]
    [SerializeField, Min(0.01f)] private float _minimumScaleMultiplier = 0.5f;

    [Tooltip("相对于初始缩放允许的最大倍数。")]
    [SerializeField, Min(0.01f)] private float _maximumScaleMultiplier = 3f;

    // 缓存运行时引用和基准数据，避免多个广告牌在每帧重复查询组件或主相机。
    private Transform _selfTransform;
    private Transform _targetCameraTransform;
    private Vector3 _initialLocalScale;
    private float _referenceDistance;

    /// <summary>
    /// 在任何缩放更新前记录场景中配置的初始缩放，后续始终以该值为基准等比计算。
    /// </summary>
    private void Awake()
    {
        _selfTransform = transform;
        _initialLocalScale = _selfTransform.localScale;
        CacheTargetCamera(_targetCamera);
    }

    /// <summary>
    /// 所有场景对象初始化完成后解析一次主相机，并记录启动时的相机距离。
    /// 该距离对应缩放倍数 1，确保进入场景时广告牌尺寸不会发生跳变。
    /// </summary>
    private void Start()
    {
        if (_targetCameraTransform == null)
        {
            CacheTargetCamera(Camera.main);
        }

        if (_targetCameraTransform == null)
        {
            Debug.LogWarning(
                $"[{nameof(DistanceCompensatedBillboardScale)}] 未找到目标相机。请在检视器中指定相机，或为场景相机设置 MainCamera 标签。",
                this);
            return;
        }

        CaptureReferenceDistance();
    }

    /// <summary>
    /// 在相机控制逻辑完成后更新缩放，避免广告牌尺寸相对相机移动滞后一帧。
    /// 透视相机下，物体的屏幕尺寸与距离近似成反比，因此按距离比例补偿世界尺寸。
    /// </summary>
    private void LateUpdate()
    {
        if (_targetCameraTransform == null || _referenceDistance < MinimumValidDistance)
        {
            return;
        }

        // 正交相机的屏幕尺寸不随距离变化，保持初始缩放即可。
        if (_targetCamera != null && _targetCamera.orthographic)
        {
            ApplyScale(_initialLocalScale);
            return;
        }

        float currentDistance = Vector3.Distance(_targetCameraTransform.position, _selfTransform.position);
        float scaleMultiplier = Mathf.Clamp(
            currentDistance / _referenceDistance,
            _minimumScaleMultiplier,
            _maximumScaleMultiplier);

        ApplyScale(_initialLocalScale * scaleMultiplier);
    }

    /// <summary>
    /// 供运行时切换相机时调用。切换后以新相机的当前距离重新建立基准，避免尺寸突变。
    /// </summary>
    /// <param name="targetCamera">新的目标相机；传入空值会暂停自动缩放。</param>
    public void SetTargetCamera(Camera targetCamera)
    {
        _targetCamera = targetCamera;
        CacheTargetCamera(targetCamera);

        if (_targetCameraTransform != null)
        {
            CaptureReferenceDistance();
        }
    }

    /// <summary>
    /// 缓存相机 Transform，确保每帧缩放计算不访问 Camera.main。
    /// </summary>
    private void CacheTargetCamera(Camera targetCamera)
    {
        _targetCamera = targetCamera;
        _targetCameraTransform = targetCamera != null ? targetCamera.transform : null;
    }

    /// <summary>
    /// 记录当前相机距离作为缩放倍数 1 的参考距离，并规避相机与广告牌重合导致除零。
    /// </summary>
    private void CaptureReferenceDistance()
    {
        _referenceDistance = Mathf.Max(
            Vector3.Distance(_targetCameraTransform.position, _selfTransform.position),
            MinimumValidDistance);
    }

    /// <summary>
    /// 仅在目标缩放确实变化时写入 Transform，减少无效原生层调用。
    /// </summary>
    private void ApplyScale(Vector3 targetScale)
    {
        if ((_selfTransform.localScale - targetScale).sqrMagnitude > ScaleComparisonTolerance)
        {
            _selfTransform.localScale = targetScale;
        }
    }

    /// <summary>
    /// 保证检视器中的缩放倍数始终有效，并自动修正上下限顺序。
    /// </summary>
    private void OnValidate()
    {
        _minimumScaleMultiplier = Mathf.Max(0.01f, _minimumScaleMultiplier);
        _maximumScaleMultiplier = Mathf.Max(_minimumScaleMultiplier, _maximumScaleMultiplier);
    }
}

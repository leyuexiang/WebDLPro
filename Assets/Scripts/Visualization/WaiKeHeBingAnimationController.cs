using System;
using UnityEngine;

/// <summary>
/// WaiKeHeBing 设备的零件动画控制器。
/// 风扇和涡轮使用独立旋转枢轴驱动，右侧外壳使用透明材质并通过材质属性块控制透明度；
/// 原始模型资源不被修改，适合直接挂在演示预制体上循环播放。
/// </summary>
[DisallowMultipleComponent]
public sealed class WaiKeHeBingAnimationController : MonoBehaviour
{
    private static readonly int BaseColorPropertyId = Shader.PropertyToID("_BaseColor");

    [Header("旋转目标")]
    [Tooltip("风扇旋转枢轴。所有枢轴均由编辑器配置工具创建，运行时不按名称查找对象。")]
    [SerializeField] private Transform[] _fanPivots = Array.Empty<Transform>();
    [Tooltip("涡轮旋转枢轴。所有枢轴均由编辑器配置工具创建，运行时不按名称查找对象。")]
    [SerializeField] private Transform[] _turbinePivots = Array.Empty<Transform>();

    [Header("动画参数")]
    [Tooltip("风扇转速，单位为每秒旋转角度。")]
    [SerializeField, Min(0f)] private float _fanSpeedDegrees = 180f;
    [Tooltip("涡轮转速，单位为每秒旋转角度。")]
    [SerializeField, Min(0f)] private float _turbineSpeedDegrees = 360f;
    [Tooltip("启用组件时是否自动开始循环旋转。")]
    [SerializeField] private bool _playOnEnable = true;

    [Header("右侧外壳")]
    [Tooltip("模型本地坐标正 X 侧的外壳渲染器。透明材质已单独分配，不会修改原始模型材质。")]
    [SerializeField] private Renderer[] _rightShellRenderers = Array.Empty<Renderer>();
    [Tooltip("右侧外壳透明度，数值越小越透明。")]
    [SerializeField, Range(0.05f, 0.95f)] private float _rightShellOpacity = 0.28f;

    private bool _isPlaying;
    private bool _playbackAllowed = true;
    private MaterialPropertyBlock _rightShellPropertyBlock;

    /// <summary>
    /// 编辑器配置工具使用的绑定入口；数组保存到预制体后，运行时不再进行层级搜索。
    /// </summary>
    public void Configure(
        Transform[] fanPivots,
        Transform[] turbinePivots,
        Renderer[] rightShellRenderers)
    {
        _fanPivots = fanPivots ?? Array.Empty<Transform>();
        _turbinePivots = turbinePivots ?? Array.Empty<Transform>();
        _rightShellRenderers = rightShellRenderers ?? Array.Empty<Renderer>();
        ApplyRightShellOpacity();
    }

    /// <summary>
    /// 开始播放两类旋转动画。
    /// </summary>
    public void Play()
    {
        _isPlaying = _playbackAllowed;
    }

    /// <summary>
    /// 暂停播放并保留当前零件角度。
    /// </summary>
    public void Pause()
    {
        _isPlaying = false;
    }

    /// <summary>
    /// 设置当前实例是否允许按序列化的自动播放基线运行。该入口可在根对象激活前调用，
    /// 因而故障状态不会等到首个 Update 才停止旋转；恢复时也不会强行启动原本关闭自动播放的实例。
    /// </summary>
    public void SetPlaybackAllowed(bool allowed)
    {
        _playbackAllowed = allowed;
        _isPlaying = isActiveAndEnabled && _playOnEnable && _playbackAllowed;
    }

    /// <summary>
    /// 更新右侧外壳透明度，并立即刷新材质属性块。
    /// </summary>
    public void SetRightShellOpacity(float opacity)
    {
        _rightShellOpacity = Mathf.Clamp(opacity, 0.05f, 0.95f);
        ApplyRightShellOpacity();
    }

    private void OnEnable()
    {
        _isPlaying = _playOnEnable && _playbackAllowed;
        ApplyRightShellOpacity();
    }

    private void Update()
    {
        if (!_isPlaying)
            return;

        var deltaTime = Time.deltaTime;
        RotatePivots(_fanPivots, _fanSpeedDegrees * deltaTime);
        RotatePivots(_turbinePivots, _turbineSpeedDegrees * deltaTime);
    }

    /// <summary>
    /// 所有旋转枢轴统一使用本地 Z 轴；模型中的叶片平面为 XY 平面，
    /// 因此绕 Z 轴旋转不会改变零件在设备轴向上的位置。
    /// </summary>
    private static void RotatePivots(Transform[] pivots, float angle)
    {
        for (var i = 0; i < pivots.Length; i++)
        {
            var pivot = pivots[i];
            if (pivot != null)
                pivot.Rotate(Vector3.forward, angle, Space.Self);
        }
    }

    /// <summary>
    /// 使用材质属性块覆盖透明度，避免为每个外壳渲染器复制运行时材质，
    /// 同时保留透明材质中的颜色、贴图和其他渲染设置。
    /// </summary>
    private void ApplyRightShellOpacity()
    {
        if (_rightShellRenderers.Length == 0)
            return;

        _rightShellPropertyBlock ??= new MaterialPropertyBlock();
        for (var i = 0; i < _rightShellRenderers.Length; i++)
        {
            var renderer = _rightShellRenderers[i];
            if (renderer == null)
                continue;

            var material = renderer.sharedMaterial;
            if (material == null || !material.HasProperty(BaseColorPropertyId))
                continue;

            _rightShellPropertyBlock.Clear();
            renderer.GetPropertyBlock(_rightShellPropertyBlock);
            var color = material.GetColor(BaseColorPropertyId);
            color.a = _rightShellOpacity;
            _rightShellPropertyBlock.SetColor(BaseColorPropertyId, color);
            renderer.SetPropertyBlock(_rightShellPropertyBlock);
        }
    }
}

using System;
using UnityEngine;

/// <summary>
/// WaiKeHeBing 的三维气流体积控制器。
/// 体积网格的横截面由多组低面数环形采样组成，网格边界在外壳内侧，
/// 流动方向和颜色由现有管道流动材质控制；运行时只更新材质属性块，不创建网格或材质实例。
/// </summary>
[DisallowMultipleComponent]
public sealed class WaiKeHeBingGasVolumeController : MonoBehaviour
{
    private static readonly int FlowSpeedPropertyId = Shader.PropertyToID("_FlowSpeed");
    private static readonly int FlowColorPropertyId = Shader.PropertyToID("_FlowColor");
    private static readonly int FlowIntensityPropertyId = Shader.PropertyToID("_FlowIntensity");
    private static readonly int FlowDirectionPropertyId = Shader.PropertyToID("_FlowDirectionOS");

    [Header("流体体积")]
    [Tooltip("蓝色进气体积网格。")]
    [SerializeField] private Renderer _blueVolumeRenderer;
    [Tooltip("红色排气体积网格。")]
    [SerializeField] private Renderer _redVolumeRenderer;
    [Tooltip("橘色燃烧体积网格，用于覆盖 YuanTong/Tong 内部燃烧区域。")]
    [SerializeField] private Renderer _orangeVolumeRenderer;
    [Tooltip("蓝色进气流速，正值配合局部 X 方向从设备入口流向出口。")]
    [SerializeField] private float _blueFlowSpeed = 1.2f;
    [Tooltip("红色排气流速，正值配合局部 X 方向从设备入口流向出口。")]
    [SerializeField] private float _redFlowSpeed = 1.35f;
    [Tooltip("橘色燃烧体积流速；负值表示沿局部 X 轴反向流动，匹配燃烧段实际方向。")]
    [SerializeField] private float _orangeFlowSpeed = -0.95f;
    [Tooltip("流动亮度。")]
    [SerializeField, Range(0f, 8f)] private float _flowIntensity = 2.2f;
    [Tooltip("启用组件时是否播放流动。")]
    [SerializeField] private bool _playOnEnable = true;

    [Header("颜色")]
    [Tooltip("蓝色进气体积和粒子叠加层颜色。")]
    [SerializeField, ColorUsage(true, true)] private Color _blueFlowColor = new Color(0.02f, 0.35f, 1f, 1f);
    [Tooltip("红色排气体积和粒子叠加层颜色。")]
    [SerializeField, ColorUsage(true, true)] private Color _redFlowColor = new Color(1f, 0.03f, 0.01f, 1f);
    [Tooltip("橘色燃烧体积颜色。")]
    [SerializeField, ColorUsage(true, true)] private Color _orangeFlowColor = new Color(1.5f, 0.16f, 0.015f, 1f);

    [Header("粒子叠加")]
    [Tooltip("蓝色流体体积内部的粒子叠加层；粒子从蓝色体积网格内部生成。")]
    [SerializeField] private ParticleSystem _blueParticleOverlay;
    [Tooltip("红色流体体积内部的粒子叠加层；粒子从红色体积网格内部生成。")]
    [SerializeField] private ParticleSystem _redParticleOverlay;

    private bool _isPlaying;
    private bool _playbackAllowed = true;
    private MaterialPropertyBlock _propertyBlock;

    /// <summary>
    /// 配置预先生成的蓝色和红色体积网格；不复制共享材质，避免增加运行时内存。
    /// </summary>
    public void Configure(Renderer blueVolumeRenderer, Renderer redVolumeRenderer)
    {
        _blueVolumeRenderer = blueVolumeRenderer;
        _redVolumeRenderer = redVolumeRenderer;
        ApplyMaterialProperties();
    }

    /// <summary>
    /// 配置橘色燃烧体积；单独保留该入口，避免改变已有蓝红体积的调用方式。
    /// </summary>
    public void ConfigureOrangeVolume(Renderer orangeVolumeRenderer)
    {
        _orangeVolumeRenderer = orangeVolumeRenderer;
        ApplyMaterialProperties();
    }

    public void Play()
    {
        if (!_playbackAllowed)
        {
            Pause();
            return;
        }

        _isPlaying = true;
        SetParticlePlayback(true);
        ApplyMaterialProperties();
    }

    public void Pause()
    {
        _isPlaying = false;
        SetParticlePlayback(false);
        // 立即把材质属性块中的流速写为零，不能等待下一次强度设置，否则体积 Shader 仍会继续按 _Time 流动。
        ApplyMaterialProperties();
    }

    /// <summary>
    /// 设置是否允许按序列化自动播放基线运行。该入口可在包装根对象激活前调用，
    /// 保证首次显示为故障时体积流速和粒子叠加层均已停止。
    /// </summary>
    public void SetPlaybackAllowed(bool allowed)
    {
        _playbackAllowed = allowed;
        if (!isActiveAndEnabled)
        {
            _isPlaying = _playOnEnable && _playbackAllowed;
            if (!allowed)
            {
                SetParticlePlayback(false);
                ApplyMaterialProperties();
            }
            return;
        }

        if (_playOnEnable && allowed)
        {
            Play();
        }
        else
        {
            Pause();
        }
    }

    public void SetIntensity(float intensity)
    {
        _flowIntensity = Mathf.Clamp(intensity, 0f, 8f);
        ApplyMaterialProperties();
    }

    private void OnEnable()
    {
        _isPlaying = _playOnEnable && _playbackAllowed;
        SetParticlePlayback(_isPlaying);
        ApplyMaterialProperties();
    }

    private void LateUpdate()
    {
        if (_isPlaying)
            ApplyMaterialProperties();
    }

    /// <summary>
    /// 通过材质属性块覆盖流速和颜色，保留项目现有管道流动着色器的批处理兼容性。
    /// _FlowDirectionOS 设为 X 正轴，体积网格 UV0 由编辑器生成并沿设备轴向递增。
    /// </summary>
    private void ApplyMaterialProperties()
    {
        _propertyBlock ??= new MaterialPropertyBlock();
        ApplyMaterialProperties(_blueVolumeRenderer, _blueFlowColor, _blueFlowSpeed);
        ApplyMaterialProperties(_redVolumeRenderer, _redFlowColor, _redFlowSpeed);
        ApplyMaterialProperties(_orangeVolumeRenderer, _orangeFlowColor, _orangeFlowSpeed);
    }

    private void ApplyMaterialProperties(Renderer renderer, Color color, float speed)
    {
        if (renderer == null)
            return;

        _propertyBlock.Clear();
        renderer.GetPropertyBlock(_propertyBlock);
        _propertyBlock.SetColor(FlowColorPropertyId, color);
        _propertyBlock.SetFloat(FlowSpeedPropertyId, _isPlaying ? speed : 0f);
        _propertyBlock.SetFloat(FlowIntensityPropertyId, _flowIntensity);
        _propertyBlock.SetVector(FlowDirectionPropertyId, new Vector4(1f, 0f, 0f, 0f));
        renderer.SetPropertyBlock(_propertyBlock);
    }

    /// <summary>
    /// 让体积与粒子叠加层共享播放状态；停止时清除粒子，避免重新播放时残留旧粒子。
    /// </summary>
    private void SetParticlePlayback(bool play)
    {
        SetParticlePlayback(_blueParticleOverlay, play);
        SetParticlePlayback(_redParticleOverlay, play);
    }

    private static void SetParticlePlayback(ParticleSystem particleSystem, bool play)
    {
        if (particleSystem == null)
            return;

        if (play)
            particleSystem.Play(true);
        else
            particleSystem.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
    }
}

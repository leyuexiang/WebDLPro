using System;
using UnityEngine;

/// <summary>
/// WaiKeHeBing 外部气流特效的运行时控制器。
/// 通过预先配置的粒子系统控制蓝色进气云和红色排气火焰，
/// 不依赖高级视觉特效管线，兼容 WebGL，并避免运行时重复创建粒子对象。
/// </summary>
[DisallowMultipleComponent]
public sealed class WaiKeHeBingGasFlowEffectController : MonoBehaviour
{
    [Header("外部气流")]
    [Tooltip("模型前端的蓝色进气粒子系统。")]
    [SerializeField] private ParticleSystem _blueIntakeCloud;
    [Tooltip("模型后端的红色排气粒子系统。")]
    [SerializeField] private ParticleSystem _redExhaustFlame;
    [Tooltip("启用组件时是否自动播放气流。")]
    [SerializeField] private bool _playOnEnable = true;

    [Header("内部气流")]
    [Tooltip("模型内部蓝色进气粒子系统，可选；留空时仅播放外部进气云。")]
    [SerializeField] private ParticleSystem _blueInternalFlow;
    [Tooltip("模型内部红色排气粒子系统，可选；留空时仅播放外部排气火焰。")]
    [SerializeField] private ParticleSystem _redInternalFlow;
    [Tooltip("燃烧段橘黄色火焰粒子系统，可选；用于表现燃烧室内部火焰。")]
    [SerializeField] private ParticleSystem _orangeCombustionFlame;
    [Tooltip("Tong 内部每个小筒对应的橘色火焰喷射粒子系统。")]
    [SerializeField] private ParticleSystem[] _tongFlameJets = Array.Empty<ParticleSystem>();
    [Tooltip("单个小筒在强度为 1 时的火焰发射率。")]
    [SerializeField, Min(0f)] private float _tongFlameEmissionRate = 12f;

    [Header("内部截面约束")]
    [Tooltip("蓝色内部气流使用的粒子系统；粒子中心会被限制在椭圆截面内。")]
    [SerializeField] private ParticleSystem _blueInternalFlowConstraint;
    [Tooltip("红色内部气流使用的粒子系统；粒子中心会被限制在椭圆截面内。")]
    [SerializeField] private ParticleSystem _redInternalFlowConstraint;
    [Tooltip("蓝色气流截面中心，相对于蓝色粒子系统的局部 X/Y 坐标。")]
    [SerializeField] private Vector2 _blueSectionCenter = Vector2.zero;
    [Tooltip("红色气流截面中心，相对于红色粒子系统的局部 X/Y 坐标。")]
    [SerializeField] private Vector2 _redSectionCenter = Vector2.zero;
    [Tooltip("蓝色气流椭圆截面的起始 X/Y 半径。")]
    [SerializeField] private Vector2 _blueSectionRadius = new Vector2(0.52f, 0.52f);
    [Tooltip("蓝色气流椭圆截面的末端 X/Y 半径，用于适配设备沿轴向的截面变化。")]
    [SerializeField] private Vector2 _blueSectionEndRadius = new Vector2(0.46f, 0.46f);
    [Tooltip("红色气流椭圆截面的起始 X/Y 半径。")]
    [SerializeField] private Vector2 _redSectionRadius = new Vector2(0.52f, 0.52f);
    [Tooltip("红色气流椭圆截面的末端 X/Y 半径，用于适配设备沿轴向的截面变化。")]
    [SerializeField] private Vector2 _redSectionEndRadius = new Vector2(0.42f, 0.42f);
    [Tooltip("蓝色内部气流的局部轴向长度，粒子沿负 Z 方向移动时用它计算截面变化。")]
    [SerializeField, Min(0.1f)] private float _blueSectionLength = 3.2f;
    [Tooltip("红色内部气流的局部轴向长度，粒子沿负 Z 方向移动时用它计算截面变化。")]
    [SerializeField, Min(0.1f)] private float _redSectionLength = 2.4f;
    [Tooltip("粒子中心距离外壳的安全边距，用于避免粒子公告板视觉穿出外壳。")]
    [SerializeField, Range(0f, 0.2f)] private float _sectionPadding = 0.08f;

    private bool _isPlaying;
    private bool _playbackAllowed = true;
    private ParticleSystem.Particle[] _particleBuffer;

    /// <summary>
    /// 编辑器配置工具使用的绑定入口；粒子引用保存到预制体后，运行时不进行层级搜索。
    /// </summary>
    public void Configure(
        ParticleSystem blueIntakeCloud,
        ParticleSystem redExhaustFlame,
        ParticleSystem blueInternalFlow,
        ParticleSystem redInternalFlow,
        ParticleSystem orangeCombustionFlame,
        ParticleSystem[] tongFlameJets)
    {
        _blueIntakeCloud = blueIntakeCloud;
        _redExhaustFlame = redExhaustFlame;
        _blueInternalFlow = blueInternalFlow;
        _redInternalFlow = redInternalFlow;
        _orangeCombustionFlame = orangeCombustionFlame;
        _tongFlameJets = tongFlameJets ?? Array.Empty<ParticleSystem>();
    }

    /// <summary>
    /// 保留现有五参数配置入口，已有场景工具只需继续配置公共气流对象；
    /// Tong 火焰由单独入口绑定，避免破坏已有调用方。
    /// </summary>
    public void Configure(
        ParticleSystem blueIntakeCloud,
        ParticleSystem redExhaustFlame,
        ParticleSystem blueInternalFlow,
        ParticleSystem redInternalFlow,
        ParticleSystem orangeCombustionFlame)
    {
        _blueIntakeCloud = blueIntakeCloud;
        _redExhaustFlame = redExhaustFlame;
        _blueInternalFlow = blueInternalFlow;
        _redInternalFlow = redInternalFlow;
        _orangeCombustionFlame = orangeCombustionFlame;
    }

    /// <summary>
    /// 单独配置 Tong 下的多组火焰喷射，运行时数组引用固定，不再进行层级搜索。
    /// </summary>
    public void ConfigureTongFlameJets(ParticleSystem[] tongFlameJets)
    {
        _tongFlameJets = tongFlameJets ?? Array.Empty<ParticleSystem>();
        SetParticlePlayback(_tongFlameJets, _isPlaying);
    }

    /// <summary>
    /// 播放外部和内部气流特效。
    /// </summary>
    public void Play()
    {
        if (!_playbackAllowed)
        {
            Stop();
            return;
        }

        _isPlaying = true;
        SetParticlePlayback(true);
    }

    /// <summary>
    /// 停止外部和内部气流特效，并清除当前粒子。
    /// </summary>
    public void Stop()
    {
        _isPlaying = false;
        SetParticlePlayback(false);
    }

    /// <summary>
    /// 设置是否允许按序列化自动播放基线运行。隐藏实例可先写入该许可，激活时不会产生一帧粒子闪现；
    /// 故障解除后仅恢复原本配置为自动播放的粒子系统，重复调用保持幂等。
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
            }
            return;
        }

        if (_playOnEnable && allowed)
        {
            Play();
        }
        else
        {
            Stop();
        }
    }

    /// <summary>
    /// 设置气流整体强度；粒子数量和亮度通过已配置的粒子系统模块控制。
    /// </summary>
    public void SetIntensity(float intensity)
    {
        var clampedIntensity = Mathf.Clamp01(intensity);
        SetEmissionRate(_blueIntakeCloud, clampedIntensity);
        SetEmissionRate(_redExhaustFlame, clampedIntensity);
        SetEmissionRate(_blueInternalFlow, clampedIntensity);
        SetEmissionRate(_redInternalFlow, clampedIntensity);
        SetEmissionRate(_orangeCombustionFlame, clampedIntensity);
        SetEmissionRate(_tongFlameJets, clampedIntensity * _tongFlameEmissionRate);
    }

    private void OnEnable()
    {
        _isPlaying = _playOnEnable && _playbackAllowed;
        SetParticlePlayback(_isPlaying);
    }

    private void SetParticlePlayback(bool play)
    {
        SetParticlePlayback(_blueIntakeCloud, play);
        SetParticlePlayback(_redExhaustFlame, play);
        SetParticlePlayback(_blueInternalFlow, play);
        SetParticlePlayback(_redInternalFlow, play);
        SetParticlePlayback(_orangeCombustionFlame, play);
        SetParticlePlayback(_tongFlameJets, play);
    }

    private void LateUpdate()
    {
        if (!_isPlaying)
            return;

        ConstrainCrossSection(
            _blueInternalFlowConstraint,
            _blueSectionCenter,
            _blueSectionRadius,
            _blueSectionEndRadius,
            _blueSectionLength);
        ConstrainCrossSection(
            _redInternalFlowConstraint,
            _redSectionCenter,
            _redSectionRadius,
            _redSectionEndRadius,
            _redSectionLength);
    }

    /// <summary>
    /// 在粒子系统完成本帧模拟后限制粒子截面。
    /// 粒子从局部 Z=0 出发沿负 Z 轴流动，截面半径根据轴向位置在起始半径和末端半径之间插值；
    /// 这样既能覆盖整个横截面，又不会把统一的大半径带入较窄的设备段。
    /// 粒子数组缓存复用，避免每帧产生垃圾回收分配，适合 WebGL。
    /// </summary>
    private void ConstrainCrossSection(
        ParticleSystem particleSystem,
        Vector2 sectionCenter,
        Vector2 startRadius,
        Vector2 endRadius,
        float sectionLength)
    {
        if (particleSystem == null)
            return;

        var particleCount = particleSystem.particleCount;
        if (particleCount == 0)
            return;

        if (_particleBuffer == null || _particleBuffer.Length < particleCount)
            _particleBuffer = new ParticleSystem.Particle[Mathf.NextPowerOfTwo(particleCount)];

        particleSystem.GetParticles(_particleBuffer, particleCount);
        var safePadding = Mathf.Max(0f, _sectionPadding);
        var safeLength = Mathf.Max(0.1f, sectionLength);
        for (var i = 0; i < particleCount; i++)
        {
            var particle = _particleBuffer[i];
            var position = particle.position;
            var flowProgress = Mathf.Clamp01(-position.z / safeLength);
            var sectionRadius = Vector2.Lerp(startRadius, endRadius, flowProgress);
            var particleRadius = particle.startSize * 0.5f + safePadding;
            var safeRadiusX = Mathf.Max(0.01f, sectionRadius.x - particleRadius);
            var safeRadiusY = Mathf.Max(0.01f, sectionRadius.y - particleRadius);
            var normalizedX = (position.x - sectionCenter.x) / safeRadiusX;
            var normalizedY = (position.y - sectionCenter.y) / safeRadiusY;
            var ellipseDistance = normalizedX * normalizedX + normalizedY * normalizedY;
            if (ellipseDistance <= 1f)
                continue;

            var scale = 1f / Mathf.Sqrt(ellipseDistance);
            position.x = sectionCenter.x + normalizedX * scale * safeRadiusX;
            position.y = sectionCenter.y + normalizedY * scale * safeRadiusY;
            particle.position = position;
            particle.velocity = new Vector3(0f, 0f, particle.velocity.z);
            _particleBuffer[i] = particle;
        }
        particleSystem.SetParticles(_particleBuffer, particleCount);
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

    private static void SetParticlePlayback(ParticleSystem[] particleSystems, bool play)
    {
        if (particleSystems == null)
            return;

        for (var i = 0; i < particleSystems.Length; i++)
            SetParticlePlayback(particleSystems[i], play);
    }

    private static void SetEmissionRate(ParticleSystem particleSystem, float intensity)
    {
        if (particleSystem == null)
            return;

        var emission = particleSystem.emission;
        var rate = emission.rateOverTime;
        rate.constant = intensity;
        emission.rateOverTime = rate;
    }

    private static void SetEmissionRate(ParticleSystem[] particleSystems, float emissionRate)
    {
        if (particleSystems == null)
            return;

        for (var i = 0; i < particleSystems.Length; i++)
            SetEmissionRate(particleSystems[i], emissionRate);
    }
}

using System;
using System.Collections;
using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// WaiKeHeBing 整体特效统一控制器。
/// 整合动画、气流粒子、体积流动和电线信号四个子系统，提供点击交互和逐步启动效果。
/// 点击控制柜后按顺序启动各子系统，再次点击则立即全部停止。
/// </summary>
[DisallowMultipleComponent]
public sealed class WaiKeHeBingMasterController : MonoBehaviour
{
    private static readonly int BaseColorPropertyId = Shader.PropertyToID("_BaseColor");
    private static readonly int FlowSpeedPropertyId = Shader.PropertyToID("_FlowSpeed");
    private static readonly int FlowColorPropertyId = Shader.PropertyToID("_FlowColor");
    private static readonly int FlowIntensityPropertyId = Shader.PropertyToID("_FlowIntensity");
    private static readonly int FlowDirectionPropertyId = Shader.PropertyToID("_FlowDirectionOS");

    [Header("点击交互")]
    [Tooltip("点击目标物体（控制柜）。必须有 Collider，用于射线检测。")]
    [SerializeField] private GameObject _clickTarget;
    [Tooltip("默认状态：false = 初始关闭，点击后逐步启动；true = 自动播放。")]
    [SerializeField] private bool _playOnEnable;

    [Header("动画旋转")]
    [SerializeField] private Transform[] _fanPivots = Array.Empty<Transform>();
    [SerializeField] private Transform[] _turbinePivots = Array.Empty<Transform>();
    [SerializeField, Min(0f)] private float _fanSpeedDegrees = 180f;
    [SerializeField, Min(0f)] private float _turbineSpeedDegrees = 360f;
    [SerializeField] private Renderer[] _rightShellRenderers = Array.Empty<Renderer>();
    [SerializeField, Range(0.05f, 0.95f)] private float _rightShellOpacity = 0.28f;

    [Header("气流粒子")]
    [SerializeField] private ParticleSystem _blueIntakeCloud;
    [SerializeField] private ParticleSystem _redExhaustFlame;
    [SerializeField] private ParticleSystem _blueInternalFlow;
    [SerializeField] private ParticleSystem _redInternalFlow;
    [SerializeField] private ParticleSystem _orangeCombustionFlame;
    [SerializeField] private ParticleSystem[] _tongFlameJets = Array.Empty<ParticleSystem>();
    [SerializeField, Min(0f)] private float _tongFlameEmissionRate = 42f;

    [Header("内部截面约束")]
    [SerializeField] private ParticleSystem _blueInternalFlowConstraint;
    [SerializeField] private ParticleSystem _redInternalFlowConstraint;
    [SerializeField] private Vector2 _blueSectionCenter = Vector2.zero;
    [SerializeField] private Vector2 _redSectionCenter = Vector2.zero;
    [SerializeField] private Vector2 _blueSectionRadius = new Vector2(0.58f, 0.58f);
    [SerializeField] private Vector2 _blueSectionEndRadius = new Vector2(0.42f, 0.42f);
    [SerializeField] private Vector2 _redSectionRadius = new Vector2(0.48f, 0.48f);
    [SerializeField] private Vector2 _redSectionEndRadius = new Vector2(0.36f, 0.36f);
    [SerializeField, Min(0.1f)] private float _blueSectionLength = 3.6f;
    [SerializeField, Min(0.1f)] private float _redSectionLength = 2.4f;
    [SerializeField, Range(0f, 0.2f)] private float _sectionPadding = 0.09f;

    [Header("体积流动")]
    [SerializeField] private Renderer _blueVolumeRenderer;
    [SerializeField] private Renderer _redVolumeRenderer;
    [SerializeField] private Renderer _orangeVolumeRenderer;
    [SerializeField] private float _blueFlowSpeed = 1.45f;
    [SerializeField] private float _redFlowSpeed = 1.35f;
    [SerializeField] private float _orangeFlowSpeed = -0.95f;
    [SerializeField, Range(0f, 8f)] private float _flowIntensity = 2.6f;
    [SerializeField, ColorUsage(true, true)] private Color _blueFlowColor = new Color(0.02f, 0.35f, 1f, 1f);
    [SerializeField, ColorUsage(true, true)] private Color _redFlowColor = new Color(1f, 0.03f, 0.01f, 1f);
    [SerializeField, ColorUsage(true, true)] private Color _orangeFlowColor = new Color(1.5f, 0.16f, 0.015f, 1f);
    [SerializeField] private ParticleSystem _blueParticleOverlay;
    [SerializeField] private ParticleSystem _redParticleOverlay;

    [Header("电线信号")]
    [SerializeField] private Renderer _wireRenderer;
    [SerializeField] private int _wireMaterialIndex;

    [Header("逐步启动时序")]
    [Tooltip("各子系统启动间隔（秒）。")]
    [SerializeField, Min(0.05f)] private float _startupStepDelay = 0.3f;

    private Camera _mainCamera;
    private MaterialPropertyBlock _rightShellPropertyBlock;
    private MaterialPropertyBlock _volumePropertyBlock;
    private MaterialPropertyBlock _wirePropertyBlock;
    private ParticleSystem.Particle[] _particleBuffer;
    private float _wireOriginalFlowSpeed;
    private bool _isPlaying;
    private bool _isStartingUp;

    private void Awake()
    {
        _mainCamera = Camera.main;
        if (_mainCamera == null)
        {
            Debug.LogError("[WaiKeHeBingMasterController] 未找到主相机，无法处理点击。", this);
            enabled = false;
            return;
        }

        if (_clickTarget != null && _clickTarget.GetComponent<Collider>() == null)
        {
            Debug.LogWarning($"[WaiKeHeBingMasterController] 点击目标 {_clickTarget.name} 缺少 Collider，自动添加 MeshCollider。", this);
            MeshFilter meshFilter = _clickTarget.GetComponent<MeshFilter>();
            if (meshFilter != null && meshFilter.sharedMesh != null)
            {
                MeshCollider collider = _clickTarget.AddComponent<MeshCollider>();
                collider.sharedMesh = meshFilter.sharedMesh;
            }
            else
            {
                _clickTarget.AddComponent<BoxCollider>();
            }
        }

        _rightShellPropertyBlock = new MaterialPropertyBlock();
        _volumePropertyBlock = new MaterialPropertyBlock();
        _wirePropertyBlock = new MaterialPropertyBlock();

        if (_wireRenderer != null && _wireRenderer.sharedMaterials.Length > _wireMaterialIndex)
        {
            Material wireMaterial = _wireRenderer.sharedMaterials[_wireMaterialIndex];
            if (wireMaterial != null && wireMaterial.HasProperty(FlowSpeedPropertyId))
            {
                _wireOriginalFlowSpeed = wireMaterial.GetFloat(FlowSpeedPropertyId);
            }
        }

        ApplyRightShellOpacity();

        // 强制初始化为关闭状态，确保所有特效不可见
        if (!_playOnEnable)
        {
            StopAllSubsystems();
        }
    }

    private void OnEnable()
    {
        if (_playOnEnable)
        {
            SetPlaying(true);
        }
    }

    private void Update()
    {
        HandleClick();
        UpdateAnimation();
        UpdateInternalParticleConstraints();
    }

    private void HandleClick()
    {
        Mouse mouse = Mouse.current;
        if (_clickTarget == null || mouse == null || !mouse.leftButton.wasPressedThisFrame)
        {
            return;
        }

        Ray ray = _mainCamera.ScreenPointToRay(mouse.position.ReadValue());
        if (Physics.Raycast(ray, out RaycastHit hit) && hit.collider.gameObject == _clickTarget)
        {
            TogglePlayback();
        }
    }

    public void TogglePlayback()
    {
        SetPlaying(!_isPlaying);
    }

    public void SetPlaying(bool isPlaying)
    {
        if (_isPlaying == isPlaying)
        {
            return;
        }

        _isPlaying = isPlaying;

        if (isPlaying)
        {
            StartCoroutine(StartupSequence());
        }
        else
        {
            StopAllSubsystems();
        }
    }

    private IEnumerator StartupSequence()
    {
        if (_isStartingUp)
        {
            yield break;
        }

        _isStartingUp = true;

        // 1. 动画旋转
        yield return new WaitForSeconds(_startupStepDelay);

        // 2. 气流粒子
        SetParticlePlayback(true);
        yield return new WaitForSeconds(_startupStepDelay);

        // 3. 体积流动
        SetVolumeRendererEnabled(true);
        SetVolumeFlowSpeed(true);
        yield return new WaitForSeconds(_startupStepDelay);

        // 4. 电线信号
        SetWireFlowIntensity(2.8f);
        SetWireFlowSpeed(_wireOriginalFlowSpeed);

        _isStartingUp = false;
    }

    private void StopAllSubsystems()
    {
        StopAllCoroutines();
        _isStartingUp = false;
        SetParticlePlayback(false);
        SetVolumeRendererEnabled(false);
        SetWireFlowIntensity(0f);
    }

    private void UpdateAnimation()
    {
        if (!_isPlaying)
        {
            return;
        }

        float deltaAngleFan = _fanSpeedDegrees * Time.deltaTime;
        for (int index = 0; index < _fanPivots.Length; index++)
        {
            if (_fanPivots[index] != null)
            {
                _fanPivots[index].Rotate(Vector3.forward, deltaAngleFan, Space.Self);
            }
        }

        float deltaAngleTurbine = _turbineSpeedDegrees * Time.deltaTime;
        for (int index = 0; index < _turbinePivots.Length; index++)
        {
            if (_turbinePivots[index] != null)
            {
                _turbinePivots[index].Rotate(Vector3.forward, deltaAngleTurbine, Space.Self);
            }
        }
    }

    private void SetParticlePlayback(bool play)
    {
        if (_blueIntakeCloud != null) SetParticle(_blueIntakeCloud, play);
        if (_redExhaustFlame != null) SetParticle(_redExhaustFlame, play);
        if (_blueInternalFlow != null) SetParticle(_blueInternalFlow, play);
        if (_redInternalFlow != null) SetParticle(_redInternalFlow, play);
        if (_orangeCombustionFlame != null) SetParticle(_orangeCombustionFlame, play);
        if (_blueParticleOverlay != null) SetParticle(_blueParticleOverlay, play);
        if (_redParticleOverlay != null) SetParticle(_redParticleOverlay, play);

        for (int index = 0; index < _tongFlameJets.Length; index++)
        {
            if (_tongFlameJets[index] != null) SetParticle(_tongFlameJets[index], play);
        }
    }

    private static void SetParticle(ParticleSystem ps, bool play)
    {
        if (play)
        {
            if (!ps.isPlaying) ps.Play();
        }
        else
        {
            if (ps.isPlaying) ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
        }
    }

    private void UpdateInternalParticleConstraints()
    {
        if (_blueInternalFlowConstraint != null)
        {
            ConstrainParticles(_blueInternalFlowConstraint, _blueSectionCenter, _blueSectionRadius, _blueSectionEndRadius, _blueSectionLength);
        }

        if (_redInternalFlowConstraint != null)
        {
            ConstrainParticles(_redInternalFlowConstraint, _redSectionCenter, _redSectionRadius, _redSectionEndRadius, _redSectionLength);
        }
    }

    private void ConstrainParticles(ParticleSystem ps, Vector2 center, Vector2 startRadius, Vector2 endRadius, float length)
    {
        int count = ps.particleCount;
        if (count == 0) return;

        if (_particleBuffer == null || _particleBuffer.Length < count)
        {
            _particleBuffer = new ParticleSystem.Particle[count];
        }

        ps.GetParticles(_particleBuffer, count);

        for (int i = 0; i < count; i++)
        {
            Vector3 pos = _particleBuffer[i].position;
            float t = Mathf.Clamp01(-pos.z / length);
            Vector2 radius = Vector2.Lerp(startRadius, endRadius, t);
            radius -= Vector2.one * _sectionPadding;
            Vector2 offset = new Vector2(pos.x - center.x, pos.y - center.y);
            float distSq = (offset.x * offset.x) / (radius.x * radius.x) + (offset.y * offset.y) / (radius.y * radius.y);

            if (distSq > 1f)
            {
                Vector2 clamped = offset / Mathf.Sqrt(distSq);
                _particleBuffer[i].position = new Vector3(clamped.x * radius.x + center.x, clamped.y * radius.y + center.y, pos.z);
            }
        }

        ps.SetParticles(_particleBuffer, count);
    }

    private void SetVolumeRendererEnabled(bool enabled)
    {
        if (_blueVolumeRenderer != null)
        {
            _blueVolumeRenderer.enabled = enabled;
        }

        if (_redVolumeRenderer != null)
        {
            _redVolumeRenderer.enabled = enabled;
        }

        if (_orangeVolumeRenderer != null)
        {
            _orangeVolumeRenderer.enabled = enabled;
        }
    }

    private void SetVolumeFlowSpeed(bool play)
    {
        if (_blueVolumeRenderer != null)
        {
            ApplyVolumeProperties(_blueVolumeRenderer, play ? _blueFlowSpeed : 0f, _blueFlowColor);
        }

        if (_redVolumeRenderer != null)
        {
            ApplyVolumeProperties(_redVolumeRenderer, play ? _redFlowSpeed : 0f, _redFlowColor);
        }

        if (_orangeVolumeRenderer != null)
        {
            ApplyVolumeProperties(_orangeVolumeRenderer, play ? _orangeFlowSpeed : 0f, _orangeFlowColor);
        }
    }

    private void ApplyVolumeProperties(Renderer renderer, float speed, Color color)
    {
        _volumePropertyBlock.Clear();
        renderer.GetPropertyBlock(_volumePropertyBlock);
        _volumePropertyBlock.SetFloat(FlowSpeedPropertyId, speed);
        _volumePropertyBlock.SetColor(FlowColorPropertyId, color);
        _volumePropertyBlock.SetFloat(FlowIntensityPropertyId, _flowIntensity);
        renderer.SetPropertyBlock(_volumePropertyBlock);
    }

    private void SetWireFlowIntensity(float intensity)
    {
        if (_wireRenderer == null || _wireRenderer.sharedMaterials.Length <= _wireMaterialIndex)
        {
            return;
        }

        _wirePropertyBlock.Clear();
        _wireRenderer.GetPropertyBlock(_wirePropertyBlock, _wireMaterialIndex);
        _wirePropertyBlock.SetFloat(FlowIntensityPropertyId, intensity);
        _wireRenderer.SetPropertyBlock(_wirePropertyBlock, _wireMaterialIndex);
    }

    private void SetWireFlowSpeed(float speed)
    {
        if (_wireRenderer == null || _wireRenderer.sharedMaterials.Length <= _wireMaterialIndex)
        {
            return;
        }

        _wirePropertyBlock.Clear();
        _wireRenderer.GetPropertyBlock(_wirePropertyBlock, _wireMaterialIndex);
        _wirePropertyBlock.SetFloat(FlowSpeedPropertyId, speed);
        _wireRenderer.SetPropertyBlock(_wirePropertyBlock, _wireMaterialIndex);
    }

    private void ApplyRightShellOpacity()
    {
        for (int index = 0; index < _rightShellRenderers.Length; index++)
        {
            Renderer renderer = _rightShellRenderers[index];
            if (renderer == null)
            {
                continue;
            }

            _rightShellPropertyBlock.Clear();
            renderer.GetPropertyBlock(_rightShellPropertyBlock);
            Color baseColor = renderer.sharedMaterial != null && renderer.sharedMaterial.HasProperty(BaseColorPropertyId)
                ? renderer.sharedMaterial.GetColor(BaseColorPropertyId)
                : Color.white;
            baseColor.a = _rightShellOpacity;
            _rightShellPropertyBlock.SetColor(BaseColorPropertyId, baseColor);
            renderer.SetPropertyBlock(_rightShellPropertyBlock);
        }
    }
}

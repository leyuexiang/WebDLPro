using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// WaiKeHeBing 整体特效点击开关控制器。
/// 点击控制柜切换所有特效（动画、气流、体积流动、电线信号）的播放/停止状态。
/// </summary>
[DisallowMultipleComponent]
public sealed class WaiKeHeBingClickController : MonoBehaviour
{
    [Header("交互对象")]
    [Tooltip("点击目标物体（控制柜）。必须有 Collider，用于射线检测。")]
    [SerializeField] private GameObject _clickTarget;

    [Header("特效组件引用")]
    [Tooltip("动画控制器，控制风扇和涡轮旋转。")]
    [SerializeField] private WaiKeHeBingAnimationController _animationController;
    [Tooltip("气流特效控制器，控制粒子系统。")]
    [SerializeField] private WaiKeHeBingGasFlowEffectController _gasFlowController;
    [Tooltip("气体体积流动控制器，控制体积网格流动材质。")]
    [SerializeField] private WaiKeHeBingGasVolumeController _gasVolumeController;
    [Tooltip("电线信号流动的 Renderer，会通过 MaterialPropertyBlock 控制 _FlowSpeed。")]
    [SerializeField] private Renderer _wireRenderer;
    [Tooltip("电线 Renderer 的材质索引，用于指定操作哪个材质槽位。")]
    [SerializeField] private int _wireMaterialIndex;

    [Header("初始状态")]
    [Tooltip("启用组件时是否立即播放所有特效。")]
    [SerializeField] private bool _playOnEnable = true;

    private static readonly int FlowSpeedPropertyId = Shader.PropertyToID("_FlowSpeed");

    private Camera _mainCamera;
    private MaterialPropertyBlock _wirePropertyBlock;
    private float _wireOriginalFlowSpeed;
    private bool _isPlaying;

    private void Awake()
    {
        _mainCamera = Camera.main;
        if (_mainCamera == null)
        {
            Debug.LogError("[WaiKeHeBingClickController] 未找到主相机，无法处理点击。", this);
            enabled = false;
            return;
        }

        if (_clickTarget == null)
        {
            Debug.LogError("[WaiKeHeBingClickController] 未配置点击目标，无法响应交互。", this);
            enabled = false;
            return;
        }

        if (_clickTarget.GetComponent<Collider>() == null)
        {
            Debug.LogWarning($"[WaiKeHeBingClickController] 点击目标 {_clickTarget.name} 缺少 Collider，自动添加 MeshCollider。", this);
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

        _wirePropertyBlock = new MaterialPropertyBlock();
        if (_wireRenderer != null && _wireRenderer.sharedMaterials.Length > _wireMaterialIndex)
        {
            Material wireMaterial = _wireRenderer.sharedMaterials[_wireMaterialIndex];
            if (wireMaterial != null && wireMaterial.HasProperty(FlowSpeedPropertyId))
            {
                _wireOriginalFlowSpeed = wireMaterial.GetFloat(FlowSpeedPropertyId);
            }
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
        Mouse mouse = Mouse.current;
        if (mouse == null || !mouse.leftButton.wasPressedThisFrame)
        {
            return;
        }

        Ray ray = _mainCamera.ScreenPointToRay(mouse.position.ReadValue());
        if (Physics.Raycast(ray, out RaycastHit hit))
        {
            if (hit.collider.gameObject == _clickTarget)
            {
                TogglePlayback();
            }
        }
    }

    /// <summary>
    /// 切换所有特效的播放/停止状态。
    /// </summary>
    public void TogglePlayback()
    {
        SetPlaying(!_isPlaying);
    }

    /// <summary>
    /// 设置所有特效的播放状态。
    /// </summary>
    public void SetPlaying(bool isPlaying)
    {
        _isPlaying = isPlaying;

        if (_animationController != null)
        {
            _animationController.enabled = isPlaying;
            if (isPlaying)
            {
                _animationController.Play();
            }
        }

        if (_gasFlowController != null)
        {
            if (isPlaying)
            {
                _gasFlowController.Play();
            }
            else
            {
                _gasFlowController.Stop();
            }
        }

        if (_gasVolumeController != null)
        {
            _gasVolumeController.enabled = isPlaying;
            if (isPlaying)
            {
                _gasVolumeController.Play();
            }
        }

        SetWireFlowSpeed(isPlaying ? _wireOriginalFlowSpeed : 0f);
    }

    /// <summary>
    /// 通过 MaterialPropertyBlock 控制电线流动速度，不改变共享材质。
    /// </summary>
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
}

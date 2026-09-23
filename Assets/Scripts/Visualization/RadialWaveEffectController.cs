using System.Collections;
using UnityEngine;

/// <summary>
/// 径向扩散波纹特效控制器。
/// 从中心点生成并播放向外扩散的光圈波纹，支持自定义颜色、大小和持续时间。
/// </summary>
[DisallowMultipleComponent]
public sealed class RadialWaveEffectController : MonoBehaviour
{
    private static readonly int AlphaPropertyId = Shader.PropertyToID("_Alpha");

    [Header("扩散参数")]
    [Tooltip("波纹初始半径（米）。")]
    [SerializeField, Min(0.1f)] private float _startRadius = 0.5f;
    [Tooltip("波纹最终半径（米）。")]
    [SerializeField, Min(0.5f)] private float _endRadius = 10f;
    [Tooltip("扩散持续时间（秒）。")]
    [SerializeField, Min(0.2f)] private float _duration = 2f;
    [Tooltip("透明度衰减曲线，控制波纹从出现到消失的透明度变化。")]
    [SerializeField] private AnimationCurve _alphaCurve = AnimationCurve.EaseInOut(0f, 1f, 1f, 0f);

    [Header("视觉")]
    [Tooltip("波纹材质，必须使用 RadialWaveURP Shader。")]
    [SerializeField] private Material _waveMaterial;
    [Tooltip("波纹朝向。默认 Y 轴向上，适合地面扩散；可改为相机朝向实现公告板效果。")]
    [SerializeField] private Vector3 _waveNormal = Vector3.up;
    [Tooltip("启用后波纹始终面向主相机。")]
    [SerializeField] private bool _billboardToCamera;

    [Header("运行时")]
    [Tooltip("启用组件时是否自动播放一次。")]
    [SerializeField] private bool _playOnEnable = true;

    private Transform _waveTransform;
    private MeshRenderer _waveRenderer;
    private MaterialPropertyBlock _propertyBlock;
    private Coroutine _playCoroutine;

    /// <summary>
    /// 播放一次扩散波纹。
    /// </summary>
    public void Play()
    {
        if (_playCoroutine != null)
        {
            StopCoroutine(_playCoroutine);
        }

        _playCoroutine = StartCoroutine(PlaySequence());
    }

    /// <summary>
    /// 停止当前播放并隐藏波纹。
    /// </summary>
    public void Stop()
    {
        if (_playCoroutine != null)
        {
            StopCoroutine(_playCoroutine);
            _playCoroutine = null;
        }

        if (_waveRenderer != null)
        {
            _waveRenderer.enabled = false;
        }
    }

    private void Awake()
    {
        if (_waveMaterial == null)
        {
            Debug.LogError("[RadialWaveEffectController] 未配置波纹材质。", this);
            enabled = false;
            return;
        }

        _propertyBlock = new MaterialPropertyBlock();
        CreateWaveQuad();
    }

    private void OnEnable()
    {
        if (_playOnEnable)
        {
            Play();
        }
    }

    private void OnDisable()
    {
        Stop();
    }

    private void CreateWaveQuad()
    {
        // 创建子对象承载波纹网格
        GameObject waveObj = new GameObject("WaveQuad");
        waveObj.transform.SetParent(transform, false);
        _waveTransform = waveObj.transform;

        // 创建圆形 Quad 网格
        Mesh quadMesh = new Mesh { name = "RadialWaveQuad" };
        Vector3[] vertices = new Vector3[4]
        {
            new Vector3(-1, 0, -1),
            new Vector3( 1, 0, -1),
            new Vector3(-1, 0,  1),
            new Vector3( 1, 0,  1)
        };
        Vector2[] uvs = new Vector2[4]
        {
            new Vector2(0, 0),
            new Vector2(1, 0),
            new Vector2(0, 1),
            new Vector2(1, 1)
        };
        int[] triangles = new int[6] { 0, 2, 1, 2, 3, 1 };

        quadMesh.vertices = vertices;
        quadMesh.uv = uvs;
        quadMesh.triangles = triangles;
        quadMesh.RecalculateNormals();
        quadMesh.RecalculateBounds();

        // 添加渲染组件
        MeshFilter mf = waveObj.AddComponent<MeshFilter>();
        mf.sharedMesh = quadMesh;

        _waveRenderer = waveObj.AddComponent<MeshRenderer>();
        _waveRenderer.sharedMaterial = _waveMaterial;
        _waveRenderer.enabled = false;

        // 设置初始朝向
        if (!_billboardToCamera)
        {
            _waveTransform.rotation = Quaternion.FromToRotation(Vector3.up, _waveNormal.normalized);
        }
    }

    private IEnumerator PlaySequence()
    {
        if (_waveRenderer == null)
        {
            yield break;
        }

        _waveRenderer.enabled = true;

        float elapsed = 0f;
        while (elapsed < _duration)
        {
            float t = elapsed / _duration;

            // 缩放控制半径
            float radius = Mathf.Lerp(_startRadius, _endRadius, t);
            _waveTransform.localScale = Vector3.one * radius;

            // 透明度衰减
            float alpha = _alphaCurve.Evaluate(t);
            _propertyBlock.Clear();
            _waveRenderer.GetPropertyBlock(_propertyBlock);
            _propertyBlock.SetFloat(AlphaPropertyId, alpha);
            _waveRenderer.SetPropertyBlock(_propertyBlock);

            // Billboard 朝向相机
            if (_billboardToCamera && Camera.main != null)
            {
                _waveTransform.rotation = Quaternion.LookRotation(
                    Camera.main.transform.position - _waveTransform.position,
                    Camera.main.transform.up);
            }

            elapsed += Time.deltaTime;
            yield return null;
        }

        _waveRenderer.enabled = false;
        _playCoroutine = null;
    }
}

using UnityEngine;

/// <summary>沿局部中心线输送蒸汽粒子；确定性预填充使编辑预览和运行时方向一致。</summary>
[ExecuteAlways, DisallowMultipleComponent, RequireComponent(typeof(ParticleSystem))]
public sealed class PipeSteamParticleFlow : MonoBehaviour
{
    [SerializeField, Tooltip("粒子对象局部空间，顺序为入口到设备端。")]
    private Vector3[] _path = new Vector3[0];
    [SerializeField, Min(0.05f)] private float _speed = 1.8f;
    [SerializeField, Range(16, 512)] private int _particleCount = 180;
    [SerializeField, Range(0f, 0.3f)] private float _spread = 0.16f;
    [SerializeField, Range(0.05f, 0.6f)] private float _size = 0.32f;
    [SerializeField] private Color _color = new Color(0.68f, 0.9f, 1f, 0.7f);
    [SerializeField] private bool _previewInEditor = true;
    [SerializeField] private bool _effectEnabled = true;
    [SerializeField] private bool _volumeMode;
    [SerializeField] private Vector3 _volumeCenter;
    [SerializeField] private Vector3 _volumeRadii = new Vector3(0.7f, 0.7f, 0.65f);
    private float _intensity = 1f;

    public void SetEffectEnabled(bool value) { _effectEnabled = value; if (!value && _system) _system.Clear(); }
    public void SetIntensity(float value) { _intensity = Mathf.Clamp01(value); }


    private ParticleSystem _system;
    private ParticleSystem.Particle[] _particles;
    private float[] _distances;
    private float _length;
    private double _travel;
    private double _previousTime;

    private void OnEnable()
    {
        _system = GetComponent<ParticleSystem>();
        RebuildPath();
        _previousTime = Time.realtimeSinceStartupAsDouble;
#if UNITY_EDITOR
        UnityEditor.EditorApplication.update += EditorTick;
#endif
        RenderParticles();
    }

    private void OnDisable()
    {
#if UNITY_EDITOR
        UnityEditor.EditorApplication.update -= EditorTick;
#endif
        if (_system != null) _system.Clear();
    }

    private void OnValidate()
    {
        _particleCount = Mathf.Clamp(_particleCount, 16, 512);
        _speed = Mathf.Max(0.05f, _speed);
        RebuildPath();
    }

    private void RebuildPath()
    {
        _length = 0f;
        if (_path == null || _path.Length < 2) return;
        _distances = new float[_path.Length];
        for (int i = 1; i < _path.Length; i++)
        {
            _length += Vector3.Distance(_path[i - 1], _path[i]);
            _distances[i] = _length;
        }
    }

    private void LateUpdate()
    {
        if (!Application.isPlaying) return;
        _travel += Time.deltaTime * _speed;
        RenderParticles();
    }

#if UNITY_EDITOR
    private void EditorTick()
    {
        if (Application.isPlaying || !_previewInEditor || this == null) return;
        double now = Time.realtimeSinceStartupAsDouble;
        double delta = now - _previousTime;
        if (delta < 1.0 / 30.0) return;
        _previousTime = now;
        _travel += System.Math.Min(delta, 0.1) * _speed;
        RenderParticles();
        UnityEditor.SceneView.RepaintAll();
    }
#endif

    private Vector3 Sample(float distance, out Vector3 tangent)
    {
        int segment = 1;
        while (segment < _path.Length - 1 && distance > _distances[segment]) segment++;
        tangent = (_path[segment] - _path[segment - 1]).normalized;
        float t = Mathf.InverseLerp(_distances[segment - 1], _distances[segment], distance);
        return Vector3.Lerp(_path[segment - 1], _path[segment], t);
    }

    private void RenderParticles()
    {
        if (_system == null) return;
        if (!_effectEnabled || _intensity <= 0f || (!_volumeMode && _length < 0.01f)) { _system.Clear(); return; }
        if (_particles == null || _particles.Length != _particleCount)
            _particles = new ParticleSystem.Particle[_particleCount];
        // 手动控制位置与生命周期；不让 Unity 自由积分把粒子带出弯管。
        if (!_system.isPaused) _system.Pause(false);
        float cycleLength = _volumeMode ? 8f : _length;
        float phase = (float)(_travel % cycleLength) / cycleLength;
        for (int i = 0; i < _particles.Length; i++)
        {
            float seed = i * 2.399963f;
            float initial = (i + 0.5f) / _particles.Length;
            // 成组烟团之间留出间隔，比均匀填满管腔更容易辨认推进方向。
            initial += 0.044f * Mathf.Sin(initial * Mathf.PI * 6f);
            float age = Mathf.Repeat(initial + phase, 1f);
            Vector3 tangent = Vector3.forward;
            Vector3 position = _volumeMode ? _volumeCenter : Sample(age * _length, out tangent);
            Vector3 side = Vector3.Cross(tangent, Vector3.right).normalized;
            Vector3 up = Vector3.Cross(side, tangent).normalized;
            float twist = seed + age * 2.5f;
            float radius = _spread * (0.3f + 0.7f * Mathf.Abs(Mathf.Sin(seed * 1.7f)));
            position += (side * Mathf.Cos(twist) + up * Mathf.Sin(twist)) * radius;
            if (_volumeMode)
            {
                float h = 1f - 2f * initial;
                float ring = Mathf.Sqrt(Mathf.Max(0f, 1f - h * h));
                float angle = seed + (float)(_travel % 20) * 0.45f;
                float radial = 0.5f + 0.5f * Mathf.Abs(Mathf.Sin(seed * 1.31f));
                position = _volumeCenter + Vector3.Scale(new Vector3(ring * Mathf.Cos(angle), ring * Mathf.Sin(angle), h) * radial, _volumeRadii);
            }
            Color color = _color;
            color.a *= _intensity;
            color.a *= Mathf.SmoothStep(0f, 1f, age / 0.07f)
                * Mathf.SmoothStep(0f, 1f, (1f - age) / 0.09f);
            _particles[i].position = position;
            _particles[i].velocity = tangent * _speed;
            _particles[i].startColor = color;
            _particles[i].startSize = _size * (0.65f + 0.35f * Mathf.Abs(Mathf.Sin(seed)))
                * (0.85f + 0.2f * Mathf.Sin(age * Mathf.PI));
            _particles[i].rotation = seed * Mathf.Rad2Deg;
            _particles[i].startLifetime = 10f;
            _particles[i].remainingLifetime = 10f;
            _particles[i].randomSeed = (uint)(i + 1);
        }
        _system.SetParticles(_particles, _particles.Length);
    }
}

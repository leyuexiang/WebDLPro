using System;
using UnityEngine;

/// <summary>
/// 风机齿轮与叶片的运行时旋转控制。
/// 旋转轴使用每个模型节点的局部坐标，避免依赖风机根节点的安装姿态。
/// 默认配置对应参考图：叶片顺时针、七个齿轮逆时针、主轴关联齿轮顺时针。
/// </summary>
[DisallowMultipleComponent]
public sealed class WindTurbineRotationController : MonoBehaviour
{
    [Serializable]
    public sealed class RotationTarget
    {
        [Tooltip("便于在检视面板识别该旋转部件。")]
        public string label;
        [Tooltip("需要旋转的模型节点。")]
        public Transform target;
        [Tooltip("旋转轴，使用目标节点的局部坐标。风机齿轮和叶片通常为 Y 轴。")]
        public Vector3 localAxis = Vector3.up;
        [Tooltip("带方向的角速度，单位为度/秒。正负号决定旋转方向。")]
        public float speedDegreesPerSecond;
        [Tooltip("本地旋转中心；零值保持绕节点原点旋转。用于导出原点偏离齿轮中心的模型。")]
        public Vector3 localPivot;
    }

    [Header("运行控制")]
    [SerializeField] private bool _playOnEnable = true;
    [SerializeField] private bool _useUnscaledTime;

    [Header("叶片：顺时针")]
    [SerializeField] private RotationTarget _blade;

    [Header("七个齿轮：逆时针")]
    [SerializeField] private RotationTarget[] _counterClockwiseGears = Array.Empty<RotationTarget>();

    [Header("主轴关联齿轮：顺时针")]
    [SerializeField] private RotationTarget[] _mainShaftGears = Array.Empty<RotationTarget>();

    private bool _isPlaying;

    public bool IsPlaying => _isPlaying;

    private void OnEnable()
    {
        _isPlaying = _playOnEnable;
    }

    private void OnDisable()
    {
    }

    private void OnDestroy()
    {
    }

    private void Update()
    {
        if (!_isPlaying)
        {
            return;
        }

        float deltaTime = _useUnscaledTime ? Time.unscaledDeltaTime : Time.deltaTime;
        RotateTarget(_blade, deltaTime);
        RotateTargets(_counterClockwiseGears, deltaTime);
        RotateTargets(_mainShaftGears, deltaTime);
    }

    public void Play()
    {
        _isPlaying = true;
    }

    public void Pause()
    {
        _isPlaying = false;
    }

    public void SetPlaying(bool playing)
    {
        _isPlaying = playing;
    }

    /// <summary>
    /// 编辑器配置入口。运行时只读取已绑定的目标，不按名称搜索层级。
    /// </summary>
    public void Configure(
        RotationTarget blade,
        RotationTarget[] counterClockwiseGears,
        RotationTarget[] mainShaftGears)
    {
        _blade = blade;
        _counterClockwiseGears = counterClockwiseGears ?? Array.Empty<RotationTarget>();
        _mainShaftGears = mainShaftGears ?? Array.Empty<RotationTarget>();
    }

    private void RotateTargets(RotationTarget[] targets, float deltaTime)
    {
        if (targets == null)
        {
            return;
        }

        for (int index = 0; index < targets.Length; index++)
        {
            RotateTarget(targets[index], deltaTime);
        }
    }

    private void RotateTarget(RotationTarget rotationTarget, float deltaTime)
    {
        if (rotationTarget == null || rotationTarget.target == null ||
            rotationTarget.localAxis.sqrMagnitude < 0.0001f ||
            Mathf.Approximately(rotationTarget.speedDegreesPerSecond, 0f))
        {
            return;
        }

        float angle = rotationTarget.speedDegreesPerSecond * deltaTime;
        rotationTarget.target.Rotate(rotationTarget.localAxis.normalized, angle, Space.Self);
    }
}

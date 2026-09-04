using System.Collections;
using UnityEngine;

/// <summary>
/// 循环播放径向扩散波纹特效。
/// 按指定间隔重复触发波纹扩散动画。
/// </summary>
[RequireComponent(typeof(RadialWaveEffectController))]
[DisallowMultipleComponent]
public sealed class RadialWaveLooper : MonoBehaviour
{
    [Tooltip("循环间隔时间（秒）。")]
    [SerializeField, Min(0.5f)] private float _loopInterval = 3f;
    [Tooltip("启用组件时是否自动开始循环。")]
    [SerializeField] private bool _playOnEnable = true;

    private RadialWaveEffectController _waveController;
    private Coroutine _loopCoroutine;

    /// <summary>
    /// 开始循环播放。
    /// </summary>
    public void StartLoop()
    {
        if (_loopCoroutine != null)
        {
            StopCoroutine(_loopCoroutine);
        }

        _loopCoroutine = StartCoroutine(LoopSequence());
    }

    /// <summary>
    /// 停止循环播放。
    /// </summary>
    public void StopLoop()
    {
        if (_loopCoroutine != null)
        {
            StopCoroutine(_loopCoroutine);
            _loopCoroutine = null;
        }

        if (_waveController != null)
        {
            _waveController.Stop();
        }
    }

    private void Awake()
    {
        _waveController = GetComponent<RadialWaveEffectController>();
        if (_waveController == null)
        {
            Debug.LogError("[RadialWaveLooper] 未找到 RadialWaveEffectController 组件。", this);
            enabled = false;
        }
    }

    private void OnEnable()
    {
        if (_playOnEnable)
        {
            StartLoop();
        }
    }

    private void OnDisable()
    {
        StopLoop();
    }

    private IEnumerator LoopSequence()
    {
        while (true)
        {
            if (_waveController != null)
            {
                _waveController.Play();
            }

            yield return new WaitForSeconds(_loopInterval);
        }
    }
}

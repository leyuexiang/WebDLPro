using UnityEngine;

/// <summary>汽轮机特效开关及阀芯先开启、气体后充盈的联动控制。</summary>
[ExecuteAlways, DisallowMultipleComponent]
public sealed class CoalPowerSteamEffectsController : MonoBehaviour
{
    [Header("特效开关")]
    [SerializeField] private bool _allEffectsEnabled = true;
    [SerializeField] private bool _intakeEnabled = true;
    [SerializeField] private bool _valveEnabled = true;
    [SerializeField] private bool _outletEnabled = true;
    [SerializeField] private bool _shaftEnergyEnabled = true;
    [SerializeField] private bool _controlWireEnabled = true;
    [Header("阀芯开启（播放模式）")]
    [SerializeField] private Transform _valveCore;
    [SerializeField] private Vector3 _closedCoreLocalPosition;
    [SerializeField, Min(0f)] private float _coreOpenDelay = 1.5f;
    [SerializeField, Min(0.01f)] private float _coreLiftDistance = 0.45f;
    [SerializeField, Min(0.1f)] private float _coreOpenDuration = 2.4f;
    private float _openDelayElapsed;
    private float _openAmount;
    [Header("气体充盈")]
    [SerializeField, Min(0.1f)] private float _fillDuration = 2f;
    [Header("显式绑定")]
    [SerializeField] private PipeSteamParticleFlow _intake;
    [SerializeField] private PipeSteamParticleFlow _valveFill;
    [SerializeField] private PipeSteamParticleFlow _valveThrough;
    [SerializeField] private PipeSteamParticleFlow _outlet;
    [SerializeField] private CoalPowerShaftEnergyEffect _shaftEnergy;
    [SerializeField] private ControlCircuitElectronFlowEffect _controlWire;
    private float _fill;
    private double _previousTime;

    private bool _faultStop;
    public float FillAmount => _fill;
    public float OpenAmount => _openAmount;
    public bool EffectsRunning => _allEffectsEnabled;

    /// <summary>运行时总控。开启会从进气、开阀、充盈到出气重新播放；关闭会清除全部特效并复位阀芯。</summary>
    public void SetEffectsRunning(bool value)
    {
        _faultStop = false;
        SetRunning(value);
    }

    /// <summary>Fault stops valve/outlet effects but preserves intake, wiring and speed-synchronised shaft energy.</summary>
    public void SetFaultStopped()
    {
        _faultStop = true;
        SetRunning(false);
    }

    private void SetRunning(bool value)
    {
        if (_allEffectsEnabled == value)
        {
            if (value) RestartFilling();
            else Apply(0f);
            return;
        }
        _allEffectsEnabled = value;
        if (value) RestartFilling();
        else
        {
            _openDelayElapsed = 0f;
            _openAmount = 0f;
            _fill = 0f;
            ResetValveCore();
            Apply(0f);
        }
    }

    public void PlayAllEffects() => SetEffectsRunning(true);
    public void StopAllEffects() => SetEffectsRunning(false);
    public void ToggleAllEffects() => SetEffectsRunning(!_allEffectsEnabled);
    public void SetAllEffectsEnabled(bool value) => SetEffectsRunning(value);
    public void SetIntakeEnabled(bool value) { _intakeEnabled = value; Apply(0f); }
    public void SetValveEnabled(bool value) { _valveEnabled = value; Apply(0f); }
    public void SetOutletEnabled(bool value) { _outletEnabled = value; Apply(0f); }
    public void SetShaftEnergyEnabled(bool value) { _shaftEnergyEnabled = value; Apply(0f); }
    public void SetControlWireEnabled(bool value) { _controlWireEnabled = value; Apply(0f); }
    [ContextMenu("重播开阀过程")]
    public void RestartFilling() { _fill = 0f; _openAmount = 0f; _openDelayElapsed = 0f; Apply(0f); }

    private void OnEnable()
    {
        _fill = 0f;
        _openAmount = 0f;
        _openDelayElapsed = 0f;
        _previousTime = Time.realtimeSinceStartupAsDouble;
#if UNITY_EDITOR
        UnityEditor.EditorApplication.update += EditorTick;
#endif
        Apply(0f);
    }

    private void OnDisable()
    {
#if UNITY_EDITOR
        UnityEditor.EditorApplication.update -= EditorTick;
#endif
        ResetValveCore();
        _openAmount = 0f;
        _openDelayElapsed = 0f;
        _fill = 0f;
        SetFlow(_intake, false, 0f);
        SetFlow(_valveFill, false, 0f);
        SetFlow(_valveThrough, false, 0f);
        SetFlow(_outlet, false, 0f);
        if (_controlWire != null) _controlWire.enabled = false;
        if (_shaftEnergy != null) _shaftEnergy.enabled = false;
    }

    private void Update()
    {
        if (Application.isPlaying) Apply(Time.deltaTime);
    }

#if UNITY_EDITOR
    private void EditorTick()
    {
        if (this == null || Application.isPlaying) return;
        double now = Time.realtimeSinceStartupAsDouble;
        float delta = (float)(now - _previousTime);
        if (delta < 1f / 30f) return;
        _previousTime = now;
        Apply(Mathf.Min(delta, 0.1f));
    }
#endif

    private void Apply(float delta)
    {
        bool active = isActiveAndEnabled && _allEffectsEnabled;
        bool valve = active && _valveEnabled;
        // 编辑模式保持配置的关闭姿态，避免保存时把动画抬升写成模型初始位置。
        bool opening = valve && Application.isPlaying && _valveCore != null;
        if (opening)
            _openDelayElapsed = Mathf.Min(_coreOpenDelay, _openDelayElapsed + delta);
        else
            _openDelayElapsed = 0f;
        bool liftAllowed = opening && _openDelayElapsed >= _coreOpenDelay;
        bool wasOpen = _openAmount >= 1f;
        _openAmount = liftAllowed
            ? Mathf.MoveTowards(_openAmount, 1f, delta / Mathf.Max(0.1f, _coreOpenDuration))
            : 0f;
        if (Application.isPlaying && _valveCore != null)
        {
            Transform parent = _valveCore.parent;
            Vector3 worldOffset = Vector3.up * (_coreLiftDistance * Mathf.SmoothStep(0f, 1f, _openAmount));
            _valveCore.localPosition = _closedCoreLocalPosition
                + (parent != null ? parent.InverseTransformVector(worldOffset) : worldOffset);
        }
        bool gasAllowed = liftAllowed && _openAmount >= 1f;
        _fill = gasAllowed && wasOpen
            ? Mathf.MoveTowards(_fill, 1f, delta / Mathf.Max(0.1f, _fillDuration)) : 0f;
        bool faultActive = isActiveAndEnabled && _faultStop;
        SetFlow(_intake, (active || faultActive) && _intakeEnabled, 1f);
        SetFlow(_valveFill, gasAllowed, _fill);
        SetFlow(_valveThrough, gasAllowed, Mathf.SmoothStep(0f, 1f, _fill));
        float outletIntensity = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((_fill - 0.4f) / 0.6f));
        SetFlow(_outlet, gasAllowed && _outletEnabled, outletIntensity);
        bool wire = (active || faultActive) && _controlWireEnabled;
        if (_controlWire != null && _controlWire.enabled != wire)
            _controlWire.enabled = wire;
        if (_shaftEnergy != null)
        {
            bool show = (active || faultActive) && _shaftEnergyEnabled;
            if (_shaftEnergy.enabled != show) _shaftEnergy.enabled = show;
        }
    }

    private void ResetValveCore()
    {
        if (_valveCore != null)
            _valveCore.localPosition = _closedCoreLocalPosition;
    }

    private static void SetFlow(PipeSteamParticleFlow flow, bool active, float intensity)
    {
        if (flow == null) return;
        flow.SetEffectEnabled(active);
        flow.SetIntensity(intensity);
    }
}

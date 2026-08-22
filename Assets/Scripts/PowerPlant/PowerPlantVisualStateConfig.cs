using UnityEngine;

/// <summary>
/// 发电场景共用的设备状态视觉配置。
/// 正常态不配置颜色：正常状态始终恢复模型登记时的基础材质；这里只保存需要覆盖显示的状态参数。
/// </summary>
[CreateAssetMenu(
    fileName = "PowerPlantVisualStateConfig",
    menuName = "WebDLPro/Power Plant/Visual State Config")]
public sealed class PowerPlantVisualStateConfig : ScriptableObject
{
    [Header("状态颜色")]
    [Tooltip("告警态颜色。Alarm（告警态）通过半透明覆盖与同色描边显示。")]
    [SerializeField, ColorUsage(true, true)] private Color _alarmColor = new Color(1f, 176f / 255f, 0f, 1f);

    [Tooltip("故障态颜色。Fault（故障态）通过半透明覆盖与同色描边显示。")]
    [SerializeField, ColorUsage(true, true)] private Color _faultColor = new Color(1f, 0f, 8f / 255f, 1f);

    [Tooltip("离线态颜色。Offline（离线态）仅在显示开关开启时通过半透明覆盖与同色描边显示。")]
    [SerializeField, ColorUsage(true, true)] private Color _offlineColor = new Color(154f / 255f, 164f / 255f, 178f / 255f, 1f);

    [Header("状态显示")]
    [Tooltip("告警、故障纯色半透明材质的透明强度。当前项目配置为 0.32。")]
    [SerializeField, Range(0f, 1f)] private float _overlayOpacity = 0.32f;

    [Tooltip("状态同色描边宽度。当前项目配置为 0.3。")]
    [SerializeField, Min(0f)] private float _outlineWidth = 0.3f;

    [Header("告警故障填充闪烁")]
    [Tooltip("告警纯色半透明填充的闪烁频率（次/秒）。告警采用较慢节奏，告警描边与填充同步闪烁。")]
    [SerializeField, Range(0.1f, 5f)] private float _alarmFillPulseFrequency = 0.8f;

    [Tooltip("故障纯色半透明填充的闪烁频率（次/秒）。故障采用快于告警的节奏，故障描边与填充同步闪烁。")]
    [SerializeField, Range(0.1f, 8f)] private float _faultFillPulseFrequency = 2.2f;

    [Tooltip("告警、故障填充闪烁时的最低透明度。最大透明度使用状态显示中的透明强度。")]
    [SerializeField, Range(0f, 1f)] private float _fillPulseMinimumOpacity = 0.08f;

    [Tooltip("是否在 Unity 三维场景显示离线态；关闭时仍接收离线状态，但不显示离线覆盖和描边。")]
    [SerializeField] private bool _showOfflineState;

    public Color AlarmColor => _alarmColor;
    public Color FaultColor => _faultColor;
    public Color OfflineColor => _offlineColor;
    public float OverlayOpacity => _overlayOpacity;
    public float OutlineWidth => _outlineWidth;
    public float AlarmFillPulseFrequency => _alarmFillPulseFrequency;
    public float FaultFillPulseFrequency => _faultFillPulseFrequency;
    public float FillPulseMinimumOpacity => Mathf.Min(_fillPulseMinimumOpacity, _overlayOpacity);
    public bool ShowOfflineState => _showOfflineState;
}

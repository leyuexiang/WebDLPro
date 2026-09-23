using UnityEngine;

/// <summary>
/// 为测试立方体保存设备标识，并向父页面上报“对象单击”消息。
/// 鼠标输入由 CubeMouseManipulator 统一处理，避免拖拽旋转刚按下时被错误识别为设备单击。
/// </summary>
public sealed class UnityIframeTestObject : MonoBehaviour
{
    // 默认值支持直接挂载在测试场景；自动引导器仍可按需覆盖为其他设备标识。
    [SerializeField] private string _deviceCode = "DEMO-CUBE-001";
    [SerializeField] private string _deviceName = "WebGL 测试立方体";

    /// <summary>
    /// 由引导器写入稳定的设备标识，避免将业务数据分散硬编码到输入控制脚本中。
    /// </summary>
    public void Initialize(string deviceCode, string deviceName)
    {
        _deviceCode = deviceCode;
        _deviceName = deviceName;
    }

    /// <summary>
    /// 由 CubeMouseManipulator 在确认“真实单击”后调用。
    /// 序列化旧场景可能保留空字符串，因此上报前统一回退到标准测试标识。
    /// </summary>
    public void ReportClick()
    {
        string deviceCode = string.IsNullOrWhiteSpace(_deviceCode) ? "DEMO-CUBE-001" : _deviceCode;
        string deviceName = string.IsNullOrWhiteSpace(_deviceName) ? "WebGL 测试立方体" : _deviceName;
        UnityIframeBridgeManager.Instance?.ReportObjectClick(deviceCode, deviceName);
    }
}

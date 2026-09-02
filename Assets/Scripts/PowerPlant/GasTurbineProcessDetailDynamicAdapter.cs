using UnityEngine;
using UnityEngine.Scripting;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 燃气轮机第三层动态目标适配器。它统一控制零件旋转、六套粒子与蓝红气流体积。
/// 播放许可只由独立关键环节命令修改，设备正常、告警、故障和离线状态均不会隐式启停动态效果。
/// </summary>
[Preserve]
[DisallowMultipleComponent]
public sealed class GasTurbineProcessDetailDynamicAdapter : MonoBehaviour, IProcessDetailDynamicTarget
{
    [SerializeField] private WaiKeHeBingAnimationController _animationController;
    [SerializeField] private WaiKeHeBingGasFlowEffectController _gasFlowController;
    [SerializeField] private WaiKeHeBingGasVolumeController _gasVolumeController;

    private bool _hasAppliedPlayback;
    private bool _playing = true;
    private bool _released;

    /// <summary>
    /// 直接设置三个动态控制器的播放许可。停止时旋转保持当前角度，粒子立即停止并清空，气流速度归零；
    /// 恢复时从当前旋转角度继续，并按各控制器既有配置重新启动粒子和气流。重复命令不会重复创建运行资源。
    /// </summary>
    public void SetPlayback(bool playing)
    {
        if (_released || _animationController == null || _gasFlowController == null || _gasVolumeController == null)
        {
            return;
        }
        if (_hasAppliedPlayback && _playing == playing)
        {
            return;
        }

        _hasAppliedPlayback = true;
        _playing = playing;
        _animationController.SetPlaybackAllowed(playing);
        _gasFlowController.SetPlaybackAllowed(playing);
        _gasVolumeController.SetPlaybackAllowed(playing);
    }

    /// <summary>退出第三层前强制停止全部动态目标，但不关闭包装根对象，销毁与资源释放由统一句柄执行。</summary>
    public void StopForRelease()
    {
        if (_released)
        {
            return;
        }

        SetPlayback(false);
    }

    public void Release()
    {
        if (_released)
        {
            return;
        }

        StopForRelease();
        _released = true;
    }

#if UNITY_EDITOR
    /// <summary>仅供第三层包装预制体生成器保存三个显式控制器引用。</summary>
    public void ConfigureForEditor(
        WaiKeHeBingAnimationController animationController,
        WaiKeHeBingGasFlowEffectController gasFlowController,
        WaiKeHeBingGasVolumeController gasVolumeController)
    {
        _animationController = animationController;
        _gasFlowController = gasFlowController;
        _gasVolumeController = gasVolumeController;
        _hasAppliedPlayback = false;
        _playing = true;
        _released = false;
    }
#endif
}

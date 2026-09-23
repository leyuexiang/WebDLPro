using UnityEngine;
using UnityEngine.Scripting;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 燃气轮机第三层动态目标适配器。它通过统一控制器控制零件旋转、粒子、气流体积和电线流动。
/// 播放许可由关键环节状态绑定器驱动：故障停止，其他状态或没有状态数据时播放。
/// </summary>
[Preserve]
[DisallowMultipleComponent]
public sealed class GasTurbineProcessDetailDynamicAdapter : ProcessDetailDynamicTargetBase
{
    [SerializeField] private WaiKeHeBingMasterController _masterController;

    /// <summary>
    /// 正常、告警、离线和无状态时完整播放；故障时由燃机控制器保留其专用蓝色前端粒子例外。
    /// </summary>
    protected override void ApplyPlayback(bool playing, bool faultStop)
    {
        if (_masterController != null)
        {
            _masterController.SetPlaying(playing, faultStop);
        }
    }

#if UNITY_EDITOR
    /// <summary>仅供第三层包装预制体生成器保存统一动态控制器引用。</summary>
    public void ConfigureForEditor(WaiKeHeBingMasterController masterController)
    {
        _masterController = masterController;
        ResetPlaybackStateForEditor();
    }
#endif
}

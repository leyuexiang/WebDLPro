using UnityEngine;
using UnityEngine.Scripting;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 变电站保护关键环节的静态动态适配器。
/// 这些模型当前没有已核验的动画、粒子或流动材质，因此只接入统一生命周期协议，
/// 不伪造播放效果；故障状态仍由 ProcessDetailStateVisualAdapter 负责四态变色。
/// </summary>
[Preserve]
[DisallowMultipleComponent]
public sealed class SubstationProtectionProcessDetailDynamicAdapter : ProcessDetailDynamicTargetBase
{
    protected override void ApplyPlayback(bool playing, bool faultStop)
    {
        // 当前三份保护模型没有可安全控制的动态资源，保留统一播放/故障/释放协议。
    }
}

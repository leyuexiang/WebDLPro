using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 关键环节动态目标的统一生命周期基类。
    /// 统一处理重复状态过滤、退出停播和资源释放；各关键环节只实现自身动画、粒子或材质流动的具体控制。
    /// </summary>
    public abstract class ProcessDetailDynamicTargetBase : MonoBehaviour, IProcessDetailDynamicTarget
    {
        private bool _hasAppliedPlayback;
        private bool _playing = true;
        private bool _faultStop;
        private bool _released;

        /// <summary>
        /// 应用协调器计算出的播放许可。相同状态不会重复下发，避免反复重启粒子、协程或动画状态机。
        /// </summary>
        public void SetPlayback(bool playing, bool faultStop)
        {
            if (_released || (_hasAppliedPlayback && _playing == playing && _faultStop == faultStop))
            {
                return;
            }

            _hasAppliedPlayback = true;
            _playing = playing;
            _faultStop = faultStop;
            ApplyPlayback(playing, faultStop);
        }

        /// <summary>关键环节退出前停止全部受控动态效果；非故障释放不保留任何故障例外效果。</summary>
        public void StopForRelease()
        {
            if (!_released)
            {
                SetPlayback(false, false);
            }
        }

        /// <summary>幂等释放动态目标，保证后续迟到状态不会重新启动已经退出的关键环节。</summary>
        public void Release()
        {
            if (_released)
            {
                return;
            }

            StopForRelease();
            _released = true;
            OnReleased();
        }

        /// <summary>由环节专用适配器实现具体播放、暂停及故障例外策略。</summary>
        protected abstract void ApplyPlayback(bool playing, bool faultStop);

        /// <summary>环节需要释放自有运行时缓存时覆盖；默认无需额外处理。</summary>
        protected virtual void OnReleased()
        {
        }

#if UNITY_EDITOR
        /// <summary>包装预制体生成器重新配置组件时清除制作期临时状态。</summary>
        protected void ResetPlaybackStateForEditor()
        {
            _hasAppliedPlayback = false;
            _playing = true;
            _faultStop = false;
            _released = false;
        }
#endif
    }
}

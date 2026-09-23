using System;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>切换令牌将单调序号、事务标识和目标场景绑定，旧回调无法只凭相同场景名取得提交权。</summary>
    public readonly struct SceneSwitchToken
    {
        public long Sequence { get; }
        public string TransitionId { get; }
        public string SceneId { get; }

        internal SceneSwitchToken(long sequence, string transitionId, string sceneId)
        {
            Sequence = sequence;
            TransitionId = transitionId;
            SceneId = sceneId;
        }
    }

    /// <summary>
    /// 纯逻辑事务门实现“最后一次有效切换生效”。每次 Begin 都废弃旧令牌；
    /// 只有当前令牌可以提交或报告失败，释放后所有令牌永久失效。
    /// </summary>
    public sealed class SceneSwitchTransactionGate
    {
        private long _sequence;
        private SceneSwitchToken? _current;
        private bool _disposed;

        public bool IsDisposed => _disposed;
        public string CurrentTransitionId => _current?.TransitionId;

        public bool TryBegin(string transitionId, string sceneId, out SceneSwitchToken token, out string supersededTransitionId, out string error)
        {
            token = default;
            supersededTransitionId = string.Empty;
            error = string.Empty;
            if (_disposed)
            {
                error = "场景切换事务门已经释放。";
                return false;
            }
            if (string.IsNullOrWhiteSpace(transitionId) || string.IsNullOrWhiteSpace(sceneId))
            {
                error = "切换事务标识和目标场景标识不能为空。";
                return false;
            }
            if (_current.HasValue && string.Equals(_current.Value.TransitionId, transitionId, StringComparison.Ordinal))
            {
                error = "活动切换已使用相同 transitionId。";
                return false;
            }

            supersededTransitionId = _current?.TransitionId ?? string.Empty;
            _sequence++;
            token = new SceneSwitchToken(_sequence, transitionId, sceneId);
            _current = token;
            return true;
        }

        public bool IsCurrent(SceneSwitchToken token)
        {
            return !_disposed && _current.HasValue &&
                   _current.Value.Sequence == token.Sequence &&
                   string.Equals(_current.Value.TransitionId, token.TransitionId, StringComparison.Ordinal) &&
                   string.Equals(_current.Value.SceneId, token.SceneId, StringComparison.Ordinal);
        }

        public bool TryComplete(SceneSwitchToken token)
        {
            if (!IsCurrent(token))
            {
                return false;
            }
            _current = null;
            return true;
        }

        public void Dispose()
        {
            _disposed = true;
            _current = null;
        }
    }
}

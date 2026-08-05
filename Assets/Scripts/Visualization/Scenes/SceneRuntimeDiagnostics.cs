using System;
using UnityEngine.Profiling;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 单次场景切换的受限运行诊断快照。
    /// 只保存稳定场景、事务、阶段、耗时和内存数值；不保存场景路径、资源名、层级、异常堆栈或历史载荷，
    /// 因而可用于开发诊断而不扩大跨场景引用或日志泄露面。
    /// </summary>
    public readonly struct SceneRuntimeDiagnosticsSnapshot
    {
        public string TargetSceneId { get; }
        public string CurrentSceneId { get; }
        public string TransitionId { get; }
        public string StageCode { get; }
        public string FailureStageCode { get; }
        public string ErrorCode { get; }
        public long LoadDurationMilliseconds { get; }
        public long FirstFrameDelayMilliseconds { get; }
        public long PeakAllocatedMemoryBytes { get; }
        public long CurrentAllocatedMemoryBytes { get; }
        public bool Completed { get; }
        public bool Released { get; }

        internal SceneRuntimeDiagnosticsSnapshot(
            string targetSceneId,
            string currentSceneId,
            string transitionId,
            string stageCode,
            string failureStageCode,
            string errorCode,
            long loadDurationMilliseconds,
            long firstFrameDelayMilliseconds,
            long peakAllocatedMemoryBytes,
            long currentAllocatedMemoryBytes,
            bool completed,
            bool released)
        {
            TargetSceneId = targetSceneId ?? string.Empty;
            CurrentSceneId = currentSceneId ?? string.Empty;
            TransitionId = transitionId ?? string.Empty;
            StageCode = stageCode ?? string.Empty;
            FailureStageCode = failureStageCode ?? string.Empty;
            ErrorCode = errorCode ?? string.Empty;
            LoadDurationMilliseconds = loadDurationMilliseconds;
            FirstFrameDelayMilliseconds = firstFrameDelayMilliseconds;
            PeakAllocatedMemoryBytes = peakAllocatedMemoryBytes;
            CurrentAllocatedMemoryBytes = currentAllocatedMemoryBytes;
            Completed = completed;
            Released = released;
        }
    }

    /// <summary>
    /// 场景协调器的单事务运行诊断器。
    /// 它只保留当前事务的一份快照，并且仅在切换阶段、提交首帧、失败或释放时采样内存；
    /// 不在 Update 中轮询、不调用全局卸载未使用资源，也不保留无界历史，从而避免诊断逻辑自身造成性能或内存问题。
    /// </summary>
    public sealed class SceneRuntimeDiagnostics
    {
        private readonly Func<double> _timeProvider;
        private readonly Func<long> _allocatedMemoryProvider;
        private double _startedAtSeconds;
        private double _committedAtSeconds = -1d;

        public SceneRuntimeDiagnosticsSnapshot Snapshot { get; private set; }

        /// <summary>
        /// 默认使用 Unity 非缩放实时时钟与总分配内存。测试可注入确定性数值，
        /// 生产路径不会创建计时器、采样协程或每帧 GC 压力。
        /// 构造阶段刻意不调用内存采样器：本对象会作为 MonoBehaviour 字段初始化，
        /// 而 Unity 禁止在组件构造函数期间调用 Profiler（性能分析器）接口。
        /// </summary>
        public SceneRuntimeDiagnostics(Func<double> timeProvider = null, Func<long> allocatedMemoryProvider = null)
        {
            _timeProvider = timeProvider ?? (() => UnityEngine.Time.realtimeSinceStartupAsDouble);
            _allocatedMemoryProvider = allocatedMemoryProvider ?? ReadAllocatedMemoryBytes;
            // 初始快照没有事务、阶段或可观测运行数据，因此以零内存值直接构造。
            // 第一次 BeginTransition（开始切换）或 RecordImmediateFailure（即时失败）发生在 Awake（唤醒）之后，
            // 此后 CreateSnapshot 才会读取性能分析器，既保留真实峰值统计，又不会触发 Unity 生命周期异常。
            Snapshot = new SceneRuntimeDiagnosticsSnapshot(
                string.Empty,
                string.Empty,
                string.Empty,
                string.Empty,
                string.Empty,
                string.Empty,
                -1L,
                -1L,
                0L,
                0L,
                false,
                false);
        }

        /// <summary>开始新事务时原子替换旧快照；旧事务的迟到进度、完成和失败都会因事务不匹配被忽略。</summary>
        public void BeginTransition(string targetSceneId, string transitionId, string currentSceneId)
        {
            _startedAtSeconds = _timeProvider();
            _committedAtSeconds = -1d;
            Snapshot = CreateSnapshot(targetSceneId, currentSceneId, transitionId, "validation", string.Empty, string.Empty, -1L, -1L, false, false);
        }

        /// <summary>记录当前事务的有限加载阶段；阶段文本由协调器固定产生，调用方不能写入任意日志内容。</summary>
        public bool RecordStage(string transitionId, string stageCode, string currentSceneId)
        {
            if (!IsCurrentTransition(transitionId) || Snapshot.Completed || Snapshot.Released)
            {
                return false;
            }
            // 加载进度可能每帧报告；同一阶段和当前场景不重新采样内存或发布事件，
            // 这样诊断成本固定为阶段数，而不是资源加载帧数。
            if (string.Equals(Snapshot.StageCode, stageCode, StringComparison.Ordinal) &&
                string.Equals(Snapshot.CurrentSceneId, currentSceneId ?? string.Empty, StringComparison.Ordinal))
            {
                return false;
            }

            Snapshot = CreateSnapshot(
                Snapshot.TargetSceneId,
                currentSceneId,
                Snapshot.TransitionId,
                stageCode,
                Snapshot.FailureStageCode,
                Snapshot.ErrorCode,
                Snapshot.LoadDurationMilliseconds,
                Snapshot.FirstFrameDelayMilliseconds,
                false,
                false);
            return true;
        }

        /// <summary>目标场景提交后记录加载耗时；首帧耗时由协调器在下一个渲染帧回填。</summary>
        public void MarkSceneCommitted(string sceneId, string transitionId)
        {
            if (!IsCurrentTransition(transitionId) || Snapshot.Released)
            {
                return;
            }

            _committedAtSeconds = _timeProvider();
            Snapshot = CreateSnapshot(
                // 恢复旧场景时，当前场景可能不同于原始目标；目标标识必须保留，
                // 才能让诊断明确区分“目标加载失败后恢复成功”和“直接切换成功”。
                Snapshot.TargetSceneId,
                sceneId,
                transitionId,
                "ready",
                string.Empty,
                string.Empty,
                ToMilliseconds(_committedAtSeconds - _startedAtSeconds),
                Snapshot.FirstFrameDelayMilliseconds,
                false,
                false);
        }

        /// <summary>仅在提交后的第一个渲染帧调用一次；重复调用不会覆盖已记录的首帧数据。</summary>
        public bool MarkFirstFrame(string sceneId, string transitionId)
        {
            if (!IsCurrentTransition(transitionId) || Snapshot.Released || Snapshot.FirstFrameDelayMilliseconds >= 0L)
            {
                return false;
            }

            double referenceSeconds = _committedAtSeconds >= 0d ? _committedAtSeconds : _startedAtSeconds;
            Snapshot = CreateSnapshot(
                Snapshot.TargetSceneId,
                sceneId,
                Snapshot.TransitionId,
                Snapshot.StageCode,
                Snapshot.FailureStageCode,
                Snapshot.ErrorCode,
                Snapshot.LoadDurationMilliseconds,
                ToMilliseconds(_timeProvider() - referenceSeconds),
                Snapshot.Completed,
                false);
            return true;
        }

        /// <summary>记录成功终态；没有实际场景重载的同场景请求将首帧延迟标为零而非伪造采样值。</summary>
        public void Complete(string transitionId, string currentSceneId)
        {
            if (!IsCurrentTransition(transitionId) || Snapshot.Released)
            {
                return;
            }

            long firstFrameDelay = Snapshot.FirstFrameDelayMilliseconds >= 0L ? Snapshot.FirstFrameDelayMilliseconds : 0L;
            long loadDuration = Snapshot.LoadDurationMilliseconds >= 0L
                ? Snapshot.LoadDurationMilliseconds
                : ToMilliseconds(_timeProvider() - _startedAtSeconds);
            Snapshot = CreateSnapshot(
                Snapshot.TargetSceneId,
                currentSceneId,
                Snapshot.TransitionId,
                "ready",
                string.Empty,
                string.Empty,
                loadDuration,
                firstFrameDelay,
                true,
                false);
        }

        /// <summary>记录失败或被取代终态；只保留固定错误码和阶段，不保存异常消息或对象引用。</summary>
        public void Fail(string transitionId, string currentSceneId, string failureStageCode, string errorCode)
        {
            if (!IsCurrentTransition(transitionId) || Snapshot.Released)
            {
                return;
            }

            Snapshot = CreateSnapshot(
                Snapshot.TargetSceneId,
                currentSceneId,
                Snapshot.TransitionId,
                failureStageCode,
                failureStageCode,
                errorCode,
                ToMilliseconds(_timeProvider() - _startedAtSeconds),
                Snapshot.FirstFrameDelayMilliseconds,
                true,
                false);
        }

        /// <summary>
        /// 记录尚未获得有效事务令牌时的即时失败，例如空令牌、目录校验失败或未知场景。
        /// 这类请求不会进入异步切换队列，但仍必须留下有限的失败阶段和错误码，
        /// 以便诊断界面与桥接结果对齐；不保存调用方消息、异常堆栈或对象引用。
        /// </summary>
        public void RecordImmediateFailure(
            string targetSceneId,
            string transitionId,
            string currentSceneId,
            string failureStageCode,
            string errorCode)
        {
            _startedAtSeconds = _timeProvider();
            _committedAtSeconds = -1d;
            Snapshot = CreateSnapshot(
                targetSceneId,
                currentSceneId,
                transitionId,
                failureStageCode,
                failureStageCode,
                errorCode,
                0L,
                -1L,
                true,
                false);
        }

        /// <summary>整个子应用释放时封口当前快照，后续任何阶段或首帧回调都会被拒绝。</summary>
        public void MarkReleased(string currentSceneId)
        {
            Snapshot = CreateSnapshot(
                Snapshot.TargetSceneId,
                currentSceneId,
                Snapshot.TransitionId,
                "disposing",
                Snapshot.FailureStageCode,
                Snapshot.ErrorCode,
                Snapshot.LoadDurationMilliseconds,
                Snapshot.FirstFrameDelayMilliseconds,
                Snapshot.Completed,
                true);
        }

        private bool IsCurrentTransition(string transitionId)
        {
            return !string.IsNullOrWhiteSpace(transitionId) && string.Equals(Snapshot.TransitionId, transitionId, StringComparison.Ordinal);
        }

        private SceneRuntimeDiagnosticsSnapshot CreateSnapshot(
            string targetSceneId,
            string currentSceneId,
            string transitionId,
            string stageCode,
            string failureStageCode,
            string errorCode,
            long loadDurationMilliseconds,
            long firstFrameDelayMilliseconds,
            bool completed,
            bool released)
        {
            long allocatedBytes = NormalizeMemoryValue(_allocatedMemoryProvider());
            long peakBytes = Math.Max(Snapshot.PeakAllocatedMemoryBytes, allocatedBytes);
            return new SceneRuntimeDiagnosticsSnapshot(
                targetSceneId,
                currentSceneId,
                transitionId,
                stageCode,
                failureStageCode,
                errorCode,
                loadDurationMilliseconds,
                firstFrameDelayMilliseconds,
                peakBytes,
                allocatedBytes,
                completed,
                released);
        }

        /// <summary>部分 WebGL 或受限平台可能无法报告总分配内存；规范化为零，避免负值污染峰值比较。</summary>
        private static long ReadAllocatedMemoryBytes()
        {
            return NormalizeMemoryValue(Profiler.GetTotalAllocatedMemoryLong());
        }

        private static long NormalizeMemoryValue(long value)
        {
            return value < 0L ? 0L : value;
        }

        private static long ToMilliseconds(double seconds)
        {
            return seconds <= 0d ? 0L : (long)Math.Round(seconds * 1000d, MidpointRounding.AwayFromZero);
        }
    }
}

using System;
using System.Collections.Generic;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 三层管道流动运行时适配器。
    /// 管道、路由和材质槽均由显式 ID 与登记关系提供；本类不扫描层级、不读取对象名称，
    /// 只在状态发生变化时通过材质属性块覆盖流速，避免创建运行时材质副本。
    /// </summary>
    public sealed class ThreeLayerPipeFlowRuntime
    {
        private sealed class PipeState
        {
            public readonly string PipeId;
            public readonly string RouteId;
            public readonly ThreeLayerMaterialPropertyAdapter[] MaterialAdapters;
            public bool ImpactStopped;
            public bool ManualStopped;
            public float SpeedMultiplier = 1f;
            public bool HasAppliedState;
            public bool AppliedStopped;
            public float AppliedSpeedMultiplier;

            public PipeState(
                string pipeId,
                string routeId,
                ThreeLayerMaterialPropertyAdapter[] materialAdapters)
            {
                PipeId = pipeId;
                RouteId = routeId;
                MaterialAdapters = materialAdapters;
            }
        }

        private readonly ThreeLayerBindingIndex _bindingIndex;
        private readonly Dictionary<string, PipeState> _pipesById =
            new Dictionary<string, PipeState>(StringComparer.Ordinal);
        private readonly Dictionary<string, PipeState> _pipesByRouteId =
            new Dictionary<string, PipeState>(StringComparer.Ordinal);
        private bool _released;

        public ThreeLayerPipeFlowRuntime(ThreeLayerBindingIndex bindingIndex)
        {
            _bindingIndex = bindingIndex ?? throw new ArgumentNullException(nameof(bindingIndex));
        }

        public int RegisteredPipeCount => _pipesById.Count;
        public bool IsReleased => _released;

        /// <summary>
        /// 登记一个稳定 pipeId 对应的全部材质槽。登记只执行一次，后续热路径直接访问缓存数组。
        /// 同一管道可以登记多个材质槽，但一个 routeId 只能由目录绑定到一个 pipeId。
        /// </summary>
        public bool TryRegisterPipe(
            string pipeId,
            IReadOnlyList<ThreeLayerMaterialPropertyAdapter> materialAdapters,
            out string error)
        {
            error = string.Empty;
            if (_released)
            {
                error = "管道流动运行时适配器已经释放。";
                return false;
            }
            if (!_bindingIndex.TryGetPipe(pipeId, out ThreeLayerPipeBinding binding))
            {
                error = $"未登记的 pipeId：{pipeId ?? string.Empty}。";
                return false;
            }
            if (_pipesById.ContainsKey(binding.PipeId))
            {
                error = $"pipeId 已重复登记：{binding.PipeId}。";
                return false;
            }
            if (_pipesByRouteId.ContainsKey(binding.RouteId))
            {
                error = $"routeId 已重复登记：{binding.RouteId}。";
                return false;
            }
            if (materialAdapters == null || materialAdapters.Count == 0)
            {
                error = $"管道 {binding.PipeId} 没有登记材质属性块适配器。";
                return false;
            }

            ThreeLayerMaterialPropertyAdapter[] adapters = new ThreeLayerMaterialPropertyAdapter[materialAdapters.Count];
            for (int index = 0; index < materialAdapters.Count; index++)
            {
                ThreeLayerMaterialPropertyAdapter adapter = materialAdapters[index];
                if (adapter == null || adapter.IsReleased || adapter.PropertyIds.FlowSpeed == 0)
                {
                    error = $"管道 {binding.PipeId} 的第 {index} 个材质槽不具备可用流速属性。";
                    return false;
                }

                adapters[index] = adapter;
            }

            PipeState state = new PipeState(binding.PipeId, binding.RouteId, adapters);
            _pipesById.Add(state.PipeId, state);
            _pipesByRouteId.Add(state.RouteId, state);
            return true;
        }

        /// <summary>
        /// 按影响投影结果切换管道停流状态。
        /// activePipeIds 只允许包含目录中已登记且已完成材质绑定的 pipeId，避免异常影响被静默吞掉。
        /// </summary>
        public BusinessSceneCommandResult ApplyImpact(ISet<string> activePipeIds)
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Failed(
                    "pipe-flow-runtime-released",
                    "管道流动运行时适配器已经释放。");
            }
            if (activePipeIds == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "pipe-flow-impact-null",
                    "管道影响集合不能为空。若没有影响管道，应传入空集合。 ");
            }

            foreach (string pipeId in activePipeIds)
            {
                if (!_pipesById.ContainsKey(pipeId))
                {
                    return BusinessSceneCommandResult.Failed(
                        "pipe-flow-not-registered",
                        $"影响结果中的 pipeId 尚未完成运行时材质登记：{pipeId ?? string.Empty}。 ");
                }
            }

            foreach (PipeState state in _pipesById.Values)
            {
                bool impactStopped = activePipeIds.Contains(state.PipeId);
                if (state.ImpactStopped == impactStopped)
                {
                    continue;
                }

                state.ImpactStopped = impactStopped;
                ApplyEffectiveState(state);
            }

            return BusinessSceneCommandResult.Completed(
                $"管道影响状态已更新，停流管道数：{activePipeIds.Count}。 ");
        }

        /// <summary>
        /// 按显式 routeId 控制单条路由。异常影响优先级高于手动启用：影响仍存在时启用请求不会恢复流动。
        /// enabled 为 true 时使用登记时的原始流速乘以 speedMultiplier；false 时只停止该路由。
        /// </summary>
        public BusinessSceneCommandResult SetRouteFlow(string routeId, bool enabled, float speedMultiplier)
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Failed(
                    "pipe-flow-runtime-released",
                    "管道流动运行时适配器已经释放。 ");
            }
            if (!_pipesByRouteId.TryGetValue(routeId ?? string.Empty, out PipeState state))
            {
                return BusinessSceneCommandResult.Failed(
                    "route-flow-not-registered",
                    $"未登记的 routeId：{routeId ?? string.Empty}。 ");
            }
            if (float.IsNaN(speedMultiplier) || float.IsInfinity(speedMultiplier) || speedMultiplier < 0f)
            {
                return BusinessSceneCommandResult.Failed(
                    "route-flow-speed-invalid",
                    "路由流速倍率必须是大于等于零的有限数值。 ");
            }

            state.ManualStopped = !enabled;
            if (enabled)
            {
                state.SpeedMultiplier = speedMultiplier;
            }

            ApplyEffectiveState(state);
            return BusinessSceneCommandResult.Completed(
                state.ImpactStopped
                    ? $"路由 {state.RouteId} 仍受异常影响，保持停流。"
                    : enabled
                        ? $"路由 {state.RouteId} 已恢复流动。"
                        : $"路由 {state.RouteId} 已停止流动。");
        }

        /// <summary>查询已登记管道当前是否因异常或手动命令而停流。</summary>
        public bool IsPipeStopped(string pipeId)
        {
            return _pipesById.TryGetValue(pipeId ?? string.Empty, out PipeState state) &&
                (state.ImpactStopped || state.ManualStopped);
        }

        /// <summary>
        /// 恢复所有登记材质槽的原始流速并释放适配器引用。释放可重复调用，且不会销毁共享材质资产。
        /// </summary>
        public BusinessSceneCommandResult Release()
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Completed("管道流动运行时适配器已释放。 ");
            }

            foreach (PipeState state in _pipesById.Values)
            {
                for (int index = 0; index < state.MaterialAdapters.Length; index++)
                {
                    ThreeLayerMaterialPropertyAdapter adapter = state.MaterialAdapters[index];
                    adapter.Restore();
                    adapter.Release();
                }
            }

            _pipesById.Clear();
            _pipesByRouteId.Clear();
            _released = true;
            return BusinessSceneCommandResult.Completed("管道流动运行时适配器已恢复基线并释放。 ");
        }

        private static void ApplyEffectiveState(PipeState state)
        {
            bool stopped = state.ImpactStopped || state.ManualStopped;
            if (state.HasAppliedState &&
                state.AppliedStopped == stopped &&
                (stopped || state.AppliedSpeedMultiplier == state.SpeedMultiplier))
            {
                return;
            }

            float speedMultiplier = stopped ? 0f : state.SpeedMultiplier;
            ThreeLayerMaterialPropertyValues values = ThreeLayerMaterialPropertyValues.ForFlowSpeed(
                state.MaterialAdapters[0].OriginalFlowSpeed * speedMultiplier);
            for (int index = 0; index < state.MaterialAdapters.Length; index++)
            {
                ThreeLayerMaterialPropertyAdapter adapter = state.MaterialAdapters[index];
                if (index > 0)
                {
                    values = ThreeLayerMaterialPropertyValues.ForFlowSpeed(
                        adapter.OriginalFlowSpeed * speedMultiplier);
                }

                adapter.Apply(values);
            }

            state.HasAppliedState = true;
            state.AppliedStopped = stopped;
            state.AppliedSpeedMultiplier = state.SpeedMultiplier;
        }
    }
}

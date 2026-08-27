using System;
using System.Collections.Generic;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 已通过校验的三层映射运行时索引。索引在目录加载阶段一次构建，状态热路径只做字典读取，
    /// 不扫描场景层级、不解析模型名称，也不创建材质副本。
    /// </summary>
    public sealed class ThreeLayerBindingIndex
    {
        private readonly Dictionary<string, ThreeLayerNodeBinding> _nodeById;
        private readonly Dictionary<string, string> _buildingByGroupId;
        private readonly Dictionary<string, string[]> _nodeIdsByGroupId;
        private readonly Dictionary<string, ThreeLayerPipeBinding> _pipeById;
        private readonly Dictionary<string, ThreeLayerAreaBinding> _areaById;
        private readonly Dictionary<string, ThreeLayerEffectProfileBinding> _effectProfileById;
        private readonly Dictionary<string, ThreeLayerPipeImpactRule[]> _pipeRulesByGroupId;
        private readonly Dictionary<string, ThreeLayerAreaImpactRule[]> _areaRulesByGroupId;

        private ThreeLayerBindingIndex(
            Dictionary<string, ThreeLayerNodeBinding> nodeById,
            Dictionary<string, string> buildingByGroupId,
            Dictionary<string, string[]> nodeIdsByGroupId,
            Dictionary<string, ThreeLayerPipeBinding> pipeById,
            Dictionary<string, ThreeLayerAreaBinding> areaById,
            Dictionary<string, ThreeLayerEffectProfileBinding> effectProfileById,
            Dictionary<string, ThreeLayerPipeImpactRule[]> pipeRulesByGroupId,
            Dictionary<string, ThreeLayerAreaImpactRule[]> areaRulesByGroupId)
        {
            _nodeById = nodeById;
            _buildingByGroupId = buildingByGroupId;
            _nodeIdsByGroupId = nodeIdsByGroupId;
            _pipeById = pipeById;
            _areaById = areaById;
            _effectProfileById = effectProfileById;
            _pipeRulesByGroupId = pipeRulesByGroupId;
            _areaRulesByGroupId = areaRulesByGroupId;
        }

        public static bool TryCreate(ThreeLayerBindingCatalog catalog, out ThreeLayerBindingIndex builtIndex, out IReadOnlyList<ThreeLayerBindingValidationIssue> issues)
        {
            builtIndex = null;
            issues = ThreeLayerBindingCatalogValidator.Validate(catalog);
            if (issues.Count > 0)
            {
                return false;
            }

            Dictionary<string, ThreeLayerNodeBinding> nodeById = new Dictionary<string, ThreeLayerNodeBinding>(StringComparer.Ordinal);
            Dictionary<string, string> buildingByGroupId = new Dictionary<string, string>(StringComparer.Ordinal);
            Dictionary<string, List<string>> nodeIdsByGroupId = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            Dictionary<string, ThreeLayerPipeBinding> pipeById = new Dictionary<string, ThreeLayerPipeBinding>(StringComparer.Ordinal);
            Dictionary<string, ThreeLayerAreaBinding> areaById = new Dictionary<string, ThreeLayerAreaBinding>(StringComparer.Ordinal);
            Dictionary<string, ThreeLayerEffectProfileBinding> effectProfileById = new Dictionary<string, ThreeLayerEffectProfileBinding>(StringComparer.Ordinal);
            Dictionary<string, List<ThreeLayerPipeImpactRule>> pipeRulesByGroupId = new Dictionary<string, List<ThreeLayerPipeImpactRule>>(StringComparer.Ordinal);
            Dictionary<string, List<ThreeLayerAreaImpactRule>> areaRulesByGroupId = new Dictionary<string, List<ThreeLayerAreaImpactRule>>(StringComparer.Ordinal);

            ThreeLayerNodeBinding[] nodeBindings = catalog.NodeBindings;
            for (int index = 0; index < nodeBindings.Length; index++)
            {
                ThreeLayerNodeBinding binding = nodeBindings[index];
                nodeById.Add(binding.NodeId, binding);
                AddToList(nodeIdsByGroupId, binding.DeviceGroupId, binding.NodeId);
                if (binding.HasOverviewTarget && !buildingByGroupId.ContainsKey(binding.DeviceGroupId))
                {
                    buildingByGroupId.Add(binding.DeviceGroupId, binding.OverviewBuildingId);
                }
            }

            ThreeLayerPipeBinding[] pipes = catalog.Pipes;
            for (int index = 0; index < pipes.Length; index++)
            {
                pipeById.Add(pipes[index].PipeId, pipes[index]);
            }

            ThreeLayerAreaBinding[] areas = catalog.Areas;
            for (int index = 0; index < areas.Length; index++)
            {
                areaById.Add(areas[index].AreaId, areas[index]);
            }

            ThreeLayerEffectProfileBinding[] effectProfiles = catalog.EffectProfiles;
            for (int index = 0; index < effectProfiles.Length; index++)
            {
                effectProfileById.Add(effectProfiles[index].EffectProfileId, effectProfiles[index]);
            }

            ThreeLayerPipeImpactRule[] pipeRules = catalog.PipeImpactRules;
            for (int index = 0; index < pipeRules.Length; index++)
            {
                AddToList(pipeRulesByGroupId, pipeRules[index].SourceDeviceGroupId, pipeRules[index]);
            }

            ThreeLayerAreaImpactRule[] areaRules = catalog.AreaImpactRules;
            for (int index = 0; index < areaRules.Length; index++)
            {
                AddToList(areaRulesByGroupId, areaRules[index].SourceDeviceGroupId, areaRules[index]);
            }

            builtIndex = new ThreeLayerBindingIndex(
                nodeById,
                buildingByGroupId,
                ConvertLists(nodeIdsByGroupId),
                pipeById,
                areaById,
                effectProfileById,
                ConvertLists(pipeRulesByGroupId),
                ConvertLists(areaRulesByGroupId));
            return true;
        }

        public bool TryGetNode(string nodeId, out ThreeLayerNodeBinding binding)
        {
            return _nodeById.TryGetValue(nodeId ?? string.Empty, out binding);
        }

        public bool TryGetOverviewBuildingId(string deviceGroupId, out string overviewBuildingId)
        {
            return _buildingByGroupId.TryGetValue(deviceGroupId ?? string.Empty, out overviewBuildingId);
        }

        public bool TryGetPipe(string pipeId, out ThreeLayerPipeBinding binding)
        {
            return _pipeById.TryGetValue(pipeId ?? string.Empty, out binding);
        }

        public bool TryGetArea(string areaId, out ThreeLayerAreaBinding binding)
        {
            return _areaById.TryGetValue(areaId ?? string.Empty, out binding);
        }

        public bool TryGetEffectProfile(string effectProfileId, out ThreeLayerEffectProfileBinding profile)
        {
            return _effectProfileById.TryGetValue(effectProfileId ?? string.Empty, out profile);
        }

        public IReadOnlyList<string> GetNodeIdsForDeviceGroup(string deviceGroupId)
        {
            return _nodeIdsByGroupId.TryGetValue(deviceGroupId ?? string.Empty, out string[] nodeIds)
                ? nodeIds
                : Array.Empty<string>();
        }

        public IReadOnlyList<ThreeLayerPipeImpactRule> GetPipeImpactRules(string deviceGroupId)
        {
            return _pipeRulesByGroupId.TryGetValue(deviceGroupId ?? string.Empty, out ThreeLayerPipeImpactRule[] rules)
                ? rules
                : Array.Empty<ThreeLayerPipeImpactRule>();
        }

        public IReadOnlyList<ThreeLayerAreaImpactRule> GetAreaImpactRules(string deviceGroupId)
        {
            return _areaRulesByGroupId.TryGetValue(deviceGroupId ?? string.Empty, out ThreeLayerAreaImpactRule[] rules)
                ? rules
                : Array.Empty<ThreeLayerAreaImpactRule>();
        }

        private static void AddToList<T>(Dictionary<string, List<T>> lists, string key, T value)
        {
            if (!lists.TryGetValue(key, out List<T> values))
            {
                values = new List<T>();
                lists.Add(key, values);
            }
            values.Add(value);
        }

        private static Dictionary<string, T[]> ConvertLists<T>(Dictionary<string, List<T>> lists)
        {
            Dictionary<string, T[]> result = new Dictionary<string, T[]>(lists.Count, StringComparer.Ordinal);
            foreach (KeyValuePair<string, List<T>> pair in lists)
            {
                result.Add(pair.Key, pair.Value.ToArray());
            }
            return result;
        }
    }

    /// <summary>固定四态优先级：Fault 大于 Alarm，大于明确 Offline，大于 Normal。</summary>
    public static class ThreeLayerStateAggregator
    {
        public static BusinessSceneNodeVisualState Aggregate(IReadOnlyList<BusinessSceneNodeVisualState> states)
        {
            if (states == null || states.Count == 0)
            {
                return BusinessSceneNodeVisualState.Normal;
            }

            BusinessSceneNodeVisualState aggregate = BusinessSceneNodeVisualState.Normal;
            for (int index = 0; index < states.Count; index++)
            {
                aggregate = Max(aggregate, states[index]);
                if (aggregate == BusinessSceneNodeVisualState.Fault)
                {
                    return aggregate;
                }
            }
            return aggregate;
        }

        public static BusinessSceneNodeVisualState Max(
            BusinessSceneNodeVisualState left,
            BusinessSceneNodeVisualState right)
        {
            return Rank(right) > Rank(left) ? right : left;
        }

        public static bool IsImpactActive(BusinessSceneNodeVisualState state, bool onAlarm, bool onFault, bool onOffline)
        {
            switch (state)
            {
                case BusinessSceneNodeVisualState.Alarm:
                    return onAlarm;
                case BusinessSceneNodeVisualState.Fault:
                    return onFault;
                case BusinessSceneNodeVisualState.Offline:
                    return onOffline;
                default:
                    return false;
            }
        }

        private static int Rank(BusinessSceneNodeVisualState state)
        {
            switch (state)
            {
                case BusinessSceneNodeVisualState.Fault:
                    return 3;
                case BusinessSceneNodeVisualState.Alarm:
                    return 2;
                case BusinessSceneNodeVisualState.Offline:
                    return 1;
                default:
                    return 0;
            }
        }
    }

    /// <summary>
    /// 将设备组最终状态合并为受影响 pipe/area 集合。规则来源必须是显式配置，未配置目标不会产生影响。
    /// 调用方可复用传入的 HashSet，比较更新前后集合即可实现 change-only 下发。
    /// </summary>
    public static class ThreeLayerImpactProjector
    {
        public static void Project(
            IReadOnlyDictionary<string, BusinessSceneNodeVisualState> deviceGroupStates,
            ThreeLayerBindingIndex index,
            ISet<string> activePipeIds,
            ISet<string> activeAreaIds)
        {
            if (activePipeIds == null || activeAreaIds == null)
            {
                throw new ArgumentNullException(activePipeIds == null ? nameof(activePipeIds) : nameof(activeAreaIds));
            }

            activePipeIds.Clear();
            activeAreaIds.Clear();
            if (deviceGroupStates == null || index == null)
            {
                return;
            }

            foreach (KeyValuePair<string, BusinessSceneNodeVisualState> pair in deviceGroupStates)
            {
                IReadOnlyList<ThreeLayerPipeImpactRule> pipeRules = index.GetPipeImpactRules(pair.Key);
                for (int indexInRules = 0; indexInRules < pipeRules.Count; indexInRules++)
                {
                    ThreeLayerPipeImpactRule rule = pipeRules[indexInRules];
                    if (ThreeLayerStateAggregator.IsImpactActive(pair.Value, rule.OnAlarm, rule.OnFault, rule.OnOffline))
                    {
                        activePipeIds.Add(rule.PipeId);
                    }
                }

                IReadOnlyList<ThreeLayerAreaImpactRule> areaRules = index.GetAreaImpactRules(pair.Key);
                for (int indexInRules = 0; indexInRules < areaRules.Count; indexInRules++)
                {
                    ThreeLayerAreaImpactRule rule = areaRules[indexInRules];
                    if (ThreeLayerStateAggregator.IsImpactActive(pair.Value, rule.OnAlarm, rule.OnFault, rule.OnOffline))
                    {
                        activeAreaIds.Add(rule.AreaId);
                    }
                }
            }
        }
    }
}

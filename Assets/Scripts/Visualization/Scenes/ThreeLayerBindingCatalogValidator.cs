using System;
using System.Collections.Generic;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>三层映射校验问题使用稳定代码，编辑器导入、构建门禁和运行时索引共用同一结果模型。</summary>
    public readonly struct ThreeLayerBindingValidationIssue
    {
        public string Code { get; }
        public string Message { get; }

        public ThreeLayerBindingValidationIssue(string code, string message)
        {
            Code = code;
            Message = message;
        }
    }

    /// <summary>
    /// 三层映射静态校验器。校验只依赖显式数据，不读取 Unity 层级、模型名称、材质名称或资源路径。
    /// </summary>
    public static class ThreeLayerBindingCatalogValidator
    {
        public const int MaxNodeBindings = 500;
        public const int MaxPipeBindings = 512;
        public const int MaxAreaBindings = 256;
        public const int MaxImpactRules = 1024;

        public static IReadOnlyList<ThreeLayerBindingValidationIssue> Validate(ThreeLayerBindingCatalog catalog)
        {
            if (catalog == null)
            {
                return new[]
                {
                    new ThreeLayerBindingValidationIssue("binding-catalog.null", "三层映射目录不能为空。")
                };
            }

            return Validate(
                catalog.NodeBindings,
                catalog.Pipes,
                catalog.Areas,
                catalog.EffectProfiles,
                catalog.PipeImpactRules,
                catalog.AreaImpactRules);
        }

        public static IReadOnlyList<ThreeLayerBindingValidationIssue> Validate(
            IReadOnlyList<ThreeLayerNodeBinding> nodeBindings,
            IReadOnlyList<ThreeLayerPipeBinding> pipes,
            IReadOnlyList<ThreeLayerAreaBinding> areas,
            IReadOnlyList<ThreeLayerEffectProfileBinding> effectProfiles,
            IReadOnlyList<ThreeLayerPipeImpactRule> pipeImpactRules,
            IReadOnlyList<ThreeLayerAreaImpactRule> areaImpactRules)
        {
            List<ThreeLayerBindingValidationIssue> issues = new List<ThreeLayerBindingValidationIssue>();
            nodeBindings = nodeBindings ?? Array.Empty<ThreeLayerNodeBinding>();
            pipes = pipes ?? Array.Empty<ThreeLayerPipeBinding>();
            areas = areas ?? Array.Empty<ThreeLayerAreaBinding>();
            effectProfiles = effectProfiles ?? Array.Empty<ThreeLayerEffectProfileBinding>();
            pipeImpactRules = pipeImpactRules ?? Array.Empty<ThreeLayerPipeImpactRule>();
            areaImpactRules = areaImpactRules ?? Array.Empty<ThreeLayerAreaImpactRule>();

            ValidateCount(nodeBindings.Count, MaxNodeBindings, "node", issues);
            ValidateCount(pipes.Count, MaxPipeBindings, "pipe", issues);
            ValidateCount(areas.Count, MaxAreaBindings, "area", issues);
            ValidateCount(effectProfiles.Count, MaxAreaBindings, "effect-profile", issues);
            ValidateCount(pipeImpactRules.Count + areaImpactRules.Count, MaxImpactRules, "impact-rule", issues);

            Dictionary<string, ThreeLayerNodeBinding> nodeById = new Dictionary<string, ThreeLayerNodeBinding>(StringComparer.Ordinal);
            Dictionary<string, string> groupToBuilding = new Dictionary<string, string>(StringComparer.Ordinal);
            Dictionary<string, HashSet<string>> groupScenes = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            HashSet<string> sceneNodeKeys = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < nodeBindings.Count; index++)
            {
                ThreeLayerNodeBinding binding = nodeBindings[index];
                if (binding == null ||
                    !RequireStableId(binding.NodeId, "node", issues) ||
                    !RequireBusinessScene(binding.SceneId, "node", issues) ||
                    !RequireStableId(binding.DeviceGroupId, "device-group", issues))
                {
                    continue;
                }

                if (!nodeById.TryAdd(binding.NodeId, binding))
                {
                    issues.Add(new ThreeLayerBindingValidationIssue("binding.node-duplicate", $"nodeId {binding.NodeId} 重复登记。"));
                }

                if (binding.HasSceneTarget)
                {
                    if (!RequireStableId(binding.SceneNodeId, "scene-node", issues))
                    {
                        continue;
                    }

                    string sceneNodeKey = CreateSceneNodeKey(binding.SceneId, binding.SceneNodeId);
                    if (!sceneNodeKeys.Add(sceneNodeKey))
                    {
                        issues.Add(new ThreeLayerBindingValidationIssue(
                            "binding.scene-node-duplicate",
                            $"场景 {binding.SceneId} 的 sceneNodeId {binding.SceneNodeId} 重复登记。"));
                    }
                }
                else if (!string.IsNullOrWhiteSpace(binding.SceneNodeId))
                {
                    issues.Add(new ThreeLayerBindingValidationIssue(
                        "binding.scene-node-orphan-value",
                        $"nodeId {binding.NodeId} 未声明三维目标，却填写了 sceneNodeId。"));
                }

                if (!groupScenes.TryGetValue(binding.DeviceGroupId, out HashSet<string> scenes))
                {
                    scenes = new HashSet<string>(StringComparer.Ordinal);
                    groupScenes.Add(binding.DeviceGroupId, scenes);
                }
                scenes.Add(binding.SceneId);

                if (binding.HasOverviewTarget)
                {
                    if (!RequireStableId(binding.OverviewBuildingId, "overview-building", issues))
                    {
                        continue;
                    }
                    if (groupToBuilding.TryGetValue(binding.DeviceGroupId, out string existingBuildingId) &&
                        !string.Equals(existingBuildingId, binding.OverviewBuildingId, StringComparison.Ordinal))
                    {
                        issues.Add(new ThreeLayerBindingValidationIssue(
                            "binding.group-building-conflict",
                            $"设备组 {binding.DeviceGroupId} 关联了多个 overviewBuildingId。"));
                    }
                    else
                    {
                        groupToBuilding[binding.DeviceGroupId] = binding.OverviewBuildingId;
                    }
                }
                else if (!string.IsNullOrWhiteSpace(binding.OverviewBuildingId))
                {
                    issues.Add(new ThreeLayerBindingValidationIssue(
                        "binding.overview-orphan-value",
                        $"nodeId {binding.NodeId} 未声明总览目标，却填写了 overviewBuildingId。"));
                }
            }

            Dictionary<string, ThreeLayerPipeBinding> pipeById = new Dictionary<string, ThreeLayerPipeBinding>(StringComparer.Ordinal);
            Dictionary<string, string> routeToPipe = new Dictionary<string, string>(StringComparer.Ordinal);
            for (int index = 0; index < pipes.Count; index++)
            {
                ThreeLayerPipeBinding pipe = pipes[index];
                if (pipe == null ||
                    !RequireStableId(pipe.PipeId, "pipe", issues) ||
                    !RequireStableId(pipe.RouteId, "route", issues) ||
                    !RequireBusinessScene(pipe.SceneId, "pipe", issues))
                {
                    continue;
                }
                if (!pipeById.TryAdd(pipe.PipeId, pipe))
                {
                    issues.Add(new ThreeLayerBindingValidationIssue("binding.pipe-duplicate", $"pipeId {pipe.PipeId} 重复登记。"));
                }
                if (routeToPipe.TryGetValue(pipe.RouteId, out string existingPipeId) &&
                    !string.Equals(existingPipeId, pipe.PipeId, StringComparison.Ordinal))
                {
                    issues.Add(new ThreeLayerBindingValidationIssue(
                        "binding.route-duplicate",
                        $"routeId {pipe.RouteId} 不能同时绑定多个 pipeId。"));
                }
                else
                {
                    routeToPipe[pipe.RouteId] = pipe.PipeId;
                }
            }

            Dictionary<string, ThreeLayerEffectProfileBinding> profileById = new Dictionary<string, ThreeLayerEffectProfileBinding>(StringComparer.Ordinal);
            for (int index = 0; index < effectProfiles.Count; index++)
            {
                ThreeLayerEffectProfileBinding profile = effectProfiles[index];
                if (profile == null || !RequireStableId(profile.EffectProfileId, "effect-profile", issues))
                {
                    continue;
                }
                if (!profileById.TryAdd(profile.EffectProfileId, profile))
                {
                    issues.Add(new ThreeLayerBindingValidationIssue(
                        "binding.effect-profile-duplicate",
                        $"effectProfileId {profile.EffectProfileId} 重复登记。"));
                }
            }

            Dictionary<string, ThreeLayerAreaBinding> areaById = new Dictionary<string, ThreeLayerAreaBinding>(StringComparer.Ordinal);
            for (int index = 0; index < areas.Count; index++)
            {
                ThreeLayerAreaBinding area = areas[index];
                if (area == null ||
                    !RequireStableId(area.AreaId, "area", issues) ||
                    !RequireBusinessScene(area.SceneId, "area", issues) ||
                    !RequireStableId(area.EffectProfileId, "effect-profile", issues))
                {
                    continue;
                }
                if (!areaById.TryAdd(area.AreaId, area))
                {
                    issues.Add(new ThreeLayerBindingValidationIssue("binding.area-duplicate", $"areaId {area.AreaId} 重复登记。"));
                }
                if (!profileById.ContainsKey(area.EffectProfileId))
                {
                    issues.Add(new ThreeLayerBindingValidationIssue(
                        "binding.effect-profile-unknown",
                        $"区域 {area.AreaId} 引用了未登记的 effectProfileId {area.EffectProfileId}。"));
                }
            }

            HashSet<string> pipeRuleKeys = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < pipeImpactRules.Count; index++)
            {
                ThreeLayerPipeImpactRule rule = pipeImpactRules[index];
                if (rule == null ||
                    !RequireStableId(rule.SourceDeviceGroupId, "device-group", issues) ||
                    !RequireStableId(rule.PipeId, "pipe", issues))
                {
                    continue;
                }
                ValidateImpactSource(rule.SourceDeviceGroupId, groupScenes, issues);
                if (!pipeById.ContainsKey(rule.PipeId))
                {
                    issues.Add(new ThreeLayerBindingValidationIssue(
                        "binding.pipe-impact-target-unknown",
                        $"管道影响规则引用了未登记的 pipeId {rule.PipeId}。"));
                }
                ValidateTrigger(rule.OnAlarm, rule.OnFault, rule.OnOffline, "pipe", rule.PipeId, issues);
                string ruleKey = $"{rule.SourceDeviceGroupId}|{rule.PipeId}";
                if (!pipeRuleKeys.Add(ruleKey))
                {
                    issues.Add(new ThreeLayerBindingValidationIssue("binding.pipe-impact-duplicate", $"管道影响规则 {ruleKey} 重复。"));
                }
            }

            HashSet<string> areaRuleKeys = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < areaImpactRules.Count; index++)
            {
                ThreeLayerAreaImpactRule rule = areaImpactRules[index];
                if (rule == null ||
                    !RequireStableId(rule.SourceDeviceGroupId, "device-group", issues) ||
                    !RequireStableId(rule.AreaId, "area", issues))
                {
                    continue;
                }
                ValidateImpactSource(rule.SourceDeviceGroupId, groupScenes, issues);
                if (!areaById.ContainsKey(rule.AreaId))
                {
                    issues.Add(new ThreeLayerBindingValidationIssue(
                        "binding.area-impact-target-unknown",
                        $"区域影响规则引用了未登记的 areaId {rule.AreaId}。"));
                }
                ValidateTrigger(rule.OnAlarm, rule.OnFault, rule.OnOffline, "area", rule.AreaId, issues);
                string ruleKey = $"{rule.SourceDeviceGroupId}|{rule.AreaId}";
                if (!areaRuleKeys.Add(ruleKey))
                {
                    issues.Add(new ThreeLayerBindingValidationIssue("binding.area-impact-duplicate", $"区域影响规则 {ruleKey} 重复。"));
                }
            }

            return issues;
        }

        public static bool IsStableIdentifier(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || value[0] < 'a' || value[0] > 'z')
            {
                return false;
            }

            bool previousWasSeparator = false;
            for (int index = 1; index < value.Length; index++)
            {
                char character = value[index];
                bool isLowercase = character >= 'a' && character <= 'z';
                bool isDigit = character >= '0' && character <= '9';
                bool isSeparator = character == '.' || character == '-' || character == '_';
                if (!isLowercase && !isDigit && !isSeparator)
                {
                    return false;
                }
                if (isSeparator && previousWasSeparator)
                {
                    return false;
                }
                previousWasSeparator = isSeparator;
            }
            return !previousWasSeparator;
        }

        private static void ValidateCount(int count, int maximum, string name, ICollection<ThreeLayerBindingValidationIssue> issues)
        {
            if (count > maximum)
            {
                issues.Add(new ThreeLayerBindingValidationIssue(
                    "binding.capacity",
                    $"{name} 配置数量超过上限 {maximum}。"));
            }
        }

        private static bool RequireStableId(string value, string name, ICollection<ThreeLayerBindingValidationIssue> issues)
        {
            if (IsStableIdentifier(value))
            {
                return true;
            }
            issues.Add(new ThreeLayerBindingValidationIssue(
                "binding.id-invalid",
                $"{name} 标识不符合稳定 ID 规则：{value ?? string.Empty}。"));
            return false;
        }

        private static bool RequireBusinessScene(string sceneId, string name, ICollection<ThreeLayerBindingValidationIssue> issues)
        {
            if (BusinessSceneCatalog.IsRequiredSceneId(sceneId))
            {
                return true;
            }
            issues.Add(new ThreeLayerBindingValidationIssue(
                "binding.scene-unknown",
                $"{name} 绑定了未知业务场景：{sceneId ?? string.Empty}。"));
            return false;
        }

        private static void ValidateImpactSource(
            string sourceDeviceGroupId,
            IReadOnlyDictionary<string, HashSet<string>> groupScenes,
            ICollection<ThreeLayerBindingValidationIssue> issues)
        {
            if (!groupScenes.ContainsKey(sourceDeviceGroupId))
            {
                issues.Add(new ThreeLayerBindingValidationIssue(
                    "binding.impact-source-unknown",
                    $"影响规则引用了未登记的 deviceGroupId {sourceDeviceGroupId}。"));
            }
        }

        private static void ValidateTrigger(
            bool onAlarm,
            bool onFault,
            bool onOffline,
            string targetType,
            string targetId,
            ICollection<ThreeLayerBindingValidationIssue> issues)
        {
            if (!onAlarm && !onFault && !onOffline)
            {
                issues.Add(new ThreeLayerBindingValidationIssue(
                    "binding.impact-trigger-empty",
                    $"{targetType} {targetId} 的影响规则没有任何触发状态。"));
            }
        }

        private static string CreateSceneNodeKey(string sceneId, string sceneNodeId)
        {
            return $"{sceneId}|{sceneNodeId}";
        }
    }
}

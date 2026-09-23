using System;
using System.Collections.Generic;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 三层场景业务映射目录。该目录只保存稳定 ID 和显式关系，不保存模型名称、层级路径或平台真实设备号。
    /// 正式业务映射未提供前，目录可以保持空内容；空目录不会被误当作已交付映射。
    /// </summary>
    [CreateAssetMenu(fileName = "ThreeLayerBindingCatalog", menuName = "WebDLPro/Three Layer Binding Catalog")]
    public sealed class ThreeLayerBindingCatalog : ScriptableObject
    {
        [SerializeField] private ThreeLayerNodeBinding[] _nodeBindings = Array.Empty<ThreeLayerNodeBinding>();
        [SerializeField] private ThreeLayerPipeBinding[] _pipes = Array.Empty<ThreeLayerPipeBinding>();
        [SerializeField] private ThreeLayerAreaBinding[] _areas = Array.Empty<ThreeLayerAreaBinding>();
        [SerializeField] private ThreeLayerEffectProfileBinding[] _effectProfiles = Array.Empty<ThreeLayerEffectProfileBinding>();
        [SerializeField] private ThreeLayerPipeImpactRule[] _pipeImpactRules = Array.Empty<ThreeLayerPipeImpactRule>();
        [SerializeField] private ThreeLayerAreaImpactRule[] _areaImpactRules = Array.Empty<ThreeLayerAreaImpactRule>();

        public ThreeLayerNodeBinding[] NodeBindings => _nodeBindings ?? Array.Empty<ThreeLayerNodeBinding>();
        public ThreeLayerPipeBinding[] Pipes => _pipes ?? Array.Empty<ThreeLayerPipeBinding>();
        public ThreeLayerAreaBinding[] Areas => _areas ?? Array.Empty<ThreeLayerAreaBinding>();
        public ThreeLayerEffectProfileBinding[] EffectProfiles => _effectProfiles ?? Array.Empty<ThreeLayerEffectProfileBinding>();
        public ThreeLayerPipeImpactRule[] PipeImpactRules => _pipeImpactRules ?? Array.Empty<ThreeLayerPipeImpactRule>();
        public ThreeLayerAreaImpactRule[] AreaImpactRules => _areaImpactRules ?? Array.Empty<ThreeLayerAreaImpactRule>();

        public IReadOnlyList<ThreeLayerBindingValidationIssue> ValidateForRuntime()
        {
            return ThreeLayerBindingCatalogValidator.Validate(this);
        }

#if UNITY_EDITOR
        /// <summary>仅供编辑器导入器和测试夹具整体写入目录，运行时不允许替换正式映射。</summary>
        public void SetEntriesForEditor(
            IReadOnlyList<ThreeLayerNodeBinding> nodeBindings,
            IReadOnlyList<ThreeLayerPipeBinding> pipes,
            IReadOnlyList<ThreeLayerAreaBinding> areas,
            IReadOnlyList<ThreeLayerEffectProfileBinding> effectProfiles,
            IReadOnlyList<ThreeLayerPipeImpactRule> pipeImpactRules,
            IReadOnlyList<ThreeLayerAreaImpactRule> areaImpactRules)
        {
            if (Application.isPlaying)
            {
                throw new InvalidOperationException("运行时不能替换三层业务映射目录。");
            }

            _nodeBindings = Copy(nodeBindings);
            _pipes = Copy(pipes);
            _areas = Copy(areas);
            _effectProfiles = Copy(effectProfiles);
            _pipeImpactRules = Copy(pipeImpactRules);
            _areaImpactRules = Copy(areaImpactRules);
        }
#endif

        private static T[] Copy<T>(IReadOnlyList<T> values)
        {
            if (values == null || values.Count == 0)
            {
                return Array.Empty<T>();
            }

            T[] copy = new T[values.Count];
            for (int index = 0; index < values.Count; index++)
            {
                copy[index] = values[index];
            }
            return copy;
        }
    }

    /// <summary>单个外部 nodeId 到业务场景、三维节点、设备组和总览建筑的显式绑定。</summary>
    [Serializable]
    public sealed class ThreeLayerNodeBinding
    {
        [SerializeField] private string _nodeId;
        [SerializeField] private string _sceneId;
        [SerializeField] private bool _hasSceneTarget;
        [SerializeField] private string _sceneNodeId;
        [SerializeField] private string _deviceGroupId;
        [SerializeField] private bool _hasOverviewTarget;
        [SerializeField] private string _overviewBuildingId;

        public string NodeId => _nodeId;
        public string SceneId => _sceneId;
        public bool HasSceneTarget => _hasSceneTarget;
        public string SceneNodeId => _sceneNodeId;
        public string DeviceGroupId => _deviceGroupId;
        public bool HasOverviewTarget => _hasOverviewTarget;
        public string OverviewBuildingId => _overviewBuildingId;

        public ThreeLayerNodeBinding(
            string nodeId,
            string sceneId,
            bool hasSceneTarget,
            string sceneNodeId,
            string deviceGroupId,
            bool hasOverviewTarget,
            string overviewBuildingId)
        {
            _nodeId = nodeId;
            _sceneId = sceneId;
            _hasSceneTarget = hasSceneTarget;
            _sceneNodeId = sceneNodeId;
            _deviceGroupId = deviceGroupId;
            _hasOverviewTarget = hasOverviewTarget;
            _overviewBuildingId = overviewBuildingId;
        }
    }

    /// <summary>管道和业务路由的一对一稳定绑定；运行时不从 Shader 或 GameObject 名称推断。</summary>
    [Serializable]
    public sealed class ThreeLayerPipeBinding
    {
        [SerializeField] private string _pipeId;
        [SerializeField] private string _routeId;
        [SerializeField] private string _sceneId;

        public string PipeId => _pipeId;
        public string RouteId => _routeId;
        public string SceneId => _sceneId;

        public ThreeLayerPipeBinding(string pipeId, string routeId, string sceneId)
        {
            _pipeId = pipeId;
            _routeId = routeId;
            _sceneId = sceneId;
        }
    }

    /// <summary>区域与效果配置的一对一稳定绑定；具体 Renderer 和材质变体由后续资源任务提供。</summary>
    [Serializable]
    public sealed class ThreeLayerAreaBinding
    {
        [SerializeField] private string _areaId;
        [SerializeField] private string _sceneId;
        [SerializeField] private string _effectProfileId;

        public string AreaId => _areaId;
        public string SceneId => _sceneId;
        public string EffectProfileId => _effectProfileId;

        public ThreeLayerAreaBinding(string areaId, string sceneId, string effectProfileId)
        {
            _areaId = areaId;
            _sceneId = sceneId;
            _effectProfileId = effectProfileId;
        }
    }

    public enum ThreeLayerAreaEffectType
    {
        AreaCover,
        Boundary,
        StaticBlockMarker
    }

    /// <summary>区域效果配置只描述稳定类型，不提前绑定具体材质或区域模型。</summary>
    [Serializable]
    public sealed class ThreeLayerEffectProfileBinding
    {
        [SerializeField] private string _effectProfileId;
        [SerializeField] private ThreeLayerAreaEffectType _effectType;

        public string EffectProfileId => _effectProfileId;
        public ThreeLayerAreaEffectType EffectType => _effectType;

        public ThreeLayerEffectProfileBinding(string effectProfileId, ThreeLayerAreaEffectType effectType)
        {
            _effectProfileId = effectProfileId;
            _effectType = effectType;
        }
    }

    /// <summary>设备组异常到管道路由的显式影响规则。</summary>
    [Serializable]
    public sealed class ThreeLayerPipeImpactRule
    {
        [SerializeField] private string _sourceDeviceGroupId;
        [SerializeField] private string _pipeId;
        [SerializeField] private bool _onAlarm;
        [SerializeField] private bool _onFault;
        [SerializeField] private bool _onOffline;

        public string SourceDeviceGroupId => _sourceDeviceGroupId;
        public string PipeId => _pipeId;
        public bool OnAlarm => _onAlarm;
        public bool OnFault => _onFault;
        public bool OnOffline => _onOffline;

        public ThreeLayerPipeImpactRule(string sourceDeviceGroupId, string pipeId, bool onAlarm, bool onFault, bool onOffline)
        {
            _sourceDeviceGroupId = sourceDeviceGroupId;
            _pipeId = pipeId;
            _onAlarm = onAlarm;
            _onFault = onFault;
            _onOffline = onOffline;
        }
    }

    /// <summary>设备组异常到区域效果的显式影响规则。</summary>
    [Serializable]
    public sealed class ThreeLayerAreaImpactRule
    {
        [SerializeField] private string _sourceDeviceGroupId;
        [SerializeField] private string _areaId;
        [SerializeField] private bool _onAlarm;
        [SerializeField] private bool _onFault;
        [SerializeField] private bool _onOffline;

        public string SourceDeviceGroupId => _sourceDeviceGroupId;
        public string AreaId => _areaId;
        public bool OnAlarm => _onAlarm;
        public bool OnFault => _onFault;
        public bool OnOffline => _onOffline;

        public ThreeLayerAreaImpactRule(string sourceDeviceGroupId, string areaId, bool onAlarm, bool onFault, bool onOffline)
        {
            _sourceDeviceGroupId = sourceDeviceGroupId;
            _areaId = areaId;
            _onAlarm = onAlarm;
            _onFault = onFault;
            _onOffline = onOffline;
        }
    }
}

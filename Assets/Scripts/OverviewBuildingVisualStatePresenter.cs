using System;
using System.Collections.Generic;
using HighlightPlus;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 总览代表建筑的四态视觉呈现器。
/// 仅在播放模式首次收到异常状态时创建一个 HighlightEffect（高亮效果）组件；
/// 正常态和清除态只关闭效果；故障停流仅为显式绑定的电线创建独占运行时材质副本，
/// 不修改共享材质资产，也不会为每次状态更新重复创建组件或材质。
/// </summary>
[DisallowMultipleComponent]
public sealed class OverviewBuildingVisualStatePresenter : MonoBehaviour, IOverviewBuildingVisualStatePresenter
{
    private const float PulseAngularFrequencyMultiplier = Mathf.PI * 2f;
    private static readonly int FlowSpeedPropertyId = Shader.PropertyToID("_FlowSpeed");

    /// <summary>
    /// 单个绑定电线材质槽的运行时实例。
    /// 原共享材质始终只读，故障速度只写入该渲染器独占的材质副本，确保共用材质的其它电线不受影响。
    /// </summary>
    private sealed class FaultFlowMaterialInstance
    {
        public Renderer Renderer;
        public int MaterialIndex;
        public Material OriginalMaterial;
        public Material RuntimeMaterial;
    }

    [SerializeField] private Renderer _targetRenderer;
    [SerializeField] private PowerPlantVisualStateConfig _visualStateConfig;

    [Header("故障联动")]
    [Tooltip("该厂房故障时需要停止流动的电线渲染器。支持显式绑定多条电线；运行时为包含 _FlowSpeed 的材质槽创建渲染器独占副本，不修改共享材质球。")]
    [SerializeField] private Renderer[] _faultFlowRenderers = Array.Empty<Renderer>();
    [Tooltip("总览场景共享的球形脉冲特效管理器。不同厂房通过动态目标接口共用同一个实例。")]
    [SerializeField] private BuildingSphericalPulseEffect _sphericalPulseEffect;
    [Tooltip("故障时加入球形脉冲特效的建筑模型对象组；故障清除时从管理器中逐个删除。支持一座厂房显式绑定多个独立模型。")]
    [SerializeField] private GameObject[] _sphericalPulseTargets = Array.Empty<GameObject>();

    private readonly List<FaultFlowMaterialInstance> _flowMaterialInstances =
        new List<FaultFlowMaterialInstance>();
    private readonly HashSet<Renderer> _registeredFlowRenderers = new HashSet<Renderer>();
    private HighlightEffect _highlightEffect;
    private BusinessSceneNodeVisualState _activeState = BusinessSceneNodeVisualState.Normal;
    private bool _flowMaterialsInitialized;
    private bool _faultResponseActive;
    private bool _released;

    /// <summary>
    /// 切换异常显示。告警和故障使用共享配置的颜色、描边和低频透明覆盖；
    /// 离线尊重现有全局开关，关闭时仅保存状态而不改变建筑外观。
    /// </summary>
    public void ApplyVisualState(BusinessSceneNodeVisualState visualState)
    {
        if (_released)
        {
            return;
        }

        _activeState = visualState;
        // 只有故障状态联动停流与球形脉冲；告警和离线仍沿用原有建筑高亮语义。
        SetFaultResponseActive(visualState == BusinessSceneNodeVisualState.Fault);
        if (visualState == BusinessSceneNodeVisualState.Normal ||
            visualState == BusinessSceneNodeVisualState.Offline &&
            (_visualStateConfig == null || !_visualStateConfig.ShowOfflineState))
        {
            SetHighlightVisible(false);
            return;
        }

        if (_targetRenderer == null || _visualStateConfig == null || !Application.isPlaying)
        {
            return;
        }

        EnsureHighlightEffect();
        Color stateColor = ResolveColor(visualState);
        _highlightEffect.outlineColor = stateColor;
        _highlightEffect.overlayColor = stateColor;
        _highlightEffect.overlay = _visualStateConfig.OverlayOpacity;
        _highlightEffect.SetHighlighted(true);
    }

    /// <summary>清除动态状态并恢复建筑基础视觉；故障停流会恢复原共享材质引用。</summary>
    public void ClearVisualState()
    {
        if (_released)
        {
            return;
        }

        _activeState = BusinessSceneNodeVisualState.Normal;
        SetFaultResponseActive(false);
        SetHighlightVisible(false);
    }

    private void Update()
    {
        if (_highlightEffect == null || !_highlightEffect.highlighted || _visualStateConfig == null)
        {
            return;
        }

        // 仅异常建筑执行闪烁；使用状态配置中的低频参数，避免总览出现高频全屏动画。
        float frequency = _activeState == BusinessSceneNodeVisualState.Fault
            ? _visualStateConfig.FaultFillPulseFrequency
            : _activeState == BusinessSceneNodeVisualState.Alarm
                ? _visualStateConfig.AlarmFillPulseFrequency
                : 0f;
        if (frequency <= 0f)
        {
            return;
        }

        float pulse = 0.5f + 0.5f * Mathf.Sin(Time.time * frequency * PulseAngularFrequencyMultiplier);
        _highlightEffect.overlay = Mathf.Lerp(
            _visualStateConfig.FillPulseMinimumOpacity,
            _visualStateConfig.OverlayOpacity,
            pulse);
    }

    /// <summary>
    /// 释放仅销毁本组件创建的运行时高亮效果，保留目标 Renderer、Collider 和共享配置资产。
    /// </summary>
    public void ReleaseVisualState()
    {
        if (_released)
        {
            return;
        }

        // 先恢复所有故障联动，再标记释放，确保场景卸载时不残留停流材质实例或共享特效目标。
        SetFaultResponseActive(false);
        _released = true;
        if (_highlightEffect != null)
        {
            _highlightEffect.SetHighlighted(false);
            if (Application.isPlaying)
            {
                Destroy(_highlightEffect);
            }
            else
            {
                DestroyImmediate(_highlightEffect);
            }

            _highlightEffect = null;
        }

        ReleaseFlowMaterialInstances();
    }

    /// <summary>
    /// 幂等切换故障联动。重复故障快照不会重复创建材质实例或特效对象，重复清除也不会影响共享材质。
    /// </summary>
    private void SetFaultResponseActive(bool active)
    {
        if (_released || _faultResponseActive == active)
        {
            return;
        }

        _faultResponseActive = active;
        SetFlowStopped(active);
        if (_sphericalPulseEffect == null)
        {
            return;
        }

        // 状态切换并非每帧热路径，直接遍历序列化数组即可；管理器负责忽略空引用和重复目标。
        // 每个模型独立计算包围盒，避免把相距较远的多个模型合并成一个过大的球形效果。
        for (int targetIndex = 0; targetIndex < _sphericalPulseTargets.Length; targetIndex++)
        {
            GameObject sphericalPulseTarget = _sphericalPulseTargets[targetIndex];
            if (active)
            {
                _sphericalPulseEffect.TryAddTarget(sphericalPulseTarget);
            }
            else
            {
                _sphericalPulseEffect.TryRemoveTarget(sphericalPulseTarget);
            }
        }
    }

    /// <summary>
    /// 仅修改已绑定电线渲染器的独占运行时材质实例；共享材质球始终保持原流速。
    /// 清除故障时立即恢复共享材质引用并销毁实例，正常状态不保留额外材质。
    /// </summary>
    private void SetFlowStopped(bool stopped)
    {
        if (!stopped)
        {
            ReleaseFlowMaterialInstances();
            return;
        }

        EnsureFlowMaterialInstances();
        for (int materialIndex = 0; materialIndex < _flowMaterialInstances.Count; materialIndex++)
        {
            Material runtimeMaterial = _flowMaterialInstances[materialIndex].RuntimeMaterial;
            if (runtimeMaterial != null)
            {
                runtimeMaterial.SetFloat(FlowSpeedPropertyId, 0f);
            }
        }
    }

    /// <summary>
    /// 首次故障时为已绑定渲染器中包含 _FlowSpeed 的材质槽创建独占运行时实例。
    /// 每个渲染器只扫描一次，后续状态切换直接写入缓存材质，不查询层级、不接触共享材质。
    /// </summary>
    private void EnsureFlowMaterialInstances()
    {
        if (_flowMaterialsInitialized)
        {
            return;
        }

        _flowMaterialsInitialized = true;
        _registeredFlowRenderers.Clear();
        for (int rendererIndex = 0; rendererIndex < _faultFlowRenderers.Length; rendererIndex++)
        {
            Renderer flowRenderer = _faultFlowRenderers[rendererIndex];
            if (flowRenderer == null || !_registeredFlowRenderers.Add(flowRenderer))
            {
                continue;
            }

            Material[] rendererMaterials = flowRenderer.sharedMaterials;
            bool materialsChanged = false;
            for (int materialIndex = 0; materialIndex < rendererMaterials.Length; materialIndex++)
            {
                Material originalMaterial = rendererMaterials[materialIndex];
                if (originalMaterial == null || !originalMaterial.HasProperty(FlowSpeedPropertyId))
                {
                    continue;
                }

                Material runtimeMaterial = new Material(originalMaterial)
                {
                    name = originalMaterial.name + " (故障停流实例)",
                    hideFlags = HideFlags.DontSave
                };
                rendererMaterials[materialIndex] = runtimeMaterial;
                materialsChanged = true;
                _flowMaterialInstances.Add(new FaultFlowMaterialInstance
                {
                    Renderer = flowRenderer,
                    MaterialIndex = materialIndex,
                    OriginalMaterial = originalMaterial,
                    RuntimeMaterial = runtimeMaterial
                });
            }

            if (materialsChanged)
            {
                // sharedMaterials 在此处仅用于给当前渲染器挂接独占副本，不会修改任何材质资产。
                flowRenderer.sharedMaterials = rendererMaterials;
            }
        }

        if (_faultFlowRenderers.Length > 0 && _flowMaterialInstances.Count == 0)
        {
            Debug.LogWarning(
                $"[{nameof(OverviewBuildingVisualStatePresenter)}] 已绑定电线，但没有材质槽提供 _FlowSpeed 属性。",
                this);
        }
    }

    /// <summary>
    /// 释放故障停流实例。仅当材质槽仍引用本组件创建的副本时才恢复原材质，避免覆盖其它系统的后续替换。
    /// </summary>
    private void ReleaseFlowMaterialInstances()
    {
        for (int bindingIndex = 0; bindingIndex < _flowMaterialInstances.Count; bindingIndex++)
        {
            FaultFlowMaterialInstance binding = _flowMaterialInstances[bindingIndex];
            if (binding.Renderer != null)
            {
                Material[] rendererMaterials = binding.Renderer.sharedMaterials;
                if (binding.MaterialIndex >= 0 &&
                    binding.MaterialIndex < rendererMaterials.Length &&
                    rendererMaterials[binding.MaterialIndex] == binding.RuntimeMaterial)
                {
                    rendererMaterials[binding.MaterialIndex] = binding.OriginalMaterial;
                    binding.Renderer.sharedMaterials = rendererMaterials;
                }
            }

            if (binding.RuntimeMaterial != null)
            {
                if (Application.isPlaying)
                {
                    Destroy(binding.RuntimeMaterial);
                }
                else
                {
                    DestroyImmediate(binding.RuntimeMaterial);
                }
            }
        }

        _flowMaterialInstances.Clear();
        _registeredFlowRenderers.Clear();
        _flowMaterialsInitialized = false;
    }

    private void EnsureHighlightEffect()
    {
        if (_highlightEffect != null)
        {
            return;
        }

        _highlightEffect = gameObject.AddComponent<HighlightEffect>();
        _highlightEffect.hideFlags = HideFlags.DontSave;
        _highlightEffect.profile = null;
        _highlightEffect.profileSync = false;
        _highlightEffect.previewInEditor = false;
        _highlightEffect.camerasLayerMask = -1;
        _highlightEffect.cullBackFaces = true;
        _highlightEffect.constantWidth = true;
        _highlightEffect.fadeInDuration = 0f;
        _highlightEffect.fadeOutDuration = 0f;
        _highlightEffect.outline = 1f;
        _highlightEffect.outlineWidth = _visualStateConfig.OutlineWidth;
        _highlightEffect.outlineQuality = HighlightPlus.QualityLevel.High;
        _highlightEffect.outlineDownsampling = 1;
        _highlightEffect.outlineVisibility = Visibility.Normal;
        _highlightEffect.glow = 0f;
        _highlightEffect.innerGlow = 0f;
        _highlightEffect.overlayAnimationSpeed = 0f;
        _highlightEffect.overlayMinIntensity = 1f;
        _highlightEffect.overlayBlending = 1f;
        _highlightEffect.seeThrough = SeeThroughMode.Never;
        _highlightEffect.SetTargets(transform, new[] { _targetRenderer });
        _highlightEffect.SetHighlighted(false);
        _highlightEffect.Refresh();
    }

    private void SetHighlightVisible(bool visible)
    {
        if (_highlightEffect != null)
        {
            _highlightEffect.SetHighlighted(visible);
        }
    }

    private Color ResolveColor(BusinessSceneNodeVisualState visualState)
    {
        switch (visualState)
        {
            case BusinessSceneNodeVisualState.Fault:
                return _visualStateConfig.FaultColor;
            case BusinessSceneNodeVisualState.Offline:
                return _visualStateConfig.OfflineColor;
            default:
                return _visualStateConfig.AlarmColor;
        }
    }

#if UNITY_EDITOR
    /// <summary>仅供总览生成器绑定既有渲染器和共享状态配置资产。</summary>
    public void ConfigureForEditor(Renderer targetRenderer, PowerPlantVisualStateConfig visualStateConfig)
    {
        if (Application.isPlaying)
        {
            throw new InvalidOperationException("运行时不能修改总览建筑状态呈现配置。");
        }

        _targetRenderer = targetRenderer;
        _visualStateConfig = visualStateConfig;
    }

    /// <summary>
    /// 仅供编辑器场景配置写入故障电线、共享球形脉冲管理器和模型目标组。
    /// 两类数组都按厂房显式绑定，不根据对象名称或距离推断归属。
    /// </summary>
    public void ConfigureFaultResponseForEditor(
        Renderer[] faultFlowRenderers,
        BuildingSphericalPulseEffect sphericalPulseEffect,
        GameObject[] sphericalPulseTargets)
    {
        if (Application.isPlaying)
        {
            throw new InvalidOperationException("运行时不能修改总览建筑故障联动配置。");
        }

        _faultFlowRenderers = faultFlowRenderers ?? Array.Empty<Renderer>();
        _sphericalPulseEffect = sphericalPulseEffect;
        _sphericalPulseTargets = sphericalPulseTargets ?? Array.Empty<GameObject>();
    }
#endif
}

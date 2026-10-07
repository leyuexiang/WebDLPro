using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Scripting;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 第三层设备四态视觉适配器。渲染器数组由编辑器装配工具生成，明确排除右侧透明外壳、
    /// 气流体积和全部粒子渲染器；运行时只更新已缓存材质槽的颜色属性，不创建材质实例。
    /// </summary>
    [Preserve]
    [DisallowMultipleComponent]
    public sealed class ProcessDetailStateVisualAdapter : MonoBehaviour, IProcessDetailVisualStateTarget
    {
        [Header("状态视觉开关")]
        [Tooltip("是否启用告警、故障和离线状态的模型变色。关闭后仍接收状态并控制动态特效，但模型保持基础颜色。")]
        [SerializeField] private bool _enableStateVisuals = true;
        [Tooltip("故障状态是否应用故障颜色。关闭后故障仍参与动态停播，但模型恢复基础颜色。")]
        [SerializeField] private bool _enableFaultVisual = true;

        [Header("状态视觉参数")]
        [SerializeField] private Renderer[] _renderers = Array.Empty<Renderer>();
        [SerializeField, ColorUsage(true, true)] private Color _alarmColor = new Color(1f, 0.69f, 0f, 1f);
        [SerializeField, ColorUsage(true, true)] private Color _faultColor = new Color(1f, 0f, 0.03f, 1f);
        [SerializeField, ColorUsage(true, true)] private Color _offlineColor = new Color(0.6f, 0.64f, 0.7f, 1f);
        [SerializeField, Range(0f, 1f)] private float _tintStrength = 0.72f;

        [Header("故障停流")]
        [Tooltip("故障时经属性块把流光速度立即置零的流光渲染器（材质需带 _FlowSpeed 属性）；恢复正常或清除状态时立即还原材质自身流速。")]
        [SerializeField] private Renderer[] _flowStopRenderers = Array.Empty<Renderer>();

        [Header("故障隐藏")]
        [Tooltip("故障时整体隐藏（渲染器关闭）的对象；恢复正常或清除状态时按制作期状态还原。")]
        [SerializeField] private Renderer[] _faultHiddenRenderers = Array.Empty<Renderer>();

        private static readonly int BaseColorPropertyId = Shader.PropertyToID("_BaseColor");
        private static readonly int AlternateBaseColorPropertyId = Shader.PropertyToID("_BASE_COLOR");
        private static readonly int FlowSpeedPropertyId = Shader.PropertyToID("_FlowSpeed");

        private int[][] _colorPropertyIds;
        private Color[][] _baselineColors;
        private MaterialPropertyBlock _propertyBlock;
        private bool _initialized;
        private bool _released;
        // 故障隐藏渲染器的初始启用状态缓存：恢复时按制作期状态还原，不写死 true。
        private bool[] _faultHiddenInitialEnabled;
        private bool _faultHidden;

        /// <summary>故障隐藏渲染器的当前隐藏状态；供状态模拟面板与测试读取。</summary>
        public bool IsFaultHidden => _faultHidden;

        public BusinessSceneCommandResult ApplyVisualState(BusinessSceneNodeVisualState visualState)
        {
            if (!_enableStateVisuals)
            {
                RestoreBaselineIfInitialized();
                // 状态视觉关闭时故障仍参与动态停播（含流光停流与故障隐藏），与动态停播语义保持一致。
                ApplyFlowStop(visualState == BusinessSceneNodeVisualState.Fault);
                ApplyFaultHidden(visualState == BusinessSceneNodeVisualState.Fault);
                return BusinessSceneCommandResult.Completed("关键环节状态视觉已关闭，模型保持基础颜色。" );
            }

            if (!EnsureInitialized(out string error))
            {
                return BusinessSceneCommandResult.Failed("process-detail-visual-binding-invalid", error);
            }
            if (visualState == BusinessSceneNodeVisualState.Normal ||
                (visualState == BusinessSceneNodeVisualState.Fault && !_enableFaultVisual))
            {
                RestoreBaseline();
                ApplyFlowStop(false);
                ApplyFaultHidden(false);
                return visualState == BusinessSceneNodeVisualState.Fault
                    ? BusinessSceneCommandResult.Completed("关键环节故障变色已关闭，模型保持基础颜色。")
                    : BusinessSceneCommandResult.Completed("关键环节已恢复正常基础视觉。");
            }

            Color stateColor = visualState == BusinessSceneNodeVisualState.Alarm
                ? _alarmColor
                : visualState == BusinessSceneNodeVisualState.Fault
                    ? _faultColor
                    : _offlineColor;
            ApplyTint(stateColor);
            ApplyFlowStop(visualState == BusinessSceneNodeVisualState.Fault);
            ApplyFaultHidden(visualState == BusinessSceneNodeVisualState.Fault);
            return BusinessSceneCommandResult.Completed($"关键环节已更新为 {visualState} 状态视觉。" );
        }

        public BusinessSceneCommandResult ClearVisualState()
        {
            if (!_enableStateVisuals)
            {
                RestoreBaselineIfInitialized();
                ApplyFlowStop(false);
                ApplyFaultHidden(false);
                return BusinessSceneCommandResult.Completed("关键环节状态视觉已关闭，模型保持基础颜色。" );
            }

            if (!EnsureInitialized(out string error))
            {
                return BusinessSceneCommandResult.Failed("process-detail-visual-binding-invalid", error);
            }

            RestoreBaseline();
            ApplyFlowStop(false);
            ApplyFaultHidden(false);
            return BusinessSceneCommandResult.Completed("关键环节已清除动态状态并恢复基础视觉。" );
        }

        public void Release()
        {
            if (_released)
            {
                return;
            }

            if (_initialized)
            {
                RestoreBaseline();
            }
            ApplyFlowStop(false);
            ApplyFaultHidden(false);
            _released = true;
            _colorPropertyIds = null;
            _baselineColors = null;
            _propertyBlock?.Clear();
        }

        private bool EnsureInitialized(out string error)
        {
            error = string.Empty;
            if (_released)
            {
                error = "关键环节状态视觉适配器已经释放。";
                return false;
            }
            if (_initialized)
            {
                return true;
            }
            if (_renderers == null || _renderers.Length == 0)
            {
                error = "关键环节状态视觉适配器没有显式渲染器。";
                return false;
            }

            _propertyBlock = new MaterialPropertyBlock();
            _colorPropertyIds = new int[_renderers.Length][];
            _baselineColors = new Color[_renderers.Length][];
            for (int rendererIndex = 0; rendererIndex < _renderers.Length; rendererIndex++)
            {
                Renderer renderer = _renderers[rendererIndex];
                if (renderer == null)
                {
                    error = "关键环节状态视觉渲染器包含空引用。";
                    return false;
                }

                Material[] materials = renderer.sharedMaterials;
                if (materials == null || materials.Length == 0)
                {
                    error = $"关键环节渲染器 {renderer.name} 没有共享材质。";
                    return false;
                }

                _colorPropertyIds[rendererIndex] = new int[materials.Length];
                _baselineColors[rendererIndex] = new Color[materials.Length];
                for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
                {
                    Material material = materials[materialIndex];
                    int propertyId = ResolveColorPropertyId(material);
                    if (propertyId == 0)
                    {
                        error = $"关键环节材质 {material?.name ?? "<null>"} 不支持已登记颜色属性。";
                        return false;
                    }

                    _colorPropertyIds[rendererIndex][materialIndex] = propertyId;
                    _propertyBlock.Clear();
                    renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                    _baselineColors[rendererIndex][materialIndex] = _propertyBlock.HasColor(propertyId)
                        ? _propertyBlock.GetColor(propertyId)
                        : material.GetColor(propertyId);
                }
            }

            _initialized = true;
            return true;
        }

        private void ApplyTint(Color stateColor)
        {
            float strength = Mathf.Clamp01(_tintStrength);
            for (int rendererIndex = 0; rendererIndex < _renderers.Length; rendererIndex++)
            {
                Renderer renderer = _renderers[rendererIndex];
                for (int materialIndex = 0; materialIndex < _colorPropertyIds[rendererIndex].Length; materialIndex++)
                {
                    Color baseline = _baselineColors[rendererIndex][materialIndex];
                    Color tinted = Color.Lerp(baseline, stateColor, strength);
                    // 状态只改变不透明设备本体的色调，保留每个材质槽原有透明度。
                    tinted.a = baseline.a;
                    _propertyBlock.Clear();
                    renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                    _propertyBlock.SetColor(_colorPropertyIds[rendererIndex][materialIndex], tinted);
                    renderer.SetPropertyBlock(_propertyBlock, materialIndex);
                }
            }
        }

        /// <summary>仅在已经缓存基础颜色后执行恢复，关闭视觉开关时不触发无意义的渲染器初始化。</summary>
        private void RestoreBaselineIfInitialized()
        {
            if (_initialized)
            {
                RestoreBaseline();
            }
        }

        private void RestoreBaseline()
        {
            for (int rendererIndex = 0; rendererIndex < _renderers.Length; rendererIndex++)
            {
                Renderer renderer = _renderers[rendererIndex];
                if (renderer == null)
                {
                    continue;
                }

                for (int materialIndex = 0; materialIndex < _colorPropertyIds[rendererIndex].Length; materialIndex++)
                {
                    _propertyBlock.Clear();
                    renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                    _propertyBlock.SetColor(
                        _colorPropertyIds[rendererIndex][materialIndex],
                        _baselineColors[rendererIndex][materialIndex]);
                    renderer.SetPropertyBlock(_propertyBlock, materialIndex);
                }
            }
        }

        /// <summary>
        /// 故障停流：故障时流光保持原速延迟后按双曲衰减（速度 ∝ 1/时间）逐渐减速，
        /// 视觉为流光沿原方向缓慢减速趋停（无倒流）；恢复正常/清除状态时立即还原材质自身流速。
        /// 速度经属性块下发，不实例化材质、不触碰共享材质资产。
        /// </summary>
        /// <summary>
        /// 故障停流：故障时流光速度立即置为零，恢复正常/清除状态时立即还原材质自身流速。
        /// 速度经属性块下发，不实例化材质、不触碰共享材质资产。
        /// </summary>
        private void ApplyFlowStop(bool stopped)
        {
            if (_flowStopRenderers == null || _flowStopRenderers.Length == 0)
            {
                return;
            }
            if (_propertyBlock == null)
            {
                _propertyBlock = new MaterialPropertyBlock();
            }

            for (int rendererIndex = 0; rendererIndex < _flowStopRenderers.Length; rendererIndex++)
            {
                Renderer flowRenderer = _flowStopRenderers[rendererIndex];
                if (flowRenderer == null || flowRenderer.sharedMaterial == null ||
                    !flowRenderer.sharedMaterial.HasProperty(FlowSpeedPropertyId))
                {
                    continue;
                }

                _propertyBlock.Clear();
                _propertyBlock.SetFloat(FlowSpeedPropertyId,
                    stopped ? 0f : flowRenderer.sharedMaterial.GetFloat(FlowSpeedPropertyId));
                flowRenderer.SetPropertyBlock(_propertyBlock);
            }
        }

        /// <summary>
        /// 故障隐藏：把登记的渲染器整体关闭（renderer.enabled=false），恢复正常/清除状态时还原。
        /// 与流光停流互补——流光停流对基准位有图案的材质生效，故障隐藏对"故障时本就不该显示"的
        /// 对象生效（如偏航方向指示箭头3）。
        /// </summary>
        private void ApplyFaultHidden(bool hidden)
        {
            if (_faultHiddenRenderers == null || _faultHiddenRenderers.Length == 0)
            {
                return;
            }
            for (int rendererIndex = 0; rendererIndex < _faultHiddenRenderers.Length; rendererIndex++)
            {
                Renderer faultHiddenRenderer = _faultHiddenRenderers[rendererIndex];
                if (faultHiddenRenderer == null)
                {
                    continue;
                }
                faultHiddenRenderer.enabled = !hidden;
            }
        }

        private static int ResolveColorPropertyId(Material material)
        {
            if (material == null)
            {
                return 0;
            }
            if (material.HasProperty(BaseColorPropertyId))
            {
                return BaseColorPropertyId;
            }
            return material.HasProperty(AlternateBaseColorPropertyId) ? AlternateBaseColorPropertyId : 0;
        }

#if UNITY_EDITOR
        /// <summary>仅供包装预制体生成器写入已排除透明壳和气流后的稳定数组。</summary>
        public void ConfigureForEditor(
            bool enableStateVisuals,
            bool enableFaultVisual,
            Renderer[] renderers,
            Color alarmColor,
            Color faultColor,
            Color offlineColor,
            float tintStrength)
        {
            _enableStateVisuals = enableStateVisuals;
            _enableFaultVisual = enableFaultVisual;
            _renderers = renderers ?? Array.Empty<Renderer>();
            _alarmColor = alarmColor;
            _faultColor = faultColor;
            _offlineColor = offlineColor;
            _tintStrength = Mathf.Clamp01(tintStrength);
            _initialized = false;
            _released = false;
            _colorPropertyIds = null;
            _baselineColors = null;
        }
#endif
    }
}

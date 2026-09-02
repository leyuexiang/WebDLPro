using System;
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
        [SerializeField] private Renderer[] _renderers = Array.Empty<Renderer>();
        [SerializeField, ColorUsage(true, true)] private Color _alarmColor = new Color(1f, 0.69f, 0f, 1f);
        [SerializeField, ColorUsage(true, true)] private Color _faultColor = new Color(1f, 0f, 0.03f, 1f);
        [SerializeField, ColorUsage(true, true)] private Color _offlineColor = new Color(0.6f, 0.64f, 0.7f, 1f);
        [SerializeField, Range(0f, 1f)] private float _tintStrength = 0.72f;

        private static readonly int BaseColorPropertyId = Shader.PropertyToID("_BaseColor");
        private static readonly int AlternateBaseColorPropertyId = Shader.PropertyToID("_BASE_COLOR");

        private int[][] _colorPropertyIds;
        private Color[][] _baselineColors;
        private MaterialPropertyBlock _propertyBlock;
        private bool _initialized;
        private bool _released;

        public BusinessSceneCommandResult ApplyVisualState(BusinessSceneNodeVisualState visualState)
        {
            if (!EnsureInitialized(out string error))
            {
                return BusinessSceneCommandResult.Failed("process-detail-visual-binding-invalid", error);
            }
            if (visualState == BusinessSceneNodeVisualState.Normal)
            {
                RestoreBaseline();
                return BusinessSceneCommandResult.Completed("关键环节已恢复正常基础视觉。" );
            }

            Color stateColor = visualState == BusinessSceneNodeVisualState.Alarm
                ? _alarmColor
                : visualState == BusinessSceneNodeVisualState.Fault
                    ? _faultColor
                    : _offlineColor;
            ApplyTint(stateColor);
            return BusinessSceneCommandResult.Completed($"关键环节已更新为 {visualState} 状态视觉。" );
        }

        public BusinessSceneCommandResult ClearVisualState()
        {
            if (!EnsureInitialized(out string error))
            {
                return BusinessSceneCommandResult.Failed("process-detail-visual-binding-invalid", error);
            }

            RestoreBaseline();
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
            Renderer[] renderers,
            Color alarmColor,
            Color faultColor,
            Color offlineColor,
            float tintStrength)
        {
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

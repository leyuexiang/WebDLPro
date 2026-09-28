using System;
using UnityEngine;
using UnityEngine.Scripting;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 光伏逆变器第三层动态适配器。故障时将显式绑定的输出线临时染红，并停止材质支持的流动；
/// 正常、告警、离线及清除状态时恢复进入环节前的颜色和流速。
/// </summary>
[Preserve]
[DisallowMultipleComponent]
public sealed class SolarInverterProcessDetailDynamicAdapter : ProcessDetailDynamicTargetBase
{
    [SerializeField] private Renderer[] _wireRenderers = Array.Empty<Renderer>();
    [SerializeField, ColorUsage(true, true)] private Color _faultColor = Color.red;

    private static readonly int FlowSpeedPropertyId = Shader.PropertyToID("_FlowSpeed");
    private static readonly int BaseColorPropertyId = Shader.PropertyToID("_BaseColor");
    private static readonly int AlternateBaseColorPropertyId = Shader.PropertyToID("_BASE_COLOR");

    private MaterialPropertyBlock _propertyBlock;
    private Material[][] _materialsByRenderer;
    private float[][] _baselineSpeeds;
    private bool[][] _hasFlowSpeed;
    private int[][] _colorPropertyIds;
    private Color[][] _baselineColors;
    private bool _initialized;

    protected override void ApplyPlayback(bool playing, bool faultStop)
    {
        if (!EnsureInitialized())
        {
            return;
        }

        for (int rendererIndex = 0; rendererIndex < _wireRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _wireRenderers[rendererIndex];
            Material[] materials = _materialsByRenderer[rendererIndex];
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                if (materials[materialIndex] == null)
                {
                    continue;
                }

                bool hasFlowSpeed = _hasFlowSpeed[rendererIndex][materialIndex];
                int colorPropertyId = _colorPropertyIds[rendererIndex][materialIndex];
                if (!hasFlowSpeed && colorPropertyId == 0)
                {
                    continue;
                }

                _propertyBlock.Clear();
                renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                if (hasFlowSpeed)
                {
                    _propertyBlock.SetFloat(
                        FlowSpeedPropertyId,
                        faultStop ? 0f : _baselineSpeeds[rendererIndex][materialIndex]);
                }
                if (colorPropertyId != 0)
                {
                    Color color = faultStop ? _faultColor : _baselineColors[rendererIndex][materialIndex];
                    color.a = _baselineColors[rendererIndex][materialIndex].a;
                    _propertyBlock.SetColor(colorPropertyId, color);
                }
                renderer.SetPropertyBlock(_propertyBlock, materialIndex);
            }
        }
    }

    protected override void OnReleased()
    {
        RestoreBaseline();
        _baselineSpeeds = null;
        _materialsByRenderer = null;
        _hasFlowSpeed = null;
        _colorPropertyIds = null;
        _baselineColors = null;
        _propertyBlock?.Clear();
        _initialized = false;
    }

    private bool EnsureInitialized()
    {
        if (_initialized)
        {
            return true;
        }
        if (_wireRenderers == null || _wireRenderers.Length == 0)
        {
            Debug.LogError($"[{nameof(SolarInverterProcessDetailDynamicAdapter)}] 未绑定电线渲染器。", this);
            return false;
        }

        _propertyBlock = new MaterialPropertyBlock();
        _baselineSpeeds = new float[_wireRenderers.Length][];
        _materialsByRenderer = new Material[_wireRenderers.Length][];
        _hasFlowSpeed = new bool[_wireRenderers.Length][];
        _colorPropertyIds = new int[_wireRenderers.Length][];
        _baselineColors = new Color[_wireRenderers.Length][];
        for (int rendererIndex = 0; rendererIndex < _wireRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _wireRenderers[rendererIndex];
            if (renderer == null)
            {
                Debug.LogError($"[{nameof(SolarInverterProcessDetailDynamicAdapter)}] 电线渲染器包含空引用。", this);
                return false;
            }

            Material[] materials = renderer.sharedMaterials;
            _materialsByRenderer[rendererIndex] = materials;
            _baselineSpeeds[rendererIndex] = new float[materials.Length];
            _hasFlowSpeed[rendererIndex] = new bool[materials.Length];
            _colorPropertyIds[rendererIndex] = new int[materials.Length];
            _baselineColors[rendererIndex] = new Color[materials.Length];
            bool hasEffectSlot = false;
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                Material material = materials[materialIndex];
                if (material == null)
                {
                    continue;
                }

                if (material.HasProperty(FlowSpeedPropertyId))
                {
                    hasEffectSlot = true;
                    _hasFlowSpeed[rendererIndex][materialIndex] = true;
                    _propertyBlock.Clear();
                    renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                    _baselineSpeeds[rendererIndex][materialIndex] = _propertyBlock.HasFloat(FlowSpeedPropertyId)
                        ? _propertyBlock.GetFloat(FlowSpeedPropertyId)
                        : material.GetFloat(FlowSpeedPropertyId);
                }

                int colorPropertyId = ResolveColorPropertyId(material);
                if (colorPropertyId != 0)
                {
                    hasEffectSlot = true;
                    _colorPropertyIds[rendererIndex][materialIndex] = colorPropertyId;
                    _propertyBlock.Clear();
                    renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                    _baselineColors[rendererIndex][materialIndex] = _propertyBlock.HasColor(colorPropertyId)
                        ? _propertyBlock.GetColor(colorPropertyId)
                        : material.GetColor(colorPropertyId);
                }
            }

            if (!hasEffectSlot)
            {
                Debug.LogError($"[{nameof(SolarInverterProcessDetailDynamicAdapter)}] {renderer.name} 没有可用于停流或故障变色的材质属性。", renderer);
                return false;
            }
        }

        _initialized = true;
        return true;
    }

    private void RestoreBaseline()
    {
        if (!_initialized || _wireRenderers == null)
        {
            return;
        }

        for (int rendererIndex = 0; rendererIndex < _wireRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _wireRenderers[rendererIndex];
            if (renderer == null)
            {
                continue;
            }

            Material[] materials = _materialsByRenderer[rendererIndex];
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                if (materials[materialIndex] == null ||
                    (!_hasFlowSpeed[rendererIndex][materialIndex] && _colorPropertyIds[rendererIndex][materialIndex] == 0))
                {
                    continue;
                }

                _propertyBlock.Clear();
                renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                if (_hasFlowSpeed[rendererIndex][materialIndex])
                {
                    _propertyBlock.SetFloat(FlowSpeedPropertyId, _baselineSpeeds[rendererIndex][materialIndex]);
                }
                int colorPropertyId = _colorPropertyIds[rendererIndex][materialIndex];
                if (colorPropertyId != 0)
                {
                    _propertyBlock.SetColor(colorPropertyId, _baselineColors[rendererIndex][materialIndex]);
                }
                renderer.SetPropertyBlock(_propertyBlock, materialIndex);
            }
        }
    }

    private static int ResolveColorPropertyId(Material material)
    {
        if (material.HasProperty(BaseColorPropertyId))
        {
            return BaseColorPropertyId;
        }
        return material.HasProperty(AlternateBaseColorPropertyId) ? AlternateBaseColorPropertyId : 0;
    }

#if UNITY_EDITOR
    public void ConfigureForEditor(Renderer[] wireRenderers, Color faultColor)
    {
        _wireRenderers = wireRenderers ?? Array.Empty<Renderer>();
        _faultColor = faultColor;
        _baselineSpeeds = null;
        _materialsByRenderer = null;
        _hasFlowSpeed = null;
        _colorPropertyIds = null;
        _baselineColors = null;
        _initialized = false;
        ResetPlaybackStateForEditor();
    }
#endif
}

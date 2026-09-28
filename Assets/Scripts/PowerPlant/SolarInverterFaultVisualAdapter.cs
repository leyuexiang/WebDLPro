using System;
using UnityEngine;
using UnityEngine.Scripting;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 光伏逆变器故障视觉适配器。仅处理显式绑定设备 Renderer 中支持底色属性的材质槽，
/// 故障时临时覆盖为红色，其他状态及清除状态均恢复进入环节前的原始颜色。
/// </summary>
[Preserve]
[DisallowMultipleComponent]
public sealed class SolarInverterFaultVisualAdapter : MonoBehaviour, IProcessDetailVisualStateTarget
{
    [SerializeField] private Renderer[] _equipmentRenderers = Array.Empty<Renderer>();
    [SerializeField, ColorUsage(true, true)] private Color _faultColor = Color.red;

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
            return BusinessSceneCommandResult.Failed("solar-inverter-visual-binding-invalid", error);
        }

        if (visualState == BusinessSceneNodeVisualState.Fault)
        {
            ApplyFaultColor();
            return BusinessSceneCommandResult.Completed("逆变器及汇流箱设备已切换为故障红色。");
        }

        RestoreBaseline();
        return BusinessSceneCommandResult.Completed("逆变器及汇流箱设备已恢复默认材质状态。");
    }

    public BusinessSceneCommandResult ClearVisualState()
    {
        if (!EnsureInitialized(out string error))
        {
            return BusinessSceneCommandResult.Failed("solar-inverter-visual-binding-invalid", error);
        }

        RestoreBaseline();
        return BusinessSceneCommandResult.Completed("逆变器及汇流箱故障视觉已清除。");
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
            error = "逆变器故障视觉适配器已经释放。";
            return false;
        }
        if (_initialized)
        {
            return true;
        }
        if (_equipmentRenderers == null || _equipmentRenderers.Length == 0)
        {
            error = "逆变器故障视觉没有显式绑定设备渲染器。";
            return false;
        }

        _propertyBlock = new MaterialPropertyBlock();
        _colorPropertyIds = new int[_equipmentRenderers.Length][];
        _baselineColors = new Color[_equipmentRenderers.Length][];
        for (int rendererIndex = 0; rendererIndex < _equipmentRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _equipmentRenderers[rendererIndex];
            if (renderer == null)
            {
                error = "逆变器故障视觉渲染器包含空引用。";
                return false;
            }

            Material[] materials = renderer.sharedMaterials;
            _colorPropertyIds[rendererIndex] = new int[materials.Length];
            _baselineColors[rendererIndex] = new Color[materials.Length];
            int supportedSlotCount = 0;
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                Material material = materials[materialIndex];
                int colorPropertyId = ResolveColorPropertyId(material);
                if (colorPropertyId == 0)
                {
                    continue;
                }

                supportedSlotCount++;
                _colorPropertyIds[rendererIndex][materialIndex] = colorPropertyId;
                _propertyBlock.Clear();
                renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                _baselineColors[rendererIndex][materialIndex] = _propertyBlock.HasColor(colorPropertyId)
                    ? _propertyBlock.GetColor(colorPropertyId)
                    : material.GetColor(colorPropertyId);
            }

            if (supportedSlotCount == 0)
            {
                error = $"设备 {renderer.name} 没有支持底色属性的材质槽。";
                return false;
            }
        }

        _initialized = true;
        return true;
    }

    private void ApplyFaultColor()
    {
        for (int rendererIndex = 0; rendererIndex < _equipmentRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _equipmentRenderers[rendererIndex];
            for (int materialIndex = 0; materialIndex < _colorPropertyIds[rendererIndex].Length; materialIndex++)
            {
                int colorPropertyId = _colorPropertyIds[rendererIndex][materialIndex];
                if (colorPropertyId == 0)
                {
                    continue;
                }

                Color color = _faultColor;
                color.a = _baselineColors[rendererIndex][materialIndex].a;
                _propertyBlock.Clear();
                renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                _propertyBlock.SetColor(colorPropertyId, color);
                renderer.SetPropertyBlock(_propertyBlock, materialIndex);
            }
        }
    }

    private void RestoreBaseline()
    {
        for (int rendererIndex = 0; rendererIndex < _equipmentRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _equipmentRenderers[rendererIndex];
            if (renderer == null)
            {
                continue;
            }

            for (int materialIndex = 0; materialIndex < _colorPropertyIds[rendererIndex].Length; materialIndex++)
            {
                int colorPropertyId = _colorPropertyIds[rendererIndex][materialIndex];
                if (colorPropertyId == 0)
                {
                    continue;
                }

                _propertyBlock.Clear();
                renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                _propertyBlock.SetColor(colorPropertyId, _baselineColors[rendererIndex][materialIndex]);
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
    /// <summary>编辑器生成器显式绑定目标设备渲染器和故障色，不依赖 FBX 材质槽排序。</summary>
    public void ConfigureForEditor(Renderer[] equipmentRenderers, Color faultColor)
    {
        _equipmentRenderers = equipmentRenderers ?? Array.Empty<Renderer>();
        _faultColor = faultColor;
        _colorPropertyIds = null;
        _baselineColors = null;
        _initialized = false;
        _released = false;
    }
#endif
}

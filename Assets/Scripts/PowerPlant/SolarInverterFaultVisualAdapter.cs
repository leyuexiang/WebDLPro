using System;
using UnityEngine;
using UnityEngine.Scripting;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 光伏逆变器故障视觉适配器。仅改变显式绑定 Renderer 的“材质.002”槽，
/// 故障时覆盖为红色，其他状态及清除状态均恢复进入环节前的原始颜色。
/// </summary>
[Preserve]
[DisallowMultipleComponent]
public sealed class SolarInverterFaultVisualAdapter : MonoBehaviour, IProcessDetailVisualStateTarget
{
    [SerializeField] private Renderer[] _inverterRenderers = Array.Empty<Renderer>();
    [SerializeField] private string _targetMaterialName = "材质.002";
    [SerializeField, ColorUsage(true, true)] private Color _faultColor = Color.red;

    private static readonly int BaseColorPropertyId = Shader.PropertyToID("_BaseColor");
    private static readonly int AlternateBaseColorPropertyId = Shader.PropertyToID("_BASE_COLOR");

    private int[] _materialIndices;
    private int[] _colorPropertyIds;
    private Color[] _baselineColors;
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
            return BusinessSceneCommandResult.Completed("逆变器材质.002已切换为故障红色。");
        }

        RestoreBaseline();
        return BusinessSceneCommandResult.Completed("逆变器保持默认材质状态。");
    }

    public BusinessSceneCommandResult ClearVisualState()
    {
        if (!EnsureInitialized(out string error))
        {
            return BusinessSceneCommandResult.Failed("solar-inverter-visual-binding-invalid", error);
        }

        RestoreBaseline();
        return BusinessSceneCommandResult.Completed("逆变器故障视觉已清除。");
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
        _materialIndices = null;
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
        if (_inverterRenderers == null || _inverterRenderers.Length == 0 || string.IsNullOrWhiteSpace(_targetMaterialName))
        {
            error = "逆变器故障视觉缺少渲染器或目标材质名称。";
            return false;
        }

        _propertyBlock = new MaterialPropertyBlock();
        _materialIndices = new int[_inverterRenderers.Length];
        _colorPropertyIds = new int[_inverterRenderers.Length];
        _baselineColors = new Color[_inverterRenderers.Length];
        for (int rendererIndex = 0; rendererIndex < _inverterRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _inverterRenderers[rendererIndex];
            if (renderer == null)
            {
                error = "逆变器故障视觉渲染器包含空引用。";
                return false;
            }

            Material[] materials = renderer.sharedMaterials;
            int targetIndex = FindTargetMaterialIndex(materials);
            if (targetIndex < 0)
            {
                error = $"逆变器 {renderer.name} 未找到目标材质槽 {_targetMaterialName}。";
                return false;
            }

            Material targetMaterial = materials[targetIndex];
            int colorPropertyId = ResolveColorPropertyId(targetMaterial);
            if (colorPropertyId == 0)
            {
                error = $"逆变器材质 {targetMaterial.name} 不支持基础色属性。";
                return false;
            }

            _materialIndices[rendererIndex] = targetIndex;
            _colorPropertyIds[rendererIndex] = colorPropertyId;
            _propertyBlock.Clear();
            renderer.GetPropertyBlock(_propertyBlock, targetIndex);
            _baselineColors[rendererIndex] = _propertyBlock.HasColor(colorPropertyId)
                ? _propertyBlock.GetColor(colorPropertyId)
                : targetMaterial.GetColor(colorPropertyId);
        }

        _initialized = true;
        return true;
    }

    private int FindTargetMaterialIndex(Material[] materials)
    {
        for (int materialIndex = 0; materials != null && materialIndex < materials.Length; materialIndex++)
        {
            Material material = materials[materialIndex];
            if (material != null && string.Equals(material.name, _targetMaterialName, StringComparison.Ordinal))
            {
                return materialIndex;
            }
        }
        return -1;
    }

    private void ApplyFaultColor()
    {
        for (int rendererIndex = 0; rendererIndex < _inverterRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _inverterRenderers[rendererIndex];
            int materialIndex = _materialIndices[rendererIndex];
            int propertyId = _colorPropertyIds[rendererIndex];
            Color color = _faultColor;
            color.a = _baselineColors[rendererIndex].a;
            _propertyBlock.Clear();
            renderer.GetPropertyBlock(_propertyBlock, materialIndex);
            _propertyBlock.SetColor(propertyId, color);
            renderer.SetPropertyBlock(_propertyBlock, materialIndex);
        }
    }

    private void RestoreBaseline()
    {
        for (int rendererIndex = 0; rendererIndex < _inverterRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _inverterRenderers[rendererIndex];
            if (renderer == null)
            {
                continue;
            }

            int materialIndex = _materialIndices[rendererIndex];
            _propertyBlock.Clear();
            renderer.GetPropertyBlock(_propertyBlock, materialIndex);
            _propertyBlock.SetColor(_colorPropertyIds[rendererIndex], _baselineColors[rendererIndex]);
            renderer.SetPropertyBlock(_propertyBlock, materialIndex);
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
    public void ConfigureForEditor(
        Renderer[] inverterRenderers,
        string targetMaterialName,
        Color faultColor)
    {
        _inverterRenderers = inverterRenderers ?? Array.Empty<Renderer>();
        _targetMaterialName = targetMaterialName;
        _faultColor = faultColor;
        _materialIndices = null;
        _colorPropertyIds = null;
        _baselineColors = null;
        _initialized = false;
        _released = false;
    }
#endif
}

using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Scripting;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 光伏逆变器故障视觉适配器。故障时向显式绑定设备渲染器写入红色自发光（外发光高亮），
/// 不改变本色；恢复或清除状态时移除自发光覆盖。
/// </summary>
[Preserve]
[DisallowMultipleComponent]
public sealed class SolarInverterFaultVisualAdapter : MonoBehaviour, IProcessDetailVisualStateTarget
{
    [SerializeField] private Renderer[] _equipmentRenderers = Array.Empty<Renderer>();
    [SerializeField, ColorUsage(true, true)] private Color _faultColor = Color.red;

    private static readonly int EmissionColorPropertyId = Shader.PropertyToID("_EmissionColor");

    private readonly List<Renderer> _activeRenderers = new List<Renderer>();
    private readonly List<int[]> _activeMaterialIndices = new List<int[]>();
    private MaterialPropertyBlock _propertyBlock;
    private bool _initialized;
    private bool _released;
    private bool _faultActive;

    public BusinessSceneCommandResult ApplyVisualState(BusinessSceneNodeVisualState visualState)
    {
        if (!EnsureInitialized(out string error))
        {
            return BusinessSceneCommandResult.Failed("solar-inverter-visual-binding-invalid", error);
        }

        if (visualState == BusinessSceneNodeVisualState.Fault)
        {
            ApplyFaultGlow();
            return BusinessSceneCommandResult.Completed("逆变器及汇流箱设备已切换为故障红色外发光。");
        }

        ClearFaultGlow();
        return BusinessSceneCommandResult.Completed("逆变器及汇流箱设备已恢复默认发光状态。");
    }

    public BusinessSceneCommandResult ClearVisualState()
    {
        if (!EnsureInitialized(out string error))
        {
            return BusinessSceneCommandResult.Failed("solar-inverter-visual-binding-invalid", error);
        }

        ClearFaultGlow();
        return BusinessSceneCommandResult.Completed("逆变器及汇流箱故障视觉已清除。");
    }

    public void Release()
    {
        if (_released) return;
        ClearFaultGlow();
        _released = true;
        _activeRenderers.Clear();
        _activeMaterialIndices.Clear();
        _propertyBlock = null;
    }

    /// <summary>初始化：收集全部有效目标渲染器（不过滤材质属性，确保新模型也能参与发光高亮）。</summary>
    private bool EnsureInitialized(out string error)
    {
        error = string.Empty;
        if (_released)
        {
            error = "逆变器故障视觉适配器已经释放。";
            return false;
        }
        if (_initialized) return true;

        if (_equipmentRenderers == null || _equipmentRenderers.Length == 0)
        {
            error = "逆变器故障视觉没有显式绑定设备渲染器。";
            return false;
        }

        _propertyBlock = new MaterialPropertyBlock();
        for (int i = 0; i < _equipmentRenderers.Length; i++)
        {
            var renderer = _equipmentRenderers[i];
            if (renderer == null)
            {
                error = $"逆变器故障视觉渲染器包含空引用（索引 {i}）。";
                return false;
            }
            _activeRenderers.Add(renderer);
        }

        _initialized = true;
        return true;
    }

    /// <summary>故障高亮：通过材质属性块向所有目标渲染器写入红色自发光。</summary>
    private void ApplyFaultGlow()
    {
        _faultActive = true;
        _propertyBlock.SetColor(EmissionColorPropertyId, _faultColor);
        foreach (var renderer in _activeRenderers)
        {
            if (renderer == null) continue;
            renderer.SetPropertyBlock(_propertyBlock);
        }
    }

    /// <summary>恢复正常：清除全部目标渲染器上的自发光覆盖。</summary>
    private void ClearFaultGlow()
    {
        _faultActive = false;
        _propertyBlock.Clear();
        foreach (var renderer in _activeRenderers)
        {
            if (renderer == null) continue;
            renderer.SetPropertyBlock(_propertyBlock);
        }
    }

#if UNITY_EDITOR
    /// <summary>编辑器生成器显式绑定目标设备渲染器和故障色，不依赖 FBX 材质槽排序。</summary>
    public void ConfigureForEditor(Renderer[] equipmentRenderers, Color faultColor)
    {
        _equipmentRenderers = equipmentRenderers ?? Array.Empty<Renderer>();
        _faultColor = faultColor;
        _initialized = false;
        _released = false;
        _activeRenderers.Clear();
        _activeMaterialIndices.Clear();
    }
#endif
}

using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Scripting;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 光伏逆变器故障视觉适配器。故障时向显式绑定设备渲染器按材质槽写入红色底色并按周期闪烁；
/// 不改变本色；恢复或清除状态时还原各材质槽基础颜色并停止闪烁。
/// 注意：不能走 _EmissionColor 自发光路线——逆变器 FBX 导入的 URP/Lit 材质未启用 _EMISSION
/// 关键字，发光色会被渲染器整体忽略，因此这里与四态适配器一致走底色属性块。
/// </summary>
[Preserve]
[DisallowMultipleComponent]
public sealed class SolarInverterFaultVisualAdapter : MonoBehaviour, IProcessDetailVisualStateTarget
{
    [SerializeField] private Renderer[] _equipmentRenderers = Array.Empty<Renderer>();
    [SerializeField, ColorUsage(true, true)] private Color _faultColor = Color.red;

    private static readonly int BaseColorPropertyId = Shader.PropertyToID("_BaseColor");
    private static readonly int AlternateBaseColorPropertyId = Shader.PropertyToID("_BASE_COLOR");

    // 每渲染器每材质槽：颜色属性 Id 与基础颜色；0 表示该槽没有可用底色属性，闪烁时跳过。
    private int[][] _colorPropertyIds;
    private Color[][] _baselineColors;
    private MaterialPropertyBlock _propertyBlock;
    private bool _initialized;
    private bool _released;
    private bool _faultActive;
    private Coroutine _blinkRoutine;
    private float _blinkStrength = 1f;

    /// <summary>当前闪烁强度（0.35~1）；供测试与验证面板读取，用于推算期望颜色。</summary>
    public float CurrentBlinkStrength => _blinkStrength;

    /// <summary>配置的故障色只读入口；供测试按强度推算期望闪烁颜色。</summary>
    public Color FaultColor => _faultColor;

    public BusinessSceneCommandResult ApplyVisualState(BusinessSceneNodeVisualState visualState)
    {
        if (!EnsureInitialized(out string error))
        {
            return BusinessSceneCommandResult.Failed("solar-inverter-visual-binding-invalid", error);
        }

        if (visualState == BusinessSceneNodeVisualState.Fault)
        {
            ApplyFaultGlow();
            return BusinessSceneCommandResult.Completed("逆变器及汇流箱设备已切换为故障红色闪烁高亮。");
        }

        ClearFaultGlow();
        return BusinessSceneCommandResult.Completed("逆变器及汇流箱设备已恢复默认基础颜色。");
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
        _colorPropertyIds = null;
        _baselineColors = null;
        _propertyBlock = null;
    }

    private void OnEnable()
    {
        // 提交阶段会在实例 Root.SetActive(true) 之前重放故障状态；未激活对象上协程无法启动，
        // 这里在激活时补启，保证"先故障后进入"的环节进入后立即闪烁。
        if (_faultActive)
        {
            TryStartBlinkRoutine();
        }
    }

    /// <summary>初始化：解析每个设备渲染器各材质槽的底色属性并缓存基础颜色。</summary>
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
        _colorPropertyIds = new int[_equipmentRenderers.Length][];
        _baselineColors = new Color[_equipmentRenderers.Length][];
        for (int rendererIndex = 0; rendererIndex < _equipmentRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _equipmentRenderers[rendererIndex];
            if (renderer == null)
            {
                error = $"逆变器故障视觉渲染器包含空引用（索引 {rendererIndex}）。";
                return false;
            }

            Material[] materials = renderer.sharedMaterials;
            if (materials == null || materials.Length == 0)
            {
                error = $"逆变器故障视觉渲染器 {renderer.name} 没有共享材质。";
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
                    error = $"逆变器故障视觉材质 {material?.name ?? "<null>"} 不支持底色属性。";
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

    /// <summary>故障高亮：标记故障、同步写入首帧颜色并启动闪烁协程；实例未激活时由 OnEnable 补启。</summary>
    private void ApplyFaultGlow()
    {
        _faultActive = true;
        // 协程只在激活实例上运行；隐藏加载或编辑器测试中没有协程，状态应用时必须同步落一次颜色，
        // 否则进入提交前重放的故障状态在下一帧之前没有任何视觉。
        _blinkStrength = ComputeBlink();
        if (_initialized)
        {
            ApplyBlinkColor(_blinkStrength);
        }
        TryStartBlinkRoutine();
    }

    private void TryStartBlinkRoutine()
    {
        if (_blinkRoutine == null && isActiveAndEnabled)
        {
            _blinkRoutine = StartCoroutine(FaultBlinkRoutine());
        }
    }

    private static float ComputeBlink()
    {
        // 0.4 秒周期呼吸：强度在 0.35 与 1 之间平滑波动，人眼读作持续闪烁。
        return 0.35f + 0.65f * Mathf.Abs(Mathf.Sin(Time.time * Mathf.PI / 0.4f));
    }

    /// <summary>故障闪烁协程：红色底色按正弦呼吸式明暗变化，直到故障解除。</summary>
    private IEnumerator FaultBlinkRoutine()
    {
        if (!_initialized)
        {
            _blinkRoutine = null;
            yield break;
        }
        while (_faultActive)
        {
            _blinkStrength = ComputeBlink();
            ApplyBlinkColor(_blinkStrength);
            yield return null;
        }
        _blinkRoutine = null;
    }

    /// <summary>按材质槽写入故障色×闪烁强度；保留各槽基础透明度，不覆盖属性块中的其它属性。</summary>
    private void ApplyBlinkColor(float blink)
    {
        for (int rendererIndex = 0; rendererIndex < _equipmentRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _equipmentRenderers[rendererIndex];
            if (renderer == null) continue;
            for (int materialIndex = 0; materialIndex < _colorPropertyIds[rendererIndex].Length; materialIndex++)
            {
                Color baseline = _baselineColors[rendererIndex][materialIndex];
                Color blinkColor = new Color(
                    _faultColor.r * blink,
                    _faultColor.g * blink,
                    _faultColor.b * blink,
                    baseline.a);
                _propertyBlock.Clear();
                renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                _propertyBlock.SetColor(_colorPropertyIds[rendererIndex][materialIndex], blinkColor);
                renderer.SetPropertyBlock(_propertyBlock, materialIndex);
            }
        }
    }

    /// <summary>恢复正常：停止闪烁并把全部目标材质槽还原为登记时的基础颜色。</summary>
    private void ClearFaultGlow()
    {
        _faultActive = false;
        if (_blinkRoutine != null)
        {
            StopCoroutine(_blinkRoutine);
            _blinkRoutine = null;
        }
        _blinkStrength = 0f;
        if (!_initialized || _equipmentRenderers == null)
        {
            return;
        }

        for (int rendererIndex = 0; rendererIndex < _equipmentRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _equipmentRenderers[rendererIndex];
            if (renderer == null) continue;
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
    /// <summary>编辑器生成器显式绑定目标设备渲染器和故障色，不依赖 FBX 材质槽排序。</summary>
    public void ConfigureForEditor(Renderer[] equipmentRenderers, Color faultColor)
    {
        _equipmentRenderers = equipmentRenderers ?? Array.Empty<Renderer>();
        _faultColor = faultColor;
        _initialized = false;
        _released = false;
        _colorPropertyIds = null;
        _baselineColors = null;
        _faultActive = false;
        _blinkRoutine = null;
        _blinkStrength = 0f;
    }
#endif
}
